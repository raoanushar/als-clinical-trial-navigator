window.UpdateChat = (() => {
 function mount(root,{trial=null,general=false}={}){
  const legacyKey='sava-update-chat:'+root.id;
  try{sessionStorage.removeItem(legacyKey);}catch{}
  const storageKey='sava-update-chat:v2:'+root.id;
  let restored=[];try{restored=JSON.parse(sessionStorage.getItem(storageKey)||'[]');}catch{}
  const threads=new Map(Array.isArray(restored)?restored:[]);for(const state of threads.values()){state.pending=false;state.confirming=false;state.controller=null;}
  let currentTrial=trial,key=trial?.nctId||'general';
  function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify([...threads].map(([id,state])=>[id,{...state,controller:null,pending:false,confirming:false}])));}catch{}}
  const esc=escapeHtml;
  function thread(){if(!threads.has(key))threads.set(key,{turns:[],pending:false,controller:null,proposal:null,error:'',draft:'',activeNctId:'',conversationId:''});return threads.get(key);}
  root.innerHTML=`<header class="update-chat-header"><div><p class="eyebrow">SAVA</p><h3>${general?'Ask for an update':'Update this trial'}</h3></div><button type="button" class="chat-reset" title="New conversation" aria-label="New update conversation">↺</button></header><p class="update-chat-context"></p><div class="update-chat-log" role="log" aria-label="Update assistant conversation" aria-live="polite"></div><div class="update-chat-proposal"></div><p class="update-chat-error error-text" role="alert" hidden></p><form class="chat-composer"><textarea rows="1" maxlength="3000" aria-label="Ask SAVA for a trial update" placeholder="Ask about a trial or request a change…"></textarea><button class="primary-button chat-send" type="submit" aria-label="Send message"></button></form><p class="chat-footnote">Confirmed changes update this portal, not ClinicalTrials.gov.</p>${general?'<details class="chat-saved-updates"><summary>Update history</summary><div></div></details>':''}`;
  const log=root.querySelector('.update-chat-log'),input=root.querySelector('textarea'),send=root.querySelector('.chat-send'),error=root.querySelector('.update-chat-error'),proposalBox=root.querySelector('.update-chat-proposal');
  function changesHtml(proposal){return proposal.changes.map(change=>`<div class="proposal-change"><strong>${esc(change.label)}</strong><small>${esc(change.scope)}</small><div><span>${proposal.saved||proposal.status==='applied'?'Previous':'Current'}</span><p>${esc(change.before || 'Not listed')}</p></div><div class="proposal-after"><span>${proposal.saved||proposal.status==='applied'?'Updated':'Proposed'}</span><p>${esc(change.after || '(Remove value)')}</p></div></div>`).join('');}
  function render(){
   const state=thread();root.querySelector('.update-chat-context').textContent=currentTrial?`${currentTrial.nctId} · ${currentTrial.title}`:'';
   log.innerHTML=state.turns.length?state.turns.filter(turn=>!turn.confirmation).map(turn=>`<div class="update-chat-turn">${turn.question?`<p class="chat-user-bubble">${esc(turn.question)}</p>`:''}<div class="chat-assistant-bubble">${general&&turn.trial&&state.turns.slice(0,state.turns.indexOf(turn)).filter(t=>t.trial).at(-1)?.trial.nctId!==turn.trial.nctId?`<button type="button" class="chat-trial-context" data-chat-trial="${esc(turn.trial.nctId)}">${esc(turn.trial.title)}<small>${esc(turn.trial.nctId)} ↗</small></button>`:''}<p>${esc(turn.answer || 'Finding the trial and checking the request…')}</p>${turn.choices?.length?`<div class="update-trial-choices">${turn.choices.map((choice,index)=>`<button type="button" data-choice="${index}" data-turn="${state.turns.indexOf(turn)}"><strong>${esc(choice.title)}</strong>${choice.nctId?`<small>${esc(choice.nctId)} · ${esc(choice.sponsor || '')}</small>`:''}</button>`).join('')}</div>`:''}</div></div>`).join(''):`<div class="update-chat-welcome"><span aria-hidden="true">✦</span><h4>${general?'Find a trial. Ask a question. Make an update.':'What needs changing?'}</h4><p>${general?'Try “Does the Spinogenix trial have an NYU site?”':'Tell me the new information. I’ll prepare a change for you to review.'}</p></div>`;
   log.querySelectorAll('[data-choice]').forEach(button=>{button.disabled=state.pending||Boolean(state.confirming);button.addEventListener('click',()=>{const choice=state.turns[Number(button.dataset.turn)].choices[Number(button.dataset.choice)];ask(choice.question);});});
   log.querySelectorAll('[data-chat-trial]').forEach(button=>button.addEventListener('click',()=>openTrialDetail(button.dataset.chatTrial)));
   const proposal=state.proposal;
   proposalBox.innerHTML=proposal?(proposal.saved?`<section class="update-success" role="status"><span class="update-success-icon" aria-hidden="true">✓</span><div><h4>Trial updated</h4><p>Your changes are now visible in this portal.</p><details><summary>View saved changes</summary>${changesHtml(proposal)}</details></div></section>`:`<section class="proposal-card"><p class="eyebrow">Review your changes</p>${general?`<h4>${esc(proposal.trial.title)}</h4>`:''}<button type="button" class="proposal-trial-link">${esc(proposal.trial.nctId)} ↗</button>${changesHtml(proposal)}<div class="proposal-actions"><button type="button" class="secondary-button proposal-revise">Revise</button><button type="button" class="primary-button proposal-confirm">${state.confirming?'Saving…':'Confirm update'}</button></div></section>`):'';
   proposalBox.querySelector('.proposal-trial-link')?.addEventListener('click',()=>openTrialDetail(proposal.trial.nctId));
   proposalBox.querySelector('.proposal-revise')?.addEventListener('click',()=>{input.placeholder='Tell me what to revise…';input.focus();});
   proposalBox.querySelector('.proposal-confirm')?.addEventListener('click',confirm);
   error.hidden=!state.error;error.textContent=state.error;input.value=state.draft;ChatUI.autosize(input);ChatUI.button(send,state.pending);send.disabled=Boolean(state.confirming);
   root.querySelector('.chat-reset').disabled=Boolean(state.confirming);
   proposalBox.querySelectorAll('button').forEach(button=>button.disabled=state.pending||Boolean(state.confirming));
   log.scrollTop=log.scrollHeight;persist();
  }
  async function ask(question){
   const state=thread();if(state.pending||state.confirming||!question.trim())return;
   state.controller=new AbortController();state.pending=true;state.error='';state.draft='';
   const history=state.turns.filter(t=>t.answer&&!t.failed).slice(-8).map(t=>({question:t.question,answer:t.answer}));
   const turn={question:question.trim(),answer:'',choices:[]};state.turns.push(turn);state.turns=state.turns.slice(-10);const requestKey=key;render();
   try{const result=await fetchJson('/api/update-assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:turn.question,history,contextNctId:currentTrial?.nctId||'',activeNctId:state.activeNctId,conversationId:state.conversationId}),signal:state.controller.signal});state.conversationId=result.conversationId||state.conversationId;turn.answer=result.message;turn.trial=result.trial;turn.choices=result.choices || [];if(result.trial)state.activeNctId=result.trial.nctId;state.proposal=result.proposal || (result.kind==='answer'&&state.proposal?.trial.nctId===result.trial?.nctId?state.proposal:null);}
   catch(e){turn.failed=true;turn.answer=e.name==='AbortError'?'Request stopped.':'I couldn’t prepare that update.';state.error=e.name==='AbortError'?'':e.message;if(!state.draft)state.draft=turn.question;}
   finally{state.pending=false;if(requestKey===key)render();}
  }
  async function confirm(){
   const state=thread(),proposal=state.proposal,requestKey=key;if(!proposal||state.pending||state.confirming)return;
   state.confirming=true;state.error='';render();
   try{const saved=await fetchJson('/api/update-assistant/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:proposal.id,confirmed:true})});proposal.saved=true;const last=state.turns.at(-1);if(last)last.answer='The requested changes have been saved.';state.turns.push({question:'',answer:'Saved changes: '+saved.changes.map(c=>`${c.label}: ${c.after}`).join('; '),confirmation:true});window.dispatchEvent(new CustomEvent('portal-trial-updated',{detail:{nctId:proposal.trial.nctId,changes:saved.changes}}));}
   catch(e){state.error=e.message;}finally{state.confirming=false;if(requestKey===key)render();}
  }
  input.addEventListener('input',()=>{thread().draft=input.value;ChatUI.autosize(input);persist();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!thread().pending)ask(input.value);}});
  root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();if(thread().pending)thread().controller?.abort();else ask(input.value);});
  root.querySelector('.chat-reset').addEventListener('click',()=>{thread().controller?.abort();threads.delete(key);render();});
  const saved=root.querySelector('.chat-saved-updates');saved?.addEventListener('toggle',async()=>{if(!saved.open)return;const list=saved.querySelector('div');list.textContent='Loading update history…';try{const payload=await fetchJson('/api/update-assistant/saved');list.innerHTML=payload.updates.length?payload.updates.map(item=>`<article class="saved-proposal"><strong>${esc(item.trial.nctId)} · ${esc(item.trial.title)}</strong><small>${esc(formatDate(item.confirmedAt))} · ${esc(item.reviewer)}</small>${changesHtml(item)}</article>`).join(''):'<p>No updates saved yet.</p>';}catch(e){list.textContent=e.message;}});
  render();
  return {setContext(trial){const next=trial?.nctId||'general';if(next===key){currentTrial=trial;root.querySelector('.update-chat-context').textContent=trial?`${trial.nctId} · ${trial.title}`:'';return;}thread().controller?.abort();currentTrial=trial;key=next;render();}};
 }
 return {mount};
})();
