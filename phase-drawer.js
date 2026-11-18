(() => {
 const drawer=document.getElementById('phase-drawer'),results=document.getElementById('phase-drawer-results'),search=document.getElementById('phase-drawer-search'),count=document.getElementById('phase-drawer-count'),filters=document.getElementById('phase-drawer-filters');
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=[],ongoing=true,sequence=0,selections=[];
 const names={placebo:'AI placebo', 'registry-placebo':'CT.gov placebo',phase:'Phase',status:'Status','study-type':'Study type',population:'Population',intervention:'Intervention'};
 function render(){const q=search.value.trim().toLowerCase();const matches=rows.filter(t=>[t.title,t.nctId,t.sponsor].join(' ').toLowerCase().includes(q));count.textContent=`${matches.length} ${matches.length===1?'trial':'trials'}${q?' of '+rows.length:''}`;results.innerHTML=matches.map(t=>`<button class="phase-result" data-id="${esc(t.nctId)}"><strong>${esc(t.title)}</strong><span>${esc(t.status)} · ${esc(t.phase==='Na'?'Not applicable':t.phase)}</span><small>${esc(t.sponsor)} · ${esc(t.nctId)}</small></button>`).join('')||'<p>No matching trials.</p>';results.querySelectorAll('button').forEach(b=>b.onclick=()=>{drawer.close();openTrialDetail(b.dataset.id);});}
 function endpoint(selection){
 const params=new URLSearchParams({ongoingOnly:String(ongoing)});
 const {type,label,values}=selection;
 if(type==='placebo'||type==='registry-placebo'){params.set('placebo',label);if(type==='registry-placebo')params.set('source','ctgov');}
 else if(type==='phase')params.set('phase',label);
 else if(type==='population')params.set('population',label);
 else if(type==='intervention')params.set('ids',values.join(','));
 else if(type==='study-type'){params.set('studyType',values[0]||'');params.set('purpose',values[1]||'');}
 else values.forEach(value=>params.append('status',value));
 return '/api/dashboard/'+(type==='registry-placebo'?'placebo':type)+'-trials?'+params;
 }
 async function load(){
 const seq=++sequence;
 document.getElementById('phase-drawer-title').textContent='Matching trials';
 filters.innerHTML=`<div class="dashboard-filter-chips">${selections.map(s=>`<button class="meta-pill" data-remove-filter="${s.type}" aria-label="Remove ${esc(names[s.type])}: ${esc(s.label)}">${esc(names[s.type])}: ${esc(s.label)} <span aria-hidden="true">×</span></button>`).join('')}</div><div class="dashboard-filter-actions"><button class="meta-pill" id="toggle-drawer-scope" aria-pressed="${ongoing}">${ongoing?'Ongoing only':'All statuses'}</button>${selections.length?'<button class="dashboard-clear-filters" id="clear-dashboard-filters">Clear all</button>':''}</div><p class="dashboard-filter-hint">Click another chart to add a filter. Choose another item in the same chart to switch it.</p>`;
 filters.querySelectorAll('[data-remove-filter]').forEach(button=>button.onclick=()=>{selections=selections.filter(s=>s.type!==button.dataset.removeFilter);load();});
 document.getElementById('clear-dashboard-filters')?.addEventListener('click',()=>{selections=[];search.value='';load();});
 document.getElementById('toggle-drawer-scope').onclick=()=>{ongoing=!ongoing;load();};
 rows=[];results.innerHTML='';count.textContent='Loading trials…';
 try{
 const active=selections.length?selections:[{type:'status',label:'',values:[]}];
 const datasets=await Promise.all(active.map(async selection=>{const response=await fetch(endpoint(selection));if(!response.ok)throw Error();return (await response.json()).trials;}));
 if(seq!==sequence)return;
 const memberships=datasets.slice(1).map(trials=>new Set(trials.map(t=>t.nctId)));
 rows=datasets[0].filter(trial=>memberships.every(ids=>ids.has(trial.nctId)));
 render();
 }catch{if(seq===sequence)count.textContent='Could not load trials. Please try selecting a filter again.';}
 }
 function open(label,scope,type='phase',values=[]){
 if(!drawer.open){selections=[];ongoing=scope;search.value='';drawer.show();}
 selections=selections.filter(selection=>selection.type!==type);
 selections.push({type,label,values});
 document.body.classList.add('phase-panel-open');load();
 }
 window.openInterventionDrawer=(label,ids,allIds,scope)=>open(label,scope,'intervention',ids);
 window.openGeneticPopulationDrawer=(gene,scope,relationship='include')=>open((relationship==='exclude'?'Gene excluded: ':'Gene: ')+gene,scope,'population');
 window.openPlaceboDrawer=(label,scope)=>open(label,scope,'placebo');
 window.openRegistryPlaceboDrawer=(label,scope)=>open(label,scope,'registry-placebo');
 window.setupPhaseDrawer=(container,items,scope)=>{container.querySelectorAll('.status-legend-row').forEach((row,i)=>{const label=items[i]?.label;if(!label)return;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View ${label} trials`);row.onclick=()=>open(label,scope);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(label,scope);}};});const slices=container.querySelectorAll('svg > path, svg > circle:first-child');slices.forEach((slice,i)=>{if(items[i]){slice.style.cursor='pointer';slice.onclick=()=>open(items[i].label,scope);}});};
 window.setupStatusDrawer=(container,items,scope)=>{
 items=items.map(item=>item.label==='Available'?{...item,label:'Available Expanded Access Programs',values:['Available']}:item);
 const display=items.length>6?[...items.slice(0,6),{label:'Other',values:items.slice(6).flatMap(i=>i.values||[i.label])}]:items;
 container.querySelectorAll('.status-legend-row').forEach((old,i)=>{const item=display[i];if(!item)return;const row=old.cloneNode(true);old.replaceWith(row);row.disabled=false;row.setAttribute('role','button');row.setAttribute('aria-label',`View ${item.label} trials`);row.onclick=()=>open(item.label,scope,'status',item.values||[item.label]);});
 container.querySelectorAll('svg > path').forEach((slice,i)=>{const item=display[i];if(item){slice.style.cursor='pointer';slice.onclick=()=>open(item.label,scope,'status',item.values||[item.label]);}});
 container.querySelector('[data-status-breakdown-panel]')?.remove();
 };
 window.setupPopulationDrawer=(container,items,scope)=>{
 container.querySelectorAll('.dashboard-breakdown-row').forEach((row,i)=>{
 const item=items[i];if(!item)return;
 row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View ${item.label} trials`);
 row.onclick=()=>open(item.label,scope,'population');
 row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(item.label,scope,'population');}};
 });
 };
 window.setupStudyTypeDrawer=(container,parents,parts,scope)=>{
 const bind=(el,label,values)=>{el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',`View ${label} studies`);el.onclick=()=>open(label,scope,'study-type',values);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(label,scope,'study-type',values);}};};
 container.querySelectorAll('.status-legend-row').forEach((el,i)=>{if(parents[i])bind(el,parents[i].label,[parents[i].label]);});
 container.querySelectorAll('svg > path, svg > circle:first-child').forEach((el,i)=>{if(parents[i])bind(el,parents[i].label,[parents[i].label]);});
 container.querySelectorAll('.study-purpose-inline-row').forEach((el,i)=>{const p=parts[i];if(p)bind(el,p.label,['Interventional',p.purpose]);});
 };
 search.oninput=render;document.getElementById('phase-drawer-close').onclick=()=>drawer.close();drawer.addEventListener('close',()=>{sequence++;document.body.classList.remove('phase-panel-open');});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawer.open)drawer.close();});drawer.addEventListener('click',e=>{if(e.target===drawer){const r=drawer.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)drawer.close();}});
})();
