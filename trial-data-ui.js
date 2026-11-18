(() => {
  const $ = id => document.getElementById(id), esc = escapeHtml;
  let rows = [], loaded = false, loading = false, page = 0, view = 'all';
  const size = 25;
  const lines = value => Array.isArray(value) ? value.filter(Boolean).join('\n') : value == null ? '' : String(value);
  const ct = (key, label, transform = lines) => ({label, source:'registry', get:r => transform(r.registry[key])});
  const tags = (r, dimension) => r.targeting.findings.filter(f=>f.dimension===dimension).map(f=>`${f.value} (${String(f.relationship).replaceAll('_',' ')})`).join('\n');
  const rationale = (r, dimension) => r.targeting.findings.filter(f=>f.dimension===dimension).map(f=>`${f.value} (${f.relationship}): ${f.detail || 'No rationale saved'}${f.cohort ? '\nCohort: '+f.cohort : ''}`).join('\n\n');
  const interventionTags = (r, dimension) => r.intervention?.findings.filter(f=>f.dimension===dimension).map(f=>`${f.label} (${f.relationship}; ${f.confidence} confidence)`).join('\n') || '';
  const columns = [
    ct('status','Recruitment status'),ct('studyType','Study type'),ct('phase','Phase'),ct('primaryPurpose','Purpose'),ct('sponsor','Sponsor'),
    ct('interventionTypes','Intervention types'),ct('interventions','Interventions'),ct('allocation','Allocation'),ct('interventionModel','Intervention model'),
    ct('armGroups','Study arms',v=>(v||[]).map(a=>[a.label,a.type,a.description].filter(Boolean).join(' — ')).join('\n\n')),
    ct('conditions','Conditions'),ct('studyPopulation','Study population'),ct('summary','Summary'),ct('eligibilityCriteria','Eligibility'),
    ct('locations','Sites',v=>(v||[]).map(a=>[a.facility,a.city,a.state,a.country].filter(Boolean).join(', ')).join('\n')),
    ct('centralContacts','Contacts',v=>(v||[]).map(a=>[a.name,a.email,a.phone].filter(Boolean).join(' · ')).join('\n')),
    ct('firstPostedAt','First posted'),ct('updatedAt','Last updated'),ct('startDate','Start date'),ct('primaryCompletionDate','Primary completion'),ct('completionDate','Completion'),
    {label:'Targeting analysis status',source:'ai',get:r=>r.targeting.status.replaceAll('_',' ')},
    ...['gene','phenotype','onset','progression'].flatMap(d=>[
      {label:`${d==='gene'?'Genetic populations':d[0].toUpperCase()+d.slice(1)} tags`,source:'ai',get:r=>tags(r,d)},
      {label:`${d[0].toUpperCase()+d.slice(1)} rationale`,source:'ai',get:r=>rationale(r,d)},
    ]),
    {label:'Targeting evidence',source:'ai',get:r=>r.targeting.findings.map(f=>`${f.value}: ${(f.evidence||[]).map(e=>[e.sourceField||e.path,e.quote].filter(Boolean).join(': ')).join('\n')}`).join('\n\n')},
    ...[['modality','Treatment modality'],['nonTreatment','Other intervention'],['population','Intervention population'],['mechanism','Biological mechanism']].map(([d,label])=>({label,source:'ai',get:r=>interventionTags(r,d)})),
    {label:'Intervention evidence',source:'ai',get:r=>r.intervention?.findings.map(f=>`${f.label}: ${(f.evidence||[]).map(e=>`${e.path}: ${e.quote}`).join('\n')}`).join('\n\n') || ''},
    {label:'Intervention analysis status',source:'ai',get:r=>r.intervention?`${r.intervention.screenedAt || 'Saved analysis'}${r.intervention.needsReview?' · Needs review':''}`:'Not screened'},
    {label:'Review notes',source:'ai',get:r=>[r.targeting.reviewReason,r.intervention?.reviewReason].filter(Boolean).join('\n\n')},
    {label:'Curated intervention categories',source:'ai',badge:'Curated',get:r=>lines(r.curated)},
    {label:'Portal field edits',source:'ai',badge:'Portal edits',get:r=>Object.entries(r.portalFields).map(([key,value])=>`${key}: ${typeof value==='object'?JSON.stringify(value):value}`).join('\n')},
  ];
  function placeboExplainer(r) {
    const label=r.placebo?.label;
    if(label==='Placebo')return 'CT.gov lists a placebo or sham comparison arm.';
    if(label==='No placebo')return 'The recorded arms do not identify a placebo. The summary has not been checked by this rule.';
    const arms=r.placeboInputs?.armGroups || [];
    if(!arms.length)return 'No study arms were saved, so we cannot tell.';
    if(/placebo/i.test(JSON.stringify([arms,r.placeboInputs?.interventions || []])))return 'The arm or treatment text mentions placebo, but no arm is labeled as a placebo comparator.';
    return 'The arm types are missing or unclear, so we cannot tell.';
  }
  const armTypeLabels={PLACEBO_COMPARATOR:'Placebo comparison',ACTIVE_COMPARATOR:'Active treatment comparison',EXPERIMENTAL:'Experimental treatment',NO_INTERVENTION:'No intervention',SHAM_COMPARATOR:'Sham comparison',OTHER:'Other / unclear'};
  const placeboColumns = [
    {label:'Dashboard label',badge:'',plain:true,get:r=>r.placebo?.label || 'Unavailable'},
    {label:'AI label',badge:'',plain:true,get:r=>r.placeboAI ? r.placeboAI.label : 'Not screened'},
    {label:'AI rationale',badge:'',get:r=>r.placeboAI ? [r.placeboAI.rationale,r.placeboAI.reviewReason].filter(Boolean).join('\n\n') : ''},
    {label:'AI supporting evidence',badge:'',get:r=>r.placeboAI?.evidence.map(e=>`“${e.quote}” — ${e.path.replaceAll('.', ' › ')}`).join('\n\n') || ''},
    {label:'Why this label?',badge:'',plain:true,get:placeboExplainer},
    {label:'Study arms from CT.gov',badge:'',get:r=>(r.placeboInputs?.armGroups || []).map(a=>`${a.label || 'Unnamed arm'} — ${armTypeLabels[a.type] || 'Type not listed'}${a.description?'\n'+a.description:''}`).join('\n\n') || 'No arms recorded.'},
    {label:'Trial summary',badge:'',get:r=>r.registry.summary || 'No summary recorded.'},
    {label:'More detail for review',badge:'',get:r=>[
      r.registry.detailedDescription ? 'STUDY DESCRIPTION\n'+r.registry.detailedDescription : '',
      'TREATMENTS\n'+(r.registry.targetingInterventions || r.registry.interventionDetails || []).map(i=>[i.name,i.description].filter(Boolean).join(': ')).join('\n'),
      r.registry.eligibilityCriteria ? 'ELIGIBILITY\n'+r.registry.eligibilityCriteria : ''
    ].filter(Boolean).join('\n\n')},
  ];
  function cell(value) {
    const text = lines(value);
    if (!text) return '<span class="subtle">—</span>';
    return text.length > 180 ? `<div class="trial-data-text-block"><div class="trial-data-long is-collapsed">${esc(text)}</div><button type="button" class="trial-data-expand" aria-expanded="false">Show more</button></div>` : `<div class="trial-data-long">${esc(text)}</div>`;
  }
  function render() {
    if (!loaded) return;
    const source=document.querySelector('input[name="data-source"]:checked').value;
    const visible=view==='placebo'?placeboColumns:columns.filter(c=>source==='both'||c.source===source);
    const q=$('trial-data-search').value.trim().toLowerCase();
    const matches=rows.filter(r=>(view!=='placebo'||$('placebo-direct-conflicts').getAttribute('aria-pressed')!=='true'||(r.placeboAI&&!r.placeboAI.stale&&['Placebo','No placebo'].includes(r.placeboAI.label)&&['Placebo','No placebo'].includes(r.placebo?.label)&&r.placeboAI.label!==r.placebo.label))&&(view!=='placebo'||$('placebo-differences').getAttribute('aria-pressed')!=='true'||(r.placeboAI&&!r.placeboAI.stale&&r.placeboAI.label!==r.placebo?.label))&&(view!=='placebo'||!$('placebo-ai-only').checked||r.placeboAI)&&(view!=='placebo'||r.placeboInputs?.studyType==='Interventional')&&(view!=='placebo'||!$('placebo-label-filter').value||r.placebo?.label===$('placebo-label-filter').value)&&(!$('trial-data-ongoing').checked||['Recruiting','Active Not Recruiting','Not Yet Recruiting','Available'].includes(r.registry.status))&&(!q||r.searchText.includes(q)));
    const pages=Math.max(1,Math.ceil(matches.length/size));page=Math.min(page,pages-1);
    $('trial-data-state').textContent=`${matches.length} trials · ${visible.length} data columns${view==='placebo'&&$('placebo-differences').getAttribute('aria-pressed')==='true'?' · Different AI and dashboard labels (current analyses only)':''}`;
    $('trial-data-table').innerHTML=`<thead><tr><th scope="col">Trial</th>${visible.map(c=>`<th scope="col">${view==='placebo'?'':`<small>${c.badge||(c.source==='registry'?'CT.gov':'AI extracted')}</small>`}${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${matches.slice(page*size,(page+1)*size).map(r=>`<tr><th scope="row"><button class="trial-data-title" data-trial-id="${esc(r.nctId)}">${esc(r.title)}</button><small>${esc(r.nctId)}</small></th>${visible.map(c=>`<td>${c.plain?`<div class="trial-data-long">${esc(c.get(r))}</div>`:cell(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('trial-data-table').querySelectorAll('.trial-data-expand').forEach(button=>button.onclick=()=>{
      const expanded=button.getAttribute('aria-expanded')==='true';
      button.setAttribute('aria-expanded',String(!expanded));
      button.textContent=expanded?'Show more':'Show less';
      button.previousElementSibling.classList.toggle('is-collapsed',expanded);
    });
    $('trial-data-table').querySelectorAll('[data-trial-id]').forEach(b=>b.onclick=()=>openTrialDetail(b.dataset.trialId));
    $('trial-data-page').textContent=`Page ${page+1} of ${pages}`;
    $('trial-data-prev').disabled=page===0;$('trial-data-next').disabled=page>=pages-1;
  }
  async function load() {
    if(loaded||loading)return;loading=true;$('trial-data-state').textContent='Loading trial data…';
    try {const result=await fetchJson('/api/trial-data-table');rows=result.trials.map(r=>({...r,searchText:[r.nctId,r.title,...columns.map(c=>c.get(r)),...placeboColumns.map(c=>c.get(r))].join(' ').toLowerCase()}));loaded=true;render();}
    catch(error){$('trial-data-state').textContent='Could not load trial data. Restart the app and reopen this tab.';}
    finally{loading=false;}
  }
  document.querySelector('[data-panel-target="trial-data-panel"]').addEventListener('click',load);
  document.querySelectorAll('[data-data-view]').forEach(button=>button.onclick=()=>{
    view=button.dataset.dataView;page=0;
    document.querySelectorAll('[data-data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    $('trial-data-source').hidden=view==='placebo';
    $('trial-data-general-note').hidden=view==='placebo';
    $('placebo-review-note').hidden=view!=='placebo';
    $('placebo-label-filter-wrap').hidden=view!=='placebo';
    $('placebo-ai-only-wrap').hidden=view!=='placebo';
    $('placebo-differences').hidden=view!=='placebo';
    $('placebo-direct-conflicts').hidden=view!=='placebo';
    $('trial-data-table').parentElement.scrollLeft=0;render();
  });
  $('placebo-direct-conflicts').onclick=()=>{
    const b=$('placebo-direct-conflicts');b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));page=0;render();
  };
  $('placebo-differences').onclick=()=>{
    const button=$('placebo-differences');
    button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));
    page=0;render();
  };
  $('placebo-ai-only').onchange=()=>{page=0;render();};
  $('placebo-label-filter').onchange=()=>{page=0;render();};
  $('trial-data-source').onchange=()=>{page=0;$('trial-data-table').parentElement.scrollLeft=0;render();};
  $('trial-data-search').oninput=()=>{page=0;render();};$('trial-data-ongoing').onchange=()=>{page=0;render();};
  $('trial-data-prev').onclick=()=>{page--;render();$('trial-data-table').parentElement.scrollTop=0;};
  $('trial-data-next').onclick=()=>{page++;render();$('trial-data-table').parentElement.scrollTop=0;};
})();
