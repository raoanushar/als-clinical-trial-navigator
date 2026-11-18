const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const cachePath = path.join(rootDir, "data", "trials-cache.json");
const storePath = path.join(rootDir, "data", "agent-analyses.json");
const outDir = path.join(rootDir, "reports", "agent-new-candidates-20260902");

const targetStatuses = new Set([
  "Recruiting",
  "Not Yet Recruiting",
  "Enrolling By Invitation",
  "Active Not Recruiting",
  "Available",
  "Approved For Marketing",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function writeCsv(filePath, headers, rows) {
  const lines = [
    headers,
    ...rows,
  ].map((row) => row.map(csvEscape).join(","));
  fs.writeFileSync(filePath, lines.join("\n"));
}

const cache = readJson(cachePath);
const store = readJson(storePath);
const analysesByNctId = store.analysesByNctId || {};
const seenIds = new Set(Object.keys(analysesByNctId));

const current = (cache.trials || []).filter((trial) => targetStatuses.has(trial.status));
const seen = current.filter((trial) => seenIds.has(trial.nctId));
const neverScreened = current.filter((trial) => !seenIds.has(trial.nctId));
const seenButUpdated = seen.filter((trial) => {
  const latest = analysesByNctId[trial.nctId]?.latest;
  return latest?.updatedAt && trial.updatedAt && trial.updatedAt > latest.updatedAt;
});

const sortByNewest = (left, right) =>
  String(right.firstPostedAt || right.updatedAt || "").localeCompare(String(left.firstPostedAt || left.updatedAt || "")) ||
  String(left.nctId).localeCompare(String(right.nctId));

const report = {
  generatedAt: new Date().toISOString(),
  cacheSyncedAt: cache.syncedAt,
  ctGovDataTimestamp: cache.ctGovDataTimestamp,
  selectionStatuses: [...targetStatuses],
  totalCurrent: current.length,
  currentStatusCounts: countBy(current, (trial) => trial.status),
  agentStoreSeenNctIds: seenIds.size,
  alreadyScreenedInCurrent: seen.length,
  neverScreenedInCurrent: neverScreened.length,
  neverScreenedStatusCounts: countBy(neverScreened, (trial) => trial.status),
  alreadyScreenedRiskCounts: countBy(seen, (trial) => analysesByNctId[trial.nctId]?.latest?.risk || "not_run"),
  seenButCtGovUpdatedSinceAnalysis: seenButUpdated.length,
  seenButCtGovUpdatedStatusCounts: countBy(seenButUpdated, (trial) => trial.status),
  neverScreened: neverScreened.slice().sort(sortByNewest).map((trial) => ({
    nctId: trial.nctId,
    title: trial.title,
    status: trial.status,
    sponsor: trial.sponsor,
    firstPostedAt: trial.firstPostedAt,
    updatedAt: trial.updatedAt,
    trialUrl: trial.trialUrl,
  })),
  seenButUpdated: seenButUpdated.slice().sort(sortByNewest).map((trial) => ({
    nctId: trial.nctId,
    title: trial.title,
    status: trial.status,
    sponsor: trial.sponsor,
    currentUpdatedAt: trial.updatedAt,
    lastAnalyzedTrialUpdatedAt: analysesByNctId[trial.nctId]?.latest?.updatedAt,
    analyzedAt: analysesByNctId[trial.nctId]?.latest?.analyzedAt,
    risk: analysesByNctId[trial.nctId]?.latest?.risk,
    score: analysesByNctId[trial.nctId]?.latest?.score,
    trialUrl: trial.trialUrl,
  })),
};

fs.mkdirSync(outDir, { recursive: true });

const jsonPath = path.join(outDir, "new-candidates-summary.json");
const neverScreenedCsvPath = path.join(outDir, "never-screened-current-expanded.csv");
const seenButUpdatedCsvPath = path.join(outDir, "seen-but-updated-current-expanded.csv");

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeCsv(
  neverScreenedCsvPath,
  ["nct_id", "title", "status", "sponsor", "first_posted_at", "updated_at", "trial_url"],
  report.neverScreened.map((trial) => [
    trial.nctId,
    trial.title,
    trial.status,
    trial.sponsor,
    trial.firstPostedAt,
    trial.updatedAt,
    trial.trialUrl,
  ]),
);
writeCsv(
  seenButUpdatedCsvPath,
  [
    "nct_id",
    "title",
    "status",
    "sponsor",
    "current_updated_at",
    "last_analyzed_trial_updated_at",
    "analyzed_at",
    "risk",
    "score",
    "trial_url",
  ],
  report.seenButUpdated.map((trial) => [
    trial.nctId,
    trial.title,
    trial.status,
    trial.sponsor,
    trial.currentUpdatedAt,
    trial.lastAnalyzedTrialUpdatedAt,
    trial.analyzedAt,
    trial.risk,
    trial.score,
    trial.trialUrl,
  ]),
);

console.log(JSON.stringify({
  summary: {
    totalCurrent: report.totalCurrent,
    currentStatusCounts: report.currentStatusCounts,
    alreadyScreenedInCurrent: report.alreadyScreenedInCurrent,
    neverScreenedInCurrent: report.neverScreenedInCurrent,
    neverScreenedStatusCounts: report.neverScreenedStatusCounts,
    seenButCtGovUpdatedSinceAnalysis: report.seenButCtGovUpdatedSinceAnalysis,
    seenButCtGovUpdatedStatusCounts: report.seenButCtGovUpdatedStatusCounts,
    alreadyScreenedRiskCounts: report.alreadyScreenedRiskCounts,
  },
  files: {
    json: jsonPath,
    neverScreenedCsv: neverScreenedCsvPath,
    seenButUpdatedCsv: seenButUpdatedCsvPath,
  },
  neverScreened: report.neverScreened,
}, null, 2));
