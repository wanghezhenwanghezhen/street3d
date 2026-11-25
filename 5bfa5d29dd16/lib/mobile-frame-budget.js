// Preserve scene content and lighting. Only sustained GPU pressure may reduce
// the phone canvas resolution; cold loading, hidden tabs and isolated stalls do not.
export function createMobileFrameBudget(renderer,{enabled=false,maxRatio=1}={}){
 const samples=[];let ratio=maxRatio,lastChange=0,startedAt=0;const changes=[];
 function sample(ms,now,{active=true,busy=false}={}){
  if(!enabled)return;
  if(!active||busy){samples.length=0;startedAt=now;return;}
  if(!startedAt)startedAt=now;
  if(ms>0&&ms<250)samples.push(ms);if(samples.length>180)samples.shift();
  if(samples.length<90||now-startedAt<3000||now-lastChange<12000)return;
  const sorted=[...samples].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length*.5)],p85=sorted[Math.floor(sorted.length*.85)];
  let next=ratio;
  if(median>30&&p85>40)next=Math.max(.75,ratio-.125);
  else if(p85<21)next=Math.min(maxRatio,ratio+.125);
  if(next!==ratio){ratio=next;renderer.setPixelRatio(ratio);lastChange=now;changes.push({at:now,ratio,median,p85});if(changes.length>20)changes.shift();}
  samples.length=0;startedAt=now;
 }
 return {sample,snapshot:()=>({enabled,ratio,minRatio:.75,maxRatio,changes:[...changes],policy:'sustained foreground pressure only; unchanged geometry, textures, lights and shadows'})};
}
