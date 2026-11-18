const {updateSavedTrials}=require('./saved-trials');
const {buildTrialDataTable}=require('./trial-data-table');
const {placeboCategory,placeboAssessment,registryPlaceboCategory}=require('./dashboard-placebo');
const {sourceFor: placeboSource, hash: placeboHash}=require('./placebo-agent');
const {buildTriage,saveTriage,publishTriage,trainingRows,saveTriageDraft}=require('./review-triage');
const {applyTrialOverrides}=require('./trial-overrides');
const http = require("node:http");
const { streamResult } = require("./ai-transport");
const { createUpdateAssistant } = require("./update-assistant");
const { runSavaSearch } = require("./sava-search");
const { createReviewStore, buildReviewQueues, saveReview } = require("./review-portal");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TARGET_STATUSES, enrichDataset: enrichTargetingDataset } = require("./trial-targeting");

const STARTED_AT = new Date().toISOString();
const ASSISTANT_VERSION = "conversation-v3";
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8000);
const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT_DIR;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const portalReviewStore = createReviewStore(path.join(DATA_DIR, "expert-portal-reviews.json"));
const conversationStore = createReviewStore(path.join(DATA_DIR, "assistant-conversations.json"));
const updateAssistant = createUpdateAssistant(portalReviewStore, {conversationStore});
const PROMPTS_DIR = path.join(ROOT_DIR, "prompts");
const CACHE_FILE = path.join(DATA_DIR, "trials-cache.json");
const AGENT_STORE_FILE = path.join(DATA_DIR, "agent-analyses.json");
const MANUAL_REVIEW_FILE = path.join(DATA_DIR, "manual-review.json");
const NEW_YORK_DATABASE_FILE = path.join(DATA_DIR, "new-york-trials-database.json");
const NEW_YORK_SEARCH_PROMPT_FILE = path.join(PROMPTS_DIR, "new-york-search-system.txt");
const SUSPICIOUS_TRIAL_AGENT_PROMPT_FILE = path.join(PROMPTS_DIR, "suspicious-trial-agent-prompt.txt");
const INCONSISTENCY_STORE_FILE = path.join(DATA_DIR, "inconsistency-analyses.json");
const INCONSISTENCY_AGENT_PROMPT_FILE = path.join(PROMPTS_DIR, "trial-inconsistency-agent-prompt.txt");
const REPORTS_DIR = path.join(STORAGE_DIR, "reports");
const CTG_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies";
const CTG_VERSION_URL = "https://clinicaltrials.gov/api/v2/version";
const DEFAULT_CONDITION = "ALS";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENV_FILE = path.join(ROOT_DIR, ".env");
const DEFAULT_NEW_YORK_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.4-mini";

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

async function readManualReviewStore() {
  try {
    const payload = await fs.readFile(MANUAL_REVIEW_FILE, "utf8");
    const parsed = JSON.parse(payload);
    return {
      manualByNctId: parsed.manualByNctId || {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return { manualByNctId: {} };
  }
}

async function writeManualReviewStore(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MANUAL_REVIEW_FILE, JSON.stringify(payload, null, 2));
}

async function readInconsistencyStore() {
  try {
    const payload = await fs.readFile(INCONSISTENCY_STORE_FILE, "utf8");
    return JSON.parse(payload);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { analysesByNctId: {} };
    }
    throw error;
  }
}

async function writeInconsistencyStore(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INCONSISTENCY_STORE_FILE, JSON.stringify(payload, null, 2));
}

async function writeNewYorkTrialDatabase(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NEW_YORK_DATABASE_FILE, JSON.stringify(payload, null, 2));
}

async function loadNewYorkSearchSystemPrompt() {
  try {
    return await fs.readFile(NEW_YORK_SEARCH_PROMPT_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return "You answer questions only from the provided New York ALS trial database. Be concise, factual, and do not invent facts. If the answer is not supported by the provided data, say that clearly. Cite relevant NCT IDs in citedNctIds.";
  }
}

async function loadSuspiciousTrialAgentPrompt() {
  try {
    return await fs.readFile(SUSPICIOUS_TRIAL_AGENT_PROMPT_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return "You are a clinical trial integrity analyst. Review registry records conservatively. Use only provided metadata. Do not invent facts. Score each trial from 0 to 100, where higher means more suspicious. Low score means weak evidence of concern, not proof of legitimacy.";
  }
}

async function loadInconsistencyAgentPrompt() {
  try {
    return await fs.readFile(INCONSISTENCY_AGENT_PROMPT_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return "You check ALS ClinicalTrials.gov records for study-type inconsistencies and interventional subtypes. Use only provided metadata. Do not invent facts.";
  }
}

function extractResponseText(payload) {
  const directText = String(payload?.output_text || "").trim();
  if (directText) {
    return directText;
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const textParts = [];

  for (const item of outputs) {
    if (item?.type !== "message") {
      continue;
    }

    for (const contentItem of item.content || []) {
      if (contentItem?.type === "output_text" && contentItem.text) {
        textParts.push(contentItem.text);
        continue;
      }

      if (contentItem?.type === "text" && contentItem.text) {
        textParts.push(contentItem.text);
      }
    }
  }

  return textParts.join("\n\n").trim();
}

function clipText(value, maxLength = 360) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function tokenizeQuery(value) {
  return unique(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2)
  );
}

function scoreNewYorkEntry(entry, tokens) {
  if (!tokens.length) {
    return 0;
  }

  const haystack = [
    entry.nctId,
    entry.title,
    entry.status,
    entry.studyType,
    entry.phase,
    entry.sponsor,
    entry.interventionSummary,
    ...(entry.conditions || []),
    ...(entry.interventions || []),
    entry.briefSummary,
    entry.detailedDescription,
    entry.locationSummary,
    ...(entry.newYorkSites || []).flatMap((site) => [site.facility, site.city, site.state, site.status]),
    ...(entry.centralContacts || []).flatMap((contact) => [contact.name, contact.role, contact.email]),
    ...(entry.overallOfficials || []).flatMap((official) => [official.name, official.role, official.affiliation]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) {
      continue;
    }
    score += 1;
    if (String(entry.nctId || "").toLowerCase() === token) {
      score += 10;
    }
    if (String(entry.title || "").toLowerCase().includes(token)) {
      score += 4;
    }
    if (String(entry.sponsor || "").toLowerCase().includes(token)) {
      score += 2;
    }
  }
  return score;
}

function buildCompactNewYorkContext(question, database) {
  const entries = database.entries || [];
  const tokens = tokenizeQuery(question);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreNewYorkEntry(entry, tokens) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return dateValue(right.entry.updatedAt) - dateValue(left.entry.updatedAt);
    });

  const selected = ranked.some((item) => item.score > 0)
    ? ranked.filter((item) => item.score > 0).slice(0, 6).map((item) => item.entry)
    : ranked.slice(0, 6).map((item) => item.entry);

  return {
    summary: database.summary,
    totalMatches: database.totalMatches,
    retrievedCount: selected.length,
    entries: selected.map((entry) => ({
      nctId: entry.nctId,
      title: entry.title,
      status: entry.status,
      studyType: entry.studyType,
      phase: entry.phase,
      sponsor: entry.sponsor,
      conditions: entry.conditions || [],
      interventions: entry.interventions || [],
      interventionSummary: entry.interventionSummary,
      briefSummary: clipText(entry.briefSummary, 420),
      detailedDescription: clipText(entry.detailedDescription, 700),
      totalSiteCount: entry.totalSiteCount || 0,
      newYorkSiteCount: entry.newYorkSiteCount || 0,
      newYorkSites: (entry.newYorkSites || []).slice(0, 8),
      centralContacts: entry.centralContacts || [],
      overallOfficials: entry.overallOfficials || [],
      updatedAt: entry.updatedAt,
      url: entry.url,
    })),
  };
}

function csvHeader() {
  return [
    "nct_id",
    "title",
    "sponsor",
    "status",
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
    report.status,
    report.updatedAt,
    report.score,
    report.risk,
    report.report,
    report.reasons.join(" | "),
    report.url,
  ]);
}

function getManualReview(manualStore, nctId) {
  return manualStore?.manualByNctId?.[nctId] || null;
}

function isManuallyVerified(manualStore, nctId) {
  return getManualReview(manualStore, nctId)?.status === "verified";
}

function attachManualReview(trial, manualStore) {
  const manualReview = getManualReview(manualStore, trial.nctId);
  if (!manualReview) {
    return trial;
  }

  return {
    ...trial,
    manualReview,
  };
}

function attachReviewMetadata(trial, agentStore, manualStore) {
  return attachManualReview(attachAgentAnalysis(trial, agentStore), manualStore);
}

function latestAnalysisRows(dataset, agentStore, manualStore = {}) {
  const trialsById = new Map(dataset.trials.map((trial) => [trial.nctId, trial]));

  return Object.entries(agentStore?.analysesByNctId || {})
    .map(([nctId, record]) => {
      const latest = record?.latest;
      if (!latest) {
        return null;
      }

      const trial = trialsById.get(nctId);
      const manualReview = getManualReview(manualStore, nctId);
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
        manualReviewStatus: manualReview?.status || "",
        manuallyVerifiedAt: manualReview?.verifiedAt || "",
        manuallyVerifiedNote: manualReview?.note || "",
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

async function writeAllAgentAnalysesCsv(dataset, agentStore, manualStore = {}) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const rows = latestAnalysisRows(dataset, agentStore, manualStore);
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
      "manual_review_status",
      "manually_verified_at",
      "manual_review_note",
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
      row.manualReviewStatus,
      row.manuallyVerifiedAt,
      row.manuallyVerifiedNote,
      row.trialUrl,
    ]),
  ];

  const filename = "all-agent-analyses.csv";
  const filePath = path.join(REPORTS_DIR, filename);
  await fs.writeFile(filePath, toCsv(csvRows), "utf8");
  return filePath;
}

async function writeFlaggedAgentTrialsCsv(dataset, agentStore, manualStore = {}) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const rows = latestAnalysisRows(dataset, agentStore, manualStore).filter(
    (row) => ["medium", "high"].includes(row.risk) && row.manualReviewStatus !== "verified"
  );
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

function yesNo(value) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return "";
}

function normalizeContact(contact) {
  if (!contact) {
    return null;
  }

  return {
    name: contact.name || "",
    role: contact.role ? titleCase(contact.role) : "",
    phone: contact.phone || "",
    phoneExt: contact.phoneExt || "",
    email: contact.email || "",
  };
}

function normalizeOfficial(official) {
  if (!official) {
    return null;
  }

  return {
    name: official.name || "",
    role: official.role || "",
    affiliation: official.affiliation || "",
  };
}

function flaggedAnalysisRows(dataset, agentStore, manualStore = {}) {
  return latestAnalysisRows(dataset, agentStore, manualStore).filter(
    (row) => ["medium", "high"].includes(row.risk) && row.manualReviewStatus !== "verified"
  );
}

function flaggedRiskSummary(rows) {
  return {
    total: rows.length,
    high: rows.filter((row) => row.risk === "high").length,
    medium: rows.filter((row) => row.risk === "medium").length,
  };
}

function buildFlaggedTrialsReportHtml(dataset, agentStore, manualStore = {}, options = {}) {
  const rows = flaggedAnalysisRows(dataset, agentStore, manualStore);
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
  const centralContacts = (locationsModule.centralContacts || []).map(normalizeContact).filter(Boolean);
  const overallOfficials = (locationsModule.overallOfficials || []).map(normalizeOfficial).filter(Boolean);

  const nctId = idModule.nctId;
  if (!nctId) {
    return null;
  }

  const locations = locationEntries.map((location) => ({
    facility: location.facility || "Unknown site",
    city: location.city || "",
    state: location.state || "",
    country: location.country || "",
    status: location.status ? titleCase(location.status) : "",
    zip: location.zip || "",
    contacts: (location.contacts || []).map(normalizeContact).filter(Boolean),
  }));

  const cities = unique(locations.map((location) => location.city));
  const states = unique(locations.map((location) => location.state));
  const interventionDetails = interventionEntries.map((intervention) => ({
    name: intervention.name || "",
    type: titleCase(intervention.type || "Unknown"),
    description: clipText(intervention.description || "", 280),
  }));
  const interventions = unique(interventionDetails.map((intervention) => intervention.name));
  const interventionTypes = unique(interventionDetails.map((intervention) => intervention.type));
  const conditions = unique(conditionsModule.conditions || []);
  const phaseValues = designModule.phases && designModule.phases.length ? designModule.phases.map(titleCase) : [];
  const designInfo = designModule.designInfo || {};

  return {
    nctId,
    title: idModule.briefTitle || idModule.officialTitle || nctId,
    officialTitle: idModule.officialTitle || "",
    eligibilityCriteria: protocol.eligibilityModule?.eligibilityCriteria || "",
    studyPopulation: protocol.eligibilityModule?.studyPopulation || "",
    armGroups: interventionsModule.armGroups || [],
    targetingInterventions: interventionEntries,
    summary: descriptionModule.briefSummary || "",
    detailedDescription: descriptionModule.detailedDescription || "",
    status: titleCase(statusModule.overallStatus),
    phase: phaseValues.length ? phaseValues.join(", ") : titleCase(designModule.studyType || "Unknown"),
    studyType: titleCase(designModule.studyType || "Unknown"),
    primaryPurpose: titleCase(designInfo.primaryPurpose || ""),
    allocation: titleCase(designInfo.allocation || ""),
    interventionModel: titleCase(designInfo.interventionModel || ""),
    observationalModel: titleCase(designInfo.observationalModel || ""),
    timePerspective: titleCase(designInfo.timePerspective || ""),
    sponsor: sponsorModule.leadSponsor?.name || "Unknown sponsor",
    interventions,
    interventionTypes,
    interventionDetails: interventionDetails.slice(0, 8),
    interventionSummary: interventions.length ? interventions.slice(0, 2).join(", ") : "No listed intervention",
    conditions,
    locations,
    centralContacts,
    overallOfficials,
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
    startDate: statusModule.startDateStruct?.date || null,
    primaryCompletionDate: statusModule.primaryCompletionDateStruct?.date || null,
    completionDate: statusModule.completionDateStruct?.date || null,
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

function buildHighRiskTrials(dataset, agentStore, manualStore = {}) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  return Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (!trial || !record.latest || record.latest.risk !== "high" || isManuallyVerified(manualStore, nctId)) {
        return null;
      }

      return attachReviewMetadata(trial, agentStore, manualStore);
    })
    .filter(Boolean)
    .sort((left, right) => (right.agentAnalysis?.score || 0) - (left.agentAnalysis?.score || 0))
    .slice(0, 20);
}

function buildMediumRiskTrials(dataset, agentStore, manualStore = {}) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  return Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (
        !trial ||
        !record.latest ||
        !["high", "medium"].includes(record.latest.risk) ||
        isManuallyVerified(manualStore, nctId)
      ) {
        return null;
      }

      return attachReviewMetadata(trial, agentStore, manualStore);
    })
    .filter(Boolean)
    .sort((left, right) => (right.agentAnalysis?.score || 0) - (left.agentAnalysis?.score || 0));
}

function buildScreenedTrials(dataset, agentStore, manualStore = {}) {
  const analysesByNctId = agentStore?.analysesByNctId || {};
  const latestTrials = Object.entries(analysesByNctId)
    .map(([nctId, record]) => {
      const trial = dataset.trials.find((item) => item.nctId === nctId);
      if (!trial || !record.latest) {
        return null;
      }

      return attachReviewMetadata(trial, agentStore, manualStore);
    })
    .filter(Boolean)
    .sort((left, right) => dateValue(right.agentAnalysis?.analyzedAt) - dateValue(left.agentAnalysis?.analyzedAt));

  const flaggedCount = latestTrials.filter(
    (trial) => ["high", "medium"].includes(trial.agentAnalysis?.risk) && trial.manualReview?.status !== "verified"
  ).length;
  const lowRiskTrials = latestTrials.filter((trial) => trial.agentAnalysis?.risk === "low");
  const manuallyVerifiedCount = latestTrials.filter((trial) => trial.manualReview?.status === "verified").length;

  return {
    summary: {
      totalProcessed: latestTrials.length,
      flaggedCount,
      lowRiskCount: lowRiskTrials.length,
      manuallyVerifiedCount,
    },
    trials: lowRiskTrials.slice(0, 12),
  };
}

function buildNyuTrials(dataset, agentStore) {
  const matches = dataset.trials
    .filter((trial) => {
      const inNewYork = (trial.locations || []).some((location) => String(location.state || "").toLowerCase() === "new york");
      if (!inNewYork) {
        return false;
      }

      const recruiting = trial.status === "Recruiting";
      const expandedAccess =
        trial.studyType === "Expanded Access" && ["Available", "Approved For Marketing"].includes(trial.status);

      return recruiting || expandedAccess;
    })
    .sort((left, right) => dateValue(right.updatedAt || right.firstPostedAt) - dateValue(left.updatedAt || left.firstPostedAt))
    .map((trial) => attachAgentAnalysis(trial, agentStore));

  return {
    summary: `Found ${matches.length} New York ALS studies that are recruiting participants or available through expanded access, including approved-for-marketing access programs.`,
    totalMatches: matches.length,
    trials: matches,
  };
}

function buildNewYorkTrialDatabase(dataset, agentStore) {
  const source = buildNyuTrials(dataset, agentStore);
  const entries = source.trials.map((trial) => {
    const newYorkSites = (trial.locations || [])
      .filter((location) => String(location.state || "").toLowerCase() === "new york")
      .map((location) => ({
        facility: location.facility || "Unknown site",
        city: location.city || "",
        state: location.state || "",
        country: location.country || "",
        status: location.status || "",
        zip: location.zip || "",
        contacts: location.contacts || [],
      }));

    return {
      nctId: trial.nctId,
      title: trial.title,
      status: trial.status,
      studyType: trial.studyType,
      phase: trial.phase,
      sponsor: trial.sponsor,
      conditions: trial.conditions || [],
      interventions: trial.interventions || [],
      interventionSummary: trial.interventionSummary,
      briefSummary: trial.summary || "No brief summary available.",
      detailedDescription: trial.detailedDescription || "No detailed description available in the current cache.",
      allSites: trial.locations || [],
      totalSiteCount: (trial.locations || []).length,
      newYorkSites,
      newYorkSiteCount: newYorkSites.length,
      locationSummary: trial.locationSummary,
      centralContacts: trial.centralContacts || [],
      overallOfficials: trial.overallOfficials || [],
      updatedAt: trial.updatedAt,
      url: trial.url,
      agentAnalysis: trial.agentAnalysis || null,
    };
  });

  return {
    summary: source.summary,
    totalMatches: entries.length,
    entries,
  };
}

async function runNewYorkTrialsChat(options) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Add it to your .env file to use New York Search chat.");
  }

  const question = String(options.question || "").trim();
  if (!question) {
    throw new Error("Question is required.");
  }

  const systemPrompt = await loadNewYorkSearchSystemPrompt();
  const model = String(process.env.OPENAI_CHAT_MODEL || DEFAULT_NEW_YORK_CHAT_MODEL).trim() || "gpt-5.4-mini";
  let conversationId = String(options.conversationId || "").trim();

  if (!conversationId) {
    const conversationResponse = await fetch("https://api.openai.com/v1/conversations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!conversationResponse.ok) {
      const detail = await conversationResponse.text();
      throw new Error(`OpenAI conversation creation failed: ${conversationResponse.status} ${detail}`);
    }

    const conversationPayload = await conversationResponse.json();
    conversationId = conversationPayload.id || "";
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      conversation: conversationId,
      temperature: 0.2,
      input: [
        {
          role: "developer",
          content: [
            systemPrompt,
            "Conversation memory is for follow-up context and user preferences only.",
            "Use the provided New York ALS trial database in this turn as the source of truth for trial facts.",
            "If information is missing from the provided trial database, say that clearly.",
            "Cite relevant NCT IDs inline when they support the answer.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "Answer a clinician's question about the provided New York ALS trials database.",
              question,
              database: buildCompactNewYorkContext(question, options.database),
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
  const text = extractResponseText(payload);
  if (!text) {
    const status = payload?.status ? ` status=${payload.status}` : "";
    throw new Error(`OpenAI returned an empty answer for the New York Search chat.${status}`);
  }

  const citedNctIds = unique(text.match(/\bNCT\d{8}\b/gi) || []).map((item) => String(item).toUpperCase());
  return {
    text,
    citedNctIds,
    conversation_id: conversationId,
  };
}

function buildTrialDetail(dataset, agentStore, nctId, inconsistencyStore, manualStore = {}) {
  const trial = dataset.trials.find((item) => item.nctId.toUpperCase() === nctId.toUpperCase());
  if (!trial) {
    return null;
  }

  const analysis = agentStore?.analysesByNctId?.[trial.nctId] || { latest: null, history: [] };
  const inconsistency = inconsistencyStore?.analysesByNctId?.[trial.nctId] || { latest: null, history: [] };
  return {
    trial: attachManualReview(attachInconsistencyAnalysis(attachAgentAnalysis(trial, agentStore), inconsistencyStore), manualStore),
    agentHistory: [...(analysis.history || [])].sort((left, right) => dateValue(right.analyzedAt) - dateValue(left.analyzedAt)),
    inconsistencyHistory: [...(inconsistency.history || [])].sort((left, right) => dateValue(right.analyzedAt) - dateValue(left.analyzedAt)),
  };
}

function buildTargetingResults(dataset) {
  const targetStatuses = new Set(TARGET_STATUSES);
  const eligibleTrials = dataset.trials.filter((trial) => targetStatuses.has(trial.status));
  const trials = eligibleTrials
    .filter((trial) => trial.targeting?.status === "screened")
    .map((trial) => ({
      nctId: trial.nctId,
      title: trial.title,
      status: trial.status,
      studyType: trial.studyType,
      phase: trial.phase,
      sponsor: trial.sponsor,
      updatedAt: trial.updatedAt,
      url: trial.url,
      targeting: trial.targeting,
    }));

  return {
    totalEligible: eligibleTrials.length,
    totalScreened: trials.length,
    remaining: eligibleTrials.length - trials.length,
    statusCounts: Object.fromEntries(TARGET_STATUSES.map((status) => [status, eligibleTrials.filter((trial) => trial.status === status).length])),
    trials,
  };
}

function filterDashboardDataset(dataset, searchParams) {
  if (searchParams.get("ongoingOnly") !== "true") return dataset;
  const statuses = new Set(["Recruiting", "Active Not Recruiting", "Not Yet Recruiting", "Available"]);
  const trials = dataset.trials.filter((trial) => statuses.has(trial.status));
  return { ...dataset, trials, totalIndexed: trials.length };
}

function targetingFindingCategory(finding) {
  if (finding.relationship === "excluded") return "excluded";
  if (finding.relationship === "cohort") {
    const detail = String(finding.detail || "");
    const value = String(finding.value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directlyExcluded = new RegExp(
      `(?:\\b${value}\\b[^.]{0,80}\\b(?:is|are) excluded\\b|\\b(?:is|are) excluded\\b[^.]{0,120}\\b${value}\\b)`,
      "i"
    ).test(detail);
    if (directlyExcluded && !new RegExp(`\\bbesides\\s+${value}\\b`, "i").test(detail)) return "excluded";
  }
  if (finding.relationship === "allowed") return "allowed";
  if (finding.relationship === "required") return "whole";
  if (finding.relationship === "cohort") return "cohort";
  if (finding.relationship === "study_focus") return "focus";
  return "context";
}


function targetedGenes(trial, relationship = "include") {
  return [...new Set((trial.targeting?.findings || [])
    .filter(f => f.dimension === "gene" && (relationship === "exclude" ? targetingFindingCategory(f) === "excluded" : ["whole", "cohort", "focus"].includes(targetingFindingCategory(f))))
    .map(f => String(f.value || "").trim().toUpperCase()).filter(Boolean))];
}

function matchesTargetPopulation(trial, label) {
  if (label.startsWith("Gene excluded: ")) return targetedGenes(trial, "exclude").includes(label.slice(15));
  if (label.startsWith("Gene: ")) return targetedGenes(trial).includes(label.slice(6));
  const positive = (trial.targeting?.findings || []).filter(finding =>
    ["whole", "cohort", "focus"].includes(targetingFindingCategory(finding)));
  if (label === "No positive target identified") return !positive.length;
  const dimensions = {"Gene-defined": ["gene"], "Phenotype-defined": ["phenotype"], "Onset or progression": ["onset", "progression"]}[label];
  return Boolean(dimensions && positive.some(finding => dimensions.includes(finding.dimension)));
}


function buildStats(trials) {
  const recruitingCount = trials.filter((trial) => trial.status === "Recruiting").length;
  const bostonCount = trials.filter((trial) => trial.cities.some((city) => city.toLowerCase() === "boston")).length;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const newThisWeekCount = trials.filter((trial) => dateValue(trial.firstPostedAt) >= sevenDaysAgo).length;

  const recentlyPostedTrials = trials.filter(trial => {
    const date = dateValue(trial.firstPostedAt);
    return date >= now - 30 * 24 * 60 * 60 * 1000 && date <= now;
  });
  const postedLast30Days = recentlyPostedTrials.length;
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

  const studyTypeMap = new Map();
  for (const trial of trials) {
    const purpose = String(trial.primaryPurpose || "").trim();
    const label = trial.studyType === "Interventional"
      ? (purpose.toLowerCase() === "treatment" ? "Interventional — treatment"
        : !purpose || /^(unknown|n\/a|na)$/i.test(purpose) ? "Interventional — purpose unspecified"
        : "Interventional — other purposes")
      : trial.studyType || "Unknown";
    studyTypeMap.set(label, (studyTypeMap.get(label) || 0) + 1);
  }
  const studyTypeCounts = [...studyTypeMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => ({ label, count, percent: Math.round((count / total) * 100) }));

  const interventionalTrials = trials.filter((trial) => trial.studyType === "Interventional");
  const interventionMap = new Map();
  for (const trial of interventionalTrials) {
    for (const type of new Set(trial.interventionTypes?.length ? trial.interventionTypes : ["Not specified"])) {
      interventionMap.set(type, (interventionMap.get(type) || 0) + 1);
    }
  }
  const interventionTypeCounts = [...interventionMap].sort((a,b) => b[1] - a[1]).map(([label,count]) => ({ label, count, percent: Math.round(count / (interventionalTrials.length || 1) * 100) }));
  const screened = interventionalTrials.filter(trial => trial.targeting?.status === "screened");
  const populationCounts = ["Gene-defined", "Phenotype-defined", "Onset or progression", "No positive target identified"]
    .map(label => { const count = screened.filter(trial => matchesTargetPopulation(trial, label)).length; return {label,count,percent:Math.round(count / (screened.length || 1) * 100)}; });
  const geneCounts = new Map();
  for (const trial of screened) for (const relationship of ["include", "exclude"]) {
    for (const gene of targetedGenes(trial, relationship)) {
      if (!geneCounts.has(gene)) geneCounts.set(gene, {label:gene, count:0, excludeCount:0});
      geneCounts.get(gene)[relationship === "include" ? "count" : "excludeCount"]++;
    }
  }
  const geneticPopulationCounts = [...geneCounts.values()].sort((a,b) => b.count-a.count || b.excludeCount-a.excludeCount || a.label.localeCompare(b.label));
  const targetingScreenedCount = screened.length;
  const phaseMap = new Map();
  for (const trial of interventionalTrials) {
    const label = !trial.phase || ["Na", "N/A", "Unknown", "Interventional"].includes(trial.phase)
      ? "Not applicable"
      : trial.phase.replaceAll(", ", "/");
    phaseMap.set(label, (phaseMap.get(label) || 0) + 1);
  }
  const phaseOrder = ["Early Phase 1", "Phase 1", "Phase 1/Phase 2", "Phase 2", "Phase 2/Phase 3", "Phase 3", "Phase 4", "Not applicable"];
  const phaseTotal = interventionalTrials.length || 1;
  const phaseCounts = [...phaseMap.entries()]
    .sort((left, right) => phaseOrder.indexOf(left[0]) - phaseOrder.indexOf(right[0]))
    .map(([label, count]) => ({ label, count, percent: Math.round((count / phaseTotal) * 100) }));

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
  const usCityMap = new Map();
  for (const trial of trials) {
    for (const city of trial.cities) {
      cityMap.set(city, (cityMap.get(city) || 0) + 1);
    }
    const citiesInTrial = new Set(
      (trial.locations || [])
        .filter((location) => location.country === "United States" && location.city)
        .map((location) => `${location.city}\u0000${location.state || ""}`)
    );
    for (const cityKey of citiesInTrial) {
      usCityMap.set(cityKey, (usCityMap.get(cityKey) || 0) + 1);
    }
  }

  const topCities = [...cityMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, count }));

  const topUsCities = [...usCityMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([cityKey, count]) => {
      const [city, state] = cityKey.split("\u0000");
      return { city, state, count };
    });

  const newOpportunities = [...recentlyPostedTrials]
    .sort((left, right) => dateValue(right.firstPostedAt) - dateValue(left.firstPostedAt))
    .map((trial) => {
      const summaryText = String(trial.summary || "")
        .replace(/[*_#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const sentences = summaryText.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
      const purposeSentence = sentences.slice(0, 8).find((sentence) =>
        /\b(?:goal|aim|this study|the study|researchers will|investigators will|will evaluate|will examine|is testing|is a .*study|assess whether|develop new ways)\b/i.test(sentence)
      );
      const explainerText = purposeSentence || sentences[0] || summaryText;
      const explainer = explainerText.length > 260 ? `${explainerText.slice(0, 257).trimEnd()}…` : explainerText;
      return {
        nctId: trial.nctId,
        title: trial.title,
        status: trial.status,
        studyType: trial.studyType,
        phase: trial.phase,
        firstPostedAt: trial.firstPostedAt,
        explainer: explainer || "The registry does not provide a brief plain-language summary for this study.",
      };
    });

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
    postedLast30Days,
    interventionTypeCounts,
    populationCounts,
    geneticPopulationCounts,
    placeboCounts: ['Placebo', 'No placebo', 'Not specified', 'Not relevant'].map(label => ({label, count:interventionalTrials.filter(trial => placeboCategory(trial) === label).length})).filter(item => item.count),
    registryPlaceboCounts: ['Placebo', 'No placebo', 'Not specified'].map(label => ({label, count:interventionalTrials.filter(trial => registryPlaceboCategory(trial) === label).length})).filter(item => item.count),
    targetingScreenedCount,
    bostonCount,
    newThisWeekCount,
    statusCounts,
    studyTypeCounts,
    phaseCounts,
    phaseTotal: interventionalTrials.length,
    interventionThemes,
    topCities,
    topUsCities,
    newOpportunities,
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

function parseQueryFilters(query, trials, explicit = {}) {
  const normalizedQuery = normalizeText(query || "");
  const filters = [];
  let matches = [...trials];
  let matchedCity = null;

  const cities = unique(trials.flatMap((trial) => trial.cities)).sort((left, right) => right.length - left.length);
  matchedCity = cities.find((city) => city && normalizedQuery.includes(city.toLowerCase())) || null;
  if (matchedCity && !explicit.city) {
    matches = matches.filter((trial) => trial.cities.some((city) => city.toLowerCase() === matchedCity.toLowerCase()));
    filters.push(`City: ${matchedCity}`);
  }

  const statuses = [
    { needle: "not yet recruiting", value: "Not Yet Recruiting" },
    { needle: "active not recruiting", value: "Active Not Recruiting" },
    { needle: "enrolling by invitation", value: "Enrolling By Invitation" },
    { needle: "recruiting", value: "Recruiting" },
    { needle: "completed", value: "Completed" },
  ];

  for (const status of statuses) {
    if (!explicit.status && normalizedQuery.includes(status.needle)) {
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
    if (!explicit.studyType && normalizedQuery.includes(studyType.needle)) {
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

  for (const [key, label] of [["status", "Status"], ["studyType", "Type"], ["phase", "Phase"]]) {
    if (!explicit[key]) continue;
    const value = normalizeText(explicit[key]).trim();
    matches = matches.filter(trial => key === "phase"
      ? String(trial.phase || "").split(/[,/]/).some(phase => normalizeText(phase).trim() === value)
      : normalizeText(trial[key] || "").trim() === value);
    filters.push(`${label}: ${explicit[key]}`);
  }
  if (explicit.city) {
    matchedCity = explicit.city.trim();
    matches = matches.filter(trial => (trial.cities || []).some(city => normalizeText(city).trim() === normalizeText(matchedCity).trim()));
    filters.push(`City: ${matchedCity}`);
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

function normalizeStatusFilter(value) {
  return normalizeText(value);
}

function parseStatusFilters(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(value.map((status) => String(status || "").trim()).filter(Boolean));
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
  const statuses = parseStatusFilters(options.statuses);
  const statusSet = new Set(statuses.map(normalizeStatusFilter));
  const threshold = days === 0 ? 0 : Date.now() - days * 24 * 60 * 60 * 1000;
  const analysesByNctId = options.agentStore?.analysesByNctId || {};

  let selectedTrials = [];
  let candidateTrials = [];
  let totalCandidates = 0;

  if (nctId) {
    selectedTrials = dataset.trials.filter((trial) => trial.nctId.toUpperCase() === nctId);
    candidateTrials = selectedTrials;
    totalCandidates = selectedTrials.length;
  } else {
    let candidates = days === 0
      ? [...dataset.trials]
      : dataset.trials.filter((trial) => dateValue(trial.updatedAt || trial.firstPostedAt) >= threshold);

    if (statusSet.size) {
      candidates = candidates.filter((trial) => statusSet.has(normalizeStatusFilter(trial.status)));
    }

    if (query) {
      candidates = parseQueryFilters(query, candidates).matches;
    }

    if (skipProcessed) {
      candidates = candidates.filter((trial) => !analysesByNctId[trial.nctId]?.latest);
    }

    candidates = candidates.sort((left, right) => dateValue(right.updatedAt || right.firstPostedAt) - dateValue(left.updatedAt || left.firstPostedAt));
    candidateTrials = candidates;
    totalCandidates = candidates.length;
    selectedTrials = candidates
      .slice(cursor, cursor + limit);
  }

  const selected = selectedTrials.map((trial) => ({
    nctId: trial.nctId,
    title: trial.title,
    sponsor: trial.sponsor,
    status: trial.status,
    phase: trial.phase,
    studyType: trial.studyType,
    primaryPurpose: trial.primaryPurpose || "",
    allocation: trial.allocation || "",
    interventionModel: trial.interventionModel || "",
    observationalModel: trial.observationalModel || "",
    timePerspective: trial.timePerspective || "",
    summary: trial.summary,
    detailedDescription: clipText(trial.detailedDescription, 900),
    interventionSummary: trial.interventionSummary,
    interventionTypes: trial.interventionTypes || [],
    interventionDetails: trial.interventionDetails || [],
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
    statuses,
    cursor,
    sequenceId,
    runNumber,
    skipProcessed,
    totalCandidates,
    candidates: candidateTrials.map((trial) => ({
      nctId: trial.nctId,
      title: trial.title,
      sponsor: trial.sponsor,
      status: trial.status,
      studyType: trial.studyType,
      updatedAt: trial.updatedAt,
      url: trial.url,
    })),
    selected,
  };
}

async function buildInconsistencyPreview(dataset, options) {
  const inconsistencyStore = await readInconsistencyStore();
  const selection = pickAgentCandidates(dataset, {
    ...options,
    agentStore: inconsistencyStore,
  });
  const batchCount = selection.nctId ? (selection.selected.length ? 1 : 0) : Math.ceil(selection.totalCandidates / selection.limit);

  return {
    summary: {
      totalCandidates: selection.totalCandidates,
      shownCount: selection.candidates.length,
      batchSize: selection.limit,
      batchCount,
      days: selection.days,
      query: selection.query,
      statuses: selection.statuses,
      skipProcessed: selection.skipProcessed,
      exactNctId: selection.nctId,
    },
    trials: selection.candidates,
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

  const systemPrompt = await loadSuspiciousTrialAgentPrompt();
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
          content: systemPrompt,
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

function normalizeInconsistencyReport(rawReport, fallbackTrial) {
  const inferredStudyTypes = ["Interventional", "Observational", "Expanded Access", "Unclear"];
  const subtypes = ["Drug", "Other", "Not applicable"];
  const otherSubtypes = ["Device", "BCI", "Procedure", "Behavioral", "Diagnostic", "Dietary", "Mixed", "Unclear"];
  const therapyModalities = ["Small molecule", "ASO/RNA therapy", "Gene therapy", "Viral vector gene therapy", "Cell therapy", "Biologic/protein", "Immunotherapy", "Microbiome", "Nutrition/supplement", "Repurposed drug", "Combination drug", "Other drug", "Unclear", "Not applicable"];
  const mechanismCategories = ["Genetic targeting", "Neuroinflammation/immune modulation", "Neuroprotection/cell survival", "Protein aggregation/proteostasis", "Excitotoxicity/glutamate", "Oxidative stress/mitochondrial/metabolism", "Muscle/neuromuscular function", "Symptom management", "Biomarker/imaging agent", "Microbiome/gut-brain", "Regenerative/cell replacement", "Other mechanism", "Unclear", "Not applicable"];
  const geneTargets = ["SOD1", "C9orf72", "FUS", "TARDBP", "ATXN2", "UNC13A", "CHCHD10", "Multiple genes", "Sporadic/non-genetic", "Other specified gene", "Unclear", "Not applicable"];
  const deliveryVectors = ["AAV", "Lentiviral", "Other viral vector", "Non-viral vector", "ASO/intrathecal oligo", "Small molecule/oral", "Infusion/injection", "Cell transplant", "Device/procedure", "Not applicable", "Unclear"];
  const deviceCategories = ["BCI", "Respiratory/ventilation", "Neuromodulation/stimulation", "Assistive/robotic", "Monitoring/wearable", "Surgical/procedural device", "Imaging/diagnostic device", "Communication device", "Other device", "Not applicable", "Unclear"];
  const devicePurposes = ["Communication", "Mobility/control", "Treatment/disease modification", "Symptom support", "Respiratory support", "Diagnosis/measurement", "Rehabilitation/training", "Care delivery", "Not applicable", "Unclear"];
  const procedureCategories = ["Surgery/procedure", "Stimulation", "Imaging/diagnostic procedure", "Rehabilitation/exercise", "Nutrition/dietary intervention", "Behavioral/digital intervention", "Training/education", "Not applicable", "Unclear"];
  const therapeuticPurposes = ["Disease modifying", "Symptom/supportive care", "Diagnostic/measurement", "Biomarker/natural history", "Communication/assistive technology", "Rehabilitation/function", "Expanded access", "Safety/tolerability", "Unclear"];
  const inferredStudyType = inferredStudyTypes.includes(rawReport.inferredStudyType)
    ? rawReport.inferredStudyType
    : "Unclear";
  const registeredStudyType = fallbackTrial.studyType || "Unknown";
  const studyTypeMatch =
    typeof rawReport.studyTypeMatch === "boolean"
      ? rawReport.studyTypeMatch
      : inferredStudyType === "Unclear" || inferredStudyType === registeredStudyType;
  let interventionalSubtype = subtypes.includes(rawReport.interventionalSubtype)
    ? rawReport.interventionalSubtype
    : registeredStudyType === "Interventional" || inferredStudyType === "Interventional"
      ? "Other"
      : "Not applicable";

  if (interventionalSubtype !== "Drug" && interventionalSubtype !== "Other" && interventionalSubtype !== "Not applicable") {
    interventionalSubtype = "Not applicable";
  }

  const otherSubtype =
    interventionalSubtype === "Other"
      ? otherSubtypes.includes(rawReport.otherSubtype)
        ? rawReport.otherSubtype
        : "Unclear"
      : "";
  const reasons = Array.isArray(rawReport.reasons)
    ? rawReport.reasons.map((reason) => String(reason)).filter(Boolean).slice(0, 6)
    : [];

  return {
    nctId: fallbackTrial.nctId,
    title: fallbackTrial.title,
    sponsor: fallbackTrial.sponsor,
    status: fallbackTrial.status,
    phase: fallbackTrial.phase,
    updatedAt: fallbackTrial.updatedAt,
    url: fallbackTrial.url,
    registeredStudyType,
    inferredStudyType,
    studyTypeMatch,
    studyTypeIssue: String(rawReport.studyTypeIssue || (studyTypeMatch ? "" : `Registered as ${registeredStudyType} but reads as ${inferredStudyType}.`)),
    interventionalSubtype,
    otherSubtype,
    landscapeCategory: String(rawReport.landscapeCategory || "Unclear"),
    landscapeSubcategory: String(rawReport.landscapeSubcategory || "Unclear"),
    therapeuticPurpose: therapeuticPurposes.includes(rawReport.therapeuticPurpose) ? rawReport.therapeuticPurpose : "Unclear",
    mechanismOrDesign: String(rawReport.mechanismOrDesign || "Unclear"),
    therapyModality: therapyModalities.includes(rawReport.therapyModality) ? rawReport.therapyModality : "Not applicable",
    mechanismCategory: mechanismCategories.includes(rawReport.mechanismCategory) ? rawReport.mechanismCategory : "Not applicable",
    geneTarget: geneTargets.includes(rawReport.geneTarget) ? rawReport.geneTarget : "Not applicable",
    deliveryVector: deliveryVectors.includes(rawReport.deliveryVector) ? rawReport.deliveryVector : "Not applicable",
    viralTherapy: Boolean(rawReport.viralTherapy),
    deviceCategory: deviceCategories.includes(rawReport.deviceCategory) ? rawReport.deviceCategory : "Not applicable",
    devicePurpose: devicePurposes.includes(rawReport.devicePurpose) ? rawReport.devicePurpose : "Not applicable",
    procedureCategory: procedureCategories.includes(rawReport.procedureCategory) ? rawReport.procedureCategory : "Not applicable",
    landscapeRationale: String(rawReport.landscapeRationale || ""),
    confidenceScore: Math.max(0, Math.min(100, Number(rawReport.confidenceScore) || 0)),
    reasons: reasons.length ? reasons : ["The model returned no explicit reasons."],
    rationale: String(rawReport.rationale || "No rationale returned."),
  };
}

function buildInconsistencyAnalysisRecord(report, metadata = {}) {
  return {
    ...report,
    analyzedAt: metadata.analyzedAt || timestampIso(),
    model: metadata.model || "unknown",
    sequenceId: metadata.sequenceId || "",
    runNumber: metadata.runNumber || 1,
    sourceFile: metadata.sourceFile || "",
  };
}

function upsertInconsistencyAnalyses(store, reports, metadata = {}) {
  for (const report of reports) {
    const record = buildInconsistencyAnalysisRecord(report, metadata);
    const existing = store.analysesByNctId[report.nctId] || { latest: null, history: [] };
    existing.history.push(record);
    existing.latest = record;
    store.analysesByNctId[report.nctId] = existing;
  }

  return store;
}

async function writeInconsistencyReportCsv(result, options = {}) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const sequenceId = normalizeSequenceId(options.sequenceId) || `inconsistency-sequence-${timestampForFile()}`;
  const runNumber = Math.max(1, Number.parseInt(options.runNumber, 10) || 1);
  const sequenceDir = path.join(REPORTS_DIR, sequenceId);
  await fs.mkdir(sequenceDir, { recursive: true });

  const headers = [
    "nct_id",
    "title",
    "sponsor",
    "registered_study_type",
    "inferred_study_type",
    "study_type_match",
    "study_type_issue",
    "interventional_subtype",
    "other_subtype",
    "landscape_category",
    "landscape_subcategory",
    "therapeutic_purpose",
    "mechanism_or_design",
    "therapy_modality",
    "mechanism_category",
    "gene_target",
    "delivery_vector",
    "viral_therapy",
    "device_category",
    "device_purpose",
    "procedure_category",
    "landscape_rationale",
    "confidence_score",
    "rationale",
    "reasons",
    "trial_url",
  ];
  const rows = result.reports.map((report) => [
    report.nctId,
    report.title,
    report.sponsor,
    report.registeredStudyType,
    report.inferredStudyType,
    report.studyTypeMatch,
    report.studyTypeIssue,
    report.interventionalSubtype,
    report.otherSubtype,
    report.landscapeCategory,
    report.landscapeSubcategory,
    report.therapeuticPurpose,
    report.mechanismOrDesign,
    report.therapyModality,
    report.mechanismCategory,
    report.geneTarget,
    report.deliveryVector,
    report.viralTherapy,
    report.deviceCategory,
    report.devicePurpose,
    report.procedureCategory,
    report.landscapeRationale,
    report.confidenceScore,
    report.rationale,
    report.reasons.join(" | "),
    report.url,
  ]);

  const runFilename = `run-${String(runNumber).padStart(2, "0")}.csv`;
  const runFilePath = path.join(sequenceDir, runFilename);
  await fs.writeFile(runFilePath, toCsv([headers, ...rows]), "utf8");

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
  };
}

function attachInconsistencyAnalysis(trial, inconsistencyStore) {
  const analysis = inconsistencyStore?.analysesByNctId?.[trial.nctId];
  if (!analysis || !analysis.latest) {
    return trial;
  }

  return {
    ...trial,
    inconsistencyAnalysis: analysis.latest,
  };
}

function latestInconsistencyReports(inconsistencyStore) {
  return Object.values(inconsistencyStore?.analysesByNctId || {})
    .map((record) => record?.latest)
    .filter(Boolean)
    .sort((left, right) => {
      if (Boolean(left.studyTypeMatch) !== Boolean(right.studyTypeMatch)) {
        return left.studyTypeMatch ? 1 : -1;
      }
      return dateValue(right.analyzedAt) - dateValue(left.analyzedAt);
    });
}

function buildInconsistencyResults(dataset, inconsistencyStore) {
  const reports = latestInconsistencyReports(inconsistencyStore);
  const trialsById = new Map(dataset.trials.map((trial) => [trial.nctId, trial]));

  function withTrial(report) {
    const trial = trialsById.get(report.nctId);
    if (!trial) {
      return { ...report, trial: null };
    }
    return {
      ...report,
      trial: attachInconsistencyAnalysis(trial, inconsistencyStore),
    };
  }

  const mismatches = reports.filter((report) => report.studyTypeMatch === false).map(withTrial);
  const drugTrials = reports.filter((report) => report.interventionalSubtype === "Drug").map(withTrial);
  const otherTrials = reports.filter((report) => report.interventionalSubtype === "Other").map(withTrial);

  return {
    summary: {
      totalProcessed: reports.length,
      mismatchCount: mismatches.length,
      drugCount: drugTrials.length,
      otherCount: otherTrials.length,
    },
    mismatches,
    drugTrials: drugTrials.slice(0, 40),
    otherTrials: otherTrials.slice(0, 40),
  };
}

function buildStudyTypeClassificationRows(dataset, inconsistencyStore) {
  const reportsById = new Map(latestInconsistencyReports(inconsistencyStore).map((report) => [report.nctId, report]));

  return [...(dataset.trials || [])]
    .map((trial) => {
      const report = reportsById.get(trial.nctId) || null;
      const agreement = report ? report.studyTypeMatch === true : null;
      const aiExplainer = report
        ? [report.rationale, ...(Array.isArray(report.reasons) ? report.reasons : [])].filter(Boolean).join(" ")
        : "";

      return {
        nctId: trial.nctId,
        title: trial.title,
        summary: trial.summary || "No brief summary available.",
        ctgovClassification: trial.studyType || "",
        aiClassification: report?.inferredStudyType || "",
        agree: yesNo(agreement),
        aiExplainer,
        registeredStudyType: report?.registeredStudyType || trial.studyType || "",
        studyTypeIssue: report?.studyTypeIssue || "",
        interventionalSubtype: report?.interventionalSubtype || "",
        otherSubtype: report?.otherSubtype || "",
        landscapeCategory: report?.landscapeCategory || "",
        landscapeSubcategory: report?.landscapeSubcategory || "",
        therapeuticPurpose: report?.therapeuticPurpose || "",
        mechanismOrDesign: report?.mechanismOrDesign || "",
        therapyModality: report?.therapyModality || "",
        mechanismCategory: report?.mechanismCategory || "",
        geneTarget: report?.geneTarget || "",
        deliveryVector: report?.deliveryVector || "",
        viralTherapy: typeof report?.viralTherapy === "boolean" ? yesNo(report.viralTherapy) : "",
        deviceCategory: report?.deviceCategory || "",
        devicePurpose: report?.devicePurpose || "",
        procedureCategory: report?.procedureCategory || "",
        landscapeRationale: report?.landscapeRationale || "",
        confidenceScore: report?.confidenceScore ?? "",
        analyzedAt: report?.analyzedAt || "",
        reviewed: Boolean(report),
        trialUrl: report?.url || trial.url || "",
      };
    })
    .sort((left, right) => {
      if (left.agree !== right.agree) {
        const priority = { No: 0, Yes: 1, "": 2 };
        return priority[left.agree] - priority[right.agree];
      }
      if (left.reviewed !== right.reviewed) {
        return left.reviewed ? -1 : 1;
      }
      return dateValue(right.analyzedAt) - dateValue(left.analyzedAt);
    });
}

function buildStudyTypeClassificationReport(dataset, inconsistencyStore) {
  const rows = buildStudyTypeClassificationRows(dataset, inconsistencyStore);
  const reviewedRows = rows.filter((row) => row.reviewed);
  const mismatches = rows.filter((row) => row.agree === "No");

  return {
    summary: {
      totalTrials: rows.length,
      reviewedCount: reviewedRows.length,
      unreviewedCount: rows.length - reviewedRows.length,
      agreementCount: rows.filter((row) => row.agree === "Yes").length,
      mismatchCount: mismatches.length,
    },
    rows: rows.slice(0, 80),
    mismatches: mismatches.slice(0, 20),
  };
}

function buildStudyTypeClassificationWorkbook(dataset, inconsistencyStore) {
  const headers = [
    "Trial NCT ID",
    "Name of Trial",
    "General Summary / Overview",
    "CT.gov Listed Classification",
    "AI Classification",
    "AI and CT.gov Agree? (Y/N)",
    "AI Explainer",
    "Interventional Subtype",
    "Other Subtype",
    "Landscape Category",
    "Landscape Subcategory",
    "Therapeutic Purpose",
    "Mechanism or Design",
    "Therapy Modality",
    "Mechanism Category",
    "Gene Target",
    "Delivery Vector",
    "Viral Therapy? (Y/N)",
    "Device Category",
    "Device Purpose",
    "Procedure Category",
    "Landscape Rationale",
    "Confidence Score",
    "Analyzed At",
    "Trial URL",
  ];
  const rows = buildStudyTypeClassificationRows(dataset, inconsistencyStore).map((row) => [
    row.nctId,
    row.title,
    row.summary,
    row.ctgovClassification,
    row.aiClassification || "Not reviewed",
    row.agree || "Not reviewed",
    row.aiExplainer || "No stored AI classification yet.",
    row.interventionalSubtype,
    row.otherSubtype,
    row.landscapeCategory,
    row.landscapeSubcategory,
    row.therapeuticPurpose,
    row.mechanismOrDesign,
    row.therapyModality,
    row.mechanismCategory,
    row.geneTarget,
    row.deliveryVector,
    row.viralTherapy,
    row.deviceCategory,
    row.devicePurpose,
    row.procedureCategory,
    row.landscapeRationale,
    row.confidenceScore,
    row.analyzedAt,
    row.trialUrl,
  ]);

  const tableRows = [headers, ...rows]
    .map(
      (row, rowIndex) =>
        `<tr>${row
          .map((cell) => {
            const tag = rowIndex === 0 ? "th" : "td";
            return `<${tag}>${escapeHtml(cell)}</${tag}>`;
          })
          .join("")}</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; }
      th, td { border: 1px solid #b8c2cc; padding: 6px; vertical-align: top; }
      th { background: #eef3f8; font-weight: bold; }
      td { mso-number-format: "\\@"; }
    </style>
  </head>
  <body>
    <table>
      ${tableRows}
    </table>
  </body>
</html>`;
}

async function writeAllInconsistencyAnalysesCsv(inconsistencyStore) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const reports = latestInconsistencyReports(inconsistencyStore);
  const csvRows = [
    [
      "nct_id",
      "title",
      "sponsor",
      "status",
      "phase",
      "registered_study_type",
      "inferred_study_type",
      "study_type_match",
      "study_type_issue",
      "interventional_subtype",
      "other_subtype",
      "landscape_category",
      "landscape_subcategory",
      "therapeutic_purpose",
      "mechanism_or_design",
      "therapy_modality",
      "mechanism_category",
      "gene_target",
      "delivery_vector",
      "viral_therapy",
      "device_category",
      "device_purpose",
      "procedure_category",
      "landscape_rationale",
      "confidence_score",
      "rationale",
      "reasons",
      "analyzed_at",
      "trial_url",
    ],
    ...reports.map((report) => [
      report.nctId,
      report.title,
      report.sponsor,
      report.status,
      report.phase,
      report.registeredStudyType,
      report.inferredStudyType,
      report.studyTypeMatch,
      report.studyTypeIssue,
      report.interventionalSubtype,
      report.otherSubtype,
      report.landscapeCategory || "",
      report.landscapeSubcategory || "",
      report.therapeuticPurpose || "",
      report.mechanismOrDesign || "",
      report.therapyModality || "",
      report.mechanismCategory || "",
      report.geneTarget || "",
      report.deliveryVector || "",
      typeof report.viralTherapy === "boolean" ? report.viralTherapy : "",
      report.deviceCategory || "",
      report.devicePurpose || "",
      report.procedureCategory || "",
      report.landscapeRationale || "",
      report.confidenceScore,
      report.rationale,
      Array.isArray(report.reasons) ? report.reasons.join(" | ") : "",
      report.analyzedAt,
      report.url,
    ]),
  ];

  const filename = "all-inconsistency-analyses.csv";
  const filePath = path.join(REPORTS_DIR, filename);
  await fs.writeFile(filePath, toCsv(csvRows), "utf8");
  return filePath;
}

async function runInconsistencyAgent(options) {
  const apiKey = (options.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Add it to your .env file to run the consistency agent.");
  }

  const systemPrompt = await loadInconsistencyAgentPrompt();
  const model = (options.model || process.env.INCONSISTENCY_AGENT_MODEL || "gpt-4.1-mini").trim();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trial_inconsistency_reports",
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
                    registeredStudyType: { type: "string" },
                    inferredStudyType: {
                      type: "string",
                      enum: ["Interventional", "Observational", "Expanded Access", "Unclear"],
                    },
                    studyTypeMatch: { type: "boolean" },
                    studyTypeIssue: { type: "string" },
                    interventionalSubtype: {
                      type: "string",
                      enum: ["Drug", "Other", "Not applicable"],
                    },
                    otherSubtype: {
                      type: "string",
                      enum: ["Device", "BCI", "Procedure", "Behavioral", "Diagnostic", "Dietary", "Mixed", "Unclear", "None"],
                    },
                    landscapeCategory: { type: "string" },
                    landscapeSubcategory: { type: "string" },
                    therapeuticPurpose: {
                      type: "string",
                      enum: ["Disease modifying", "Symptom/supportive care", "Diagnostic/measurement", "Biomarker/natural history", "Communication/assistive technology", "Rehabilitation/function", "Expanded access", "Safety/tolerability", "Unclear"],
                    },
                    mechanismOrDesign: { type: "string" },
                    therapyModality: {
                      type: "string",
                      enum: ["Small molecule", "ASO/RNA therapy", "Gene therapy", "Viral vector gene therapy", "Cell therapy", "Biologic/protein", "Immunotherapy", "Microbiome", "Nutrition/supplement", "Repurposed drug", "Combination drug", "Other drug", "Unclear", "Not applicable"],
                    },
                    mechanismCategory: {
                      type: "string",
                      enum: ["Genetic targeting", "Neuroinflammation/immune modulation", "Neuroprotection/cell survival", "Protein aggregation/proteostasis", "Excitotoxicity/glutamate", "Oxidative stress/mitochondrial/metabolism", "Muscle/neuromuscular function", "Symptom management", "Biomarker/imaging agent", "Microbiome/gut-brain", "Regenerative/cell replacement", "Other mechanism", "Unclear", "Not applicable"],
                    },
                    geneTarget: {
                      type: "string",
                      enum: ["SOD1", "C9orf72", "FUS", "TARDBP", "ATXN2", "UNC13A", "CHCHD10", "Multiple genes", "Sporadic/non-genetic", "Other specified gene", "Unclear", "Not applicable"],
                    },
                    deliveryVector: {
                      type: "string",
                      enum: ["AAV", "Lentiviral", "Other viral vector", "Non-viral vector", "ASO/intrathecal oligo", "Small molecule/oral", "Infusion/injection", "Cell transplant", "Device/procedure", "Not applicable", "Unclear"],
                    },
                    viralTherapy: { type: "boolean" },
                    deviceCategory: {
                      type: "string",
                      enum: ["BCI", "Respiratory/ventilation", "Neuromodulation/stimulation", "Assistive/robotic", "Monitoring/wearable", "Surgical/procedural device", "Imaging/diagnostic device", "Communication device", "Other device", "Not applicable", "Unclear"],
                    },
                    devicePurpose: {
                      type: "string",
                      enum: ["Communication", "Mobility/control", "Treatment/disease modification", "Symptom support", "Respiratory support", "Diagnosis/measurement", "Rehabilitation/training", "Care delivery", "Not applicable", "Unclear"],
                    },
                    procedureCategory: {
                      type: "string",
                      enum: ["Surgery/procedure", "Stimulation", "Imaging/diagnostic procedure", "Rehabilitation/exercise", "Nutrition/dietary intervention", "Behavioral/digital intervention", "Training/education", "Not applicable", "Unclear"],
                    },
                    landscapeRationale: { type: "string" },
                    confidenceScore: { type: "number" },
                    reasons: {
                      type: "array",
                      items: { type: "string" },
                    },
                    rationale: { type: "string" },
                  },
                  required: [
                    "nctId",
                    "registeredStudyType",
                    "inferredStudyType",
                    "studyTypeMatch",
                    "studyTypeIssue",
                    "interventionalSubtype",
                    "otherSubtype",
                    "landscapeCategory",
                    "landscapeSubcategory",
                    "therapeuticPurpose",
                    "mechanismOrDesign",
                    "therapyModality",
                    "mechanismCategory",
                    "geneTarget",
                    "deliveryVector",
                    "viralTherapy",
                    "deviceCategory",
                    "devicePurpose",
                    "procedureCategory",
                    "landscapeRationale",
                    "confidenceScore",
                    "reasons",
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
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "Check these ALS ClinicalTrials.gov records for study-type inconsistencies and interventional subtypes.",
              guidance: [
                "Flag only reasonably clear mismatches between registered study type and the described design.",
                "Subtype interventional studies as Drug or Other. Other includes BCI, devices, procedures, behavioral, and similar non-drug modalities.",
                "Add a deeper landscape classification for drug modality, mechanism, gene target, delivery vector, viral therapy status, device category, device purpose, and procedure category where applicable.",
                "For gene therapy, distinguish viral vector therapy from ASO/RNA therapy. For BCI, distinguish communication from mobility/control or treatment use when supported.",
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
    throw new Error("OpenAI returned invalid JSON for the consistency agent run.");
  }

  return parsed;
}

async function buildInconsistencyRun(dataset, options) {
  const inconsistencyStore = await readInconsistencyStore();
  const model = options.model || process.env.INCONSISTENCY_AGENT_MODEL || "gpt-4.1-mini";
  const selection = pickAgentCandidates(dataset, {
    ...options,
    agentStore: inconsistencyStore,
  });
  if (!selection.selected.length) {
    return {
      summary: {
        model,
        reviewedCount: 0,
        mismatchCount: 0,
        drugCount: 0,
        otherCount: 0,
        windowLabel: selection.nctId
          ? `Specific trial: ${selection.nctId}`
          : selection.days === 0
            ? "All available study history"
            : `Last ${selection.days} days`,
        queryLabel: selection.nctId ? "Filter: exact NCT ID match" : selection.query ? `Filter: ${selection.query}` : "Filter: none",
        statusLabel: selection.nctId
          ? "Statuses: ignored for exact NCT ID"
          : selection.statuses.length
            ? `Statuses: ${selection.statuses.join(", ")}`
            : "Statuses: all",
        skipProcessed: selection.skipProcessed,
      },
      continuation: null,
      reportFile: null,
      reports: [],
      results: buildInconsistencyResults(dataset, inconsistencyStore),
    };
  }
  const llmPayload = await runInconsistencyAgent({
    apiKey: options.apiKey,
    model,
    selected: selection.selected,
  });

  const reportsById = new Map(
    ((llmPayload && llmPayload.reports) || []).map((report) => [String(report.nctId || "").toUpperCase(), report])
  );

  const reports = selection.selected.map((trial) =>
    normalizeInconsistencyReport(reportsById.get(trial.nctId.toUpperCase()) || {}, trial)
  );

  const reportFile = await writeInconsistencyReportCsv(
    { reports },
    {
      sequenceId: selection.sequenceId,
      runNumber: selection.runNumber,
    }
  );

  upsertInconsistencyAnalyses(inconsistencyStore, reports, {
    analyzedAt: timestampIso(),
    model,
    sequenceId: reportFile.sequenceId,
    runNumber: reportFile.runNumber,
    sourceFile: reportFile.latestRun.path,
  });
  await writeInconsistencyStore(inconsistencyStore);

  return {
    summary: {
      model,
      reviewedCount: reports.length,
      mismatchCount: reports.filter((report) => report.studyTypeMatch === false).length,
      drugCount: reports.filter((report) => report.interventionalSubtype === "Drug").length,
      otherCount: reports.filter((report) => report.interventionalSubtype === "Other").length,
      windowLabel: selection.nctId
        ? `Specific trial: ${selection.nctId}`
        : selection.days === 0
          ? `Latest ${selection.limit} trials from all available study history`
          : `Latest ${selection.limit} trials from last ${selection.days} days`,
      queryLabel: selection.nctId ? "Filter: exact NCT ID match" : selection.query ? `Filter: ${selection.query}` : "Filter: none",
      statusLabel: selection.nctId
        ? "Statuses: ignored for exact NCT ID"
        : selection.statuses.length
          ? `Statuses: ${selection.statuses.join(", ")}`
          : "Statuses: all",
      skipProcessed: selection.skipProcessed,
    },
    continuation: selection.nctId
      ? null
      : {
          hasMore: selection.skipProcessed
            ? selection.selected.length < selection.totalCandidates
            : selection.cursor + selection.selected.length < selection.totalCandidates,
          nextCursor: selection.skipProcessed ? 0 : selection.cursor + selection.selected.length,
          processedUntil: selection.skipProcessed ? selection.selected.length : selection.cursor + selection.selected.length,
          totalCandidates: selection.totalCandidates,
          sequenceId: reportFile.sequenceId,
          nextRunNumber: reportFile.runNumber + 1,
        },
    reportFile,
    reports,
    results: buildInconsistencyResults(dataset, inconsistencyStore),
  };
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
  return enrichTargetingDataset(payload, DATA_DIR);
}

async function applyPortalEdits(dataset) {
  const data = await portalReviewStore.read();
  let exclusions={};
  try { exclusions=JSON.parse(await fs.readFile(path.join(DATA_DIR,'trial-exclusions.json'),'utf8')); }
  catch(error){if(error.code!=='ENOENT')throw error;}
  const trials = dataset.trials.filter(trial=>!exclusions[trial.nctId]).map(trial => applyTrialOverrides(trial, data));
  const placeboTrials = await Promise.all(trials.map(async trial => {
    const rule = placeboAssessment(trial);
    if (rule.manual) return {...trial, placeboDashboardLabel: rule.label, placeboDashboardReason: rule.reason};
    if (trial.studyType !== 'Interventional') return trial;
    try {
      const saved = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, 'placebo-screening', `${trial.nctId}.json`), 'utf8'));
      if (saved.sourceHash === placeboHash(placeboSource(trial))) {
        return {...trial, placeboDashboardLabel: saved.label, placeboDashboardReason: saved.rationale};
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return trial;
  }));
  return {...dataset, trials: placeboTrials, totalIndexed: placeboTrials.length, stats:buildStats(placeboTrials)};
}

async function getDataset(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cache = await readCache();

  if (!forceRefresh && cache && Date.now() - dateValue(cache.syncedAt) < CACHE_TTL_MS) {
    return applyPortalEdits(await enrichTargetingDataset(cache, DATA_DIR));
  }

  return applyPortalEdits(await syncTrials());
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
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
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

    if (request.method === "GET" && url.pathname === "/api/dashboard/intervention-trials") {
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
      const ids = new Set((url.searchParams.get("ids") || "").split(","));
      const trials = dataset.trials.filter(t => ids.has(t.nctId))
        .map(t => ({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response, 200, {trials, total:trials.length}); return;
    }

    if (url.pathname === "/api/saved-trials" && ["GET", "POST"].includes(request.method)) {
      if (request.method === "POST") {
        const body = await readRequestBody(request);
        try { await portalReviewStore.mutate(data => updateSavedTrials(data, body)); }
        catch(error) { json(response,400,{error:error.message}); return; }
      }
      const store=(await portalReviewStore.read()).savedTrials || {collections:[],trials:{}};
      const dataset=await getDataset();
      const trials=dataset.trials.filter(t=>store.trials[t.nctId]).map(t=>({nctId:t.nctId,title:t.title,status:t.status,phase:t.phase,sponsor:t.sponsor}));
      json(response,200,{...store,details:trials}); return;
    }

    if (request.method === "GET" && url.pathname === "/api/trial-data-table") {
      const dataset = await getDataset();
      json(response, 200, {trials:await buildTrialDataTable(dataset, DATA_DIR, REPORTS_DIR)}); return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard/placebo-trials") {
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
      const category = url.searchParams.get('placebo');
      const categoryFor = url.searchParams.get('source') === 'ctgov' ? registryPlaceboCategory : placeboCategory;
      const trials = dataset.trials.filter(t => t.studyType === 'Interventional' && (!category || categoryFor(t) === category))
        .map(t => ({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response,200,{trials,total:trials.length}); return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard/population-trials") {
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
      const population = url.searchParams.get("population") || "";
      const trials = dataset.trials.filter(t => t.studyType === "Interventional" && t.targeting?.status === "screened")
        .filter(t => !population || matchesTargetPopulation(t, population))
        .map(t => ({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response, 200, {trials, total:trials.length}); return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard/study-type-trials") {
      const dataset=filterDashboardDataset(await getDataset(),url.searchParams);
      const type=url.searchParams.get('studyType')||'';
      const purpose=url.searchParams.get('purpose')||'';
      const trials=dataset.trials.filter(t=>!type||t.studyType===type).filter(t=>{
        const value=String(t.primaryPurpose||'').trim();
        const category=!value||/^(unknown|n\/a|na)$/i.test(value)?'unspecified':value.toLowerCase()==='treatment'?'treatment':'other';
        return !purpose||category===purpose;
      }).map(t=>({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response,200,{trials,total:trials.length});return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard/status-trials") {
      const dataset=filterDashboardDataset(await getDataset(),url.searchParams);
      const statuses=url.searchParams.getAll('status');
      const trials=dataset.trials.filter(t=>!statuses.length||statuses.includes(t.status)).map(t=>({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response,200,{trials,total:trials.length});return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard/phase-trials") {
      const dataset=filterDashboardDataset(await getDataset(),url.searchParams);
      const phase=url.searchParams.get('phase')||'';
      const trials=dataset.trials.filter(t=>t.studyType==='Interventional').filter(t=>{
        const label=!t.phase||['Na','N/A','Unknown','Interventional'].includes(t.phase)?'Not applicable':t.phase.replaceAll(', ','/');
        return !phase||label===phase;
      }).map(t=>({nctId:t.nctId,title:t.title,status:t.status,sponsor:t.sponsor,phase:t.phase}));
      json(response,200,{trials,total:trials.length});return;
    }

    if (request.method === "GET" && url.pathname === "/api/trials") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const inconsistencyStore = await readInconsistencyStore();
      const query = url.searchParams.get("q") || "";
      const { filters, matches, matchedCity } = parseQueryFilters(query, dataset.trials, Object.fromEntries(["status", "studyType", "phase", "city"].map(key => [key, url.searchParams.get(key) || ""])));

      json(response, 200, {
        query,
        filters,
        summary: buildSummary(query, filters, matches, dataset.totalIndexed, matchedCity),
        totalMatches: matches.length,
        shownCount: Math.min(matches.length, 25),
        trials: matches.slice(0, 25).map((trial) =>
          attachInconsistencyAnalysis(
            attachAgentAnalysis(
              {
                ...trial,
                locationSummary: buildDisplayLocationSummary(trial, matchedCity),
              },
              agentStore
            ),
            inconsistencyStore
          )
        ),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/targeting/results") {
      json(response, 200, buildTargetingResults(await getDataset()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trials/nyu") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      json(response, 200, buildNyuTrials(dataset, agentStore));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/new-york/database") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const database = buildNewYorkTrialDatabase(dataset, agentStore);
      await writeNewYorkTrialDatabase(database);
      json(response, 200, database);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/high-risk") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const manualStore = await readManualReviewStore();
      json(response, 200, {
        trials: buildHighRiskTrials(dataset, agentStore, manualStore),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/medium-risk") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const manualStore = await readManualReviewStore();
      json(response, 200, {
        trials: buildMediumRiskTrials(dataset, agentStore, manualStore),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/screened") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const manualStore = await readManualReviewStore();
      json(response, 200, buildScreenedTrials(dataset, agentStore, manualStore));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const manualStore = await readManualReviewStore();
      const filePath = await writeAllAgentAnalysesCsv(dataset, agentStore, manualStore);
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
      const manualStore = await readManualReviewStore();
      const filePath = await writeFlaggedAgentTrialsCsv(dataset, agentStore, manualStore);
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
      const manualStore = await readManualReviewStore();
      textResponse(response, 200, buildFlaggedTrialsReportHtml(dataset, agentStore, manualStore), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/export-flagged-doc") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const manualStore = await readManualReviewStore();
      response.writeHead(200, {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": 'attachment; filename="flagged-agent-trials.doc"',
        "Cache-Control": "no-store",
      });
      response.end(buildFlaggedTrialsReportHtml(dataset, agentStore, manualStore, { wordExport: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trial-details") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const inconsistencyStore = await readInconsistencyStore();
      const manualStore = await readManualReviewStore();
      const nctId = url.searchParams.get("nctId") || "";
      const payload = buildTrialDetail(dataset, agentStore, nctId, inconsistencyStore, manualStore);

      if (!payload) {
        json(response, 404, { error: `Trial not found for ${nctId}` });
        return;
      }

      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agent/manual-review") {
      const body = await readRequestBody(request);
      const nctId = String(body.nctId || "").trim().toUpperCase();
      if (!/^NCT\d{8}$/.test(nctId)) {
        json(response, 400, { error: "Provide a valid NCT ID." });
        return;
      }

      const manualStore = await readManualReviewStore();
      if (body.verified === false) {
        delete manualStore.manualByNctId[nctId];
      } else {
        manualStore.manualByNctId[nctId] = {
          status: "verified",
          verifiedAt: timestampIso(),
          note: String(body.note || "Marked manually verified in UI.").trim(),
        };
      }

      await writeManualReviewStore(manualStore);
      json(response, 200, {
        nctId,
        manualReview: manualStore.manualByNctId[nctId] || null,
      });
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

    if (request.method === "GET" && url.pathname === "/api/inconsistency/results") {
      const dataset = await getDataset();
      const inconsistencyStore = await readInconsistencyStore();
      json(response, 200, buildInconsistencyResults(dataset, inconsistencyStore));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/inconsistency/classification-report") {
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
      const inconsistencyStore = await readInconsistencyStore();
      json(response, 200, buildStudyTypeClassificationReport(dataset, inconsistencyStore));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/inconsistency/preview") {
      const dataset = await getDataset();
      const body = await readRequestBody(request);
      json(response, 200, await buildInconsistencyPreview(dataset, body));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/inconsistency/export") {
      const inconsistencyStore = await readInconsistencyStore();
      const filePath = await writeAllInconsistencyAnalysesCsv(inconsistencyStore);
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="all-inconsistency-analyses.csv"',
        "Cache-Control": "no-store",
      });
      response.end(content);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/inconsistency/export-excel") {
      const dataset = filterDashboardDataset(await getDataset(), url.searchParams);
      const inconsistencyStore = await readInconsistencyStore();
      response.writeHead(200, {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": 'attachment; filename="study-type-classification-report.xls"',
        "Cache-Control": "no-store",
      });
      response.end(buildStudyTypeClassificationWorkbook(dataset, inconsistencyStore));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/inconsistency/run") {
      const dataset = await getDataset();
      const body = await readRequestBody(request);
      json(response, 200, await buildInconsistencyRun(dataset, body));
      return;
    }

    if (url.pathname === "/api/review-triage/draft" && request.method === "POST") {
      try {json(response,200,await saveTriageDraft(portalReviewStore,await readRequestBody(request)));}
      catch(error){json(response,error.status||500,{error:error.message});}return;
    }
    if (url.pathname === "/api/review-triage/export" && request.method === "GET") {
      const rows=trainingRows(await portalReviewStore.read());
      response.writeHead(200,{"Content-Type":"application/x-ndjson; charset=utf-8","Content-Disposition":'attachment; filename="flagging-training-decisions.jsonl"',"Cache-Control":"no-store"});
      response.end(rows.map(row=>JSON.stringify(row)).join("\n")+(rows.length?"\n":""));return;
    }
    if (["/api/review-triage","/api/review-triage/publish"].includes(url.pathname) && ["GET","POST"].includes(request.method)) {
      try {
        const dataset=await getDataset();const agents=await hydrateAgentStoreFromReports(await readAgentStore());
        if(request.method==="POST") {
          const body=await readRequestBody(request);
          if(url.pathname.endsWith("/publish"))await publishTriage(portalReviewStore,body,dataset,agents);
          else await saveTriage(portalReviewStore,body,dataset,agents);
        }
        json(response,200,buildTriage(dataset,agents,await portalReviewStore.read()));
      }catch(error){json(response,error.status||500,{error:error.message});}return;
    }

    if (request.method === "POST" && url.pathname === "/api/update-assistant/chat") {
      try {
        const body = await readRequestBody(request);
        const dataset = await getDataset();
        const controller = new AbortController();
        response.on("close", () => { if (!response.writableEnded) controller.abort(); });
        json(response, 200, await updateAssistant.chat({...body, signal:controller.signal, trials:dataset.trials, apiKey:process.env.OPENAI_API_KEY, model:process.env.OPENAI_CHAT_MODEL || DEFAULT_NEW_YORK_CHAT_MODEL, fetchImpl:fetch}));
      } catch (error) { json(response, error.status || 500, {error:error.message}); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/update-assistant/confirm") {
      try { const body = await readRequestBody(request); const dataset = await getDataset();
        json(response, 200, await updateAssistant.confirm(body, dataset.trials));
      } catch (error) { json(response, error.status || 500, {error:error.message}); }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/update-assistant/saved") {
      const data = await portalReviewStore.read();
      const updates = Object.values(data.trialUpdates || {}).flat().sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt));
      json(response, 200, {updates:updates.slice(0,30)}); return;
    }

    if (url.pathname === "/api/review-portal" && ["GET", "POST"].includes(request.method)) {
      try {
        const dataset = await getDataset();
        const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
        if (request.method === "POST") await saveReview(portalReviewStore, await readRequestBody(request), dataset, agentStore);
        json(response, 200, buildReviewQueues(dataset, agentStore, await readManualReviewStore(), await portalReviewStore.read()));
      } catch (error) { json(response, error.status || 500, {error:error.message}); }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sava/search/stream") {
      const body = await readRequestBody(request);
      await streamResult(request, response, async ({signal, send}) => {
        const dataset = await getDataset();
        return runSavaSearch({question:body.question, history:body.history, trials:dataset.trials, signal,
          onText:text=>send("text",{text}), onStatus:message=>send("status",{message})});
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sava/search") {
      const body = await readRequestBody(request);
      if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000) {
        json(response, 400, { error: "Enter a question of 1–2,000 characters." });
        return;
      }
      const dataset = await getDataset();
      json(response, 200, await runSavaSearch({ question: body.question, history: body.history, trials: dataset.trials }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/new-york/chat") {
      const dataset = await getDataset();
      const agentStore = await hydrateAgentStoreFromReports(await readAgentStore());
      const body = await readRequestBody(request);
      const database = buildNewYorkTrialDatabase(dataset, agentStore);
      await writeNewYorkTrialDatabase(database);
      json(response, 200, await runNewYorkTrialsChat({
        question: body.question,
        conversationId: body.conversation_id,
        database,
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true, assistantVersion: ASSISTANT_VERSION, startedAt: STARTED_AT });
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
  buildInconsistencyRun,
  buildStats,
  normalizeStudy,
  parseQueryFilters,
  syncTrials,
  server,
};
