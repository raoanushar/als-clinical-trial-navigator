const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const cachePath = path.join(rootDir, "data", "trials-cache.json");
const storePath = path.join(rootDir, "data", "inconsistency-analyses.json");
const reportsDir = path.join(rootDir, "reports");

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function firstMatch(text, rules, fallback = "Unclear") {
  for (const [label, terms] of rules) {
    if (includesAny(text, terms)) {
      return label;
    }
  }
  return fallback;
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = row[field] === false ? "false" : row[field] === true ? "true" : row[field] || "Unclear";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function classifyGene(text) {
  const genes = [
    ["SOD1", ["sod1", "superoxide dismutase"]],
    ["C9orf72", ["c9orf72", "c9orf 72"]],
    ["FUS", ["fus-als", " fus ", "fused in sarcoma"]],
    ["TARDBP", ["tardbp", "tdp-43", "tdp43"]],
    ["ATXN2", ["atxn2", "ataxin-2", "ataxin 2"]],
    ["UNC13A", ["unc13a"]],
    ["CHCHD10", ["chchd10"]],
  ];
  const matches = genes.filter(([, terms]) => includesAny(text, terms)).map(([label]) => label);
  if (matches.length > 1) {
    return "Multiple genes";
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (includesAny(text, ["genetic", "gene mutation", "variant", "mutation", "familial als"])) {
    return "Other/unclear gene";
  }
  return "Sporadic/non-genetic";
}

function classifyDrug(text) {
  const therapyModality = firstMatch(text, [
    ["Viral vector gene therapy", ["aav", "adeno-associated", "lentiviral", "viral vector"]],
    ["ASO/RNA therapy", ["antisense", "oligonucleotide", "aso", "sirna", "rna", "intrathecal injection", "tofersen"]],
    ["Cell therapy", ["stem cell", "cell therapy", "progenitor cell", "mesenchymal", "transplantation", "ipsc"]],
    ["Biologic/protein", ["monoclonal", "antibody", "interleukin", "protein", "foralumab", "abatacept"]],
    ["Immunotherapy", ["immune", "immunomod", "inflammation", "treg", "regulatory t"]],
    ["Microbiome", ["microbiome", "microbiota", "fecal", "gut"]],
    ["Nutrition/supplement", ["supplement", "nutrition", "diet", "enteral nutrition", "nicotinamide", "pterostilbene"]],
    ["Small molecule", ["small molecule", "oral", "tablet", "capsule", "dose", "placebo", "terazosin", "riluzole", "ibudilast", "baricitinib"]],
  ], "Other/unclear drug");

  const mechanism = firstMatch(text, [
    ["Genetic targeting", ["sod1", "c9orf72", "fus", "tardbp", "atxn2", "unc13a", "chchd10", "antisense", "gene therapy", "mutation"]],
    ["Neuroinflammation/immune modulation", ["immune", "inflammation", "microglial", "treg", "cytokine", "interleukin", "foralumab", "abatacept", "baricitinib"]],
    ["Oxidative stress/mitochondrial/metabolism", ["mitochond", "oxidative", "atp", "energy", "metabolism", "nicotinamide", "pterostilbene"]],
    ["Protein aggregation/proteostasis", ["tdp-43", "protein aggregation", "proteostasis", "misfold"]],
    ["Excitotoxicity/glutamate", ["glutamate", "acamprosate", "excitotoxic"]],
    ["Microbiome/gut-brain", ["microbiome", "microbiota", "fecal", "gut"]],
    ["Regenerative/cell replacement", ["stem cell", "cell therapy", "progenitor", "transplant"]],
    ["Muscle/neuromuscular function", ["muscle", "neuromuscular", "motor neuron", "reinnervation"]],
    ["Biomarker/imaging agent", ["pet", "radioligand", "imaging", "biomarker"]],
    ["Symptom/supportive", ["symptom", "respiratory", "nutrition", "feeding", "pain", "sleep"]],
  ], "Other/unclear mechanism");

  const delivery = firstMatch(text, [
    ["AAV viral vector", ["aav", "adeno-associated"]],
    ["Lentiviral vector", ["lentiviral"]],
    ["Other viral vector", ["viral vector"]],
    ["ASO/intrathecal oligo", ["antisense", "oligonucleotide", "intrathecal", "tofersen"]],
    ["Cell transplant", ["stem cell", "cell transplant", "transplantation", "progenitor cell"]],
    ["Infusion/injection", ["infusion", "intravenous", "injection", "intrathecal"]],
    ["Oral small molecule", ["oral", "tablet", "capsule", "by mouth"]],
    ["Nasal/inhaled", ["nasal", "inhaled", "spray"]],
  ], "Unclear delivery");

  const geneTarget = classifyGene(text);
  const viralTherapy = ["AAV viral vector", "Lentiviral vector", "Other viral vector"].includes(delivery);
  const landscapeSubcategory = geneTarget !== "Sporadic/non-genetic" && therapyModality !== "Other/unclear drug"
    ? `${geneTarget} ${therapyModality}`
    : therapyModality;

  return {
    landscapeCategory: "Drug/biologic therapy",
    landscapeSubcategory,
    therapyModality,
    mechanismCategory: mechanism,
    geneTarget,
    viralTherapy,
    deliveryVector: delivery,
    deviceCategory: "Not applicable",
    devicePurpose: "Not applicable",
    procedureCategory: "Not applicable",
  };
}

function classifyOther(text, fallbackSubtype) {
  const deviceCategory = firstMatch(text, [
    ["BCI", ["brain-computer", "brain computer", "bci", "neural interface", "implantable device", "cursor", "speech synthesis"]],
    ["Respiratory/ventilation", ["ventilation", "ventilator", "noninvasive ventilation", "insufflation", "cough", "respiratory"]],
    ["Neuromodulation/stimulation", ["tdcs", "rtms", "stimulation", "magnetic stimulation", "neuromodulation"]],
    ["Assistive/robotic", ["robot", "robotic", "brace", "exoskeleton", "assistive"]],
    ["Monitoring/wearable", ["wearable", "sensor", "monitoring", "digital speech", "digital marker"]],
    ["Imaging/diagnostic device", ["imaging", "pet", "mri", "diagnostic", "biomarker"]],
    ["Communication device", ["communication", "speech", "typing", "cursor"]],
  ], fallbackSubtype === "Device" || fallbackSubtype === "BCI" ? "Other/unclear device" : "Not applicable");

  const devicePurpose = firstMatch(text, [
    ["Communication", ["communication", "speech", "typing", "cursor", "locked-in"]],
    ["Mobility/control", ["mobility", "movement", "control external", "arm function", "walking", "exoskeleton"]],
    ["Treatment/disease modification", ["treatment", "disease progression", "therapeutic", "stimulation"]],
    ["Respiratory support", ["ventilation", "respiratory", "cough", "insufflation"]],
    ["Diagnosis/measurement", ["diagnosis", "biomarker", "measurement", "monitoring", "imaging"]],
    ["Rehabilitation/training", ["rehabilitation", "exercise", "training", "tongue-strengthening"]],
    ["Nutrition/supportive care", ["nutrition", "diet", "feeding", "enteral"]],
  ], deviceCategory === "Not applicable" ? "Not applicable" : "Unclear purpose");

  const procedureCategory = firstMatch(text, [
    ["Nutrition/dietary intervention", ["nutrition", "diet", "feeding", "enteral", "formula", "supplement"]],
    ["Rehabilitation/exercise", ["rehabilitation", "exercise", "training", "tongue-strengthening"]],
    ["Behavioral/digital intervention", ["behavioral", "digital", "virtual reality", "vr", "app"]],
    ["Stimulation", ["stimulation", "tdcs", "rtms", "magnetic stimulation"]],
    ["Surgery/procedure", ["surgery", "procedure", "implant", "transplantation"]],
    ["Imaging/diagnostic procedure", ["imaging", "pet", "mri", "diagnostic"]],
  ], fallbackSubtype && fallbackSubtype !== "Device" && fallbackSubtype !== "BCI" ? fallbackSubtype : "Not applicable");

  const category = deviceCategory !== "Not applicable" ? "Device/assistive technology" : "Other non-drug intervention";
  const subcategory = deviceCategory !== "Not applicable" ? `${deviceCategory} - ${devicePurpose}` : procedureCategory;

  return {
    landscapeCategory: category,
    landscapeSubcategory: subcategory,
    therapyModality: "Not applicable",
    mechanismCategory: "Not applicable",
    geneTarget: "Not applicable",
    viralTherapy: false,
    deliveryVector: "Device/procedure",
    deviceCategory,
    devicePurpose,
    procedureCategory,
  };
}

function classifyNonInterventional(text, studyType) {
  const category = firstMatch(text, [
    ["Observational registry/natural history", ["registry", "natural history", "cohort", "observational"]],
    ["Biomarker/imaging", ["biomarker", "imaging", "pet", "mri", "neurofilament"]],
    ["Genetic/biobank", ["genetic", "biobank", "gene", "mutation", "variant"]],
    ["Care delivery/supportive care", ["caregiver", "care delivery", "supportive", "quality of life"]],
    ["Diagnostic/measurement", ["diagnosis", "measurement", "screen", "assessment"]],
    ["Expanded access", ["expanded access"]],
  ], studyType || "Non-interventional/unclear");

  return {
    landscapeCategory: category,
    landscapeSubcategory: category,
    therapyModality: "Not applicable",
    mechanismCategory: "Not applicable",
    geneTarget: category === "Genetic/biobank" ? classifyGene(text) : "Not applicable",
    viralTherapy: false,
    deliveryVector: "Not applicable",
    deviceCategory: "Not applicable",
    devicePurpose: "Not applicable",
    procedureCategory: "Not applicable",
  };
}

function classifyRecord(record, trial) {
  const text = normalize([
    record.title,
    trial?.summary,
    trial?.detailedDescription,
    trial?.interventionSummary,
    ...(trial?.interventions || []),
    ...(trial?.interventionTypes || []),
    record.rationale,
    ...(record.reasons || []),
  ].filter(Boolean).join(" "));

  if (record.interventionalSubtype === "Drug") {
    return classifyDrug(text);
  }
  if (record.interventionalSubtype === "Other") {
    return classifyOther(text, record.otherSubtype);
  }
  return classifyNonInterventional(text, record.inferredStudyType || record.registeredStudyType);
}

function buildHtml(summary, rows) {
  const sections = [
    ["Interventional subtype", summary.byInterventionalSubtype],
    ["Landscape category", summary.byLandscapeCategory],
    ["Drug modality", summary.byTherapyModality],
    ["Mechanism", summary.byMechanismCategory],
    ["Gene target", summary.byGeneTarget],
    ["Device category", summary.byDeviceCategory],
    ["Device purpose", summary.byDevicePurpose],
    ["Procedure category", summary.byProcedureCategory],
  ];

  const sectionHtml = sections.map(([title, items]) => `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th>Group</th><th>Count</th></tr></thead>
        <tbody>${items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.count}</td></tr>`).join("")}</tbody>
      </table>
    </section>
  `).join("");

  const rowHtml = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.nctId)}</td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.interventionalSubtype)}</td>
      <td>${escapeHtml(row.landscapeSubcategory)}</td>
      <td>${escapeHtml(row.therapyModality)}</td>
      <td>${escapeHtml(row.mechanismCategory)}</td>
      <td>${escapeHtml(row.geneTarget)}</td>
      <td>${escapeHtml(row.deviceCategory)}</td>
      <td>${escapeHtml(row.devicePurpose)}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ALS Trial Landscape Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; color: #1f2933; }
    h1, h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 28px; }
    th, td { border: 1px solid #d5dce3; padding: 7px; vertical-align: top; font-size: 13px; }
    th { background: #eef3f8; text-align: left; }
    .summary { color: #52616f; }
  </style>
</head>
<body>
  <h1>ALS Trial Landscape Report</h1>
  <p class="summary">${summary.totalReviewed} reviewed records classified from existing saved consistency results. No AI calls were made for this report.</p>
  ${sectionHtml}
  <section>
    <h2>Trial-level landscape table</h2>
    <table>
      <thead>
        <tr><th>NCT ID</th><th>Title</th><th>Drug/Other</th><th>Landscape subcategory</th><th>Drug modality</th><th>Mechanism</th><th>Gene target</th><th>Device category</th><th>Device purpose</th></tr>
      </thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </section>
</body>
</html>`;
}

function main() {
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const trialsById = new Map((cache.trials || []).map((trial) => [trial.nctId, trial]));
  const latest = Object.values(store.analysesByNctId || {}).map((record) => record.latest).filter(Boolean);

  const rows = latest.map((record) => {
    const trial = trialsById.get(record.nctId);
    const landscape = classifyRecord(record, trial);
    return {
      nctId: record.nctId,
      title: record.title,
      status: record.status,
      registeredStudyType: record.registeredStudyType,
      inferredStudyType: record.inferredStudyType,
      studyTypeMatch: record.studyTypeMatch,
      interventionalSubtype: record.interventionalSubtype,
      otherSubtype: record.otherSubtype || "",
      sponsor: record.sponsor,
      interventionSummary: trial?.interventionSummary || "",
      ...landscape,
      rationale: record.rationale || "",
      url: record.url || trial?.url || "",
    };
  }).sort((left, right) =>
    left.interventionalSubtype.localeCompare(right.interventionalSubtype) ||
    left.landscapeCategory.localeCompare(right.landscapeCategory) ||
    left.landscapeSubcategory.localeCompare(right.landscapeSubcategory) ||
    left.title.localeCompare(right.title)
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    totalReviewed: rows.length,
    byInterventionalSubtype: countBy(rows, "interventionalSubtype"),
    byLandscapeCategory: countBy(rows, "landscapeCategory"),
    byTherapyModality: countBy(rows.filter((row) => row.interventionalSubtype === "Drug"), "therapyModality"),
    byMechanismCategory: countBy(rows.filter((row) => row.interventionalSubtype === "Drug"), "mechanismCategory"),
    byGeneTarget: countBy(rows.filter((row) => row.interventionalSubtype === "Drug"), "geneTarget"),
    byViralTherapy: countBy(rows.filter((row) => row.interventionalSubtype === "Drug"), "viralTherapy"),
    byDeviceCategory: countBy(rows.filter((row) => row.interventionalSubtype === "Other"), "deviceCategory"),
    byDevicePurpose: countBy(rows.filter((row) => row.interventionalSubtype === "Other"), "devicePurpose"),
    byProcedureCategory: countBy(rows.filter((row) => row.interventionalSubtype === "Other"), "procedureCategory"),
  };

  const outDir = path.join(reportsDir, `landscape-report-${timestampForFile()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const detailHeaders = [
    "nct_id", "title", "status", "registered_study_type", "inferred_study_type", "study_type_match",
    "interventional_subtype", "other_subtype", "landscape_category", "landscape_subcategory",
    "therapy_modality", "mechanism_category", "gene_target", "viral_therapy", "delivery_vector",
    "device_category", "device_purpose", "procedure_category", "sponsor", "intervention_summary", "rationale", "url",
  ];
  const detailRows = rows.map((row) => [
    row.nctId, row.title, row.status, row.registeredStudyType, row.inferredStudyType, row.studyTypeMatch,
    row.interventionalSubtype, row.otherSubtype, row.landscapeCategory, row.landscapeSubcategory,
    row.therapyModality, row.mechanismCategory, row.geneTarget, row.viralTherapy, row.deliveryVector,
    row.deviceCategory, row.devicePurpose, row.procedureCategory, row.sponsor, row.interventionSummary, row.rationale, row.url,
  ]);

  const summaryRows = [
    ["section", "label", "count"],
    ...Object.entries(summary)
      .filter(([, value]) => Array.isArray(value))
      .flatMap(([section, items]) => items.map((item) => [section, item.label, item.count])),
  ];

  fs.writeFileSync(path.join(outDir, "landscape-details.csv"), toCsv([detailHeaders, ...detailRows]));
  fs.writeFileSync(path.join(outDir, "landscape-summary.csv"), toCsv(summaryRows));
  fs.writeFileSync(path.join(outDir, "landscape-report.json"), JSON.stringify({ summary, rows }, null, 2));
  fs.writeFileSync(path.join(outDir, "landscape-report.html"), buildHtml(summary, rows));

  console.log(JSON.stringify({
    outDir,
    totalReviewed: summary.totalReviewed,
    files: ["landscape-details.csv", "landscape-summary.csv", "landscape-report.json", "landscape-report.html"],
    topLandscapeCategories: summary.byLandscapeCategory.slice(0, 8),
  }, null, 2));
}

main();
