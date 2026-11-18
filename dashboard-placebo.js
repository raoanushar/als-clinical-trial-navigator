const overrides = require('./data/placebo-label-overrides.json');

// Classification derived only from the CT.gov record saved in this app.
function registryPlaceboAssessment(trial) {
  if (trial.studyType && trial.studyType !== 'Interventional') return {label:'Not applicable',reason:'Not an interventional study; excluded from the dashboard placebo chart.'};
  const arms = trial.armGroups || [];
  if (arms.some(arm => ['PLACEBO_COMPARATOR','SHAM_COMPARATOR'].includes(arm.type))) return {label:'Placebo',reason:'A registered arm is typed PLACEBO_COMPARATOR or SHAM_COMPARATOR.'};
  const text = JSON.stringify([arms, trial.targetingInterventions || trial.interventionDetails || []]);
  if (/placebo|\bsham\b/i.test(text)) return {label:'Not specified',reason:'Placebo or sham is mentioned in the saved arms or interventions, but no arm is typed PLACEBO_COMPARATOR or SHAM_COMPARATOR. Needs interpretation.'};
  const nonPlacebo = new Set(['EXPERIMENTAL', 'ACTIVE_COMPARATOR', 'NO_INTERVENTION']);
  if (arms.length && arms.every(arm => nonPlacebo.has(arm.type))) return {label:'No placebo',reason:'All recorded arms have recognized non-placebo types and no placebo mention in arms/interventions. Inferred from saved data; sham controls count as placebo.'};
  return {label:'Not specified',reason:!arms.length?'No study arms are stored. Missing data is not evidence of no placebo.':'At least one arm has a missing or ambiguous type (such as OTHER).'};
}

// Saved AI or expert labels take priority; registry-arm classification is the fallback.
function placeboAssessment(trial) {
  if (trial.placeboDashboardLabel) return { label: trial.placeboDashboardLabel, reason: trial.placeboDashboardReason || 'Saved AI placebo classification.' };
  const override = overrides[trial.nctId];
  if (override) return { label: override.label, reason: override.reason, manual: true };
  return registryPlaceboAssessment(trial);
}
function placeboCategory(trial) { return placeboAssessment(trial).label; }
function registryPlaceboCategory(trial) { return registryPlaceboAssessment(trial).label; }
module.exports = { placeboCategory, placeboAssessment, registryPlaceboCategory, registryPlaceboAssessment };
