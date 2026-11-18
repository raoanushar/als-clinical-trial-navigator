const {createHash}=require('node:crypto');
const labels=['Placebo','No placebo','Not specified','Not relevant'];
const schema={type:'object',additionalProperties:false,required:['nctId','label','rationale','confidence','needsReview','reviewReason','evidence'],properties:{nctId:{type:'string'},label:{type:'string',enum:labels},rationale:{type:'string'},confidence:{type:'string',enum:['high','medium','low']},needsReview:{type:'boolean'},reviewReason:{type:'string'},evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['path','quote'],properties:{path:{type:'string'},quote:{type:'string'}}}}}};
function sourceFor(t){return Object.fromEntries(['nctId','title','officialTitle','studyType','phase','primaryPurpose','conditions','allocation','interventionModel','summary','detailedDescription','armGroups','targetingInterventions','eligibilityCriteria','studyPopulation'].map(k=>[k,t[k]??null]));}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function validate(result,source){
 if(result.nctId!==source.nctId||!labels.includes(result.label)||!result.rationale?.trim())throw Error('Invalid classification');
 if(result.label!=='Not specified'&&!result.evidence?.length)throw Error('Classification requires evidence');
 if(result.label==='Not specified'&&!result.needsReview)throw Error('Unspecified result must be flagged for review');
 if(source.studyType==='Interventional'&&result.label==='Not relevant')throw Error('Interventional studies must be assessed for placebo use');
 for(const e of result.evidence||[]){
   e.path=e.path.replace(/^(record|evidenceFields)\./,'').replace(/\[(\d+)\]/g,'.$1');
   const parts=e.path.split('.');let v=source,used=[];
   for(const part of parts){if(typeof v==='string')break;v=v?.[part];used.push(part);}
   if(typeof v!=='string'||!e.quote)throw Error('Evidence quote does not match source field '+e.path);
   if(!v.includes(e.quote)){
     const escaped=e.quote.trim().split(/\s+/).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
     const match=v.match(new RegExp(escaped));
     if(!match)throw Error('Evidence quote does not match source field '+e.path+'. Preserve exact capitalization and punctuation. Rejected quote: '+JSON.stringify(e.quote)+'. Exact source: '+JSON.stringify(v));
     e.quote=match[0];
   }
   e.path=used.join('.');
 }

 return result;
}
module.exports={schema,sourceFor,hash,validate};
