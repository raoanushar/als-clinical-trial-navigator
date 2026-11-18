const {createHash}=require('node:crypto');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'};
const dimensions=['modality','population','mechanism','nonTreatment'];
const schema=object({nctId:str,findings:{type:'array',items:object({dimension:{type:'string',enum:dimensions},label:str,interventionOrCohort:str,relationship:str,confidence:{type:'string',enum:['high','medium','low']},evidence:{type:'array',items:object({path:str,quote:str})}})},unknownDimensions:{type:'array',items:{type:'string',enum:dimensions}},notApplicableDimensions:{type:'array',items:{type:'string',enum:dimensions}},needsReview:{type:'boolean'},reviewReason:str});
function validate(result,record){
 if(result.nctId!==record.protocolSection.identificationModule.nctId)throw Error('Trial ID mismatch');
 for(const f of result.findings){
  if(!dimensions.includes(f.dimension)||!f.label.trim()||!f.evidence.length)throw Error('Unsupported finding');
  for(const e of f.evidence){
   const value=e.path.split('.').reduce((v,k)=>v?.[k],record);
   if(typeof value==='string'&&e.quote.trim()&&value.includes(e.quote))continue;
   // Repair only verifiable paths/whitespace; never paraphrase evidence.
   const matches=[];
   function visit(v,path){if(typeof v==='string'&&e.quote.trim()){
    const pattern=e.quote.trim().split(/\s+/).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
    const found=v.match(new RegExp(pattern));if(found)matches.push({path,quote:found[0]});
    else {let plain='',indices=[];for(let i=0;i<v.length;i++){if(v[i]==='\\'&&/[<>*_\[\]]/.test(v[i+1]||''))continue;indices.push(i);plain+=v[i];}const hit=plain.match(new RegExp(pattern));if(hit)matches.push({path,quote:v.slice(indices[hit.index],indices[hit.index+hit[0].length-1]+1)});}
   }else if(v&&typeof v==='object')for(const [k,item]of Object.entries(v))visit(item,path?path+'.'+k:k);}
   visit(record,'');const exact=matches.find(m=>m.path===e.path);
   if(exact||matches.length===1){Object.assign(e,exact||matches[0]);continue;}
   throw Error('Evidence is not an exact source quote: '+e.path+'; rejected quote: '+JSON.stringify(e.quote)+'; actual field: '+JSON.stringify(value)+'; omit unsupported findings and mark unknown; use an exact short substring of a string field, with its complete path.');
  }
 }
 for(const dim of dimensions){
  const states=[result.findings.some(f=>f.dimension===dim),result.unknownDimensions.includes(dim),(result.notApplicableDimensions||[]).includes(dim)].filter(Boolean).length;
  if(states!==1)throw Error('Dimension must be classified, unknown, or not applicable: '+dim);
 }
 return result;
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
module.exports={schema,validate,hash,dimensions};
