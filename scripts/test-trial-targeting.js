const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStudy } = require("../server");
const { VERSION, sourceFor, sourceHash, validateReport, attachTargeting } = require("../trial-targeting");

const trial = {
  nctId: "NCT00000001", title: "ALS trial", eligibilityCriteria: "Exclude bulbar onset. SOD1 mutation required.",
};
function report() {
  return {
    nctId: trial.nctId, dimensions: { onset: "specific", progression: "not_specified", gene: "specific", phenotype: "not_specified" },
    findings: [
      { dimension: "onset", value: "bulbar_onset", relationship: "excluded", cohort: "", detail: "Bulbar onset is excluded.", evidence: [{ sourceField: "eligibilityCriteria", quote: "Exclude bulbar onset." }] },
      { dimension: "gene", value: "SOD1", relationship: "required", cohort: "", detail: "A SOD1 mutation is required.", evidence: [{ sourceField: "eligibilityCriteria", quote: "SOD1 mutation required." }] },
    ], needsReview: false, reviewReason: "",
  };
}

test("normalization retains complete criteria, arms, and intervention text", () => {
  const description = "Full intervention description ".repeat(100);
  const normalized = normalizeStudy({ protocolSection: {
    identificationModule: { nctId: trial.nctId, officialTitle: "Official title" },
    eligibilityModule: { eligibilityCriteria: trial.eligibilityCriteria, studyPopulation: "ALS population" },
    armsInterventionsModule: { armGroups: [{ label: "Mutation carriers" }], interventions: [{ name: "A", description }] },
  } });
  assert.equal(normalized.eligibilityCriteria, trial.eligibilityCriteria);
  assert.equal(normalized.studyPopulation, "ALS population");
  assert.equal(normalized.targetingInterventions[0].description, description);
  assert.match(sourceFor(normalized).arms, /Mutation carriers/);
});

test("exclusions and requirements retain their separate relationships", () => {
  assert.deepEqual(validateReport(report(), trial).findings.map((finding) => finding.relationship), ["excluded", "required"]);
});

test("unsubstantiated evidence and trial ID mismatches are rejected", () => {
  const invented = report();
  invented.findings[0].evidence[0].quote = "Bulbar onset required.";
  assert.throws(() => validateReport(invented, trial), /exact source quote/);
  assert.throws(() => validateReport({ ...report(), nctId: "NCT99999999" }, trial), /ID mismatch/);
});

test("evidence whitespace is restored to the exact source substring", () => {
  const spaced = report();
  spaced.findings[0].evidence[0].quote = "Exclude bulbar onset.   SOD1 mutation required.";
  spaced.findings = [{ ...spaced.findings[0], evidence: [{ sourceField: "eligibilityCriteria", quote: "Exclude bulbar onset.   SOD1 mutation required." }] }];
  const result = validateReport(spaced, trial);
  assert.equal(result.findings[0].evidence[0].quote, trial.eligibilityCriteria);
});

test("displayed Markdown is restored to the registry's escaped substring", () => {
  const escapedTrial = { ...trial, eligibilityCriteria: "Familial ALS\\*\\* unless testing is negative." };
  const escaped = report();
  escaped.findings = [{
    dimension: "gene", value: "SOD1", relationship: "background_mention", cohort: "",
    detail: "Markdown evidence fixture.",
    evidence: [{ sourceField: "eligibilityCriteria", quote: "Familial ALS** unless testing is negative." }],
  }];
  const result = validateReport(escaped, escapedTrial);
  assert.equal(result.findings[0].evidence[0].quote, escapedTrial.eligibilityCriteria);
});

test("dimension status is deterministically derived from findings", () => {
  const invalid = report();
  invalid.dimensions.gene = "not_specified";
  assert.equal(validateReport(invalid, trial).dimensions.gene, "specific");
});

test("cohort findings must name a cohort", () => {
  const missing = report();
  missing.findings[0].relationship = "cohort";
  assert.throws(() => validateReport(missing, trial), /missing its cohort/);
});

test("duration-only progression and non-ALS control genes are removed", () => {
  const filtered = report();
  filtered.findings = [
    { dimension: "progression", value: "progression_rate_constraint", relationship: "required", cohort: "", detail: "Symptoms began within 24 months.", evidence: [{ sourceField: "eligibilityCriteria", quote: "Exclude bulbar onset." }] },
    { dimension: "gene", value: "RNASEH1", relationship: "cohort", cohort: "Disease Control", detail: "Disease-control gene.", evidence: [{ sourceField: "eligibilityCriteria", quote: "SOD1 mutation required." }] },
  ];
  filtered.dimensions = { onset: "not_specified", progression: "specific", gene: "specific", phenotype: "not_specified" };
  const result = validateReport(filtered, trial);
  assert.equal(result.findings.length, 0);
  assert.equal(result.dimensions.progression, "not_specified");
  assert.equal(result.dimensions.gene, "not_specified");
});

test("bulbar involvement without onset language is a phenotype, not onset", () => {
  const bulbarTrial = { ...trial, eligibilityCriteria: "ALS having only clinical bulbar involvement" };
  const bulbar = report();
  bulbar.findings = [{
    dimension: "onset", value: "bulbar_onset", relationship: "excluded", cohort: "",
    detail: "Bulbar-only ALS is excluded.",
    evidence: [{ sourceField: "eligibilityCriteria", quote: bulbarTrial.eligibilityCriteria }],
  }];
  bulbar.needsReview = true;
  bulbar.reviewReason = "The onset-related evidence describes bulbar involvement rather than onset.";
  const result = validateReport(bulbar, bulbarTrial);
  assert.equal(result.dimensions.onset, "not_specified");
  assert.equal(result.dimensions.phenotype, "specific");
  assert.equal(result.findings[0].dimension, "phenotype");
  assert.equal(result.findings[0].value, "bulbar_only_als");
  assert.equal(result.needsReview, false);
});

test("generic gene placeholders are removed and real symbols are normalized", () => {
  const genes = report();
  genes.findings = [
    { dimension: "gene", value: "UNSPECIFIED", relationship: "cohort", cohort: "Mutation carriers", detail: "No symbol named.", evidence: [{ sourceField: "eligibilityCriteria", quote: "SOD1 mutation required." }] },
    { dimension: "gene", value: "sod1", relationship: "required", cohort: "", detail: "SOD1 is required.", evidence: [{ sourceField: "eligibilityCriteria", quote: "SOD1 mutation required." }] },
  ];
  genes.needsReview = true;
  genes.reviewReason = "The record contains no explicit gene symbol.";
  const result = validateReport(genes, trial);
  assert.deepEqual(result.findings.map((finding) => finding.value), ["SOD1"]);
  assert.equal(result.needsReview, false);
});

test("catch-all other onset is not treated as an anatomical onset phenotype", () => {
  const onset = report();
  onset.findings = [{
    dimension: "onset", value: "other_onset", relationship: "required", cohort: "",
    detail: "Symptoms began within two years.",
    evidence: [{ sourceField: "eligibilityCriteria", quote: "Exclude bulbar onset." }],
  }];
  const result = validateReport(onset, trial);
  assert.equal(result.findings.length, 0);
  assert.equal(result.dimensions.onset, "not_specified");
});

test("missing criteria require review even when model omits warning", () => {
  const missing = { ...trial, eligibilityCriteria: "" };
  const result = { ...report(), findings: [], dimensions: { onset: "unclear", progression: "unclear", gene: "unclear", phenotype: "unclear" } };
  assert.equal(validateReport(result, missing).needsReview, true);
});

test("unchanged data stays screened; changed source or extractor version becomes stale", () => {
  const store = { analysesByNctId: { [trial.nctId]: { ...report(), version: VERSION, sourceHash: sourceHash(trial) } } };
  assert.equal(attachTargeting(trial, store).targeting.status, "screened");
  assert.equal(attachTargeting({ ...trial, eligibilityCriteria: "New criteria" }, store).targeting.status, "stale");
  assert.equal(attachTargeting(trial, { analysesByNctId: {} }).targeting.status, "not_screened");
  store.analysesByNctId[trial.nctId].version = "older";
  assert.equal(attachTargeting(trial, store).targeting.status, "stale");
});
