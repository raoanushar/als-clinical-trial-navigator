const {randomUUID}=require('node:crypto');
function updateSavedTrials(data, body) {
  const store=data.savedTrials ||= {collections:[],trials:{}};
  const {action,nctId}=body;
  if(action==='collection'){
    const name=String(body.name||'').trim();
    if(!name||name.length>80)throw Error('Use a collection name between 1 and 80 characters.');
    if(!store.collections.some(c=>c.name.toLowerCase()===name.toLowerCase()))store.collections.push({id:randomUUID(),name});
  }else{
    if(!/^NCT\d{8}$/.test(nctId||''))throw Error('Invalid trial ID.');
    if(action==='save')store.trials[nctId] ||= {savedAt:new Date().toISOString(),note:'',collections:[]};
    else if(action==='remove')delete store.trials[nctId];
    else if(action==='edit'){
      if(!store.trials[nctId])throw Error('Save this trial first.');
      if(typeof body.note!=='string'||body.note.length>5000)throw Error('Notes must be under 5,000 characters.');
      if(!Array.isArray(body.collections)||body.collections.some(id=>!store.collections.some(c=>c.id===id)))throw Error('Unknown collection.');
      Object.assign(store.trials[nctId],{note:body.note,collections:[...new Set(body.collections)]});
    }else throw Error('Unknown saved-trial action.');
  }
  return store;
}
module.exports={updateSavedTrials};
