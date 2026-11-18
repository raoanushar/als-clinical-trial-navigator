const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runSavaSearch,validatePlan,searchTrials} = require('../sava-search');
const plan = overrides => validatePlan({searchDescription:'Search trials',...overrides});
const trials = [
 {nctId:'NCT00000001',title:'SOD1 antisense trial',status:'Recruiting',studyType:'Interventional',phase:'Phase 1, Phase 2',summary:'SOD1 therapy',eligibilityCriteria:'SOD1 mutation required',locations:[{city:'Boston',state:'Massachusetts',country:'United States',facility:'MGH'}],updatedAt:'2026-10-01'},
 {nctId:'NCT00000002',title:'Infusion study',status:'Completed',studyType:'Interventional',phase:'Phase 2',summary:'Patients with SOD1 excluded',eligibilityCriteria:'SOD1 excluded',locations:[{city:'Boston',state:'Massachusetts',country:'United States',facility:'Other hospital'},{city:'New York',state:'New York',country:'United States',facility:'MGH'}],updatedAt:'2026-09-01'},
];
const reply = data => ({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]})});
test('AND constraints, OR statuses, combined phases, and site constraints on the same site',()=>{
 assert.deepEqual(searchTrials(trials,plan({statuses:['Recruiting','Completed'],phases:['Phase 2'],cities:['Boston'],sites:['MGH']})).map(t=>t.nctId),['NCT00000001']);
 assert.equal(searchTrials(trials,plan({termGroups:[['FUS']]})).length,0); // FUS must not match infusion.
 assert.equal(searchTrials(trials,plan({termGroups:[['SOD1'],['antisense','gene therapy']]})).length,1);
});
test('candidate search preserves exclusion mentions for evidence review',()=>assert.equal(searchTrials(trials,plan({termGroups:[['SOD1']]})).length,2));
test('date constraints exclude unknown and future dates',()=>{
 const now=Date.parse('2026-10-22'); const rows=['2026-10-21','2030-01-01','bad'].map(firstPostedAt=>({...trials[0],firstPostedAt}));
 assert.equal(searchTrials(rows,plan({postedWithinDays:30}),now).length,1);
});
test('answer grounded in candidates; bounded follow-up context reaches planner',async()=>{
 const calls=[]; const result=await runSavaSearch({question:'Only Boston',history:[{question:'SOD1 trials',answer:'Earlier answer',search:plan({termGroups:[['SOD1']]})}],trials,apiKey:'test',fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  return reply(calls.length===1 ? plan({cities:['Boston'],termGroups:[['SOD1']]}) : {answer:'NCT00000001 requires SOD1; NCT00000002 excludes it.',citedNctIds:['NCT00000001','NCT00000002'],followUps:['Only recruiting trials']});
 }});
 assert.equal(calls.length,2); assert.equal(JSON.parse(calls[0].input[1].content).history.length,1);assert.equal(result.totalMatches,2);assert.equal(result.trials.length,2);
 assert.equal(calls[0].store,false); assert.equal(calls[0].text.format.strict,true);
});
test('unsupported radius asks clarification without generating an evidence answer',async()=>{
 let calls=0; const result=await runSavaSearch({question:'Within 50 miles',trials,apiKey:'test',fetchImpl:async()=>{calls++;return reply(plan({clarification:'I cannot verify distance. Which city should I search?'}));}});
 assert.equal(calls,1);assert.equal(result.clarification,true);assert.equal(result.trials.length,0);
});
test('no matches skips answer generation',async()=>{
 let calls=0;const result=await runSavaSearch({question:'Unknown trial',trials,apiKey:'test',fetchImpl:async()=>{calls++;return reply(plan({nctIds:['NCT99999999']}));}});
 assert.equal(calls,1);assert.equal(result.totalMatches,0);
});
test('unknown citations rejected',async()=>{
 let calls=0;await assert.rejects(runSavaSearch({question:'SOD1',trials,apiKey:'test',fetchImpl:async()=>reply(++calls===1 ? plan({}) : {answer:'NCT99999999 is recruiting',citedNctIds:[],followUps:[]})}),/unsupported trial reference/);
});
test('missing credentials and upstream errors are explicit',async()=>{
 await assert.rejects(runSavaSearch({question:'SOD1',trials,apiKey:''}),/OPENAI_API_KEY/);
 await assert.rejects(runSavaSearch({question:'SOD1',trials,apiKey:'test',fetchImpl:async()=>({ok:false,status:429})}),/rate limit/);
 await assert.rejects(runSavaSearch({question:'SOD1',trials,apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/could not finish/);
});
test('sponsor names are searchable as free-text terms as well as sponsor filters',()=>{
 const rows=[{...trials[0],sponsor:'Spinogenix'}];assert.equal(searchTrials(rows,plan({termGroups:[['Spinogenix']]})).length,1);
});
test('ordinary location aliases and spaced drug names match actual records without an NCT ID',()=>{
 const rows=[{...trials[0],title:'SPG302 study',sponsor:'Spinogenix',locations:[{facility:'Mount Sinai Hospital',city:'New York',state:'New York',country:'United States'}]}];
 assert.equal(searchTrials(rows,plan({sponsors:['Spinogenix'],sites:['Mt Sinai'],cities:['NYC'],states:['NY'],countries:['USA'],termGroups:[['SPG 302']]})).length,1);
 assert.equal(searchTrials(rows,plan({sites:['NYU']})).length,0);
});
test('follow-up resolves named references, while a new sponsor search drops stale inferred IDs',async()=>{
 const rows=trials.map((t,i)=>({...t,sponsor:i?'Other sponsor':'Spinogenix'}));const history=[{question:'Spinogenix trials',answer:'The antisense study.',references:[{nctId:rows[0].nctId,title:rows[0].title,sponsor:'Spinogenix'}],search:plan({sponsors:['Spinogenix']})}];
 let calls=0;const follow=await runSavaSearch({question:'What phase is that one?',history,trials:rows,apiKey:'test',fetchImpl:async()=>reply(++calls===1?plan({contextMode:'question_about_results'}):{answer:'The antisense study spans phases 1 and 2.',citedNctIds:[rows[0].nctId],followUps:[]})});assert.equal(follow.totalMatches,1);assert.equal(follow.citedTrials[0].title,rows[0].title);
 calls=0;const changed=await runSavaSearch({question:'Now show Other sponsor trials',history,trials:rows,apiKey:'test',fetchImpl:async()=>reply(++calls===1?plan({contextMode:'new_search',sponsors:['Other sponsor'],nctIds:[rows[0].nctId]}):{answer:'The infusion study is completed.',citedNctIds:[rows[1].nctId],followUps:[]})});assert.equal(changed.trials[0].nctId,rows[1].nctId);
});
