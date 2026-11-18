const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const promptPath = path.join(rootDir, "prompts", "trial-verification-agent-prompt.txt");
const cachePath = path.join(rootDir, "data", "trials-cache.json");
const outRoot = path.join(rootDir, "reports");
const sampleSize = Number.parseInt(process.env.SAMPLE_SIZE || "25", 10);
const batchSize = Number.parseInt(process.env.BATCH_SIZE || "5", 10);
const model = process.env.VERIFICATION_AGENT_MODEL || "gpt-5.4";
const statuses = new Set(["Recruiting", "Not Yet Recruiting", "Enrolling By Invitation"]);

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function timestampForFile() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function clip(value, maxLength = 1400) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function titleCase(value) {
  return String(value || "")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeContact(contact = {}) {
  return {
    name: contact.name || "",
    role: titleCase(contact.role || ""),
    phone: contact.phone || "",
    email: contact.email || "",
  };
}

function summarizeLocations(locations = []) {
  const contactableLocations = locations.filter((location) =>
    (location.contacts || []).some((contact) => contact.email || contact.phone)
  );
  const recruitingLocations = locations.filter((location) => String(location.status || "").includes("RECRUIT"));
  const namedLocations = locations.filter((location) => location.facility && !/^unknown site$/i.test(location.facility));
  const codedLocations = locations.filter((location) => /^[A-Za-z]*\s*\d{2,}$/.test(String(location.facility || "").trim()));

  return {
    totalLocations: locations.length,
    recruitingLocations: recruitingLocations.length,
    locationsWithContacts: contactableLocations.length,
    namedLocations: namedLocations.length,
    codedOrVagueLocations: codedLocations.length,
    countries: [...new Set(locations.map((location) => location.country).filter(Boolean))],
  };
}

function compactStudy(study) {
  const protocol = study.protocolSection || {};
  const id = protocol.identificationModule || {};
  const status = protocol.statusModule || {};
  const sponsor = protocol.sponsorCollaboratorsModule || {};
  const design = protocol.designModule || {};
  const description = protocol.descriptionModule || {};
  const conditions = protocol.conditionsModule || {};
  const interventions = protocol.armsInterventionsModule || {};
  const eligibility = protocol.eligibilityModule || {};
  const contactsLocations = protocol.contactsLocationsModule || {};
  const locations = (contactsLocations.locations || []).map((location) => ({
    facility: location.facility || "",
    status: location.status || "",
    city: location.city || "",
    state: location.state || "",
    country: location.country || "",
    zip: location.zip || "",
    contacts: (location.contacts || []).map(normalizeContact),
  }));

  return {
    nctId: id.nctId || "",
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : "",
    briefTitle: id.briefTitle || "",
    officialTitle: id.officialTitle || "",
    overallStatus: status.overallStatus || "",
    statusVerifiedDate: status.statusVerifiedDate || "",
    lastUpdateSubmitDate: status.lastUpdateSubmitDate || "",
    lastUpdatePostDate: status.lastUpdatePostDateStruct?.date || "",
    studyFirstPostDate: status.studyFirstPostDateStruct?.date || "",
    leadSponsor: sponsor.leadSponsor?.name || "",
    leadSponsorClass: sponsor.leadSponsor?.class || "",
    collaborators: (sponsor.collaborators || []).map((item) => ({ name: item.name || "", class: item.class || "" })),
    responsiblePartyType: sponsor.responsibleParty?.type || "",
    studyType: design.studyType || "",
    phases: design.phases || [],
    enrollment: design.enrollmentInfo || {},
    briefSummary: clip(description.briefSummary, 1800),
    detailedDescription: clip(description.detailedDescription, 1800),
    conditions: conditions.conditions || [],
    keywords: conditions.keywords || [],
    interventions: (interventions.interventions || []).map((item) => ({
      type: item.type || "",
      name: item.name || "",
      description: clip(item.description, 500),
    })),
    eligibilityCriteria: clip(eligibility.eligibilityCriteria, 2600),
    sex: eligibility.sex || "",
    minimumAge: eligibility.minimumAge || "",
    maximumAge: eligibility.maximumAge || "",
    stdAges: eligibility.stdAges || [],
    healthyVolunteers: eligibility.healthyVolunteers,
    centralContacts: (contactsLocations.centralContacts || []).map(normalizeContact),
    overallOfficials: (contactsLocations.overallOfficials || []).map((official) => ({
      name: official.name || "",
      role: official.role || "",
      affiliation: official.affiliation || "",
    })),
    locationStats: summarizeLocations(locations),
    locations: locations.slice(0, 30),
  };
}

async function fetchStudy(nctId) {
  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.id", nctId);
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov lookup failed for ${nctId}: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const study = payload.studies?.[0];
  if (!study) {
    throw new Error(`ClinicalTrials.gov returned no study for ${nctId}`);
  }
  return compactStudy(study);
}

async function runOpenAiBatch(apiKey, prompt, trials) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trial_verification_reports",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              reports: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    nctId: { type: "string" },
                    reviewCategory: { type: "string", enum: ["Verified", "Needs Registry Update", "Physician Review"] },
                    verificationStatus: { type: "string", enum: ["Verified", "Unverified"] },
                    confidenceScore: { type: "number" },
                    flagForPhysicianReview: { type: "boolean" },
                    flagForRegistryUpdate: { type: "boolean" },
                    missingFieldCount: { type: "number" },
                    missingOrWeakFields: { type: "array", items: { type: "string" } },
                    integrityConcernCount: { type: "number" },
                    integrityConcernSignals: { type: "array", items: { type: "string" } },
                    updateNeededReasons: { type: "array", items: { type: "string" } },
                    criticalBlockers: { type: "array", items: { type: "string" } },
                    scoreDeductions: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          field: { type: "string" },
                          points: { type: "number" },
                          explanation: { type: "string" },
                        },
                        required: ["field", "points", "explanation"],
                      },
                    },
                    positiveSignals: { type: "array", items: { type: "string" } },
                    physicianReviewReasons: { type: "array", items: { type: "string" } },
                    rationale: { type: "string" },
                  },
                  required: [
                    "nctId",
                    "reviewCategory",
                    "verificationStatus",
                    "confidenceScore",
                    "flagForPhysicianReview",
                    "flagForRegistryUpdate",
                    "missingFieldCount",
                    "missingOrWeakFields",
                    "integrityConcernCount",
                    "integrityConcernSignals",
                    "updateNeededReasons",
                    "criticalBlockers",
                    "scoreDeductions",
                    "positiveSignals",
                    "physicianReviewReasons",
                    "rationale",
                  ],
                },
              },
            },
            required: ["reports"],
          },
        },
      },
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "Rate these ALS ClinicalTrials.gov records for data-quality verification. Return one report per trial.",
              currentDate: new Date().toISOString().slice(0, 10),
              targetStatuses: ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"],
              trials,
            },
            null,
            2
          ),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return JSON.parse(payload.choices?.[0]?.message?.content || "{\"reports\":[]}");
}

function normalizeReport(raw, trial) {
  const score = Math.max(0, Math.min(100, Number(raw.confidenceScore) || 0));
  const allowedCategories = ["Verified", "Needs Registry Update", "Physician Review"];
  const reviewCategory = allowedCategories.includes(raw.reviewCategory) ? raw.reviewCategory : score >= 90 ? "Verified" : "Needs Registry Update";
  const verificationStatus = reviewCategory === "Verified" && score >= 90 ? "Verified" : "Unverified";
  return {
    nctId: trial.nctId,
    title: trial.briefTitle || trial.officialTitle || trial.nctId,
    status: titleCase(trial.overallStatus),
    sponsor: trial.leadSponsor,
    url: trial.url,
    reviewCategory,
    verificationStatus,
    confidenceScore: score,
    flagForPhysicianReview: reviewCategory === "Physician Review",
    flagForRegistryUpdate: reviewCategory === "Needs Registry Update" || raw.flagForRegistryUpdate === true,
    missingFieldCount: Number(raw.missingFieldCount) || 0,
    missingOrWeakFields: Array.isArray(raw.missingOrWeakFields) ? raw.missingOrWeakFields : [],
    integrityConcernCount: Number(raw.integrityConcernCount) || 0,
    integrityConcernSignals: Array.isArray(raw.integrityConcernSignals) ? raw.integrityConcernSignals : [],
    updateNeededReasons: Array.isArray(raw.updateNeededReasons) ? raw.updateNeededReasons : [],
    criticalBlockers: Array.isArray(raw.criticalBlockers) ? raw.criticalBlockers : [],
    scoreDeductions: Array.isArray(raw.scoreDeductions) ? raw.scoreDeductions : [],
    positiveSignals: Array.isArray(raw.positiveSignals) ? raw.positiveSignals : [],
    physicianReviewReasons: Array.isArray(raw.physicianReviewReasons) ? raw.physicianReviewReasons : [],
    rationale: String(raw.rationale || ""),
  };
}

function toCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(filePath, records) {
  const columns = [
    "nctId",
    "title",
    "status",
    "sponsor",
    "reviewCategory",
    "verificationStatus",
    "confidenceScore",
    "flagForPhysicianReview",
    "flagForRegistryUpdate",
    "missingFieldCount",
    "missingOrWeakFields",
    "integrityConcernCount",
    "integrityConcernSignals",
    "updateNeededReasons",
    "criticalBlockers",
    "rationale",
    "url",
  ];
  const lines = [
    columns.join(","),
    ...records.map((record) =>
      columns
        .map((column) => {
          const value = Array.isArray(record[column]) ? record[column].join(" | ") : record[column];
          return toCsvValue(value);
        })
        .join(",")
    ),
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function writeHtml(filePath, records, summary) {
  const sorted = [...records].sort((left, right) => left.confidenceScore - right.confidenceScore);
  const body = sorted
    .map(
      (record, index) => `
        <article class="trial">
          <h2>${index + 1}. ${escapeHtml(record.nctId)} - ${escapeHtml(record.title)}</h2>
          <p><b>${escapeHtml(record.reviewCategory || record.verificationStatus)}</b> · Score ${escapeHtml(record.confidenceScore)} · ${escapeHtml(record.status)} · ${escapeHtml(record.sponsor)}</p>
          <p><a href="${escapeHtml(record.url)}">${escapeHtml(record.url)}</a></p>
          <p><b>Missing/weak fields (${escapeHtml(record.missingFieldCount)}):</b> ${escapeHtml(record.missingOrWeakFields.join("; ") || "None")}</p>
          <p><b>Critical blockers:</b> ${escapeHtml(record.criticalBlockers.join("; ") || "None")}</p>
          <p><b>Physician review:</b> ${record.flagForPhysicianReview ? "Yes" : "No"}</p>
          <p><b>Registry update:</b> ${record.flagForRegistryUpdate ? "Yes" : "No"}</p>
          <p><b>Integrity concerns:</b> ${escapeHtml((record.integrityConcernSignals || []).join("; ") || "None")}</p>
          <p><b>Update needed:</b> ${escapeHtml((record.updateNeededReasons || []).join("; ") || "None")}</p>
          <p><b>Rationale:</b> ${escapeHtml(record.rationale)}</p>
          <p><b>Positive signals:</b> ${escapeHtml(record.positiveSignals.join("; ") || "None listed")}</p>
          <p><b>Review reasons:</b> ${escapeHtml(record.physicianReviewReasons.join("; ") || "None")}</p>
        </article>
      `
    )
    .join("\n");

  fs.writeFileSync(
    filePath,
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Trial Verification Sample</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.35; color: #111; }
    .summary { background: #f3f5f7; border: 1px solid #d0d7de; padding: 12px; }
    .trial { border: 1px solid #ddd; margin: 14px 0; padding: 12px; page-break-inside: avoid; }
    h1 { font-size: 24px; }
    h2 { font-size: 16px; margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>Trial Verification Agent Sample</h1>
  <section class="summary">
    <p><b>Generated:</b> ${escapeHtml(summary.generatedAt)}</p>
    <p><b>Model:</b> ${escapeHtml(summary.model)}</p>
    <p><b>Candidate count:</b> ${escapeHtml(summary.candidateCount)}</p>
    <p><b>Sample size:</b> ${escapeHtml(summary.sampleSize)}</p>
    <p><b>Verified:</b> ${escapeHtml(summary.verifiedCount)} · <b>Unverified:</b> ${escapeHtml(summary.unverifiedCount)}</p>
  </section>
  ${body}
</body>
</html>`
  );
}

async function main() {
  loadEnvFile();
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const prompt = fs.readFileSync(promptPath, "utf8");
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const candidates = (cache.trials || []).filter((trial) => statuses.has(trial.status));
  const sample = shuffle(candidates).slice(0, sampleSize);
  const sequenceId = `verification-sample-${timestampForFile()}`;
  const outDir = path.join(outRoot, sequenceId);
  await fsp.mkdir(outDir, { recursive: true });

  const richTrials = [];
  for (const trial of sample) {
    richTrials.push(await fetchStudy(trial.nctId));
  }

  fs.writeFileSync(path.join(outDir, "sampled-trials.json"), JSON.stringify(richTrials, null, 2));

  const reports = [];
  for (let index = 0; index < richTrials.length; index += batchSize) {
    const batch = richTrials.slice(index, index + batchSize);
    const payload = await runOpenAiBatch(apiKey, prompt, batch);
    const reportsById = new Map((payload.reports || []).map((report) => [String(report.nctId || "").toUpperCase(), report]));
    reports.push(...batch.map((trial) => normalizeReport(reportsById.get(trial.nctId.toUpperCase()) || {}, trial)));
    console.log(JSON.stringify({ completed: reports.length, total: richTrials.length }));
  }

  const summary = {
    sequenceId,
    generatedAt: new Date().toISOString(),
    model,
    candidateCount: candidates.length,
    sampleSize: reports.length,
    verifiedCount: reports.filter((report) => report.verificationStatus === "Verified").length,
    unverifiedCount: reports.filter((report) => report.verificationStatus === "Unverified").length,
    physicianReviewCount: reports.filter((report) => report.reviewCategory === "Physician Review").length,
    registryUpdateCount: reports.filter((report) => report.reviewCategory === "Needs Registry Update").length,
    targetStatuses: [...statuses],
  };

  fs.writeFileSync(path.join(outDir, "verification-results.json"), JSON.stringify({ summary, reports }, null, 2));
  writeCsv(path.join(outDir, "verification-results.csv"), reports);
  writeHtml(path.join(outDir, "verification-sample-report.html"), reports, summary);
  writeHtml(path.join(outDir, "verification-sample-report.doc"), reports, summary);

  console.log(JSON.stringify({
    summary,
    files: {
      json: path.join(outDir, "verification-results.json"),
      csv: path.join(outDir, "verification-results.csv"),
      html: path.join(outDir, "verification-sample-report.html"),
      doc: path.join(outDir, "verification-sample-report.doc"),
      sampledTrials: path.join(outDir, "sampled-trials.json"),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
