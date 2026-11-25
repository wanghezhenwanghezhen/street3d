// Only same-origin read-only asset requests are retried. Hash validation remains
// in the original loaders; failed/partial bytes are never returned as success.
export function installLoadTransport({idleMs=30000,maxAttempts=3,fetchImpl=window.fetch.bind(window)}={}){
 const active=new Map(),history=[];let sequence=0,totalBytes=0,lastActivity=performance.now(),retries=0;
 const snapshot=()=>({active:[...active.values()].map(r=>({...r})),history:[...history],totalBytes,lastActivity,retries,idleMs,maxAttempts});
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function fetchAsset(input,init){
  const source=input instanceof Request?input.url:input,url=new URL(source,location.href);
  const method=init?.method??(input instanceof Request?input.method:'GET');
  if(url.origin!==location.origin||method.toUpperCase()!=='GET'||!['http:','https:'].includes(url.protocol))return fetchImpl(input,init);
  const outer=init?.signal??(input instanceof Request?input.signal:null),id=++sequence;
  const row={id,url:url.pathname,state:'loading',attempt:1,bytes:0,startedAt:performance.now()};active.set(id,row);
  try{
   for(let attempt=1;attempt<=maxAttempts;attempt++){
    row.attempt=attempt;row.state='loading';row.bytes=0;
    const controller=new AbortController();let timer,reader,timedOut=false;
    const aborted=()=>controller.abort(outer.reason),touch=()=>{lastActivity=performance.now();clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},idleMs);};
    if(outer?.aborted)throw outer.reason??new DOMException('Aborted','AbortError');
    outer?.addEventListener('abort',aborted,{once:true});touch();
    try{
     const response=await fetchImpl(input,{...init,signal:controller.signal});
     if(response.status>=500||response.status===408||response.status===429){await response.body?.cancel();throw Error('Asset HTTP '+response.status);}
     if(!response.ok||!response.body)return response;
     reader=response.body.getReader();const parts=[];let size=0;
     for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);size+=value.byteLength;row.bytes=size;totalBytes+=value.byteLength;touch();}
     const body=new Blob(parts);parts.length=0;
     const result=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
     // Preserve metadata used by Three.js loaders and diagnostics.
     for(const key of ['url','redirected','type'])Object.defineProperty(result,key,{value:response[key]});
     row.state='loaded';return result;
    }catch(error){
     try{await reader?.cancel();}catch{}
     if(outer?.aborted)throw error;
     row.error=timedOut?'Asset stalled without data':String(error?.message??error);
     history.push({url:row.url,attempt,error:row.error,at:performance.now()});if(history.length>80)history.shift();
     if(attempt===maxAttempts){row.state='failed';const failure=Error(row.error+' (after '+maxAttempts+' attempts): '+row.url);failure.transportExhausted=true;throw failure;}
     row.state='retrying';retries++;await delay(attempt*800);
    }finally{clearTimeout(timer);outer?.removeEventListener('abort',aborted);}
   }
  }finally{active.delete(id);lastActivity=performance.now();}
 }
 return {fetch:fetchAsset,snapshot};
}
export const loadTransport=installLoadTransport();
window.fetch=loadTransport.fetch;window.qianyuLoadingTransport=loadTransport;
