// Shared language normalization. Geographic facts locate a facility; they never imply trial participation.
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function city(value){const text=normalize(value);return /^(nyc|new york city|new york)$/.test(text)?'new york':text;}
function country(value){const text=normalize(value);if(['us','usa','u s','u s a','united states','united states of america','america'].includes(text))return 'united states';if(['uk','u k','united kingdom','great britain'].includes(text))return 'united kingdom';return text;}
function institution(value){return normalize(value).replace(/\bmt\b/g,'mount').replace(/\bnyc\b|new york city/g,'new york').replace(/\bnew york university\b/g,'nyu').replace(/\bmass general\b|\bmgh\b/g,'massachusetts general hospital');}
function institutionMatches(value,query){const text=institution(value),terms=institution(query).split(' ').filter(Boolean);return terms.length>0&&terms.every(term=>` ${text} `.includes(` ${term} `));}
const stateAliases={ny:'new york',ma:'massachusetts',ca:'california',tx:'texas',fl:'florida',pa:'pennsylvania',il:'illinois',oh:'ohio',wa:'washington',nj:'new jersey',ct:'connecticut',md:'maryland',nc:'north carolina',mi:'michigan',ga:'georgia',co:'colorado',az:'arizona',mn:'minnesota',mo:'missouri',or:'oregon',va:'virginia',tn:'tennessee',ut:'utah',wi:'wisconsin'};
const state=value=>stateAliases[normalize(value)]||normalize(value);
function locationFacts(request,trials){
 const requestedCity=city(request.city),requestedCountry=country(request.country),requestedState=state(request.state);
 // An explicitly named New York City is unambiguous. Do not ask users to supply its country.
 if(requestedCity==='new york'&&(!requestedCountry||requestedCountry==='united states')&&(!requestedState||requestedState==='new york'))return {city:'New York',state:'New York',country:'United States'};
 const sites=trials.flatMap(t=>t.locations||[]).filter(s=>(!requestedCity||city(s.city)===requestedCity)&&(!requestedCountry||country(s.country)===requestedCountry)&&(!requestedState||state(s.state)===requestedState)&&(!request.facility||institutionMatches(s.facility,request.facility)));
 const unique=new Map(sites.filter(s=>s.city).map(s=>[[city(s.city),state(s.state),country(s.country)].join('|'),{city:s.city,state:s.state||'',country:s.country||''}]));
 if(unique.size===1)return [...unique.values()][0];
 if(requestedCity&&request.facility)return locationFacts({...request,facility:''},trials);
 return null;
}
function explicitLocationReply(text){
 const normalized=normalize(text);
 if(/\b(nyc|new york city)\b/.test(normalized))return {city:'New York',state:'New York',country:'United States'};
 if(/^(usa|us|united states|united states of america)$/.test(normalized))return {country:'United States'};
 return null;
}
module.exports={normalize,city,country,state,institution,institutionMatches,locationFacts,explicitLocationReply};
