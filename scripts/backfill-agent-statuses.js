const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const cachePath = path.join(rootDir, "data", "trials-cache.json");
const storePath = path.join(rootDir, "data", "agent-analyses.json");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8000";
const targetStatuses = new Set(["Active Not Recruiting", "Not Yet Recruiting"]);

async function main() {
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

  const targets = cache.trials
    .filter((trial) => targetStatuses.has(trial.status))
    .filter((trial) => !store.analysesByNctId?.[trial.nctId]?.latest)
    .map((trial) => ({
      nctId: trial.nctId,
      status: trial.status,
    }));

  console.log(JSON.stringify({ targets: targets.length, statuses: [...targetStatuses] }));

  let completed = 0;
  for (const target of targets) {
    const response = await fetch(`${baseUrl}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nctId: target.nctId,
        skipProcessed: false,
        limit: 5,
        days: 30,
        query: "",
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${target.nctId}: ${payload.error || JSON.stringify(payload)}`);
    }

    completed += 1;
    if (completed % 5 === 0 || completed === targets.length) {
      console.log(JSON.stringify({
        completed,
        remaining: targets.length - completed,
        last: target.nctId,
        status: target.status,
      }));
    }
  }

  console.log(JSON.stringify({ done: true, completed }));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
