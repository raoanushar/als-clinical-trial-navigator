const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createUpdateAssistant}=require('../update-assistant');const {applyTrialOverrides}=require('../trial-overrides');const {createReviewStore}=require('../review-portal');
const trial={nctId:'NCT00000001',title:'Spinogenix ALS trial',sponsor:'Spinogenix',centralContacts:[{name:'Coordinator',email:'old@example.org'}],locations:[{facility:'NYU Langone Health',city:'New York',contacts:[{name:'Site contact',email:'site@example.org'}]}]};
const plan={trialQuery:'Spinogenix',nctId:'',scope:'study_contact',siteQuery:'',targetContact:'',contactAction:'update',question:'',changes:[{field:'contactEmail',value:'new@example.org',sourceQuote:'new@example.org'}]};
async function setup(){const store=createReviewStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(),'update-assistant-')),'reviews.json'));return {store,assistant:createUpdateAssistant(store)};}
const request=(assistant,p=plan,extra={})=>assistant.chat({question:'Update the Spinogenix study contact email to new@example.org',trials:[trial],apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({output_text:JSON.stringify(p)})}),...extra});
test('draft is read-only; explicit confirmation persists once without changing source or full-review status',async()=>{const {store,assistant}=await setup();const before=JSON.stringify(trial);const result=await request(assistant);assert.equal(result.proposal.changes[0].before,'old@example.org');assert.equal((await store.read()).trialUpdates,undefined);await assert.rejects(assistant.confirm({proposalId:result.proposal.id},[trial]),/Confirm/);const body={proposalId:result.proposal.id,confirmed:true};await Promise.all([assistant.confirm(body,[trial]),assistant.confirm(body,[trial])]);const data=await store.read();assert.equal(data.trialUpdates[trial.nctId].length,1);assert.deepEqual(data.centerReviews,{});assert.equal(JSON.stringify(trial),before);assert.equal(applyTrialOverrides(trial,data).centralContacts[0].email,'new@example.org');assert.equal(data.trialUpdates[trial.nctId][0].status,'applied');});
test('ambiguous trials, contact scope, missing values and multiple people require clarification',async()=>{const {assistant}=await setup();const duplicate={...trial,nctId:'NCT00000002'};assert.equal((await request(assistant,plan,{trials:[trial,duplicate]})).choices.length,2);assert.equal((await request(assistant,{...plan,changes:[]})).proposal,null);assert.match((await request(assistant,{...plan,scope:'unspecified'})).message,/study-wide/);assert.equal((await request(assistant,plan,{trials:[{...trial,centralContacts:[...trial.centralContacts,{name:'Other'}]}]})).choices.length,2);});
test('invented values are rejected and selected trial cannot silently switch',async()=>{const {assistant}=await setup();await assert.rejects(request(assistant,{...plan,changes:[{...plan.changes[0],value:'invented@example.org'}]}),/exact new/);const response=await request(assistant,{...plan,trialQuery:'Other sponsor'},{contextNctId:trial.nctId});assert.equal(response.proposal,null);assert.match(response.message,/different trial/);});
test('center context targets NYU site and stale source/proposal revisions block confirmation',async()=>{const {assistant}=await setup();const a=await request(assistant,{...plan,scope:'unspecified'},{contextNctId:trial.nctId});assert.equal(a.proposal.changes[0].path,'locations.0.contacts.0.email');await assert.rejects(assistant.confirm({proposalId:a.proposal.id,confirmed:true},[{...trial,title:'Changed'}]),/record changed/);const b=await request(assistant);await assistant.confirm({proposalId:b.proposal.id,confirmed:true},[trial]);await assert.rejects(assistant.confirm({proposalId:a.proposal.id,confirmed:true},[trial]),/Another update|record changed/);});

test('applied edits survive reload and source refresh, follow sites after reordering, and support another edit',async()=>{
 const {store,assistant}=await setup();const source={...trial,locations:[...trial.locations,{facility:'Other center',city:'Boston',contacts:[]}]};
 const draft=await request(assistant,{...plan,scope:'site_contact',siteQuery:'NYU'},{trials:[source]});await assistant.confirm({proposalId:draft.proposal.id,confirmed:true},[source]);
 const persisted=await store.read();const refreshed={...source,title:'Fresh registry title',locations:[source.locations[1],source.locations[0]]};
 const effective=applyTrialOverrides(refreshed,persisted);assert.equal(effective.title,'Fresh registry title');assert.equal(effective.locations[1].contacts[0].email,'new@example.org');assert.equal(effective.locations[0].contacts.length,0);
 const nextPlan={...plan,scope:'site_contact',siteQuery:'NYU',changes:[{field:'contactPhone',value:'555-0100',sourceQuote:'555-0100'}]};
 const next=await request(assistant,nextPlan,{trials:[effective],question:'Update the Spinogenix NYU phone to 555-0100'});await assistant.confirm({proposalId:next.proposal.id,confirmed:true},[effective]);
 const final=applyTrialOverrides(refreshed,await store.read());assert.equal(final.locations[1].contacts[0].phone,'555-0100');assert.equal(final.locations[1].contacts[0].email,'new@example.org');
});
const addSite={requested:true,facility:'NYU',city:'',state:'',country:'',status:'',contactName:'Donovan',contactEmail:'',contactPhone:'',sourceQuote:'add NYU as a site and list Donovan as the site contact'};
const addPlan={...plan,action:'update',question:'',scope:'site_contact',changes:[],addSite};
test('factual questions use the complete selected record and never produce an edit',async()=>{const {store,assistant}=await setup();let calls=0;const result=await assistant.chat({question:'Does the Spinogenix trial have an NYU site?',trials:[trial],apiKey:'test',fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls++;if(calls===2)assert.equal(JSON.parse(body.input[1].content).trial.locations[0].facility,'NYU Langone Health');return {ok:true,json:async()=>({output_text:JSON.stringify({...plan,action:'answer',answer:'Yes, NYU Langone Health in New York is listed.',changes:[]})})};}});assert.match(result.message,/Yes, NYU/);assert.equal(result.proposal,null);assert.equal((await store.read()).trialUpdates,undefined);});
test('add site and contact is previewed, persisted, audited and not duplicated after sync',async()=>{const {store,assistant}=await setup();const target={...trial,locations:[]};const directory={...trial,nctId:'NCT00000002',title:'Other study',sponsor:'Other'};const result=await request(assistant,addPlan,{question:'For NCT00000001 add NYU as a site and list Donovan as the site contact',trials:[target,directory]});assert.equal(result.proposal.changes[0].site.contacts[0].name,'Donovan');assert.equal(target.locations.length,0);await assistant.confirm({proposalId:result.proposal.id,confirmed:true},[target,directory]);const data=await store.read(),effective=applyTrialOverrides(target,data);assert.equal(effective.locations.length,1);assert.equal(effective.locations[0].facility,'NYU Langone Health');assert.equal(effective.locations[0].contacts[0].name,'Donovan');assert.equal(applyTrialOverrides(effective,data).locations.length,1);assert.equal(data.trialUpdates[target.nctId][0].changes[0].field,'addSite');});
test('existing site is reused while a new named contact is added without replacing people',async()=>{const {store,assistant}=await setup();const result=await request(assistant,addPlan,{question:'add NYU as a site and list Donovan as the site contact'});assert.ok(result.proposal.changes.every(c=>c.field!=='addSite'));await assistant.confirm({proposalId:result.proposal.id,confirmed:true},[trial]);const effective=applyTrialOverrides(trial,await store.read());assert.equal(effective.locations.length,1);assert.equal(effective.locations[0].contacts.length,2);assert.equal(effective.locations[0].contacts[0].name,'Site contact');assert.equal(effective.locations[0].contacts[1].name,'Donovan');});
test('unknown sites ask for missing location; invented contact values are rejected',async()=>{const {assistant}=await setup();const result=await request(assistant,{...addPlan,addSite:{...addSite,facility:'Example clinic',sourceQuote:'add Example clinic'}},{question:'For NCT00000001 add Example clinic'});assert.match(result.message,/city/);assert.equal(result.proposal,null);await assert.rejects(request(assistant,{...addPlan,addSite:{...addSite,contactEmail:'invented@example.org'}},{question:'add NYU as a site and list Donovan as the site contact'}),/exact site contact/);});
test('general chat follows the active trial when the next request uses a pronoun',async()=>{const {assistant}=await setup();const result=await request(assistant,{...plan,trialQuery:'',nctId:'',action:'answer',answer:'The study is sponsored by Spinogenix.',changes:[]},{question:'Who sponsors it?',activeNctId:trial.nctId});assert.equal(result.trial.nctId,trial.nctId);assert.match(result.message,/Spinogenix/);});
const mtSite={...addSite,facility:'Mt Sinai',contactName:'',sourceQuote:'Can you add Mt Sinai as a site?'};
const mtPlan={...addPlan,intentHandling:'replace',addSite:mtSite};
test('pending site addition survives short replies and a grounded model that incorrectly falls back to Q&A',async()=>{
 const {assistant}=await setup();let result=await request(assistant,mtPlan,{question:'Can you add Mt Sinai as a site?'});assert.match(result.message,/city/);
 const cityPlan={...plan,intentHandling:'continue',action:'answer',trialQuery:'',changes:[],addSite:{requested:false,facility:'',city:'New York City',sourceQuote:'New York City'}};
 result=await request(assistant,cityPlan,{question:'New York City',conversationId:result.conversationId,history:[]});assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.facility,'Mt Sinai');assert.equal(result.proposal.changes[0].site.city,'New York');assert.equal(trial.locations.length,1);
 const oldId=result.proposal.id;
 result=await request(assistant,{...cityPlan,addSite:{requested:false,facility:'Icahn School of Medicine',sourceQuote:'Icahn School of Medicine'}},{question:'Icahn School of Medicine',conversationId:result.conversationId,history:[]});assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.facility,'Icahn School of Medicine');assert.equal(result.proposal.changes[0].site.city,'New York');await assert.rejects(assistant.confirm({proposalId:oldId,confirmed:true},[trial]),/expired/);
});
test('same-city facilities remain distinct, Mt/Mount and NYC/New York aliases avoid duplicate sites',async()=>{
 const {assistant}=await setup();const target={...trial,locations:[...trial.locations,{facility:'Mount Sinai',city:'New York',contacts:[]}]};
 const response=await request(assistant,{...mtPlan,addSite:{...mtSite,city:'NYC'}},{question:'Can you add Mt Sinai as a site? In NYC.',trials:[target]});assert.equal(response.proposal,null);assert.match(response.message,/already listed/);
});
test('a factual detour preserves pending work; cancel invalidates it; saving clears it',async()=>{
 const {assistant}=await setup();let result=await request(assistant,mtPlan,{question:'Can you add Mt Sinai as a site?'});const id=result.conversationId;
 result=await request(assistant,{...plan,intentHandling:'question',action:'answer',answer:'Spinogenix sponsors it.',changes:[]},{question:'Who sponsors this trial?',conversationId:id});assert.equal(result.kind,'answer');assert.equal(result.proposal,null);
 result=await request(assistant,{...plan,intentHandling:'continue',action:'update',changes:[],addSite:{requested:true,city:'NYC',sourceQuote:'NYC'}},{question:'NYC',conversationId:id});assert.equal(result.kind,'proposal');const proposalId=result.proposal.id;
 result=await request(assistant,{...plan,intentHandling:'cancel'},{question:'Never mind, cancel that',conversationId:id});assert.equal(result.kind,'cancelled');await assert.rejects(assistant.confirm({proposalId,confirmed:true},[trial]),/expired/);
 result=await request(assistant,{...plan,intentHandling:'question',action:'answer',answer:'Spinogenix sponsors it.',changes:[]},{question:'Who sponsors it?',conversationId:id});assert.equal(result.proposal,null);
});
test('new trial selection does not inherit a pending site from the previous trial',async()=>{
 const {assistant}=await setup();const first=await request(assistant,mtPlan,{question:'Can you add Mt Sinai as a site?'});
 const other={...trial,nctId:'NCT00000002',title:'Different trial',sponsor:'Other'};
 const result=await request(assistant,{...plan,intentHandling:'question',action:'answer',nctId:other.nctId,trialQuery:'',answer:'A different study.',changes:[]},{question:'Tell me about NCT00000002',conversationId:first.conversationId,trials:[trial,other]});assert.equal(result.trial.nctId,other.nctId);assert.equal(result.proposal,null);
});
test('latest facility reply overrides stale facility values from both model passes',async()=>{
 const {assistant}=await setup();let result=await request(assistant,{...mtPlan,addSite:{...mtSite,city:'NYC'}},{question:'Can you add Mt Sinai as a site? In NYC.'});
 result=await request(assistant,{...mtPlan,intentHandling:'question',action:'answer',answer:'Still using Mt Sinai',addSite:{...mtSite,city:'New York City'}},{question:'Icahn School of Medicine',conversationId:result.conversationId});
 assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.facility,'Icahn School of Medicine');assert.match(result.proposal.changes[0].site.city,/NYC|New York/);
});
test('casual city and country replies fill pending location rather than becoming country questions',async()=>{
 const {assistant}=await setup();let result=await request(assistant,mtPlan,{question:'Can you add Mt Sinai as a site?'});
 const wrongAnswer={...plan,intentHandling:'question',action:'answer',answer:'The trial has US sites only.',changes:[]};
 result=await request(assistant,wrongAnswer,{question:'Yeah - its in new york city obviosuly',conversationId:result.conversationId});assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.city,'New York');assert.equal(result.proposal.changes[0].site.state,'New York');assert.equal(result.proposal.changes[0].site.country,'United States');
 result=await request(assistant,wrongAnswer,{question:'USA',conversationId:result.conversationId});assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.country,'United States');
});
test('pending conversation and confirmable preview survive assistant restart, while cancel remains effective',async()=>{
 const {store}=await setup();const conversationStore=createReviewStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(),'assistant-memory-test-')),'sessions.json'));
 let assistant=createUpdateAssistant(store,{conversationStore});let result=await request(assistant,mtPlan,{question:'Can you add Mt Sinai as a site?'});const conversationId=result.conversationId;
 assistant=createUpdateAssistant(store,{conversationStore});result=await request(assistant,{...plan,intentHandling:'continue',action:'answer',changes:[]},{question:'New York City',conversationId});assert.equal(result.kind,'proposal');const proposalId=result.proposal.id;
 assistant=createUpdateAssistant(store,{conversationStore});await assistant.confirm({proposalId,confirmed:true},[trial]);assert.equal(applyTrialOverrides(trial,await store.read()).locations.at(-1).country,'United States');assert.equal((await conversationStore.read()).sessions[conversationId].pending,null);
});
test('choosing a trial preserves the question that prompted the choice and an NCT-shaped trialQuery remains resolvable',async()=>{
 const {assistant}=await setup();const other={...trial,nctId:'NCT00000002'};
 const first=await request(assistant,{...plan,action:'answer',intentHandling:'question',answer:'NYU is listed.',changes:[]},{question:'Does the Spinogenix trial have NYU?',trials:[trial,other]});assert.equal(first.choices.length,2);
 const selected=await request(assistant,{...plan,action:'update',intentHandling:'replace',trialQuery:trial.nctId,nctId:trial.nctId,changes:[],answer:'NYU is listed.'},{question:`Use trial ${trial.nctId}.`,conversationId:first.conversationId,trials:[trial,other]});assert.equal(selected.kind,'answer');assert.match(selected.message,/NYU/);
 const edit=await request(assistant,{...mtPlan,trialQuery:trial.nctId,nctId:trial.nctId,addSite:{...mtSite,city:'NYC'}},{question:'Can you add Mt Sinai as a site? In NYC.',conversationId:selected.conversationId});assert.equal(edit.kind,'proposal');
});
test('site status resolves independently of contact scope and preserves status through a site reply',async()=>{
 const {assistant,store}=await setup();
 const statusPlan={...plan,action:'update',intentHandling:'continue',scope:'trial',trialQuery:'',changes:[{field:'siteStatus',value:'Recruiting',sourceQuote:'recruiting'}]};
 const first=await request(assistant,statusPlan,{question:'Change the site status to recruiting',activeNctId:trial.nctId});
 assert.equal(first.proposal,null);assert.ok(first.choices.length);
 const next=await request(assistant,{...statusPlan,changes:[],siteQuery:'NYU Langine'},{question:'NYU Langine',conversationId:first.conversationId});
 assert.equal(next.kind,'proposal');assert.equal(next.proposal.changes[0].path,'locations.0.status');assert.equal(next.proposal.changes[0].after,'Recruiting');
 assert.equal((await store.read()).trialUpdates,undefined);
});
test('overall status remains overall in the selected-center chat',async()=>{
 const {assistant}=await setup();const result=await request(assistant,{...plan,scope:'trial',changes:[{field:'status',value:'Recruiting',sourceQuote:'recruiting'}]},{question:'Can you change the status to recruiting',contextNctId:trial.nctId});
 assert.equal(result.proposal.changes[0].path,'status');
});
test('typo-tolerant institution matching still asks when multiple sites match',async()=>{
 const {assistant}=await setup();const result=await request(assistant,{...plan,scope:'trial',siteQuery:'NYU Langine',changes:[{field:'siteStatus',value:'Recruiting',sourceQuote:'recruiting'}]},{question:'Change NYU Langine to recruiting',trials:[{...trial,locations:[...trial.locations,{facility:'NYU Langone Hospital',city:'Brooklyn'}]}]});
 assert.equal(result.proposal,null);assert.equal(result.choices.length,2);
});
test('remote site needs no invented city and survives confirmation and reload',async()=>{
 const {assistant,store}=await setup();const p={...addPlan,addSite:{...addSite,facility:'EverythingALS (Remote)',participationType:'remote',contactName:'',sourceQuote:'Add EverythingALS (Remote)'}};
 const result=await request(assistant,p,{question:'Add EverythingALS (Remote) as a remote site'});
 assert.equal(result.kind,'proposal');assert.equal(result.proposal.changes[0].site.city,'');
 await assistant.confirm({proposalId:result.proposal.id,confirmed:true},[trial]);
 const effective=applyTrialOverrides(trial,await store.read());assert.equal(effective.locations.at(-1).participationType,'remote');
});
test('site capacity notes persist separately from status and trial notes append with attribution',async()=>{
 const {assistant,store}=await setup();const text='Nearly at capacity with a few spots left';
 const result=await request(assistant,{...plan,scope:'site_contact',siteQuery:'NYU',changes:[{field:'siteNote',value:text,sourceQuote:text}]},{question:`For NYU add a note: ${text}`});
 assert.equal((await store.read()).trialOverrides,undefined);
 await assistant.confirm({proposalId:result.proposal.id,confirmed:true},[trial]);
 let effective=applyTrialOverrides(trial,await store.read());assert.equal(effective.locations[0].portalNotes[0].text,text);assert.ok(effective.locations[0].portalNotes[0].author);assert.equal(effective.locations[0].status,trial.locations[0].status);
 for(const value of ['Travel support available','Call before visiting']){
 const r=await request(assistant,{...plan,scope:'trial',changes:[{field:'trialNote',value,sourceQuote:value}]},{question:`Add trial note: ${value}`,trials:[effective]});await assistant.confirm({proposalId:r.proposal.id,confirmed:true},[effective]);effective=applyTrialOverrides(trial,await store.read());
 }
 assert.equal(effective.portalNotes.length,2);assert.equal(effective.locations[0].portalNotes.length,1);
});
test('remote clarification completes a pending site addition without a city loop',async()=>{
 const {assistant}=await setup();let r=await request(assistant,{...addPlan,addSite:{...addSite,facility:'Community access',contactName:'',sourceQuote:'Add Community access'}} ,{question:'Add Community access'});
 assert.match(r.message,/city/);
 r=await request(assistant,{...plan,trialQuery:'',intentHandling:'continue',action:'update',changes:[],addSite:{requested:true,participationType:'remote'},question:''},{question:'It is remote',conversationId:r.conversationId});
 assert.equal(r.kind,'proposal');assert.equal(r.proposal.changes[0].site.facility,'Community access');assert.equal(r.proposal.changes[0].site.participationType,'remote');
});
test('site note ambiguity does not attach a note to an arbitrary site',async()=>{
 const {assistant}=await setup();const text='A few spots left';const r=await request(assistant,{...plan,siteQuery:'NYU',changes:[{field:'siteNote',value:text,sourceQuote:text}]},{question:text,trials:[{...trial,locations:[...trial.locations,{facility:'NYU Hospital',city:'Brooklyn'}]}]});assert.equal(r.proposal,null);assert.equal(r.choices.length,2);
});
