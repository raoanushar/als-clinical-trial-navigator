(() => {
  let payload=null, mode='flagged', selected='', saving=false, loadSequence=0;
  const drafts=new Map();
  const generalChat=UpdateChat.mount(document.getElementById("general-update-chat"),{general:true});
  const centerChat=UpdateChat.mount(document.getElementById("center-update-chat"));
  const $=id=>document.getElementById(id), esc=escapeHtml;
  const statuses=['Recruiting','Not Yet Recruiting','Active Not Recruiting','Enrolling By Invitation','Completed','Terminated','Suspended','Withdrawn','Unknown','Available','No Longer Available','Temporarily Not Available','Approved For Marketing','Withheld'];
  const assessmentLabels={suspicious:'Suspicious',legitimate:'Looks legitimate',unsure:'Not sure'};
  const date=value=>value ? formatDate(value) : 'Not checked';
  const draftKey=()=>`${mode}:${selected}`;
  function stash(){const form=$('review-form');if(form)drafts.set(draftKey(),[...new FormData(form).entries()]);}
  function entries(){return !payload ? [] : (mode==='flagged'?payload.flagged:payload.centers).filter(entry=>entry.reviewed===$('review-show-history').checked);}
  function current(){return (mode==='flagged'?payload?.flagged:payload?.centers)?.find(entry=>entry.trial.nctId===selected);}
  function updateOverview(){
    if(!payload)return;const c=payload.counts;
    $('portal-flag-count').textContent=c.flaggedPending;$('portal-flag-count').hidden=!c.flaggedPending;
    $('profile-center-summary').textContent=`${c.centerTotal} trials list NYU · ${c.centerPending} need a check.`;
  }
  function applyDemoQueue(result){
// Demo-only queue visibility. Published curation records remain unchanged.
result.flagged=result.flagged.filter(entry=>entry.trial.nctId==='NCT02795052');
result.counts.flaggedTotal=result.flagged.length;
result.counts.flaggedReviewed=result.flagged.filter(entry=>entry.reviewed).length;
result.counts.flaggedPending=result.flagged.filter(entry=>!entry.reviewed).length;
return result;
  }
  async function load(stashCurrent=true){const sequence=++loadSequence;try{const result=await fetchJson('/api/review-portal');if(sequence!==loadSequence)return;if(stashCurrent)stash();payload=applyDemoQueue(result);updateOverview();render();}catch(error){$('review-error').hidden=false;$('review-error').textContent=error.message;}}
  function field(label,name,value,type='text',textarea=false){return `<label class="review-field">${esc(label)}${textarea?`<textarea name="${name}" rows="${name==='note'?3:5}" maxlength="${name==='note'?5000:30000}">${esc(value || '')}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value || '')}" maxlength="${name==='title'?30000:500}" />`}</label>`;}
  function statusField(label,name,value,empty=false){return `<label class="review-field">${esc(label)}<select name="${name}">${empty?'<option value="">Not listed</option>':''}${[...new Set([...statuses,...(value?[value]:[])])].map(status=>`<option${status===value?' selected':''}>${esc(status)}</option>`).join('')}</select></label>`;}
  function render(){
    const isAssistant=mode==='assistant';
    $('update-assistant-view').hidden=!isAssistant;
    document.querySelector('.review-workspace').hidden=isAssistant;
    $('review-progress').hidden=isAssistant;
    $('review-show-history').closest('label').hidden=isAssistant;
    document.querySelector('#agent-panel > .portal-advanced').hidden=isAssistant;
    if(isAssistant)return;
    if(!payload)return;const list=entries();if(!list.some(entry=>entry.trial.nctId===selected))selected=list[0]?.trial.nctId || '';
    const c=payload.counts;
    $('review-progress').innerHTML=mode==='center'?`<div><strong>NYU Langone Health</strong><p>${c.centerReviewed} of ${c.centerTotal} trials checked · ${c.centerPending} need a check</p></div><progress value="${c.centerReviewed}" max="${c.centerTotal || 1}" aria-label="Center trials checked"></progress>`:`<div><strong>${c.flaggedPending} trials awaiting assessment</strong><p>${c.flaggedReviewed} reviewed · AI flags are signals for clinician review.</p></div>`;
    $('review-queue').innerHTML=list.length?list.map((entry,index)=>`<button type="button" class="review-queue-item ${entry.trial.nctId===selected?'is-selected':''}" data-review-select="${esc(entry.trial.nctId)}" ${entry.trial.nctId===selected?'aria-current="true"':''}><span class="review-queue-meta">${mode==='flagged'?`<span class="risk-badge ${entry.analysis.risk}">${esc(entry.analysis.risk)} risk</span>`:`<span class="meta-pill">${entry.reviewed?entry.review.status==='updates_pending'?'Updates proposed':'Checked':esc(entry.issues[0] || 'Needs check')}</span>`}<small>${index+1} / ${list.length}</small></span><strong>${esc(entry.trial.title)}</strong><small>${esc(entry.trial.nctId)}</small></button>`).join(''):'<p class="subtle review-empty">'+($('review-show-history').checked?'No reviews yet.':'You’re caught up on this queue.')+'</p>';
    $('review-queue').querySelectorAll('[data-review-select]').forEach(button=>button.addEventListener('click',()=>{if(saving)return;stash();selected=button.dataset.reviewSelect;$('review-feedback').textContent='';render();}));
    renderDetail();
  }
  function renderDetail(){
    const entry=current();
    $('center-update-chat').hidden=mode!=='center'||!entry;
    document.querySelector('.review-workspace').classList.toggle('has-update-chat',mode==='center'&&Boolean(entry));
    if(mode==='center'&&entry)centerChat.setContext(entry.trial);
if(!entry){$('review-detail').innerHTML=mode==='flagged'?'<div class="review-empty"><h3>Done</h3><p class="subtle">No trials left to review. Use Show reviewed to revisit your assessment.</p></div>':'<div class="review-empty"><h3>No trials to review</h3><p class="subtle">Use Show reviewed to revisit your trials.</p></div>';document.getElementById('open-triage')?.addEventListener('click',()=>window.dispatchEvent(new Event('open-triage')));return;}
    const trial=entry.trial;
    const header=`<div class="review-detail-header"><p class="eyebrow">${esc(trial.nctId)}</p><h3>${esc(trial.title)}</h3><div class="trial-meta"><span class="status-badge ${statusClassName(trial.status)}">${esc(trial.status)}</span><span class="meta-pill">${esc(trial.studyType)}</span>${trial.phase && trial.phase!==trial.studyType?`<span class="meta-pill">${esc(trial.phase)}</span>`:''}</div><p class="subtle">${esc(trial.sponsor)}</p><a href="https://clinicaltrials.gov/study/${esc(trial.nctId)}" target="_blank" rel="noreferrer">View registry record ↗</a></div>`;
    const latest=mode==='flagged'?entry.assessment:entry.review;
    let previous=latest?`<div class="review-previous"><strong>${mode==='flagged'?assessmentLabels[latest.assessment]:latest.status==='updates_pending'?'Proposed updates saved':'Confirmed up to date'}</strong><span>${date(latest.reviewedAt)} · ${esc(latest.reviewer)}</span>${latest.note?`<p>${esc(latest.note)}</p>`:''}${!entry.reviewed?'<p>The source information changed or this check is due again.</p>':''}</div>`:entry.legacyReview?.status==='verified'?'<p class="review-previous">Previously marked verified in the navigator.</p>':'';
    previous=renderPortalNotes(trial)+previous;
    if(mode==='center'&&entry.proposedUpdates?.length)previous+=`<details class="review-chat-updates"><summary>${entry.proposedUpdates.length} chat update${entry.proposedUpdates.length===1?'':'s'}</summary>${entry.proposedUpdates.map(update=>`<article><p class="subtle">${date(update.confirmedAt)} · ${esc(update.reviewer)} · ${update.status==='applied'?'Applied to portal':'Earlier proposal — not applied'}</p>${update.changes.map(change=>`<p><strong>${esc(change.label)}</strong> · ${esc(change.scope)}<br>${esc(change.before||'Not listed')} → ${esc(change.after||'(Remove value)')}</p>`).join('')}</article>`).join('')}<p class="subtle">Applied updates appear in this portal. The full trial checklist is a separate review.</p></details>`;
    if(mode==='flagged'){
      const analysis=entry.analysis;
      const reasons=(analysis.reasons || []).map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.reason || reason.text || JSON.stringify(reason))}</li>`).join('');
      $('review-detail').innerHTML=`${header}${previous}<section class="review-ai"><h4>Why SAVA flagged it</h4><p class="subtle">Analyzed ${date(analysis.analyzedAt)}</p><p>${esc(analysis.report || 'No written assessment available.')}</p>${reasons?`<ul>${reasons}</ul>`:''}</section><details class="review-registry"><summary>Registry summary &amp; eligibility</summary><p>${esc(trial.summary || 'No summary provided.')}</p><p>${esc(trial.eligibilityCriteria || 'No eligibility criteria in the stored record.')}</p></details><form id="review-form"><fieldset class="review-assessment"><legend>Your assessment</legend>${Object.entries(assessmentLabels).map(([value,label])=>`<label class="review-option"><input type="radio" name="assessment" value="${value}" required ${latest?.assessment===value?'checked':''}/><span><strong>${label}</strong><small>${value==='suspicious'?'Keep the concern on record':value==='legitimate'?'Record that you found the listing legitimate':'Record that further review is needed'}</small></span></label>`).join('')}</fieldset>${field('Comment (optional)','note',latest?.note || '', 'text',true)}<div class="review-form-actions"><button class="secondary-button" id="review-skip" type="button">Skip for now</button><button class="primary-button" type="submit">Save assessment &amp; next</button></div></form>`;
    }else{
      const fields=entry.review?.registryVersion===entry.version ? (entry.review?.proposed || entry.fields) : entry.fields;
      $('review-detail').innerHTML=`${header}${previous}<p class="subtle review-center-note">Review the four items below. Edits are saved as proposed updates in this portal, not published to ClinicalTrials.gov.</p><form id="review-form"><details class="review-check-section" open><summary>Recruitment status</summary>${field('Trial title','title',fields.title)}${statusField('Overall trial status','status',fields.status)}<label class="checkbox-row"><input type="checkbox" name="checks" value="status" required /> I reviewed the recruitment information</label></details><details class="review-check-section" open><summary>NYU sites &amp; contacts</summary>${fields.sites.map((site,index)=>`<div class="review-site"><h4>${esc(site.facility)}</h4><div class="review-field-grid">${field('Site name',`site.${index}.facility`,site.facility)}${statusField('Site recruitment status',`site.${index}.status`,site.status,true)}${field('City',`site.${index}.city`,site.city)}${field('State',`site.${index}.state`,site.state)}${field('Country',`site.${index}.country`,site.country)}</div>${(site.contacts.length?site.contacts:[{name:'',email:'',phone:''}]).map((contact,j)=>`<div class="review-field-grid">${field('Contact name',`site.${index}.contact.${j}.name`,contact.name)}${field('Email',`site.${index}.contact.${j}.email`,contact.email,'email')}${field('Phone',`site.${index}.contact.${j}.phone`,contact.phone)}</div>`).join('')}</div>`).join('')}<label class="checkbox-row"><input type="checkbox" name="checks" value="contacts" required /> I reviewed the center’s site and contact details</label></details><details class="review-check-section"><summary>Summary &amp; eligibility</summary>${field('Study summary','summary',fields.summary,'text',true)}${field('Eligibility criteria','eligibilityCriteria',fields.eligibilityCriteria,'text',true)}<label class="checkbox-row"><input type="checkbox" name="checks" value="eligibility" required /> I reviewed the summary and eligibility</label></details><details class="review-check-section"><summary>Timeline</summary><p class="subtle">Use YYYY-MM or YYYY-MM-DD. Blank means the date is unavailable in the stored record.</p><div class="review-field-grid">${field('Start date','startDate',fields.startDate)}${field('Primary completion','primaryCompletionDate',fields.primaryCompletionDate)}${field('Study completion','completionDate',fields.completionDate)}</div><label class="checkbox-row"><input type="checkbox" name="checks" value="timeline" required /> I reviewed the timeline</label></details>${field('Comment (optional)','note',latest?.note || '','text',true)}<div class="review-form-actions"><button id="review-skip" class="secondary-button" type="button">Skip for now</button><button id="review-confirm" class="primary-button" type="submit" value="confirmed">Confirm up to date &amp; next</button><button id="review-propose" class="primary-button" type="submit" value="updates_pending" hidden>Submit proposed updates &amp; next</button></div></form>`;
    }
    const form=$('review-form'),draft=drafts.get(draftKey());
    if(draft){for(const element of form.elements){if(!element.name)continue;const values=draft.filter(([name])=>name===element.name).map(([,value])=>value);if(element.type==='checkbox'||element.type==='radio')element.checked=values.includes(element.value);else if(values.length)element.value=values[0];}}
    form.addEventListener('input',()=>{stash();updateCenterAction();});form.addEventListener('change',()=>{stash();updateCenterAction();});
    form.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
    form.addEventListener('submit',submit);
    $('review-skip').addEventListener('click',()=>{stash();const list=entries();if(list.length<2){$('review-feedback').textContent='This is the last trial in this queue. Your draft stays here.';return;}selected=list[(list.findIndex(x=>x.trial.nctId===selected)+1)%list.length].trial.nctId;render();});
    updateCenterAction();
  }
  function proposedFields(){
    const entry=current(),form=new FormData($('review-form')),base=entry.review?.registryVersion===entry.version?(entry.review?.proposed || entry.fields):entry.fields;
    const result={};for(const key of ['title','status','summary','eligibilityCriteria','startDate','primaryCompletionDate','completionDate'])result[key]=String(form.get(key)||'').trim();
    result.sites=base.sites.map((site,index)=>{const value={};for(const key of ['facility','city','state','country','status'])value[key]=String(form.get(`site.${index}.${key}`)||'').trim();value.contacts=(site.contacts.length?site.contacts:[{}]).map((_,j)=>Object.fromEntries(['name','email','phone'].map(key=>[key,String(form.get(`site.${index}.contact.${j}.${key}`)||'').trim()]))).filter(c=>c.name||c.email||c.phone);return value;});return result;
  }
  function updateCenterAction(){if(mode!=='center'||!$('review-form'))return;const changed=JSON.stringify(proposedFields())!==JSON.stringify(current().fields);$('review-confirm').hidden=changed;$('review-propose').hidden=!changed;}
  async function submit(event){
    event.preventDefault();if(saving)return;const entry=current(),form=new FormData(event.target),key=draftKey();
    const body={kind:mode,nctId:entry.trial.nctId,version:entry.version,note:String(form.get('note')||'')};
    if(mode==='flagged')body.assessment=form.get('assessment');else{body.fields=proposedFields();body.checks=form.getAll('checks');body.action=JSON.stringify(body.fields)===JSON.stringify(entry.fields)?'confirmed':'updates_pending';}
    saving=true;$('review-error').hidden=true;event.target.querySelectorAll('button').forEach(button=>button.disabled=true);$('review-feedback').textContent='Saving review…';
    const list=entries();const next=list[(list.findIndex(item=>item.trial.nctId===selected)+1)%list.length]?.trial.nctId;
    try{++loadSequence;payload=applyDemoQueue(await fetchJson('/api/review-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));drafts.delete(key);selected=next || '';updateOverview();render();$('review-feedback').textContent=body.kind==='flagged'?'Assessment saved.':body.action==='confirmed'?'Trial confirmed up to date.':'Proposed updates saved for review in this portal.';}catch(error){$('review-error').hidden=false;$('review-error').textContent=error.message;$('review-feedback').textContent='';event.target.querySelectorAll('button').forEach(button=>button.disabled=false);}finally{saving=false;}
  }
  function setMode(value){if(saving)return;stash();mode=value;selected='';$('review-show-history').checked=false;$('review-feedback').textContent='';$('review-error').hidden=true;for(const [id,active]of [['review-flagged-tab',value==='flagged'],['review-center-tab',value==='center'],['review-assistant-tab',value==='assistant']]){$(id).classList.toggle('is-active',active);$(id).setAttribute('aria-pressed',String(active));}render();}
  $('review-assistant-tab').addEventListener('click',()=>setMode('assistant'));
  $('review-flagged-tab').addEventListener('click',()=>setMode('flagged'));$('review-center-tab').addEventListener('click',()=>setMode('center'));
  $('review-show-history').addEventListener('change',()=>{if(saving)return;stash();selected='';render();});
  for(const id of ['profile-open-center'])$(id).addEventListener('click',()=>{portalNavigate('agent-panel');setMode('center');});
  window.addEventListener('portal-trial-updated',async event=>{
    const {nctId,changes}=event.detail;stash();
    const entry=payload?.centers.find(item=>item.trial.nctId===nctId);
    const key=`center:${nctId}`;
    const names=(changes||[]).map(change=>{
      const parts=change.path.split('.');if(parts[0]!=='locations')return change.path;
      const site=entry?.trial.locations[Number(parts[1])];const index=entry?.fields.sites.findIndex(s=>s.facility===site?.facility && s.city===site?.city);
      return parts[2]==='contacts'?`site.${index}.contact.${parts[3]}.${parts[4]}`:`site.${index}.${parts[2]}`;
    });
    if(drafts.has(key))drafts.set(key,drafts.get(key).filter(([name])=>!names.includes(name)&&name!=='checks'&&!((changes||[]).some(c=>c.field==='addSite')&&name.startsWith('site.'))));
    if(mode==='center'&&selected===nctId)$('review-show-history').checked=false;
    await load(false);
  });
  window.addEventListener('portal-reviews-refresh',()=>{if(!saving)load();});
  load();
})();
