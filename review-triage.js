const {randomUUID}=require('node:crypto');
const {analysisVersion}=require('./review-portal');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function candidates(dataset,agents,data){
 return dataset.trials.flatMap(trial=>{
  const analysis=agents.analysesByNctId?.[trial.nctId]?.latest;
  if(!analysis||!['high','medium'].includes(analysis.risk))return [];
  const version=analysisVersion(analysis),record=data.flagTriage?.[trial.nctId];
  const current=record?.latest?.analysisVersion===version?record.latest:null;
  return [{trial,analysis,version,decision:current,previous:record?.latest||null,history:record?.history||[],draft:data.triageDrafts?.[trial.nctId]?.[version]||null}];
 }).sort((a,b)=>b.analysis.score-a.analysis.score);
}
function buildTriage(dataset,agents,data){
 const entries=candidates(dataset,agents,data);const publication=data.queuePublication;
 return {entries,counts:{total:entries.length,pending:entries.filter(e=>!e.decision).length,keep:entries.filter(e=>e.decision?.decision==='keep').length,exclude:entries.filter(e=>e.decision?.decision==='exclude').length},publication:publication||null,
 publishedCount:entries.filter(e=>publication?.items.some(item=>item.nctId===e.trial.nctId&&item.analysisVersion===e.version)).length};
}
async function saveTriage(store,body,dataset,agents){
 return store.mutate(data=>{
  const entry=candidates(dataset,agents,data).find(e=>e.trial.nctId===body.nctId);
  if(!entry)throw error('This trial is no longer flagged.',404);
  if(body.version!==entry.version)throw error('The AI assessment changed. Reload it before deciding.',409);
  if(!['keep','exclude'].includes(body.decision))throw error('Choose keep or exclude.');
  if(body.note===undefined)body.note='';
  if(typeof body.note!=='string'||body.note.length>5000)throw error('Keep your note under 5,000 characters.');
  const record={id:randomUUID(),nctId:body.nctId,decision:body.decision,note:body.note.trim(),reviewedAt:new Date().toISOString(),reviewer:'Portal curator',analysisVersion:entry.version,trialSnapshot:structuredClone(entry.trial),analysisSnapshot:structuredClone(entry.analysis)};
  data.flagTriage ||= {};const previous=data.flagTriage[body.nctId];data.flagTriage[body.nctId]={latest:record,history:[...(previous?.history||[]),record]};
  if(data.triageDrafts?.[body.nctId])delete data.triageDrafts[body.nctId][entry.version];return record;
 });
}
async function saveTriageDraft(store,body){
 if(!/^NCT\d{8}$/.test(body.nctId||'')||typeof body.version!=='string'||!/^[a-f0-9]{64}$/.test(body.version))throw error('Invalid trial draft.');
 if(typeof body.note!=='string'||body.note.length>5000||!Number.isFinite(body.editedAt)||body.editedAt>Date.now()+60000)throw error('Invalid draft note.');
 return store.mutate(data=>{
  const latest=data.flagTriage?.[body.nctId]?.latest;
  const currentId=latest?.analysisVersion===body.version?latest.id:null;
  // A delayed autosave must never resurrect a draft after a decision was saved.
  if((body.baseDecisionId||null)!==currentId)return {superseded:true};
  data.triageDrafts ||= {};data.triageDrafts[body.nctId] ||= {};
  const previous=data.triageDrafts[body.nctId][body.version];
  if(previous && previous.editedAt>body.editedAt)return previous;
  const draft={note:body.note,editedAt:body.editedAt,savedAt:new Date().toISOString(),baseDecisionId:currentId};
  data.triageDrafts[body.nctId][body.version]=draft;return draft;
 });
}
async function publishTriage(store,body,dataset,agents){
 if(body.confirmed!==true)throw error('Confirm publishing the curated queue.');
 return store.mutate(data=>{
  const entries=candidates(dataset,agents,data);
  const items=entries.filter(e=>e.decision?.decision==='keep').map(e=>({nctId:e.trial.nctId,analysisVersion:e.version,decisionId:e.decision.id}));
  const publication={id:randomUUID(),publishedAt:new Date().toISOString(),items};
  data.queuePublication=publication;data.queuePublicationHistory=[...(data.queuePublicationHistory||[]),publication];return publication;
 });
}
function trainingRows(data){return Object.values(data.flagTriage||{}).flatMap(record=>record.history||[]).map(record=>({schemaVersion:1,...record}));}
module.exports={buildTriage,saveTriage,publishTriage,trainingRows,saveTriageDraft};
