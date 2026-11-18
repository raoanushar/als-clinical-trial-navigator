// Portal edits are stored separately from imported registry records and survive syncs.
const siteKey = site => JSON.stringify(['facility','city','state','country'].map(key=>String(site[key]||'').trim().toLowerCase()));
function applyTrialOverrides(trial,data) {
 const override=data.trialOverrides?.[trial.nctId];if(!override)return trial;
 const result=structuredClone(trial);Object.assign(result,structuredClone(override.fields||{}));
 const additions=Object.values(override.addedSites||{});
 result.locations ||= [];
 for(const site of additions)if(!result.locations.some(existing=>siteKey(existing)===siteKey(site)))result.locations.push(structuredClone(site));
 result.locations=(result.locations||[]).map(site=>({...site,...structuredClone(override.sites?.[siteKey(site)]||{})}));
 result.locationSummary=result.locations.map(site=>[site.facility,site.city,site.country].filter(Boolean).join(', ')).join('; ');
 result.portalUpdatedAt=override.updatedAt;return result;
}
function saveTrialOverrides(data,trial,changes,updatedAt) {
 data.trialOverrides ||= {};
 const override=structuredClone(data.trialOverrides[trial.nctId]||{fields:{},sites:{}});
 const updated=structuredClone(trial);
 for(const change of changes){
  if(['trialNote','siteNote'].includes(change.field)){
   const note={text:change.after,createdAt:updatedAt,author:require('./review-portal').PROFILE.name};
   if(change.field==='trialNote'){updated.portalNotes ||= [];updated.portalNotes.push(note);override.fields.portalNotes=structuredClone(updated.portalNotes);}
   else {const site=updated.locations[Number(change.path.split('.')[1])];if(!site)throw new Error('Site no longer exists.');site.portalNotes ||= [];site.portalNotes.push(note);const key=siteKey(site);override.sites[key] ||= {};override.sites[key].portalNotes=structuredClone(site.portalNotes);}
   continue;
  }
  if(change.field==='addSite'){
   const site=structuredClone(change.site);if(!site?.facility||(!site.city&&site.participationType!=='remote'))throw new Error('Site name and a city or remote participation are required.');
   if(updated.locations?.some(existing=>siteKey(existing)===siteKey(site)))throw new Error('This site is already listed.');
   override.addedSites ||= {};override.addedSites[siteKey(site)]=site;updated.locations ||= [];updated.locations.push(site);continue;
  }
  const parts=change.path.split('.');
  if(parts[0]==='locations'){
   const site=updated.locations[Number(parts[1])];if(!site)throw new Error('The selected site is no longer available.');
   const key=siteKey(site);override.sites[key] ||= {};
   if(parts[2]==='status'){site.status=change.after;override.sites[key].status=change.after;}
   else if(parts[2]==='contacts' && ['name','email','phone'].includes(parts[4])){site.contacts ||= [];site.contacts[Number(parts[3])] ||= {name:'',email:'',phone:''};site.contacts[Number(parts[3])][parts[4]]=change.after;override.sites[key].contacts=structuredClone(site.contacts);}
   else throw new Error('Unsupported site field.');
  }else if(parts[0]==='centralContacts' && ['name','email','phone'].includes(parts[2])){
   updated.centralContacts ||= [];updated.centralContacts[Number(parts[1])] ||= {name:'',email:'',phone:''};updated.centralContacts[Number(parts[1])][parts[2]]=change.after;override.fields.centralContacts=structuredClone(updated.centralContacts);
  }else if(['title','status','summary','eligibilityCriteria','startDate','primaryCompletionDate','completionDate'].includes(change.path)){override.fields[change.path]=change.after;}
  else throw new Error('Unsupported trial field.');
 }
 override.updatedAt=updatedAt;data.trialOverrides[trial.nctId]=override;
}
module.exports={applyTrialOverrides,saveTrialOverrides,siteKey};
