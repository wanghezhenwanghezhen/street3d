// Pure, deterministic motion. Used by the browser, exporter and CPU validation.
export const NPC_TIME_SCALE = 0.4;
export const DAY_MINUTES = 1440;
export const wrapMinute = minute => ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
export const distanceXZ = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]);
export function advanceClock(minute,elapsedSeconds,{paused=false,timeScale=NPC_TIME_SCALE}={}) {
  const elapsed=paused?0:Math.max(0,Number.isFinite(elapsedSeconds)?elapsedSeconds:0)*timeScale;
  const total=wrapMinute(minute)+elapsed;
  return {minute:wrapMinute(total),daysElapsed:Math.floor(total/DAY_MINUTES)};
}
export function sampleSchedule(schedule,minute) {
  minute=wrapMinute(minute);
  const segment=schedule.timeline.find(t=>minute>=t.start&&minute<t.end)??schedule.timeline[0];
  const path=segment.path;
  if(segment.loopPath?.length>1){
    const loop=segment.loopPath,times=segment.loopTimes,period=segment.loopMinutes,time=((minute-segment.start+(segment.loopPhase??0))%period+period)%period;
    let k=0;while(k<times.length-2&&times[k+1]<=time)k++;
    const stopped=time>=times.at(-1),a=loop[k],b=loop[k+1],span=times[k+1]-times[k],mix=stopped?1:Math.max(0,Math.min(1,(time-times[k])/span));
    const weight=Math.max(0,Math.min(1,minute-segment.start,segment.end-minute)),position=(stopped?[...loop.at(-1)]:a.map((v,i)=>v+(b[i]-v)*mix)).map((v,i)=>path[0][i]+(v-path[0][i])*weight);
    return {segmentId:segment.id,state:segment.state,action:segment.action,position,heading:stopped?(segment.heading??0):Math.atan2(b[0]-a[0],b[2]-a[2]),speedUPerGameMinute:stopped?0:distanceXZ(a,b)/span,socialPartners:segment.socialPartners??[],microMovement:!stopped,locationId:segment.locationId};
  }
  if(path.length===1)return {segmentId:segment.id,state:segment.state,action:segment.action,position:[...path[0]],eventId:segment.eventId,heading:segment.heading??0,speedUPerGameMinute:0};
  const time=minute-segment.start,times=segment.pathTimes;
  let index=0;
  while(index<times.length-2&&times[index+1]<=time)index++;
  const a=path[index],b=path[index+1],span=times[index+1]-times[index];
  const mix=Math.max(0,Math.min(1,(time-times[index])/span));
  return {segmentId:segment.id,state:segment.state,action:segment.action,position:a.map((v,k)=>v+(b[k]-v)*mix),eventId:segment.eventId,
    heading:Math.atan2(b[0]-a[0],b[2]-a[2]),speedUPerGameMinute:distanceXZ(a,b)/span};
}
// Exact minimum of two simultaneous straight segments, including stationary ones.
export function simultaneousDistance(a,b) {
  const start=Math.max(a.start,b.start),end=Math.min(a.end,b.end);
  if(end<start)return Infinity;
  const va=[(a.b[0]-a.a[0])/(a.end-a.start),(a.b[2]-a.a[2])/(a.end-a.start)];
  const vb=[(b.b[0]-b.a[0])/(b.end-b.start),(b.b[2]-b.a[2])/(b.end-b.start)];
  const d=[a.a[0]+va[0]*(start-a.start)-b.a[0]-vb[0]*(start-b.start),a.a[2]+va[1]*(start-a.start)-b.a[2]-vb[1]*(start-b.start)];
  const v=[va[0]-vb[0],va[1]-vb[1]],vv=v[0]**2+v[1]**2;
  const t=vv?Math.max(0,Math.min(end-start,-(d[0]*v[0]+d[1]*v[1])/vv)):0;
  return Math.hypot(d[0]+v[0]*t,d[1]+v[1]*t);
}
export function schedulePieces(schedule) {
  return schedule.timeline.flatMap(segment=>segment.path.length===1?[{owner:schedule.npcId,segmentId:segment.id,start:segment.start,end:segment.end,a:segment.path[0],b:segment.path[0]}]:
    segment.path.slice(1).map((b,k)=>({owner:schedule.npcId,segmentId:segment.id,start:segment.start+segment.pathTimes[k],end:segment.start+segment.pathTimes[k+1],a:segment.path[k],b})));
}
