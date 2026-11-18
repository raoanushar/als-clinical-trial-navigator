const {sourceFor:placeboSource,hash:placeboHash}=require('./placebo-agent');
const {placeboAssessment,registryPlaceboAssessment}=require('./dashboard-placebo');
const fs = require('node:fs/promises');
const path = require('node:path');
async function optionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function buildTrialDataTable(dataset, dataDir, reportsDir) {
  const [cache, parents, edits] = await Promise.all([
    optionalJson(path.join(dataDir, 'trials-cache.json')),
    optionalJson(path.join(reportsDir, 'intervention-landscape', 'parent-groups.json')),
    optionalJson(path.join(dataDir, 'expert-portal-reviews.json')),
  ]);
  const registry = new Map((cache?.trials || []).map(t => [t.nctId, t]));
  const curated = new Map();
  for (const [kind, group] of Object.entries(parents?.groups || {})) for (const parent of group.parents || []) {
    for (const category of parent.subcategories || []) for (const id of category.trialIds || []) {
      if (!curated.has(id)) curated.set(id, new Set());
      curated.get(id).add(`${kind === 'treatment' ? 'ALS treatment' : 'Other intervention'} / ${parent.label} / ${category.label}`);
    }
  }
  return Promise.all(dataset.trials.map(async trial => {
    const raw = registry.get(trial.nctId);
    const report = await optionalJson(path.join(reportsDir, 'intervention-landscape', `${trial.nctId}.json`));
    const placeboAI = await optionalJson(path.join(reportsDir, 'placebo-screening', `${trial.nctId}.json`));
    const targeting = trial.targeting || {};
    return {
      nctId:trial.nctId, title:trial.title, registry:raw || {},
      placebo:placeboAssessment(trial),
      placeboAI:placeboAI ? {...placeboAI,stale:placeboAI.sourceHash !== placeboHash(placeboSource(raw || trial))} : null,
      registryPlacebo:raw ? registryPlaceboAssessment(raw) : {label:'Not specified',reason:'No saved registry record.'},
      placeboInputs:{studyType:trial.studyType,armGroups:trial.armGroups || [],interventions:trial.targetingInterventions || trial.interventionDetails || []},
      targeting:{status:targeting.status || 'not_screened',findings:targeting.findings || [],needsReview:targeting.needsReview,reviewReason:targeting.reviewReason || ''},
      intervention:report ? {findings:report.findings || [],screenedAt:report.screenedAt,needsReview:report.needsReview,reviewReason:report.reviewReason || ''} : null,
      curated:[...(curated.get(trial.nctId) || [])],
      portalFields:edits?.trialOverrides?.[trial.nctId]?.fields || {},
    };
  }));
}
module.exports = {buildTrialDataTable};
