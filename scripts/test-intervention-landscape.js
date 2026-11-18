const {test}=require('node:test');const assert=require('node:assert/strict');const {validate,dimensions}=require('../intervention-landscape');
const record={protocolSection:{identificationModule:{nctId:'NCT00000001'},descriptionModule:{briefSummary:'This study evaluates an antisense oligonucleotide.'}}};
const result={nctId:'NCT00000001',findings:[{dimension:'modality',label:'ASO',evidence:[{path:'protocolSection.descriptionModule.briefSummary',quote:'antisense oligonucleotide'}]}],unknownDimensions:dimensions.filter(d=>d!=='modality')};
test('accepts exact registry evidence and explicit unknowns',()=>assert.equal(validate(result,record),result));
test('rejects invented evidence and wrong trial identity',()=>{assert.throws(()=>validate({...result,nctId:'NCT00000002'},record));const bad=structuredClone(result);bad.findings[0].evidence[0].quote='monoclonal antibody';assert.throws(()=>validate(bad,record));});
test('requires coverage of every requested dimension',()=>assert.throws(()=>validate({...result,unknownDimensions:[]},record)));
test('distinguishes inapplicable from unknown and rejects contradictory states',()=>{
 const r={...result,unknownDimensions:result.unknownDimensions.filter(d=>d!=='nonTreatment'),notApplicableDimensions:['nonTreatment']};assert.equal(validate(r,record),r);
 assert.throws(()=>validate({...r,notApplicableDimensions:['nonTreatment','modality']},record));
});
test('repairs whitespace, escaped registry formatting and unique field paths without changing quote content',()=>{
 const source={protocolSection:{identificationModule:{nctId:'NCT00000001'},descriptionModule:{briefSummary:'Uses \\[11C\\] tracer\n  for imaging'}}};
 const r=structuredClone(result);r.findings[0].evidence=[{path:'wrong.path',quote:'[11C] tracer for imaging'}];validate(r,source);assert.equal(r.findings[0].evidence[0].path,'protocolSection.descriptionModule.briefSummary');assert.ok(source.protocolSection.descriptionModule.briefSummary.includes(r.findings[0].evidence[0].quote));
});
