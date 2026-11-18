// Shared streaming and composer helpers. No model HTML is inserted into the page.
window.ChatUI = (() => {
 const icons={send:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'};
 function button(node,busy=false){node.innerHTML=icons[busy?'stop':'send'];node.setAttribute('aria-label',busy?'Stop response':'Send message');node.title=busy?'Stop response':'Send message';node.classList.add('chat-send');}
 function autosize(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px';}
 async function stream(url,body,{signal,onText,onStatus}={}){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error || 'Unable to start this request.');}
  if(!response.body)throw new Error('Streaming is unavailable. Please reload.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,complete=false;
  function consume(block){let type='message';const data=[];for(const line of block.split('\n')){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}if(!data.length)return;const value=JSON.parse(data.join('\n'));if(type==='text')onText?.(value.text);if(type==='status')onStatus?.(value.message);if(type==='error')throw new Error(value.error);if(type==='done'){result=value;complete=true;}}
  try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))!==-1){consume(buffer.slice(0,end));buffer=buffer.slice(end+2);}}buffer+=decoder.decode();if(buffer.trim())consume(buffer);if(!complete)throw new Error('The connection ended before the answer was complete. Please retry.');return result;}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 return {button,autosize,stream,icons};
})();
