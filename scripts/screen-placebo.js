const fs=require('node:fs/promises'),path=require('node:path');
const {structuredRequest}=require('../ai-transport');
const {schema,sourceFor,hash,validate}=require('../placebo-agent');
const {placeboAssessment}=require('../dashboard-placebo');
const {applyTrialOverrides}=require('../trial-overrides');
function evidenceFields(value,prefix='',out={}){if(typeof value==='string')out[prefix]=value;else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))evidenceFields(item,prefix?prefix+'.'+key:key,out);return out;}
(async()=>{
 const root=path.resolve(__dirname,'..');try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const storage=process.env.STORAGE_DIR||root;
 const cache=JSON.parse(await fs.readFile(path.join(storage,'data/trials-cache.json'),'utf8'));
 const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]||5);if(!Number.isInteger(limit)||limit<1)throw Error('Invalid limit');
 let exclusions={};try{exclusions=JSON.parse(await fs.readFile(path.join(storage,'data/trial-exclusions.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let edits={};try{edits=JSON.parse(await fs.readFile(path.join(storage,'data/expert-portal-reviews.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const ongoing=new Set(['Recruiting','Not Yet Recruiting','Active Not Recruiting','Available']);
 const eligible=cache.trials.filter(t=>!exclusions[t.nctId]).filter(t=>{const current=applyTrialOverrides(t,edits);return current.studyType==='Interventional'&&ongoing.has(current.status);});
 let trials=eligible.slice(0,limit);

 const dir=path.join(storage,'reports/placebo-screening');await fs.mkdir(dir,{recursive:true});
 const prompt=await fs.readFile(path.join(root,'prompts/placebo-agent.txt'),'utf8');
 const model=process.env.PLACEBO_AGENT_MODEL||process.env.LANDSCAPE_AGENT_MODEL||process.env.OPENAI_CHAT_MODEL||'gpt-5.4-mini';
 const version=hash({prompt,schema,model});
 const next=Number(process.argv.find(a=>a.startsWith('--next='))?.split('=')[1]||0);
 if(next){
   if(!Number.isInteger(next)||next<1)throw Error('Invalid next count');
   trials=[];
   for(const t of eligible){let old;try{old=JSON.parse(await fs.readFile(path.join(dir,t.nctId+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
     if(!old)trials.push(t);
     if(trials.length===next)break;
   }
 }
 if(process.argv.includes('--resume-batch')){
   const previous=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
   const ids=new Set(previous.trials.map(t=>t.nctId));trials=eligible.filter(t=>ids.has(t.nctId));
 }
 if(process.argv.includes('--sham-review'))trials=eligible.filter(t=>/\bsham\b/i.test(JSON.stringify(sourceFor(t)))||JSON.stringify(t.armGroups||[]).includes('SHAM_COMPARATOR'));
 const target=process.argv.find(a=>a.startsWith('--nct-id='))?.split('=')[1];
 if(target){trials=eligible.filter(t=>t.nctId===target);if(!trials.length)throw Error('Trial is outside ongoing dashboard scope');}
 const manifest={createdAt:new Date().toISOString(),cacheSyncedAt:cache.syncedAt,selection:'Ongoing dashboard interventional trials only; excludes removed records. '+(next?'Next unscreened records':'Database order'),trials:trials.map(t=>({nctId:t.nctId,title:t.title})),model};
 if(!target)await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
 if(process.argv.includes('--dry-run')){console.log(JSON.stringify(manifest));return;}
 if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY is required');
 let failures=0;
 for(const trial of trials){
 const source=sourceFor(trial),file=path.join(dir,trial.nctId+'.json'),sourceHash=hash(source);
 try{
 let old;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!target&&old?.sourceHash===sourceHash&&old.version===version){console.log(trial.nctId+' already screened');continue;}
 let result,error,candidate;
 for(let attempt=0;attempt<3;attempt++){try{candidate=await structuredRequest({apiKey:process.env.OPENAI_API_KEY,model,name:'placebo_classification',schema,instructions:prompt+' Evidence paths must be exact keys from evidenceFields. Use short verbatim quotes of at most 12 words. Never paraphrase quotes or add ellipses.',data:{record:source,evidenceFields:evidenceFields(source),previousAttempt:candidate||null,validationFeedback:error?.message||''}});result=validate(candidate,source);break;}catch(e){error=e;}}
 if(!result){await fs.writeFile(path.join(dir,trial.nctId+'.error.json'),JSON.stringify({error:error?.message,candidate},null,2));throw error;}
 if(old){await fs.mkdir(path.join(dir,'history'),{recursive:true});await fs.writeFile(path.join(dir,'history',trial.nctId+'-'+Date.now()+'.json'),JSON.stringify(old,null,2));}
 await fs.writeFile(path.join(dir,trial.nctId+'.source.json'),JSON.stringify(source,null,2));
 await fs.writeFile(file+'.tmp',JSON.stringify({...result,title:trial.title,model,version,sourceHash,screenedAt:new Date().toISOString(),rule:placeboAssessment(trial)},null,2));await fs.rename(file+'.tmp',file);
 console.log(trial.nctId+' — '+result.label);
 }catch(e){failures++;console.error(trial.nctId+': '+e.message);}
 }
 console.log('Completed '+trials.length+' trials; '+failures+' failures.');if(failures)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
