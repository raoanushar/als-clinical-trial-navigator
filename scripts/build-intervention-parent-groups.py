import csv,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
folder=root/'reports/intervention-landscape'
mapping={
'Treatment':{
'Genetic medicines':['ASOs','Viral-vector gene therapy','Other gene therapies','RNA interference','Other RNA therapies'],
'Small molecules':['Small molecules'],
'Biologic & cell therapies':['Monoclonal antibodies','Other biologics','Cell therapies'],
'Nutrition & microbiome':['Supplements','Nutrition/diet','Microbiome therapies','Traditional Chinese medicine oral preparation'],
'Devices & functional therapies':['Therapeutic devices','Procedures','Exercise/behavioral therapies','Respiratory support'],
'Undisclosed modality':['Undisclosed modality']},
'Other intervention':{
'Communication & assistive technology':['Communication/BCI','Mobility/assistive devices'],
'Diagnostics & monitoring':['Diagnostics/imaging','Biomarkers/monitoring'],
'Basic science & disease models':['Basic science/disease models'],
'Speech & communication research':['Speech/communication research'],
'Supportive care & rehabilitation':['Respiratory support','Nutrition support','Rehabilitation','Microbiome therapies'],
'Care delivery & psychosocial support':['Care delivery','Psychosocial/caregiver support']}}
rows=list(csv.DictReader((folder/'intervention-screening-reclassified.csv').open(encoding='utf-8-sig')))
excluded=json.loads((root/'data/trial-exclusions.json').read_text())
result={'source':'intervention-screening-reclassified.csv','groups':{}}
for purpose,parents in mapping.items():
 trials=[r for r in rows if r['Study purpose']==purpose and r['Trial ID'] not in excluded]
 cats={r['Trial ID']:set(c.strip() for c in r['Intervention category'].split(';') if c.strip()) for r in trials}
 assert set.union(*cats.values())<=set(c for cs in parents.values() for c in cs)
 groups=[]
 for parent,children in parents.items():
  subs=[{'label':c,'trialIds':sorted(id for id,cs in cats.items() if c in cs)} for c in children]
  subs=[s for s in subs if s['trialIds']]
  ids=sorted(set(id for s in subs for id in s['trialIds']))
  if ids:groups.append({'label':parent,'trialIds':ids,'subcategories':sorted(subs,key=lambda s:-len(s['trialIds']))})
 overlap=sum(sum(id in g['trialIds'] for g in groups)>1 for id in cats)
 result['groups']['treatment' if purpose=='Treatment' else 'other']={'total':len(trials),'overlap':overlap,'parents':sorted(groups,key=lambda g:-len(g['trialIds'])),'studies':[{'nctId':r['Trial ID'],'categories':sorted(cats[r['Trial ID']])} for r in trials]}
(folder/'parent-groups.json').write_text(json.dumps(result,indent=2)+'\n')
print({k:{'trials':v['total'],'overlapping':v['overlap'],'parents':len(v['parents'])} for k,v in result['groups'].items()})
