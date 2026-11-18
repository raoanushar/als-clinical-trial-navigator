(() => {
 const $=id=>document.getElementById(id), esc=escapeHtml;
 let state={collections:[],trials:{},details:[]},ready=false,busy=false;
 const drafts=new Map();
 function bookmark(id){const b=document.createElement('button');b.type='button';b.className='trial-bookmark';b.dataset.bookmark=id;paint(b);b.onclick=async e=>{e.preventDefault();e.stopPropagation();if(!ready||busy)return;await change({action:state.trials[id]?'remove':'save',nctId:id});};return b;}
 function paint(b){const saved=Boolean(state.trials[b.dataset.bookmark]);b.textContent=saved?'★ Saved':'☆ Save';b.setAttribute('aria-pressed',String(saved));b.setAttribute('aria-label',`${saved?'Unsave':'Save'} trial ${b.dataset.bookmark}`);b.disabled=!ready||busy;}
 async function change(body){busy=true;document.querySelectorAll('[data-bookmark]').forEach(paint);try{state=await fetchJson('/api/saved-trials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(body.action==='edit'||body.action==='remove')drafts.delete(body.nctId);render();$('saved-message').textContent=body.action==='remove'?'Trial removed from saved trials.':body.action==='edit'?'Notes and collections saved.':body.action==='collection'?'Collection created.':'Trial saved. Open Saved trials to add a collection or note.';return true;}catch(e){$('saved-message').textContent=e.message;alert('Could not save: '+e.message);return false;}finally{busy=false;document.querySelectorAll('[data-bookmark]').forEach(paint);}}
 function render(){
  const selected=$('saved-collection-filter').value;
  $('saved-collection-filter').innerHTML='<option value="">All collections</option><option value="unfiled">Unfiled</option>'+state.collections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('saved-collection-filter').value=selected;
  const q=$('saved-search').value.toLowerCase(),collection=$('saved-collection-filter').value;
  const details=new Map(state.details.map(t=>[t.nctId,t]));
  const rows=Object.entries(state.trials).sort((a,b)=>b[1].savedAt.localeCompare(a[1].savedAt)).filter(([id,s])=>(!collection||(collection==='unfiled'?!s.collections.length:s.collections.includes(collection)))&&[id,details.get(id)?.title,s.note].join(' ').toLowerCase().includes(q));
  $('saved-trial-list').innerHTML=rows.map(([id,s])=>{const t=details.get(id),draft=drafts.get(id)||s;return `<article class="saved-trial-card"><div class="saved-trial-heading"><div><button type="button" class="saved-trial-title" data-saved-open="${id}">${esc(t?.title||id)}</button><p class="subtle">${esc(id)} · ${esc(t?.status||'Not in current dataset')} ${t?.phase?'· '+esc(t.phase):''}</p></div><span data-saved-bookmark="${id}"></span></div><form data-saved-edit="${id}"><fieldset><legend>Collections</legend>${state.collections.map(c=>`<label><input type="checkbox" name="collections" value="${esc(c.id)}" ${draft.collections.includes(c.id)?'checked':''}> ${esc(c.name)}</label>`).join('')||'<span class="subtle">Create a collection above to organize this trial.</span>'}</fieldset><label>Note (optional)<textarea name="note" rows="2" maxlength="5000" placeholder="Why you saved this trial, questions, or follow-up…">${esc(draft.note)}</textarea></label><button class="secondary-button" type="submit">Save note &amp; collections</button></form></article>`;}).join('')||'<p class="subtle">No saved trials here yet. Use ☆ Save on a trial to add it.</p>';
  $('saved-trial-list').querySelectorAll('[data-saved-open]').forEach(b=>b.onclick=()=>openTrialDetail(b.dataset.savedOpen));
  $('saved-trial-list').querySelectorAll('[data-saved-bookmark]').forEach(el=>el.append(bookmark(el.dataset.savedBookmark)));
  $('saved-trial-list').querySelectorAll('form').forEach(form=>{const read=()=>({note:form.elements.note.value,collections:[...new FormData(form).getAll('collections')]});form.oninput=()=>drafts.set(form.dataset.savedEdit,read());form.onsubmit=async e=>{e.preventDefault();if(busy)return;await change({action:'edit',nctId:form.dataset.savedEdit,...read()});};});
 }
 window.renderTrialBookmark=id=>{let holder=$('detail-bookmark');if(!holder){holder=document.createElement('div');holder.id='detail-bookmark';$('trial-detail-title').after(holder);}holder.replaceChildren(bookmark(id));};
 function addBookmarks(){
  document.querySelectorAll('.compact-result,.opportunity-card,.phase-result,.trial-data-title,article[data-open-trial]').forEach(el=>{
   if(el.dataset.bookmarkAttached)return;
   const id=el.dataset.openTrial||el.dataset.id||el.dataset.trialId;if(!id)return;
   el.dataset.bookmarkAttached='true';
   if(el.tagName==='ARTICLE')el.append(bookmark(id));
   else if(el.closest('td,th'))el.after(bookmark(id));
   else {const wrapper=document.createElement('div');wrapper.className='bookmark-result-wrap';el.before(wrapper);wrapper.append(el,bookmark(id));}
  });
 }
 new MutationObserver(addBookmarks).observe(document.body,{childList:true,subtree:true});
 $('saved-search').oninput=render;$('saved-collection-filter').onchange=render;
 $('saved-new-collection').onsubmit=async e=>{e.preventDefault();if(busy)return;if(await change({action:'collection',name:e.target.elements.name.value}))e.target.reset();};
 async function load(){try{state=await fetchJson('/api/saved-trials');ready=true;render();document.querySelectorAll('[data-bookmark]').forEach(paint);}catch(e){$('saved-message').textContent='Restart the app to load Saved trials, then reopen this tab.';}}
 document.querySelector('[data-panel-target="saved-trials-panel"]').addEventListener('click',load);
 addBookmarks();load();
})();
