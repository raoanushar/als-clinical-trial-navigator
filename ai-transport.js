// Responses API transport shared by search and the update assistant.
function partialString(json,key) {
 const match=new RegExp('"'+key+'"\\s*:\\s*"').exec(json);if(!match)return '';
 let value='';for(let i=match.index+match[0].length;i<json.length;i++){
  const c=json[i];if(c==='"')break;
  if(c!=='\\'){value+=c;continue;}
  if(++i>=json.length)break;const escaped=json[i];
  if(escaped==='u'){const code=json.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(code))break;value+=String.fromCharCode(parseInt(code,16));i+=4;}
  else value+=({'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','"':'"','\\':'\\','/':'/'})[escaped] || '';
 }
 // Do not emit half of a surrogate pair if an escaped character spans chunks.
 return /[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;
}
async function readEvents(body,onEvent) {
 if(!body)throw new Error('The AI service returned no stream.');
 const decoder=new TextDecoder();let buffer='';
 for await(const chunk of body){buffer+=decoder.decode(chunk,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;
  while((end=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data && data!=='[DONE]')onEvent(JSON.parse(data));}
  // The provider uses LF; normalize CRLF too, including boundaries across chunks.
  buffer=buffer.replace(/\r\n/g,'\n');
 }
 buffer+=decoder.decode();if(buffer.trim()){const data=buffer.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data && data!=='[DONE]')onEvent(JSON.parse(data));}
}
async function structuredRequest({apiKey,model,name,schema,instructions,data,fetchImpl=fetch,signal,onText,textKey='answer'}) {
 let response;const timeout=AbortSignal.timeout(90000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 try{response=await fetchImpl('https://api.openai.com/v1/responses',{
  method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:combined,
  body:JSON.stringify({model,store:false,max_output_tokens:5000,...(onText?{stream:true}:{}),input:[{role:'developer',content:instructions},{role:'user',content:JSON.stringify(data)}],text:{format:{type:'json_schema',name,strict:true,schema}}}),
 });}catch(error){if(signal?.aborted)throw error;throw new Error(error.name==='TimeoutError'?'SAVA took too long to respond. Please try again.':'SAVA could not reach the AI service. Please try again.');}
 if(!response.ok){if(response.status===429)throw new Error('The AI service is at its usage or rate limit. Please try again shortly.');if([401,403].includes(response.status))throw new Error('The server’s AI credentials could not be used. Check its OpenAI configuration.');throw new Error(`The AI service could not complete this request (${response.status}). Please try again.`);}
 let payload,text='';
 if(onText){let completed=false;await readEvents(response.body,event=>{
  if(event.type==='response.output_text.delta'){text+=event.delta || '';onText(partialString(text,textKey));}
  if(event.type==='response.completed'){payload=event.response;completed=true;}
  if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error('SAVA could not finish this answer. Please try again.');
 });if(!completed)throw new Error('The connection ended before the answer was complete. Please retry.');}
 else payload=await response.json();
 if(payload?.status && payload.status!=='completed')throw new Error('SAVA could not finish this answer. Try a more specific question.');
 text=payload?.output_text || (payload?.output || []).flatMap(item=>item.content || []).filter(item=>item.type==='output_text').map(item=>item.text).join('') || text;
 try{return JSON.parse(text);}catch{throw new Error('SAVA could not produce an answer. Please rephrase your question.');}
}
async function streamResult(request,response,work) {
 const controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
 response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});response.flushHeaders();
 const send=(event,data)=>{if(!response.destroyed)response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
 const heartbeat=setInterval(()=>{if(!response.destroyed)response.write(': keepalive\n\n');},15000);
 try{const result=await work({signal:controller.signal,send});if(!controller.signal.aborted)send('done',result);}catch(error){if(!controller.signal.aborted)send('error',{error:error.message || 'Unable to complete this request.'});}finally{clearInterval(heartbeat);response.end();}
}
module.exports={partialString,readEvents,structuredRequest,streamResult};
