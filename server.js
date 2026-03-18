const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8000);
const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT_DIR;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const CACHE_FILE = path.join(DATA_DIR, "trials-cache.json");
const AGENT_STORE_FILE = path.join(DATA_DIR, "agent-analyses.json");
const REPORTS_DIR = path.join(STORAGE_DIR, "reports");
const CTG_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies";
const CTG_VERSION_URL = "https://clinicaltrials.gov/api/v2/version";
const DEFAULT_CONDITION = "Amyotrophic Lateral Sclerosis";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENV_FILE = path.join(ROOT_DIR, ".env");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const PRIVATE_CLINIC_TERMS = [
  "stem cell",
  "regenerative",
  "wellness",
  "institute",
  "clinic",
  "anti aging",
  "longevity",
  "biocare",
];

const ACADEMIC_TERMS = [
  "university",
  "hospital",
  "massachusetts general",
  "mayo",
  "clinic",
  "medical center",
  "health",
  "nih",
  "college",
  "research",
  "institut",
  "infirmary",
  "nhs",
  "chu",
  "centre",
];

const MARKETING_TERMS = [
  "cure",
  "reverse",
  "miracle",
  "breakthrough",
  "life-changing",
  "transformative",
  "restore",
];

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function loadEnvFile() {
  try {
    const content = await fs.readFile(ENV_FILE, "utf8");
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function textResponse(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(payload);
}

function titleCase(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .toLowerCase()
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dateValue(value) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

async function readCache() {
  try {
    const payload = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(payload);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCache(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
}

async function readAgentStore() {
  try {
    const payload = await fs.readFile(AGENT_STORE_FILE, "utf8");
    return JSON.parse(payload);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        hydratedFromReports: false,
        analysesByNctId: {},
      };
    }
    throw error;
  }
}

async function writeAgentStore(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(AGENT_STORE_FILE, JSON.stringify(payload, null, 2));
}

function csvHeader() {
  return [
    "nct_id",
    "title",
    "sponsor",
    "updated_at",
    "score",
    "risk",
    "agent_report",
    "agent_reasons",
    "trial_url",
  ];
}

function reportRows(reports) {
  return reports.map((report) => [
    report.nctId,
    report.title,
    report.sponsor,
    report.updatedAt,
    report.score,
    report.risk,
    report.report,
    report.reasons.join(" | "),
    report.url,
  ]);
}

function latestAnalysisRows(dataset, agentStore) {
  const trialsById = new Map(dataset.trials.map((trial) => [trial.nctId, trial]));

  return Object.entries(agentStore?.analysesByNctId || {})
    .map(([nctId, record]) => {
      const latest = record?.latest;
      if (!latest) {
        return null;
      }

      const trial = trialsById.get(nctId);
      return {
        nctId,
        title: latest.title || trial?.title || "",
        sponsor: latest.sponsor || trial?.sponsor || "",
        status: trial?.status || "",
        phase: trial?.phase || "",
        studyType: trial?.studyType || "",
        updatedAt: latest.updatedAt || trial?.updatedAt || "",
        analyzedAt: latest.analyzedAt || "",
        score: latest.score ?? "",
        risk: latest.risk || "",
        report: latest.report || "",
        reasons: Array.isArray(latest.reasons) ? latest.reasons.join(" | ") : "",
        locationSummary: trial?.locationSummary || latest.locationSummary || "",
        historyCount: Array.isArray(record.history) ? record.history.length : 0,
        trialUrl: latest.url || trial?.url || "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if ((right.score || 0) !== (left.score || 0)) {
        return (right.score || 0) - (left.score || 0);
      }
      return dateValue(right.analyzedAt) - dateValue(left.analyzedAt);
    });
}

async function writeAllAgentAnalysesCsv(dataset, agentStore) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const rows = latestAnalysisRows(dataset, agentStore);
  const csvRows = [
    [
      "nct_id",
      "title",
      "sponsor",
      "status",
      "phase",
      "study_type",
      "updated_at",
      "analyzed_at",
      "score",
      "risk",
      "agent_report",
      "agent_reasons",
      "location_summary",
      "history_count",
      "trial_url",
    ],
    ...rows.map((row) => [
      row.nctId,
      row.title,
      row.sponsor,
      row.status,
      row.phase,
      row.studyType,
      row.updatedAt,
      row.analyzedAt,
      row.score,
      row.risk,
      row.report,
      row.reasons,
      row.locationSummary,
      row.historyCount,
      row.trialUrl,
    ]),
  ];

  const filename = "all-agent-analyses.csv";
  const filePath = path.join(REPORTS_DIR, filename);
  await fs.writeFile(filePath, toCsv(csvRows), "utf8");
  return filePath;
}

async function writeFlaggedAgentTrialsCsv(dataset, agentStore) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const rows = latestAnalysisRows(dataset, agentStore).filter((row) => ["medium", "high"].includes(row.risk));
  const csvRows = [
    [
      "nct_id",
      "title",
      "sponsor",
      "status",
      "phase",
      "study_type",
      "updated_at",
      "analyzed_at",
      "score",
      "risk",
      "agent_report",
      "agent_reasons",
      "location_summary",
      "history_count",
      "ctgov_url",
    ],
    ...rows.map((row) => [
      row.nctId,
      row.title,
      row.sponsor,
      row.status,
      row.phase,
      row.studyType,
      row.updatedAt,
      row.analyzedAt,
      row.score,
      row.risk,
      row.report,
      row.reasons,
      row.locationSummary,
      row.historyCount,
      row.trialUrl,
    ]),
  ];

  const filename = "flagged-agent-trials.csv";
  const filePath = path.join(REPORTS_DIR, filename);
  await fs.writeFile(filePath, toCsv(csvRows), "utf8");
  return filePath;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => escapeCsvValue(cell)).join(",")).join("\n");
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function flaggedAnalysisRows(dataset, agentStore) {
  return latestAnalysisRows(dataset, agentStore).filter((row) => ["medium", "high"].includes(row.risk));
}

function flaggedRiskSummary(rows) {
  return {
    total: rows.length,
    high: rows.filter((row) => row.risk === "high").length,
    medium: rows.filter((row) => row.risk === "medium").length,
  };
}

function buildFlaggedTrialsReportHtml(dataset, agentStore, options = {}) {
  const rows = flaggedAnalysisRows(dataset, agentStore);
  const summary = flaggedRiskSummary(rows);
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const body = rows.length
    ? rows
        .map(
          (row) => `
            <article class="trial-card">
              <div class="trial-card-top">
                <div>
                  <p class="kicker">${escapeHtml(row.nctId)}</p>
                  <h2>${escapeHtml(row.title)}</h2>
                </div>
                <div class="score-block">
                  <span class="risk ${escapeHtml(row.risk)}">${escapeHtml(row.risk)} risk</span>
                  <strong>Score ${escapeHtml(row.score)}</strong>
                </div>
              </div>
              <p class="ctgov-link">
                <a href="${escapeHtml(row.trialUrl)}">${escapeHtml(row.trialUrl)}</a>
              </p>
              <div class="meta-row">
                <span>${escapeHtml(row.sponsor)}</span>
                <span>${escapeHtml(row.status)}</span>
                <span>${escapeHtml(row.phase)}</span>
                <span>Reviewed ${escapeHtml(row.analyzedAt)}</span>
              </div>
              <section class="copy-block">
                <h3>Agent report</h3>
                <p>${escapeHtml(row.report)}</p>
              </section>
              <section class="copy-block">
                <h3>Rationale</h3>
                <ul>
                  ${String(row.reasons || "")
                    .split(" | ")
                    .filter(Boolean)
                    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
                    .join("")}
                </ul>
              </section>
              <section class="copy-block">
                <h3>Trial details</h3>
                <p><strong>Study type:</strong> ${escapeHtml(row.studyType)}</p>
                <p><strong>Last updated:</strong> ${escapeHtml(row.updatedAt)}</p>
                <p><strong>Location summary:</strong> ${escapeHtml(row.locationSummary)}</p>
              </section>
            </article>
          `
        )
        .join("")
    : `<article class="trial-card"><p>No flagged trials are currently stored.</p></article>`;

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Flagged ALS Trials Report</title>
        <style>
          :root {
            --bg: #f4f5f7;
            --surface: #ffffff;
            --line: #d9e0e7;
            --text: #13212d;
            --muted: #5b6978;
            --high: #b42318;
            --medium: #b54708;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
            line-height: 1.5;
          }
          .report-shell {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px 20px 60px;
          }
          .report-header, .trial-card {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 18px;
          }
          .report-header {
            padding: 28px;
            margin-bottom: 20px;
          }
          h1, h2, h3, p { margin: 0; }
          h1 { font-size: 2rem; letter-spacing: -0.03em; margin-bottom: 8px; }
          h2 { font-size: 1.25rem; line-height: 1.3; }
          h3 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 8px; }
          .kicker { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
          .summary-row, .meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 14px;
          }
          .chip {
            display: inline-flex;
            align-items: center;
            padding: 6px 10px;
            border: 1px solid var(--line);
            border-radius: 999px;
            color: var(--muted);
            background: #f8fafc;
            font-size: 0.88rem;
          }
          .trial-list { display: grid; gap: 16px; }
          .trial-card { padding: 22px; }
          .trial-card-top {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: start;
            margin-bottom: 14px;
          }
          .score-block {
            display: grid;
            gap: 8px;
            justify-items: end;
            flex: 0 0 auto;
          }
          .risk {
            display: inline-flex;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 0.84rem;
            font-weight: 600;
            border: 1px solid var(--line);
          }
          .risk.high { color: var(--high); background: #fef3f2; border-color: #fecdca; }
          .risk.medium { color: var(--medium); background: #fffaeb; border-color: #fedf89; }
          .ctgov-link { margin-bottom: 14px; }
          .ctgov-link a { color: #0958d9; text-decoration: none; word-break: break-all; }
          .ctgov-link a:hover { text-decoration: underline; }
          .copy-block { margin-top: 16px; }
          .copy-block p { color: var(--text); }
          ul { margin: 0; padding-left: 20px; }
          li + li { margin-top: 6px; }
          @media print {
            body { background: #fff; }
            .report-shell { padding: 0; }
            .report-header, .trial-card { box-shadow: none; break-inside: avoid; }
            a { color: inherit; text-decoration: none; }
          }
        </style>
      </head>
      <body>
        <main class="report-shell">
          <header class="report-header">
            <p class="kicker">ALS Clinical Trial Navigator</p>
            <h1>Flagged Trial Report</h1>
            <p>Generated ${escapeHtml(generatedAt)}${options.wordExport ? " for Word export" : ""}.</p>
            <div class="summary-row">
              <span class="chip">Flagged trials ${escapeHtml(summary.total)}</span>
              <span class="chip">High risk ${escapeHtml(summary.high)}</span>
              <span class="chip">Medium risk ${escapeHtml(summary.medium)}</span>
            </div>
          </header>
          <section class="trial-list">
            ${body}
          </section>
        </main>
      </body>
    </html>
  `;
}

function timestampForFile(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function timestampIso() {
  return new Date().toISOString();
}

function normalizeSequenceId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function buildAgentAnalysisRecord(report, metadata = {}) {
  return {
    nctId: report.nctId,
    title: report.title,
    sponsor: report.sponsor,
    updatedAt: report.updatedAt,
    trialUrl: report.url,
    score: report.score,
    risk: report.risk,
    report: report.report,
    reasons: report.reasons,
    analyzedAt: metadata.analyzedAt || timestampIso(),
    model: metadata.model || "unknown",
    sequenceId: metadata.sequenceId || "",
    runNumber: metadata.runNumber || 1,
    sourceFile: metadata.sourceFile || "",
  };
}

function upsertAgentAnalyses(store, reports, metadata = {}) {
  for (const report of reports) {
    const record = buildAgentAnalysisRecord(report, metadata);
    const existing = store.analysesByNctId[report.nctId] || { latest: null, history: [] };
    existing.history.push(record);
    existing.latest = record;
    store.analysesByNctId[report.nctId] = existing;
  }

  return store;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function csvToObjects(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const object = {};
    headers.forEach((header, index) => {
      object[header] = cells[index] || "";
    });
    return object;
  });
}

async function listReportCsvFiles(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listReportCsvFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".csv") && entry.name !== "all-results.csv") {
      results.push(fullPath);
    }
  }

  return results;
}

async function hydrateAgentStoreFromReports(store) {
  if (store.hydratedFromReports) {
    return store;
  }

  const csvFiles = (await listReportCsvFiles(REPORTS_DIR)).sort();

  for (const filePath of csvFiles) {
    const csv = await fs.readFile(filePath, "utf8");
    const rows = csvToObjects(csv);
    const sequenceDir = path.basename(path.dirname(filePath));
    const sequenceId = sequenceDir === "reports" ? "" : sequenceDir;
    const runMatch = path.basename(filePath).match(/run-(\d+)/i);
    const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : 1;

    upsertAgentAnalyses(
      store,
      rows.map((row) => ({
        nctId: row.nct_id,
        title: row.title,
        sponsor: row.sponsor,
        updatedAt: row.updated_at,
        url: row.trial_url,
        score: Number(row.score) || 0,
        risk: row.risk || "low",
        report: row.agent_report || "",
        reasons: row.agent_reasons ? row.agent_reasons.split(" | ").filter(Boolean) : [],
      })),
      {
        analyzedAt: timestampIso(),
        model: "imported-from-csv",
        sequenceId,
        runNumber,
        sourceFile: filePath,
      }
    );
  }

  store.hydratedFromReports = true;
  await writeAgentStore(store);
  return store;
}

async function writeAgentReportCsv(result, options = {}) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const sequenceId = normalizeSequenceId(options.sequenceId) || `agent-sequence-${timestampForFile()}`;
  const runNumber = Math.max(1, Number.parseInt(options.runNumber, 10) || 1);
  const sequenceDir = path.join(REPORTS_DIR, sequenceId);
  await fs.mkdir(sequenceDir, { recursive: true });

  const runFilename = `run-${String(runNumber).padStart(2, "0")}.csv`;
  const runFilePath = path.join(sequenceDir, runFilename);
  const allResultsFilename = "all-results.csv";
  const allResultsPath = path.join(sequenceDir, allResultsFilename);

  const rows = reportRows(result.reports);
  const runCsv = toCsv([csvHeader(), ...rows]);
  await fs.writeFile(runFilePath, runCsv, "utf8");

  let existingAllResults = "";
  try {
    existingAllResults = await fs.readFile(allResultsPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (!existingAllResults) {
    await fs.writeFile(allResultsPath, toCsv([csvHeader(), ...rows]), "utf8");
  } else if (rows.length) {
    await fs.appendFile(allResultsPath, `\n${toCsv(rows)}`, "utf8");
  }

  return {
    sequenceId,
    runNumber,
    directory: sequenceDir,
    latestRun: {
      filename: runFilename,
      path: runFilePath,
      url: `/reports/${sequenceId}/${runFilename}`,
      format: "csv",
    },
    combined: {
      filename: allResultsFilename,
      path: allResultsPath,
      url: `/reports/${sequenceId}/${allResultsFilename}`,
      format: "csv",
    },
  };
}

async function fetchCtGovVersion() {
  const response = await fetch(CTG_VERSION_URL, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov version request failed: ${response.status}`);
  }

  return response.json();
}

async function fetchAllAlsStudies() {
  const studies = [];
  let nextPageToken = null;

  do {
    const url = new URL(CTG_STUDIES_URL);
    url.searchParams.set("query.cond", DEFAULT_CONDITION);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("format", "json");

    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ClinicalTrials.gov study request failed: ${response.status}`);
    }

    const payload = await response.json();
    studies.push(...(payload.studies || []));
    nextPageToken = payload.nextPageToken || null;
  } while (nextPageToken);

  return studies.map(normalizeStudy).filter(Boolean).sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt));
}

function normalizeStudy(study) {
  const protocol = study.protocolSection || {};
  const idModule = protocol.identificationModule || {};
  const statusModule = protocol.statusModule || {};
  const sponsorModule = protocol.sponsorCollaboratorsModule || {};
  const designModule = protocol.designModule || {};
  const descriptionModule = protocol.descriptionModule || {};
  const conditionsModule = protocol.conditionsModule || {};
  const interventionsModule = protocol.armsInterventionsModule || {};
  const locationsModule = protocol.contactsLocationsModule || {};
  const locationEntries = locationsModule.locations || [];
  const interventionEntries = interventionsModule.interventions || [];

  const nctId = idModule.nctId;
  if (!nctId) {
    return null;
  }

  const locations = locationEntries.map((location) => ({
    facility: location.facility || "Unknown site",
    city: location.city || "",
    state: location.state || "",
    country: location.country || "",
  }));

  const cities = unique(locations.map((location) => location.city));
  const states = unique(locations.map((location) => location.state));
  const interventions = unique(interventionEntries.map((intervention) => intervention.name));
  const conditions = unique(conditionsModule.conditions || []);
  const phaseValues = designModule.phases && designModule.phases.length ? designModule.phases.map(titleCase) : [];

  return {
    nctId,
    title: idModule.briefTitle || idModule.officialTitle || nctId,
    summary: descriptionModule.briefSummary || "",
    detailedDescription: descriptionModule.detailedDescription || "",
    status: titleCase(statusModule.overallStatus),
    phase: phaseValues.length ? phaseValues.join(", ") : titleCase(designModule.studyType || "Unknown"),
    studyType: titleCase(designModule.studyType || "Unknown"),
    sponsor: sponsorModule.leadSponsor?.name || "Unknown sponsor",
    interventions,
    interventionSummary: interventions.length ? interventions.slice(0, 2).join(", ") : "No listed intervention",
    conditions,
    locations,
    cities,
    states,
    locationSummary: locations.length
      ? locations
          .slice(0, 3)
          .map((location) => [location.facility, location.city, location.state].filter(Boolean).join(", "))
          .join(" · ")
      : "No study sites listed",
    updatedAt: statusModule.lastUpdatePostDateStruct?.date || statusModule.lastUpdateSubmitDate || null,
    firstPostedAt: statusModule.studyFirstPostDateStruct?.date || null,
    url: `https://clinicaltrials.gov/study/${nctId}`,
  };
}

function attachAgentAnalysis(trial, agentStore) {
  const analysis = agentStore?.analysesByNctId?.[trial.nctId];
  if (!analysis || !analysis.latest) {
    return trial;
  }

  return {
    ...trial,
    agentAnalysis: analysis.latest,
    agentHistoryCount: Array.isArray(analysis.history) ? analysis.history.length : 0,
  };
}

function buildHighRiskTrials(dataset, agentStore) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  return Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (!trial || !record.latest || record.latest.risk !== "high") {
        return null;
      }

      return attachAgentAnalysis(trial, agentStore);
    })
    .filter(Boolean)
    .sort((left, right) => (right.agentAnalysis?.score || 0) - (left.agentAnalysis?.score || 0))
    .slice(0, 20);
}

function buildMediumRiskTrials(dataset, agentStore) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  return Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (!trial || !record.latest || record.latest.risk !== "medium") {
        return null;
      }

      return attachAgentAnalysis(trial, agentStore);
    })
    .filter(Boolean)
    .sort((left, right) => (right.agentAnalysis?.score || 0) - (left.agentAnalysis?.score || 0))
    .slice(0, 20);
}

function buildScreenedTrials(dataset, agentStore) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  const latestTrials = Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (!trial || !record.latest) {
        return null;
      }

      return attachAgentAnalysis(trial, agentStore);
    })
    .filter(Boolean)
    .sort((left, right) => dateValue(right.agentAnalysis?.analyzedAt) - dateValue(left.agentAnalysis?.analyzedAt));

  const flaggedCount = latestTrials.filter((trial) => ["high", "medium"].includes(trial.agentAnalysis?.risk)).length;
  const lowRiskTrials = latestTrials.filter((trial) => trial.agentAnalysis?.risk === "low");

  return {
    summary: {
      totalProcessed: latestTrials.length,
      flaggedCount,
      lowRiskCount: lowRiskTrials.length,
    },
    trials: lowRiskTrials.slice(0, 12),
  };
}

function buildTrialDetail(dataset, agentStore, nctId) {
  const trial = dataset.trials.find((item) => item.nctId.toUpperCase() === nctId.toUpperCase());
  if (!trial) {
    return null;
  }

  const analysis = agentStore?.analysesByNctId?.[trial.nctId] || { latest: null, history: [] };
  return {
    trial: attachAgentAnalysis(trial, agentStore),
    agentHistory: [...(analysis.history || [])].sort((left, right) => dateValue(right.analyzedAt) - dateValue(left.analyzedAt)),
  };
}

function buildStats(trials) {
  const recruitingCount = trials.filter((trial) => trial.status === "Recruiting").length;
  const bostonCount = trials.filter((trial) => trial.cities.some((city) => city.toLowerCase() === "boston")).length;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const newThisWeekCount = trials.filter((trial) => dateValue(trial.firstPostedAt) >= sevenDaysAgo).length;

  const statusMap = new Map();
  for (const trial of trials) {
    statusMap.set(trial.status, (statusMap.get(trial.status) || 0) + 1);
  }

  const total = trials.length || 1;
  const statusCounts = [...statusMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }));

  const themeMap = new Map();
  for (const trial of trials) {
    for (const name of trial.interventions.slice(0, 2)) {
      const label = summarizeIntervention(name);
      themeMap.set(label, (themeMap.get(label) || 0) + 1);
    }
  }

  const interventionThemes = [...themeMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const cityMap = new Map();
  for (const trial of trials) {
    for (const city of trial.cities) {
      cityMap.set(city, (cityMap.get(city) || 0) + 1);
    }
  }

  const topCities = [...cityMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, count }));

  const recentUpdates = [...trials]
    .sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt))
    .slice(0, 4)
    .map((trial) => ({
      nctId: trial.nctId,
      title: trial.title,
      updatedAt: trial.updatedAt,
    }));

  const notifications = recentUpdates.slice(0, 3).map((trial) => ({
    title: `${trial.nctId} updated`,
    detail: `${trial.title} posted a recent update on ${trial.updatedAt || "an unknown date"}.`,
  }));

  return {
    recruitingCount,
    bostonCount,
    newThisWeekCount,
    statusCounts,
    interventionThemes,
    topCities,
    recentUpdates,
    notifications,
  };
}

function summarizeIntervention(name) {
  const normalized = name.toLowerCase();

  if (normalized.includes("gene")) {
    return "Gene therapy";
  }
  if (normalized.includes("cell")) {
    return "Cell therapy";
  }
  if (normalized.includes("monitor")) {
    return "Monitoring";
  }
  if (normalized.includes("device")) {
    return "Device";
  }
  if (normalized.includes("antisense")) {
    return "Antisense";
  }
  if (normalized.includes("biomarker")) {
    return "Biomarker";
  }

  return name.length > 28 ? `${name.slice(0, 28)}...` : name;
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[^\w\s-]/g, " ");
}

function parseQueryFilters(query, trials) {
  const normalizedQuery = normalizeText(query || "");
  const filters = [];
  let matches = [...trials];
  let matchedCity = null;

  const cities = unique(trials.flatMap((trial) => trial.cities)).sort((left, right) => right.length - left.length);
  matchedCity = cities.find((city) => city && normalizedQuery.includes(city.toLowerCase())) || null;
  if (matchedCity) {
    matches = matches.filter((trial) => trial.cities.some((city) => city.toLowerCase() === matchedCity.toLowerCase()));
    filters.push(`City: ${matchedCity}`);
  }

  const statuses = [
    { needle: "not yet recruiting", value: "Not Yet Recruiting" },
    { needle: "active not recruiting", value: "Active Not Recruiting" },
    { needle: "recruiting", value: "Recruiting" },
    { needle: "completed", value: "Completed" },
  ];

  for (const status of statuses) {
    if (normalizedQuery.includes(status.needle)) {
      matches = matches.filter((trial) => normalizeText(trial.status) === normalizeText(status.value));
      filters.push(`Status: ${titleCase(status.value)}`);
      break;
    }
  }

  const studyTypes = [
    { needle: "interventional", value: "Interventional" },
    { needle: "observational", value: "Observational" },
    { needle: "expanded access", value: "Expanded Access" },
  ];

  for (const studyType of studyTypes) {
    if (normalizedQuery.includes(studyType.needle)) {
      matches = matches.filter((trial) => normalizeText(trial.studyType) === normalizeText(studyType.value));
      filters.push(`Type: ${studyType.value}`);
      break;
    }
  }

  const interventionKeywords = ["gene therapy", "cell", "stem cell", "antisense", "biomarker", "monitor", "device"];
  for (const keyword of interventionKeywords) {
    if (normalizedQuery.includes(keyword)) {
      matches = matches.filter((trial) => {
        const haystack = normalizeText(`${trial.interventionSummary} ${trial.title} ${trial.summary}`);
        return haystack.includes(normalizeText(keyword));
      });
      filters.push(`Intervention: ${titleCase(keyword)}`);
      break;
    }
  }

  const nctMatch = query.match(/\bNCT\d{8}\b/i);
  if (nctMatch) {
    matches = matches.filter((trial) => trial.nctId.toLowerCase() === nctMatch[0].toLowerCase());
    filters.push(`Study: ${nctMatch[0].toUpperCase()}`);
  }

  matches = matches.sort((left, right) => dateValue(right.updatedAt || right.firstPostedAt) - dateValue(left.updatedAt || left.firstPostedAt));

  return { filters, matches, matchedCity };
}

function parseAgentTokens(instructions) {
  const normalized = normalizeText(instructions || "");
  return {
    privateStemCellFocus:
      normalized.includes("private stem cell") || (normalized.includes("private") && normalized.includes("stem cell")),
    sponsorFocus: normalized.includes("sponsor"),
    cureLanguageFocus:
      normalized.includes("cure") || normalized.includes("reversal") || normalized.includes("marketing language"),
    credibilityFocus:
      normalized.includes("credible") ||
      normalized.includes("academic") ||
      normalized.includes("hospital") ||
      normalized.includes("institution"),
  };
}

function hasAnyTerm(value, terms) {
  const normalized = normalizeText(value || "");
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function analyzeTrialRisk(trial, instructions) {
  const tokens = parseAgentTokens(instructions);
  const reasons = [];
  let score = 8;

  if (trial.sponsor === "Unknown sponsor") {
    score += 28;
    reasons.push("Sponsor is missing or unclear");
  }

  if (!trial.locations.length) {
    score += 24;
    reasons.push("No study locations are listed");
  }

  if (tokens.privateStemCellFocus) {
    const sponsorLooksPrivateClinic = hasAnyTerm(trial.sponsor, PRIVATE_CLINIC_TERMS) && !hasAnyTerm(trial.sponsor, ["university", "hospital", "medical center"]);
    const mentionsStemCell = hasAnyTerm(`${trial.title} ${trial.summary} ${trial.interventionSummary}`, ["stem cell", "cell therapy"]);

    if (sponsorLooksPrivateClinic && mentionsStemCell) {
      score += 38;
      reasons.push("Private clinic style sponsor combined with stem-cell language");
    }
  }

  if (tokens.sponsorFocus && hasAnyTerm(trial.sponsor, PRIVATE_CLINIC_TERMS) && !hasAnyTerm(trial.sponsor, ["university", "hospital", "medical center"])) {
    score += 18;
    reasons.push("Sponsor name reads more like a commercial clinic than an academic center");
  }

  if (tokens.cureLanguageFocus && hasAnyTerm(`${trial.title} ${trial.summary}`, MARKETING_TERMS)) {
    score += 22;
    reasons.push("Title or summary includes cure-like or marketing-heavy language");
  }

  if (tokens.credibilityFocus) {
    const credibleSite = trial.locations.some((location) => hasAnyTerm(`${location.facility}`, ACADEMIC_TERMS));
    const credibleSponsor = hasAnyTerm(trial.sponsor, ACADEMIC_TERMS);

    if (!credibleSite && !credibleSponsor) {
      score += 20;
      reasons.push("No obvious academic or hospital credibility signal in sponsor or site list");
    }
  }

  if (trial.studyType === "Unknown") {
    score += 10;
    reasons.push("Study type is unclear");
  }

  if (!trial.summary) {
    score += 8;
    reasons.push("Brief summary is missing");
  }

  if (!reasons.length) {
    reasons.push("Mostly standard registry metadata with no strong suspicious signals");
  }

  const boundedScore = Math.max(0, Math.min(99, score));
  const risk = boundedScore >= 70 ? "high" : boundedScore >= 40 ? "medium" : "low";
  const report =
    risk === "high"
      ? "Multiple suspicious signals matched the current agent instructions. This trial should be manually reviewed before being treated as credible."
      : risk === "medium"
        ? "Some signals overlap with the current agent instructions. This record deserves a closer human check."
        : "Few suspicious signals matched the current agent instructions. This looks lower risk based on registry metadata alone.";

  return {
    nctId: trial.nctId,
    title: trial.title,
    sponsor: trial.sponsor,
    updatedAt: trial.updatedAt,
    locationSummary: trial.locationSummary,
    url: trial.url,
    score: boundedScore,
    risk,
    reasons,
    report,
  };
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2) : sorted[midpoint];
}

function pickAgentCandidates(dataset, options) {
  const instructions = (options.instructions || "").trim() || "Flag unusual sponsor, marketing, or site credibility patterns.";
  const limit = Math.max(5, Math.min(100, Number.parseInt(options.limit, 10) || 20));
  const parsedDays = Number.parseInt(options.days, 10);
  const days = Number.isFinite(parsedDays) ? Math.max(0, Math.min(3650, parsedDays)) : 365;
  const nctId = String(options.nctId || "").trim().toUpperCase();
  const query = (options.query || "").trim();
  const cursor = Math.max(0, Number.parseInt(options.cursor, 10) || 0);
  const sequenceId = normalizeSequenceId(options.sequenceId);
  const runNumber = Math.max(1, Number.parseInt(options.runNumber, 10) || 1);
  const skipProcessed = options.skipProcessed !== false;
  const threshold = days === 0 ? 0 : Date.now() - days * 24 * 60 * 60 * 1000;
  const analysesByNctId = options.agentStore?.analysesByNctId || {};

  let selectedTrials = [];
  let totalCandidates = 0;

  if (nctId) {
    selectedTrials = dataset.trials.filter((trial) => trial.nctId.toUpperCase() === nctId);
    totalCandidates = selectedTrials.length;
  } else {
    let candidates = days === 0
      ? [...dataset.trials]
      : dataset.trials.filter((trial) => dateValue(trial.updatedAt || trial.firstPostedAt) >= threshold);

    if (query) {
      candidates = parseQueryFilters(query, candidates).matches;
    }

    if (skipProcessed) {
      candidates = candidates.filter((trial) => !analysesByNctId[trial.nctId]?.latest);
    }

    candidates = candidates.sort((left, right) => dateValue(right.updatedAt || right.firstPostedAt) - dateValue(left.updatedAt || left.firstPostedAt));
    totalCandidates = candidates.length;
    selectedTrials = candidates
      .slice(cursor, cursor + limit);
  }

  const selected = selectedTrials.map((trial) => ({
    nctId: trial.nctId,
    title: trial.title,
    sponsor: trial.sponsor,
    phase: trial.phase,
    studyType: trial.studyType,
    summary: trial.summary,
    interventionSummary: trial.interventionSummary,
    conditions: trial.conditions,
    locationSummary: trial.locationSummary,
    locations: trial.locations.slice(0, 6),
    updatedAt: trial.updatedAt,
    url: trial.url,
  }));

  return {
    instructions,
    limit,
    days,
    nctId,
    query,
    cursor,
    sequenceId,
    runNumber,
    skipProcessed,
    totalCandidates,
    selected,
  };
}

function normalizeLlmReport(rawReport, fallbackTrial) {
  const score = Math.max(0, Math.min(100, Number(rawReport.score) || 0));
  const fallbackRisk = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  const risk = ["low", "medium", "high"].includes(rawReport.risk) ? rawReport.risk : fallbackRisk;
  const reasons = Array.isArray(rawReport.reasons)
    ? rawReport.reasons.map((reason) => String(reason)).filter(Boolean).slice(0, 5)
    : [];

  return {
    nctId: fallbackTrial.nctId,
    title: fallbackTrial.title,
    sponsor: fallbackTrial.sponsor,
    updatedAt: fallbackTrial.updatedAt,
    locationSummary: fallbackTrial.locationSummary,
    url: fallbackTrial.url,
    score,
    risk,
    reasons: reasons.length ? reasons : ["The model returned no explicit reasons."],
    report: String(rawReport.report || "No report returned."),
  };
}

async function runOpenAiAgent(options) {
  const apiKey = (options.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Enter a key in the agent panel or set OPENAI_API_KEY for the server.");
  }

  const model = (options.model || "gpt-4.1-mini").trim();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trial_suspicion_report",
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
                    score: { type: "number" },
                    risk: { type: "string", enum: ["low", "medium", "high"] },
                    reasons: {
                      type: "array",
                      items: { type: "string" },
                    },
                    report: { type: "string" },
                  },
                  required: ["nctId", "score", "risk", "reasons", "report"],
                },
              },
            },
            required: ["reports"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are a clinical trial integrity analyst. Review registry records conservatively. Use only provided metadata. Do not invent facts. Score each trial from 0 to 100, where higher means more suspicious. Low score means weak evidence of concern, not proof of legitimacy.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              instructions: options.instructions,
              task: "Review these ALS ClinicalTrials.gov records and score suspiciousness for each one.",
              guidance: [
                "Focus on sponsor credibility, site credibility, cure-like or promotional language, and metadata inconsistencies.",
                "Avoid false positives for legitimate academic, hospital, or pharma-sponsored studies.",
                "Return one report per input trial and preserve the NCT ID exactly.",
              ],
              trials: options.selected,
            },
            null,
            2
          ),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("OpenAI returned invalid JSON for the agent run.");
  }

  return parsed;
}

async function buildAgentRun(dataset, options) {
  const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
  const selection = pickAgentCandidates(dataset, {
    ...options,
    agentStore,
  });
  const llmPayload = await runOpenAiAgent({
    apiKey: options.apiKey,
    model: options.model,
    instructions: selection.instructions,
    selected: selection.selected,
  });

  const reportsById = new Map(
    ((llmPayload && llmPayload.reports) || []).map((report) => [String(report.nctId || "").toUpperCase(), report])
  );

  const reports = selection.selected
    .map((trial) => normalizeLlmReport(reportsById.get(trial.nctId.toUpperCase()) || {}, trial))
    .sort((left, right) => right.score - left.score);

  const reportFile = await writeAgentReportCsv(
    {
      summary: selection,
      reports,
    },
    {
      sequenceId: selection.sequenceId,
      runNumber: selection.runNumber,
    }
  );

  upsertAgentAnalyses(
    agentStore,
    reports,
    {
      analyzedAt: timestampIso(),
      model: options.model || "gpt-4.1-mini",
      sequenceId: reportFile.sequenceId,
      runNumber: reportFile.runNumber,
      sourceFile: reportFile.latestRun.path,
    }
  );
  await writeAgentStore(agentStore);

  return {
    summary: {
      instructions: selection.instructions,
      model: options.model || "gpt-4.1-mini",
      reviewedCount: reports.length,
      flaggedCount: reports.filter((report) => report.score >= 40).length,
      highRiskCount: reports.filter((report) => report.score >= 70).length,
      medianScore: median(reports.map((report) => report.score)),
      windowLabel: selection.nctId
        ? `Specific trial: ${selection.nctId}`
        : selection.days === 0
          ? `Latest ${selection.limit} trials from all available study history`
          : `Latest ${selection.limit} trials from last ${selection.days} days`,
      queryLabel: selection.nctId ? "Filter: exact NCT ID match" : selection.query ? `Filter: ${selection.query}` : "Filter: none",
      orderingLabel: selection.nctId ? "Order: single trial" : "Order: highest suspicion first",
      skipProcessed: selection.skipProcessed,
    },
    continuation: selection.nctId
      ? null
      : {
          hasMore: selection.cursor + selection.selected.length < selection.totalCandidates,
          nextCursor: selection.cursor + selection.selected.length,
          processedUntil: selection.cursor + selection.selected.length,
          totalCandidates: selection.totalCandidates,
          sequenceId: reportFile.sequenceId,
          nextRunNumber: reportFile.runNumber + 1,
        },
    reportFile,
    reports,
  };
}

function buildSummary(query, filters, matches, totalIndexed, matchedCity) {
  if (!matches.length) {
    return `No ALS studies matched "${query}" in the current ClinicalTrials.gov cache of ${totalIndexed} studies.`;
  }

  const filterText = filters.length ? filters.join(", ") : "the default ALS dataset";

  if (matchedCity) {
    const citySiteCount = matches.reduce((count, trial) => {
      return (
        count +
        trial.locations.filter((location) => location.city.toLowerCase() === matchedCity.toLowerCase()).length
      );
    }, 0);

    return `Found ${matches.length} ALS studies matching ${filterText}. These studies include ${citySiteCount} listed site entries in ${matchedCity}.`;
  }

  const siteCount = matches.reduce((count, trial) => count + trial.locations.length, 0);
  const cityCount = unique(matches.flatMap((trial) => trial.cities)).length;
  return `Found ${matches.length} ALS studies matching ${filterText}. These results cover ${siteCount} listed sites across ${cityCount} cities.`;
}

function buildDisplayLocationSummary(trial, matchedCity) {
  if (!matchedCity) {
    return trial.locationSummary;
  }

  const prioritized = [
    ...trial.locations.filter((location) => location.city.toLowerCase() === matchedCity.toLowerCase()),
    ...trial.locations.filter((location) => location.city.toLowerCase() !== matchedCity.toLowerCase()),
  ];

  return prioritized.length
    ? prioritized
        .slice(0, 3)
        .map((location) => [location.facility, location.city, location.state].filter(Boolean).join(", "))
        .join(" · ")
    : trial.locationSummary;
}

async function syncTrials() {
  const [versionPayload, trials] = await Promise.all([fetchCtGovVersion(), fetchAllAlsStudies()]);
  const payload = {
    syncedAt: new Date().toISOString(),
    ctGovDataTimestamp: versionPayload.dataTimestamp || null,
    totalIndexed: trials.length,
    trials,
    stats: buildStats(trials),
  };

  await writeCache(payload);
  return payload;
}

async function getDataset(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cache = await readCache();

  if (!forceRefresh && cache && Date.now() - dateValue(cache.syncedAt) < CACHE_TTL_MS) {
    return cache;
  }

  return syncTrials();
}

async function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT_DIR, path.normalize(requestedPath));

  if (!filePath.startsWith(ROOT_DIR)) {
    textResponse(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    textResponse(response, 200, content, MIME_TYPES[extension] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") {
      textResponse(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/overview") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const liveStats = buildStats(dataset.trials);
      json(response, 200, {
        syncedAt: dataset.syncedAt,
        ctGovDataTimestamp: dataset.ctGovDataTimestamp,
        totalIndexed: dataset.totalIndexed,
        stats: {
          ...liveStats,
          agentProcessedCount: Object.values(agentStore.analysesByNctId || {}).filter((record) => record?.latest).length,
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trials") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const query = url.searchParams.get("q") || "";
      const { filters, matches, matchedCity } = parseQueryFilters(query, dataset.trials);

      json(response, 200, {
        query,
        filters,
        summary: buildSummary(query, filters, matches, dataset.totalIndexed, matchedCity),
        totalMatches: matches.length,
        shownCount: Math.min(matches.length, 25),
        trials: matches.slice(0, 25).map((trial) =>
          attachAgentAnalysis(
            {
              ...trial,
              locationSummary: buildDisplayLocationSummary(trial, matchedCity),
            },
            agentStore
          )
        ),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/high-risk") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      json(response, 200, {
        trials: buildHighRiskTrials(dataset, agentStore),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/medium-risk") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      json(response, 200, {
        trials: buildMediumRiskTrials(dataset, agentStore),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/screened") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      json(response, 200, buildScreenedTrials(dataset, agentStore));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const filePath = await writeAllAgentAnalysesCsv(dataset, agentStore);
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="all-agent-analyses.csv"',
        "Cache-Control": "no-store",
      });
      response.end(content);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export-flagged") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const filePath = await writeFlaggedAgentTrialsCsv(dataset, agentStore);
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="flagged-agent-trials.csv"',
        "Cache-Control": "no-store",
      });
      response.end(content);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export-flagged-html") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      textResponse(response, 200, buildFlaggedTrialsReportHtml(dataset, agentStore), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export-flagged-doc") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      response.writeHead(200, {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": 'attachment; filename="flagged-agent-trials.doc"',
        "Cache-Control": "no-store",
      });
      response.end(buildFlaggedTrialsReportHtml(dataset, agentStore, { wordExport: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trial-details") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const nctId = url.searchParams.get("nctId") || "";
      const payload = buildTrialDetail(dataset, agentStore, nctId);

      if (!payload) {
        json(response, 404, { error: `Trial not found for ${nctId}` });
        return;
      }

      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sync") {
      const dataset = await getDataset({ forceRefresh: true });
      json(response, 200, {
        syncedAt: dataset.syncedAt,
        ctGovDataTimestamp: dataset.ctGovDataTimestamp,
        totalIndexed: dataset.totalIndexed,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agent/run") {
      const dataset = await getDataset();
      const body = await readRequestBody(request);
      json(response, 200, await buildAgentRun(dataset, body));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, 500, {
      error: error.message || "Unexpected server error",
    });
  }
});

if (require.main === module) {
  loadEnvFile()
    .then(() => {
      server.listen(PORT, HOST, () => {
        console.log(`ALS Trial Navigator running at http://${HOST}:${PORT}`);
      });
    })
    .catch((error) => {
      console.error(`Failed to load .env: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  buildAgentRun,
  buildStats,
  normalizeStudy,
  parseQueryFilters,
  syncTrials,
  server,
};
