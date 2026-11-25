export function distanceToBounds(position,bounds){
  const p=Array.isArray(position)?position:[position.x,position.y,position.z];
  return Math.hypot(Math.max(bounds.min[0]-p[0],0,p[0]-bounds.max[0]),Math.max(bounds.min[2]-p[2],0,p[2]-bounds.max[2]));
}
// This scheduler owns resident content, not logical roots, story IDs or collision.
export function createBuildingStream({entries,load,onAttach=()=>{},onDetach=()=>{},onChange=()=>{},isVisible=()=>true,inView=()=>true,radius=18,keepRadius=26,concurrency=2,now=()=>performance.now()}){
  const records=new Map(entries.map(entry=>[entry.instanceId,{entry,state:'unloaded',generation:0,wanted:false,distance:Infinity,handle:null,inFlight:false,error:null,pinUntil:0}]));
  let active=0,disposed=false,lastCheck=-Infinity,lastPosition=null,initialDone=false;
  const waiters=new Set(),totals={loads:0,unloads:0,lateDisposals:0,failures:0};
  function snapshot(){
    const rows=[...records.values()].map(r=>({id:r.entry.instanceId,state:r.state,wanted:r.wanted,distance:Number.isFinite(r.distance)?r.distance:null,generation:r.generation,visible:isVisible(r.entry),resident:!!r.handle,error:r.error}));
    return {total:rows.length,loaded:rows.filter(r=>r.resident).length,pending:rows.filter(r=>r.state==='queued'||r.state==='loading').length,inFlight:active,errors:rows.filter(r=>r.state==='error').length,visibleLoaded:rows.filter(r=>r.resident&&r.visible).length,unloaded:rows.filter(r=>r.state==='unloaded').length,radius,keepRadius,initialDone,...totals,rows,measurement:'loaded means resident geometry; visibleLoaded is eligible, not a rendered/frustum count'};
  }
  function changed(){
    onChange(snapshot());
    for(const waiter of [...waiters])if(waiter.ids.every(id=>{const r=records.get(id);return !r||!['queued','loading'].includes(r.state);})){waiters.delete(waiter);waiter.resolve(snapshot());}
  }
  function removeContent(r){
    const h=r.handle;if(!h)return;r.handle=null;
    try{onDetach(r.entry,h);}finally{h.dispose();totals.unloads++;}
  }
  async function start(r){
    const token=r.generation;r.state='loading';r.inFlight=true;active++;changed();
    let handle=null,attached=false;
    try{
      handle=await load(r.entry);
      if(disposed||token!==r.generation||!r.wanted){handle.dispose();handle=null;totals.lateDisposals++;return;}
      r.handle=handle;attached=true;onAttach(r.entry,handle);r.state='loaded';r.error=null;totals.loads++;
    }catch(error){
      if(attached){try{removeContent(r);}catch{}handle=null;}
      else if(handle){try{handle.dispose();}catch{}handle=null;}
      if(!disposed&&token===r.generation){r.state='error';r.error=String(error?.message??error);totals.failures++;}
    }finally{
      r.inFlight=false;active--;
      if(!disposed&&token!==r.generation&&!r.handle)r.state=r.wanted?'queued':'unloaded';
      changed();pump();
    }
  }
  function pump(){
    if(disposed)return;
    const queue=[...records.values()].filter(r=>r.state==='queued'&&!r.inFlight).sort((a,b)=>(b.pinUntil>now())-(a.pinUntil>now())||a.distance-b.distance);
    while(active<concurrency&&queue.length)void start(queue.shift());
  }
  function update(position,force=false){
    if(disposed)return;const t=now(),p=Array.isArray(position)?position:[position.x,position.y,position.z];
    if(!force&&t-lastCheck<500&&lastPosition&&Math.hypot(p[0]-lastPosition[0],p[2]-lastPosition[2])<1)return;
    lastCheck=t;lastPosition=[...p];
    for(const r of records.values()){
      r.distance=distanceToBounds(p,r.entry.bounds);
      // Visibility is an allocation rule, not just a draw flag. Retain nearby
      // residents across camera turns, but never fetch a new off-screen model.
      const resident=r.handle||r.inFlight,reach=resident?keepRadius:radius;
      const wanted=isVisible(r.entry)&&(r.pinUntil>t||(r.distance<=reach&&(resident||inView(r.entry))));
      if(!wanted){
        if(r.wanted||r.handle||r.state==='queued'){r.generation++;r.wanted=false;removeContent(r);r.state='unloaded';}
      }else{
        r.wanted=true;if(r.state==='unloaded'&&!r.inFlight)r.state='queued';
      }
    }
    changed();pump();
  }
  function settled(ids){return new Promise(resolve=>{waiters.add({ids,resolve});changed();});}
  async function loadInitial(position){update(position,true);const ids=[...records.values()].filter(r=>r.wanted).map(r=>r.entry.instanceId);const result=await settled(ids);initialDone=true;changed();return result;}
  function ensure(ids,position){const t=now();for(const id of ids){const r=records.get(id);if(r){r.pinUntil=t+15000;if(r.state==='error'){r.state='unloaded';r.error=null;}}}update(position??lastPosition??[0,0,0],true);return settled(ids);}
  function retryErrors(position){for(const r of records.values())if(r.state==='error'){r.state='unloaded';r.error=null;}update(position??lastPosition??[0,0,0],true);}
  function dispose(){if(disposed)return;disposed=true;for(const r of records.values()){r.generation++;r.wanted=false;removeContent(r);r.state='unloaded';}changed();}
  return {update,loadInitial,ensure,retryErrors,snapshot,dispose};
}
