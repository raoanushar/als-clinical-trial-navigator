const fs = require("node:fs/promises");
const path = require("node:path");
const { syncTrials } = require("../server");
const { VERSION, TARGET_STATUSES, schema, sourceFor, sourceHash, validateReport, readStore, enrichDataset } = require("../trial-targeting");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : root, "data");
const model = process.env.TARGETING_AGENT_MODEL || "gpt-5.4";
const activeStatuses = new Set(TARGET_STATUSES);

async function loadEnv() {
  let content;
  try { content = await fs.readFile(path.join(root, ".env"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

async function atomicWrite(filename, payload) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2));
  await fs.rename(temporary, filename);
}

async function screen(trial, prompt) {
  let lastError;
  let correction = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, response_format: { type: "json_schema", json_schema: { name: "trial_targeting", strict: true, schema } },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify({ nctId: trial.nctId, sources: sourceFor(trial), correction }) },
            ...(lastError ? [{ role: "user", content: `The previous extraction failed validation: ${lastError.message}. Re-read the original sources and return a corrected extraction with exact evidence.` }] : []),
          ],
        }),
      });
      if (!response.ok) {
        // Do not include request headers or credentials in errors.
        const error = new Error(`Targeting model request returned HTTP ${response.status}`);
        error.fatal = [400, 401, 403, 404].includes(response.status);
        throw error;
      }
      const payload = await response.json();
      const choice = payload.choices?.[0];
      if (choice?.finish_reason !== "stop" || !choice.message?.content) throw new Error("Incomplete targeting model response");
      try {
        return validateReport(JSON.parse(choice.message.content), trial);
      } catch (error) {
        error.invalidResponse = choice.message.content;
        throw error;
      }
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
      correction = `The previous response failed validation: ${error.message}. Re-read every rule and copy all evidence quotes exactly from the supplied source fields.`;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function main() {
  await loadEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
  if (!(limit > 0)) throw new Error("--limit must be positive");
  await fs.mkdir(dataDir, { recursive: true });
  // Exclusive lock prevents overlapping runners from losing checkpointed results.
  const lockPath = path.join(dataDir, "targeting-screen.lock");
  const lock = await fs.open(lockPath, "wx");
  try {
    await lock.writeFile(String(process.pid));
    const prompt = await fs.readFile(path.join(root, "prompts/trial-targeting-agent-prompt.txt"), "utf8");
    const promptHash = require("node:crypto").createHash("sha256").update(prompt).digest("hex");
    let dataset = JSON.parse(await fs.readFile(path.join(dataDir, "trials-cache.json"), "utf8"));
    if (args.includes("--refresh") || dataset.trials.some((trial) => !("eligibilityCriteria" in trial))) {
      console.log("Refreshing registry data to retain complete eligibility and arm text...");
      dataset = await syncTrials();
    }
    const store = await readStore(dataDir);
    const selected = dataset.trials.filter((trial) => activeStatuses.has(trial.status));
    let revalidated = 0;
    for (const trial of selected) {
      const existing = store.analysesByNctId[trial.nctId];
      if (existing?.version === VERSION && existing.sourceHash === sourceHash(trial)) {
        validateReport(existing, trial);
        revalidated++;
      }
    }
    if (revalidated) await atomicWrite(path.join(dataDir, "targeting-analyses.json"), store);
    const pending = (args.includes("--export-only") ? [] : selected.filter((trial) => {
      const existing = store.analysesByNctId[trial.nctId];
      return args.includes("--force") || !existing || existing.version !== VERSION || existing.promptHash !== promptHash || existing.sourceHash !== sourceHash(trial);
    })).slice(0, limit);
    const statusCounts = Object.fromEntries(TARGET_STATUSES.map((status) => [status, selected.filter((trial) => trial.status === status).length]));
    console.log(JSON.stringify({ selected: selected.length, statusCounts, revalidated, pending: pending.length, model }));
    if (args.includes("--dry-run")) return;
    let completed = 0;
    const errors = [];
    let nextIndex = 0;
    let checkpoint = Promise.resolve();
    let fatalError = null;
    async function worker() {
    while (nextIndex < pending.length && !fatalError) {
      const trial = pending[nextIndex++];
      try {
        const report = await screen(trial, prompt);
        store.analysesByNctId[trial.nctId] = {
          ...report, version: VERSION, sourceHash: sourceHash(trial), promptHash, model,
          analyzedAt: new Date().toISOString(), sourceUpdatedAt: trial.updatedAt,
          sourceUrl: trial.url, sources: sourceFor(trial),
        };
        store.version = VERSION;
        checkpoint = checkpoint.then(() => atomicWrite(path.join(dataDir, "targeting-analyses.json"), store));
        await checkpoint;
        completed++;
        console.log(`${completed}/${pending.length} ${trial.nctId}: ${report.findings.length} findings${report.needsReview ? " (review)" : ""}`);
      } catch (error) {
        errors.push({ nctId: trial.nctId, error: error.message });
        console.error(`${trial.nctId}: ${error.message}`);
        if (args.includes("--debug") && error.invalidResponse) console.error(error.invalidResponse);
        if (error.fatal) fatalError = error;
      }
    }
    }
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()));
    const enriched = await enrichDataset({ ...dataset, trials: selected, totalIndexed: selected.length, stats: undefined }, dataDir);
    const reportDir = path.join(root, "reports", "trial-targeting");
    await fs.mkdir(reportDir, { recursive: true });
    await atomicWrite(path.join(reportDir, "trials-with-targeting.json"), enriched);
    const summary = {
      generatedAt: new Date().toISOString(), selected: selected.length, statusCounts, completedThisRun: completed,
      screened: enriched.trials.filter((trial) => trial.targeting.status === "screened").length,
      needsReview: enriched.trials.filter((trial) => trial.targeting.status === "screened" && trial.targeting.needsReview).length,
      errors,
    };
    await atomicWrite(path.join(reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary));
    if (fatalError) throw fatalError;
    if (errors.length) process.exitCode = 1;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
