const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const VERSION = "als-targeting-v3";
const TARGET_STATUSES = ["Recruiting", "Not Yet Recruiting", "Active Not Recruiting"];
const DIMENSIONS = ["onset", "progression", "gene", "phenotype"];
const GENERIC_GENE_VALUES = new Set(["ALS", "GENE", "UNKNOWN", "UNSPECIFIED"]);
const RELATIONSHIPS = ["required", "excluded", "allowed", "cohort", "study_focus", "subgroup_analysis", "background_mention", "unclear"];
const SOURCE_FIELDS = ["title", "officialTitle", "summary", "detailedDescription", "eligibilityCriteria", "studyPopulation", "arms", "interventions"];
const object = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const string = { type: "string" };
const enumeration = (values) => ({ type: "string", enum: values });
const schema = object({
  nctId: string,
  dimensions: object(Object.fromEntries(DIMENSIONS.map((key) => [key, enumeration(["specific", "not_specified", "unclear"])]))),
  findings: { type: "array", items: object({
    dimension: enumeration(DIMENSIONS), value: string, relationship: enumeration(RELATIONSHIPS),
    cohort: string, detail: string,
    evidence: { type: "array", items: object({ sourceField: enumeration(SOURCE_FIELDS), quote: string }) },
  }) },
  needsReview: { type: "boolean" }, reviewReason: string,
});

function sourceFor(trial) {
  return {
    title: trial.title || "", officialTitle: trial.officialTitle || "",
    summary: trial.summary || "", detailedDescription: trial.detailedDescription || "",
    eligibilityCriteria: trial.eligibilityCriteria || "", studyPopulation: trial.studyPopulation || "",
    arms: (trial.armGroups || []).map((arm) => [arm.label, arm.type, arm.description].filter(Boolean).join("\n")).join("\n\n"),
    interventions: (trial.targetingInterventions || trial.interventionDetails || []).map((item) => [item.name, item.type, item.description].filter(Boolean).join("\n")).join("\n\n"),
  };
}

function sourceHash(trial) {
  return crypto.createHash("sha256").update(JSON.stringify(sourceFor(trial))).digest("hex");
}

function restoreExactQuote(source, quote) {
  if (source.includes(quote)) return quote;
  let normalizedSource = "";
  const sourceIndexes = [];
  let inWhitespace = false;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\\" && /[*_<>\[\]]/.test(source[index + 1] || "")) continue;
    if (/\s/.test(source[index])) {
      if (!inWhitespace) {
        normalizedSource += " ";
        sourceIndexes.push(index);
        inWhitespace = true;
      }
    } else {
      normalizedSource += source[index];
      sourceIndexes.push(index);
      inWhitespace = false;
    }
  }
  const normalizedQuote = quote.replace(/\\(?=[*_<>\[\]])/g, "").replace(/\s+/g, " ").trim();
  const normalizedStart = normalizedSource.indexOf(normalizedQuote);
  if (normalizedStart === -1) return null;
  const sourceStart = sourceIndexes[normalizedStart];
  const sourceEnd = sourceIndexes[normalizedStart + normalizedQuote.length - 1] + 1;
  return source.slice(sourceStart, sourceEnd);
}

function validateReport(report, trial) {
  if (!report || report.nctId !== trial.nctId) throw new Error("Targeting report trial ID mismatch");
  if (!Array.isArray(report.findings)) throw new Error("Missing targeting findings");
  const sources = sourceFor(trial);
  let correctedBulbarInvolvement = false;
  let removedGenericGene = false;
  report.findings = report.findings.map((finding) => {
    const evidenceText = (finding.evidence || []).map((evidence) => evidence.quote || "").join(" ");
    if (finding.dimension === "gene") {
      const normalizedGene = String(finding.value || "").toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-]*$/.test(normalizedGene) || GENERIC_GENE_VALUES.has(normalizedGene)) {
        removedGenericGene = true;
        return null;
      }
      return { ...finding, value: normalizedGene };
    }
    if (finding.dimension === "onset" && finding.value === "other_onset") return null;
    if (finding.dimension === "onset" && !/\bonset\b/i.test(evidenceText)) {
      if (finding.value === "bulbar_onset" && /\bbulbar involvement\b/i.test(evidenceText)) {
        correctedBulbarInvolvement = true;
        return {
          ...finding,
          dimension: "phenotype",
          value: "bulbar_only_als",
          detail: "Participants whose ALS has only clinical bulbar involvement are excluded. This describes current clinical involvement, not bulbar onset.",
        };
      }
      return null;
    }
    return finding;
  }).filter(Boolean).filter((finding) => {
    const evidenceText = (finding.evidence || []).map((evidence) => evidence.quote || "").join(" ");
    if (finding.dimension === "progression" && !/\b(?:progression|progressor|risk profile|slope|declin|delta[ -]?fs)\b|ΔFS/i.test(evidenceText)) return false;
    if (finding.dimension === "gene" && /disease control/i.test(finding.cohort || "")) return false;
    if (finding.dimension === "gene" && /gain of function/i.test(finding.cohort || "") && !/\bALS4?\b|amyotrophic lateral sclerosis/i.test(evidenceText)) return false;
    return true;
  });
  for (const finding of report.findings) {
    const namedSubset = finding.detail.match(/\b(?:for|within) (?:the )?((?:MAD|SAD) Period|Part \d+)\b/i);
    if (namedSubset && ["required", "excluded"].includes(finding.relationship)) {
      finding.relationship = "cohort";
      finding.cohort = namedSubset[1];
    }
    if (!DIMENSIONS.includes(finding.dimension) || !RELATIONSHIPS.includes(finding.relationship)) throw new Error("Invalid targeting classification");
    if (typeof finding.value !== "string" || !finding.value.trim() || typeof finding.detail !== "string" || !finding.detail.trim() || typeof finding.cohort !== "string") throw new Error("Invalid targeting detail");
    const allowedValues = { onset: ["bulbar_onset", "limb_onset", "respiratory_onset", "other_onset"], progression: ["slow_progressor", "fast_progressor", "progression_rate_constraint"] };
    if (allowedValues[finding.dimension] && !allowedValues[finding.dimension].includes(finding.value)) throw new Error("Invalid targeting value");
    if (!finding.evidence?.length) throw new Error("Finding has no evidence");
    if (finding.relationship === "cohort" && !finding.cohort.trim()) throw new Error("Cohort finding is missing its cohort name");
    for (const evidence of finding.evidence) {
      if (!SOURCE_FIELDS.includes(evidence.sourceField) || typeof evidence.quote !== "string" || !evidence.quote.trim()) {
        throw new Error("Targeting evidence is not an exact source quote");
      }
      const exactQuote = restoreExactQuote(sources[evidence.sourceField], evidence.quote);
      if (!exactQuote) throw new Error("Targeting evidence is not an exact source quote");
      evidence.quote = exactQuote;
    }
  }
  for (const dimension of DIMENSIONS) {
    const specific = report.findings.some((finding) => finding.dimension === dimension && ["required", "excluded", "cohort", "study_focus"].includes(finding.relationship));
    const unclear = report.findings.some((finding) => finding.dimension === dimension && finding.relationship === "unclear");
    report.dimensions[dimension] = unclear ? "unclear" : specific ? "specific" : "not_specified";
  }
  if (typeof report.needsReview !== "boolean" || typeof report.reviewReason !== "string") throw new Error("Invalid review status");
  if (!sources.eligibilityCriteria.trim() || report.findings.some((finding) => finding.relationship === "unclear") || Object.values(report.dimensions).includes("unclear")) {
    report.needsReview = true;
    if (!report.reviewReason) report.reviewReason = "Missing eligibility criteria or ambiguous targeting evidence.";
  } else if (correctedBulbarInvolvement && /bulbar involvement|onset-related evidence/i.test(report.reviewReason || "")) {
    report.needsReview = false;
    report.reviewReason = "";
  } else if ((removedGenericGene || report.dimensions.gene === "not_specified") && /no (?:specific|explicit) gene symbol|does not (?:explicitly )?name (?:any )?explicit/i.test(report.reviewReason || "")) {
    report.needsReview = false;
    report.reviewReason = "";
  }
  return report;
}

async function readStore(dataDir) {
  try { return JSON.parse(await fs.readFile(path.join(dataDir, "targeting-analyses.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { version: VERSION, analysesByNctId: {} }; throw error; }
}

function attachTargeting(trial, store) {
  const record = store.analysesByNctId?.[trial.nctId];
  if (!record) return { ...trial, targeting: { status: "not_screened", version: VERSION } };
  const current = record.sourceHash === sourceHash(trial) && record.version === VERSION;
  const { sources, ...publicRecord } = record;
  return { ...trial, targeting: { ...publicRecord, status: current ? "screened" : "stale" } };
}

async function enrichDataset(dataset, dataDir) {
  const store = await readStore(dataDir);
  return { ...dataset, trials: dataset.trials.map((trial) => attachTargeting(trial, store)) };
}

module.exports = { VERSION, TARGET_STATUSES, schema, sourceFor, sourceHash, validateReport, readStore, attachTargeting, enrichDataset };
