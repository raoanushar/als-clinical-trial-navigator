const fs=require('node:fs/promises');const path=require('node:path');
const {structuredRequest}=require('../ai-transport');const {schema,validate,hash}=require('../intervention-landscape');
const root=path.resolve(__dirname,'..');
function flatten(v,p='',out={}){if(typeof v==='string')out[p]=v;else if(v&&typeof v==='object')for(const [k,item]of Object.entries(v))flatten(item,p?p+'.'+k:k,out);return out;}
async function write(file,data){await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2));await fs.rename(file+'.tmp',file);}
(async()=>{
 try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const dir=path.join(process.env.STORAGE_DIR||root,'data');
 const cache=JSON.parse(await fs.readFile(path.join(dir,'trials-cache.json'),'utf8'));
 let trials=cache.trials.filter(t=>t.studyType==='Interventional'&&['Recruiting','Not Yet Recruiting','Active Not Recruiting','Available'].includes(t.status));
 let exclusions={};try{exclusions=JSON.parse(await fs.readFile(path.join(dir,'trial-exclusions.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 trials=trials.filter(t=>!exclusions[t.nctId]);
 const target=process.argv.find(a=>a.startsWith('--nct-id='))?.split('=')[1];
 if(target&&!trials.some(t=>t.nctId===target))throw Error('Trial is outside the included scope');
 const sample=process.argv.includes('--sample');
 if(sample){const ordered=[...trials].sort((a,b)=>hash(a.nctId).localeCompare(hash(b.nctId)));trials=[...ordered.filter(t=>t.primaryPurpose==='Treatment').slice(0,20),...ordered.filter(t=>t.primaryPurpose&&t.primaryPurpose!=='Treatment').slice(0,20)];}
 const out=path.join(root,sample?'reports/intervention-landscape-sample':'reports/intervention-landscape');await fs.mkdir(out,{recursive:true});
 const manifest={createdAt:new Date().toISOString(),cacheSyncedAt:cache.syncedAt,count:trials.length,trials:trials.map(t=>({nctId:t.nctId,title:t.title,primaryPurpose:t.primaryPurpose}))};
 if(process.argv.includes('--dry-run')){await write(path.join(out,'scope-preview.json'),manifest);console.log(`Scope: ${trials.length} interventional trials; no model calls.`);return;}
 if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY is required');
 const model=process.env.LANDSCAPE_AGENT_MODEL||process.env.OPENAI_CHAT_MODEL||'gpt-5.4-mini';
 const prompts={};for(const g of ['treatment','other'])prompts[g]=await fs.readFile(path.join(root,'prompts/intervention-'+g+'-agent.txt'),'utf8');
 const version=hash({prompts,schema,model});if(!target)await write(path.join(out,'manifest.json'),manifest);
 if(target)trials=trials.filter(t=>t.nctId===target);
 let failed=0;
 async function screen(t){
  const group=t.primaryPurpose==='Treatment'?'treatment':'other';
  const prompt=prompts[group]+`\nMark ${group==='treatment'?'nonTreatment':'modality'} as not applicable. The cohort is selected using the stored purpose; flag any discrepancy with the fetched record.`;
  const file=path.join(out,t.nctId+'.json');
  try{
   const response=await fetch('https://clinicaltrials.gov/api/v2/studies/'+t.nctId,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Registry HTTP '+response.status);
   const record=await response.json();const sourceHash=hash(record);
   let old;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!old&&!sample){try{const pilot=JSON.parse(await fs.readFile(path.join(root,'reports/intervention-landscape-sample',t.nctId+'.json'),'utf8'));if(pilot.sourceHash===sourceHash&&pilot.version===version){validate(pilot,record);await write(path.join(out,t.nctId+'.source.json'),record);await write(file,pilot);old=pilot;}}catch(e){if(e.code!=='ENOENT')console.log(t.nctId+' pilot not reusable');}}
   if(!target&&old?.sourceHash===sourceHash&&old.version===version){console.log(t.nctId+' unchanged');return;}
   await write(path.join(out,t.nctId+'.source.json'),record);
   let result,last,candidate;
   for(let attempt=0;attempt<3;attempt++){try{candidate=await structuredRequest({apiKey:process.env.OPENAI_API_KEY,model,name:'intervention_landscape',schema,instructions:prompt+'\nUse short evidence excerpts (at most 12 words each), copied exactly from evidenceFields. Do not reconstruct whole paragraphs. On retry, remove any unsupported claim rather than repeating rejected evidence.',data:{record,evidenceFields:flatten(record),previousAttempt:candidate||null,validationFeedback:last?.message||''}});result=validate(candidate,record);break;}catch(e){last=e;}}
   if(!result&&candidate?.nctId===t.nctId&&Array.isArray(candidate.findings)){
    const dimensions=['modality','nonTreatment','population','mechanism'];const retained=[];
    for(const finding of candidate.findings){try{validate({...candidate,findings:[finding],unknownDimensions:dimensions.filter(d=>d!==finding.dimension),notApplicableDimensions:[]},record);retained.push(finding);}catch{}}
    const unknown=dimensions.filter(d=>!retained.some(f=>f.dimension===d));
    result=validate({...candidate,findings:retained,unknownDimensions:unknown,notApplicableDimensions:[],needsReview:true,reviewReason:'Some model findings failed exact-source evidence validation and were omitted. Inspect the full record for missing classifications. '+(candidate.reviewReason||'')},record);
   }
   if(!result)throw last;
   if(old){await fs.mkdir(path.join(out,'history'),{recursive:true});await write(path.join(out,'history',t.nctId+'-'+Date.now()+'.json'),old);}
   await write(file,{...result,title:t.title,group,version,sourceHash,model,screenedAt:new Date().toISOString(),registryPurpose:record.protocolSection.designModule?.designInfo?.primaryPurpose||'',scopePurpose:t.primaryPurpose});console.log(t.nctId+' saved');
  }catch(e){failed++;await write(path.join(out,t.nctId+'.error.json'),{nctId:t.nctId,error:e.message,at:new Date().toISOString()});console.error(t.nctId+': '+e.message);}
 }
 const queue=[...trials];await Promise.all(Array.from({length:3},async()=>{while(queue.length)await screen(queue.shift());}));
 console.log(`Finished ${trials.length} trials; ${failed} failures. Successful results saved individually; reruns resume unchanged records.`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
