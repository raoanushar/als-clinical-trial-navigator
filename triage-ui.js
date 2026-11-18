(() => {
 const $=id=>document.getElementById(id),esc=escapeHtml;
 let payload=null,selected='',busy=false;const notes=new Map();
 const pending=new Map(),timers=new Map(),states=new Map();let saves=Promise.resolve();
 const storagePrefix='sava-curation-draft:';
 const draftKey=b=>storagePrefix+b.nctId+':'+b.version;
 function readLocal(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
 function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
 function removeLocal(key){try{localStorage.removeItem(key);}catch{}}
 function savePosition(){writeLocal('sava-curation-position',{selected,filter:$('triage-filter').value});}
 function status(nctId,message){states.set(nctId,message);if(selected===nctId&&$('triage-save-state'))$('triage-save-state').textContent=message;}
 function flush(nctId){
  clearTimeout(timers.get(nctId));const body=pending.get(nctId);if(!body)return saves;
  saves=saves.then(async()=>{
   try{const result=await fetchJson('/api/review-triage/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(pending.get(nctId)?.editedAt===body.editedAt){pending.delete(nctId);removeLocal(draftKey(body));const entry=payload?.entries.find(e=>e.trial.nctId===nctId);if(entry&&entry.version===body.version)entry.draft=result.superseded?null:result;status(nctId,result.superseded?'A newer decision was saved. Reload to continue.':'Draft saved');}
   }catch{status(nctId,body.localBackup?'Saved on this device. Server save will retry when you reconnect.':'Not saved yet. Keep this page open and reconnect.');}
  });return saves;
 }
 function stage(entry,note,editedAt=Date.now()){
  const body={nctId:entry.trial.nctId,version:entry.version,note,editedAt,baseDecisionId:entry.decision?.id||null};
  body.localBackup=writeLocal(draftKey(body),body);pending.set(body.nctId,body);notes.set(body.nctId,note);status(body.nctId,'Saving draft…');
  clearTimeout(timers.get(body.nctId));timers.set(body.nctId,setTimeout(()=>flush(body.nctId),500));
 }
 function restoreDrafts(){for(const entry of payload.entries){
  const id=entry.trial.nctId,key=draftKey({nctId:id,version:entry.version}),local=readLocal(key);
  if(local&&(local.baseDecisionId||null)!==(entry.decision?.id||null))removeLocal(key);
  const valid=local&&(local.baseDecisionId||null)===(entry.decision?.id||null);
  if(valid&&(!entry.draft||local.editedAt>entry.draft.editedAt))stage(entry,local.note,local.editedAt);
  else if(!pending.has(id)){notes.delete(id);if(entry.draft){notes.set(id,entry.draft.note);states.set(id,'Draft saved');}}
 }}
 const position=readLocal('sava-curation-position');if(position){selected=position.selected||'';if(['pending','keep','exclude','all'].includes(position.filter))$('triage-filter').value=position.filter;}
 window.addEventListener('online',()=>{for(const id of pending.keys())flush(id);});
 function flushLeaving(){for(const body of pending.values())fetch('/api/review-triage/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});}
 window.addEventListener('pagehide',flushLeaving);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushLeaving();});
 const entries=()=> (payload?.entries||[]).filter(e=>$('triage-filter').value==='all'||($('triage-filter').value==='pending'?!e.decision:e.decision?.decision===$('triage-filter').value));
 async function load(){try{payload=await fetchJson('/api/review-triage');restoreDrafts();render();}catch(e){showError(e);}}
 function showError(e){$('triage-error').hidden=false;$('triage-error').textContent=e.message;}
 function render(){
  if(!payload)return;const c=payload.counts,list=entries();if(!list.some(e=>e.trial.nctId===selected))selected=list[0]?.trial.nctId||'';savePosition();
  $('triage-summary').innerHTML=`<div><strong>${c.keep} kept · ${c.exclude} not needed · ${c.pending} undecided</strong><p>${payload.publishedCount} trial${payload.publishedCount===1?'':'s'} in the published expert queue. Draft decisions take effect when you publish.</p></div>`;
  $('triage-publish').textContent=`Publish ${c.keep} trial${c.keep===1?'':'s'} to experts`;
  $('triage-publish').disabled=busy;$('triage-filter').disabled=busy;
  $('triage-list').innerHTML=list.length?list.map(e=>`<button class="review-queue-item ${e.trial.nctId===selected?'is-selected':''}" data-triage-select="${esc(e.trial.nctId)}" ${busy?'disabled':''}><span class="review-queue-meta"><span class="risk-badge ${e.analysis.risk}">${esc(e.analysis.risk)} risk</span><small>${e.decision?.decision==='keep'?'Keep':e.decision?'Not needed':'Undecided'}</small></span><strong>${esc(e.trial.title)}</strong><small>${esc(e.trial.nctId)}</small></button>`).join(''):'<p class="review-empty subtle">No trials in this view.</p>';
  $('triage-list').querySelectorAll('[data-triage-select]').forEach(b=>b.onclick=()=>{flush(selected);selected=b.dataset.triageSelect;render();});
  const entry=list.find(e=>e.trial.nctId===selected);if(!entry){$('triage-detail').innerHTML='<div class="review-empty"><h3>Nothing left in this view</h3><p>Switch the filter to revisit decisions, or publish your kept trials.</p></div>';return;}
  const t=entry.trial,decision=entry.decision;const note=notes.get(selected)??entry.draft?.note??decision?.note??'';
  $('triage-detail').innerHTML=`<div class="review-detail-header"><p class="eyebrow">${esc(t.nctId)}</p><h3>${esc(t.title)}</h3><p class="subtle">${esc(t.sponsor)} · ${esc(t.status)}</p><button class="secondary-button" id="triage-open">Open trial details ↗</button></div><section class="review-ai"><h4>Why the agent flagged it</h4><p>${esc(entry.analysis.report||'No report provided.')}</p><ul>${(entry.analysis.reasons||[]).map(r=>`<li>${esc(typeof r==='string'?r:r.reason||r.text||JSON.stringify(r))}</li>`).join('')}</ul></section><details class="review-registry"><summary>Trial summary &amp; eligibility</summary><p>${esc(t.summary||'Not listed')}</p><p>${esc(t.eligibilityCriteria||'Not listed')}</p></details>${entry.previous&&!decision?'<p class="subtle">The AI assessment changed since your last decision. Review it again; the earlier decision remains in the training log.</p>':''}<form id="triage-form"><label class="review-field">Comment (optional)<textarea name="note" rows="4" maxlength="5000" ${busy?'disabled':''} placeholder="What makes this flag useful, unnecessary, or misleading?">${esc(note)}</textarea></label><p id="triage-save-state" class="subtle" role="status">${esc(states.get(selected)||(entry.draft?'Draft saved':decision?'Decision saved':'Notes save automatically. You can finish later.'))}</p><div class="triage-actions"><button class="secondary-button" type="submit" value="exclude" ${busy?'disabled':''}>Not needed for review</button><button class="primary-button" type="submit" value="keep" ${busy?'disabled':''}>Keep for experts</button></div></form><details class="triage-history"><summary>Decision history (${entry.history.length})</summary>${entry.history.map(item=>`<article><strong>${item.decision==='keep'?'Keep for experts':'Not needed for review'}</strong><p>${esc(item.note)}</p><small>${esc(formatDate(item.reviewedAt))} · ${esc(item.reviewer)}</small></article>`).join('')||'<p>No decisions yet.</p>'}</details>`;
  $('triage-open').onclick=()=>openTrialDetail(t.nctId);
  $('triage-form').elements.note.oninput=e=>stage(entry,e.target.value);
  $('triage-form').elements.note.onblur=()=>flush(entry.trial.nctId);
  $('triage-form').onsubmit=async event=>{event.preventDefault();if(busy)return;const note=event.target.elements.note.value,decision=event.submitter.value,nctId=selected;busy=true;$('triage-error').hidden=true;render();try{await flush(nctId);payload=await fetchJson('/api/review-triage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nctId,version:entry.version,note,decision})});notes.delete(nctId);pending.delete(nctId);states.delete(nctId);clearTimeout(timers.get(nctId));removeLocal(draftKey({nctId,version:entry.version}));const index=list.findIndex(e=>e.trial.nctId===nctId);selected=list[index+1]?.trial.nctId||list[0]?.trial.nctId||'';$('triage-feedback').textContent='Decision and training example saved.';}catch(e){showError(e);}finally{busy=false;render();}};
 }
 $('triage-filter').onchange=()=>{flush(selected);selected='';render();};
 $('triage-publish').onclick=async()=>{if(busy)return;busy=true;$('triage-error').hidden=true;render();try{payload=await fetchJson('/api/review-triage/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});$('triage-feedback').textContent=`Published ${payload.publishedCount} trial${payload.publishedCount===1?'':'s'}. Undecided and excluded trials are hidden from experts.`;window.dispatchEvent(new Event('portal-reviews-refresh'));}catch(e){showError(e);}finally{busy=false;render();}};
 document.querySelector('[data-panel-target="triage-panel"]').addEventListener('click',load);
 window.addEventListener('open-triage',()=>{document.querySelector('.sidebar-tools').open=true;portalNavigate('triage-panel');});
})();
