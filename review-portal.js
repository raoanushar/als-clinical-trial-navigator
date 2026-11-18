const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const PROFILE = { id:'jinsy-andrews', name:'Dr. Jinsy Andrews', initials:'JA', center:'NYU Langone Health', centerId:'nyu', prototype:true };
const CENTER_STATUSES = ['Recruiting','Not Yet Recruiting','Active Not Recruiting','Enrolling By Invitation','Completed','Terminated','Suspended','Withdrawn','Unknown','Available','No Longer Available','Temporarily Not Available','Approved For Marketing','Withheld'];
const isCenterSite = site => /\bnyu\b|\bnew york university\b/i.test(String(site.facility || ''));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const analysisVersion = analysis => digest([analysis.analyzedAt,analysis.score,analysis.risk,analysis.report,analysis.reasons]);
function centerFields(trial) {
 return {title:trial.title || '',status:trial.status || 'Unknown',summary:trial.summary || '',eligibilityCriteria:trial.eligibilityCriteria || '',startDate:trial.startDate || '',primaryCompletionDate:trial.primaryCompletionDate || '',completionDate:trial.completionDate || '',sites:(trial.locations || []).filter(isCenterSite).map(site=>({facility:site.facility || '',city:site.city || '',state:site.state || '',country:site.country || '',status:site.status || '',contacts:(site.contacts || []).map(c=>({name:c.name || '',email:c.email || '',phone:c.phone || ''}))}))};
}
function centerVersion(trial) { return digest(centerFields(trial)); }
function createReviewStore(file) {
 let tail = Promise.resolve();
 async function read() {try {return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return {profile:PROFILE,assessments:{},centerReviews:{}};}}
 function mutate(callback) {
  const operation = tail.then(async()=>{const data=await read();const result=await callback(data);await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(tmp,JSON.stringify(data,null,2));await fs.rename(tmp,file);return result;});
  tail=operation.catch(()=>{});return operation;
 }
 return {read,mutate};
}
function buildReviewQueues(dataset,agentStore,manualStore,store,now=Date.now()) {
 const candidates=dataset.trials.flatMap(trial=>{
  const analysis=agentStore.analysesByNctId?.[trial.nctId]?.latest;
  if(!analysis || !['high','medium'].includes(analysis.risk))return [];
  const record=store.assessments?.[trial.nctId];
  const assessment=record?.latest || null;
  const legacy=manualStore.manualByNctId?.[trial.nctId];
  const reviewed=assessment ? assessment.analysisVersion===analysisVersion(analysis) : legacy?.status==='verified';
  return [{trial,analysis,assessment,legacyReview:legacy || null,reviewed:Boolean(reviewed),version:analysisVersion(analysis),history:record?.history || []}];
 }).sort((a,b)=>b.analysis.score-a.analysis.score);
 const published=store.queuePublication?.items || [];
 const flagged=candidates.filter(entry=>published.some(item=>item.nctId===entry.trial.nctId && item.analysisVersion===entry.version));
 const centers=dataset.trials.filter(trial=>(trial.locations || []).some(isCenterSite)).map(trial=>{
  const record=store.centerReviews?.[trial.nctId];const latest=record?.latest || null;
  const reviewed=Boolean(latest && latest.registryVersion===centerVersion(trial) && now-Date.parse(latest.reviewedAt)<90*86400000);
  const fields=centerFields(trial);const issues=[];
  if(fields.sites.some(site=>!site.contacts.some(c=>c.email || c.phone)))issues.push(fields.sites.some(site=>site.contacts.some(c=>c.name))?'Email or phone missing':'Site contact missing');
  if(!reviewed)issues.push(latest?'Check due':'Not checked');
  if(['Recruiting','Not Yet Recruiting','Enrolling By Invitation'].includes(trial.status) && fields.completionDate && Date.parse(fields.completionDate)<now)issues.push('Completion date passed');
  return {trial,fields,version:centerVersion(trial),review:latest,reviewed,issues,history:record?.history || [],proposedUpdates:store.trialUpdates?.[trial.nctId] || []};
 }).sort((a,b)=>(Date.parse(a.review?.reviewedAt)||0)-(Date.parse(b.review?.reviewedAt)||0));
 return {profile:store.profile || PROFILE,flagged,centers,curation:{candidateCount:candidates.length,publishedAt:store.queuePublication?.publishedAt||null},counts:{flaggedPending:flagged.filter(x=>!x.reviewed).length,flaggedReviewed:flagged.filter(x=>x.reviewed).length,centerPending:centers.filter(x=>!x.reviewed).length,centerReviewed:centers.filter(x=>x.reviewed).length,centerTotal:centers.length}};
}
function reviewError(message,status=400){return Object.assign(new Error(message),{status});}
function cleanFields(raw,original) {
 if(!raw || typeof raw!=='object')throw reviewError('Provide the proposed trial information.');
 const fields={};
 for(const key of ['title','status','summary','eligibilityCriteria','startDate','primaryCompletionDate','completionDate']) {
  if(typeof raw[key]!=='string' || raw[key].length>30000)throw reviewError(`Invalid ${key}.`);
  fields[key]=raw[key].trim();
 }
 if(!fields.title || !CENTER_STATUSES.includes(fields.status))throw reviewError('Provide a title and a valid recruitment status.');
 for(const key of ['startDate','primaryCompletionDate','completionDate'])if(fields[key] && (!/^\d{4}-\d{2}(-\d{2})?$/.test(fields[key]) || !Number.isFinite(Date.parse(fields[key]))))throw reviewError('Use YYYY-MM or YYYY-MM-DD for dates.');
 if(!Array.isArray(raw.sites) || raw.sites.length!==original.sites.length)throw reviewError('The site list changed. Reload the trial before submitting.');
 fields.sites=raw.sites.map(site=>{
  const clean={};for(const key of ['facility','city','state','country','status']){if(typeof site[key]!=='string' || site[key].length>500)throw reviewError('Invalid site information.');clean[key]=site[key].trim();}
  if(!clean.facility)throw reviewError('Site name is required.');
  if(clean.status && !CENTER_STATUSES.includes(clean.status))throw reviewError('Invalid site recruitment status.');
  if(!Array.isArray(site.contacts) || site.contacts.length>30)throw reviewError('Invalid site contacts.');
  clean.contacts=site.contacts.map(contact=>{const value={};for(const key of ['name','email','phone']){if(typeof contact[key]!=='string' || contact[key].length>500)throw reviewError('Invalid contact.');value[key]=contact[key].trim();}if(value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))throw reviewError('Enter a valid contact email.');return value;}).filter(c=>c.name||c.email||c.phone);
  return clean;
 });return fields;
}
async function saveReview(store,body,dataset,agentStore) {
 const trial=dataset.trials.find(t=>t.nctId===body.nctId);if(!trial)throw reviewError('Trial not found.',404);
 if(typeof body.note!=='string' || body.note.length>5000)throw reviewError('Keep your comment under 5,000 characters.');
 return store.mutate(data=>{
  const common={reviewedAt:new Date().toISOString(),reviewer:PROFILE.name,note:body.note.trim()};
  if(body.kind==='flagged') {
   const analysis=agentStore.analysesByNctId?.[trial.nctId]?.latest;
   if(!analysis || !['high','medium'].includes(analysis.risk))throw reviewError('This trial is not flagged for review.');
   if(!data.queuePublication?.items.some(item=>item.nctId===trial.nctId && item.analysisVersion===analysisVersion(analysis)))throw reviewError('This trial is not in the published expert queue.',409);
   if(body.version!==analysisVersion(analysis))throw reviewError('The AI assessment changed. Reload before reviewing.',409);
   if(!['suspicious','legitimate','unsure'].includes(body.assessment))throw reviewError('Choose an assessment.');
   const latest={...common,assessment:body.assessment,analysisVersion:body.version};
   data.assessments ||= {};const previous=data.assessments[trial.nctId];data.assessments[trial.nctId]={latest,history:[...(previous?.history || []),latest]};return latest;
  }
  if(body.kind==='center') {
   if(!(trial.locations || []).some(isCenterSite))throw reviewError('This trial does not list your selected center.');
   if(body.version!==centerVersion(trial))throw reviewError('Registry information changed. Reload before submitting.',409);
   if(!['confirmed','updates_pending'].includes(body.action))throw reviewError('Choose confirm or submit updates.');
   const original=centerFields(trial);const proposed=cleanFields(body.fields,original);
   const changed=JSON.stringify(proposed)!==JSON.stringify(original);
   if(body.action==='confirmed' && changed)throw reviewError('You changed the information. Submit proposed updates instead.');
   if(body.action==='updates_pending' && !changed)throw reviewError('Edit at least one field before submitting updates.');
   if(!Array.isArray(body.checks) || !['status','contacts','eligibility','timeline'].every(key=>body.checks.includes(key)))throw reviewError('Review all four checklist items before submitting.');
   const latest={...common,status:body.action,registryVersion:body.version,checks:body.checks,original,proposed:changed?proposed:null};
   data.centerReviews ||= {};const previous=data.centerReviews[trial.nctId];data.centerReviews[trial.nctId]={latest,history:[...(previous?.history || []),latest]};return latest;
  }
  throw reviewError('Unknown review type.');
 });
}
module.exports={PROFILE,CENTER_STATUSES,createReviewStore,buildReviewQueues,saveReview,centerFields,centerVersion,analysisVersion};
