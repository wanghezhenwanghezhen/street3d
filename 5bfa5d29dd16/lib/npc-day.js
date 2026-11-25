import {createNarrativeView,narrativeColors} from './narrative-view.js';
import * as THREE from 'three';
import {createNpcModels} from './npc-models-r20.js';
import {sampleSchedule,advanceClock,NPC_TIME_SCALE,wrapMinute} from './npc-motion.js';
export const clockText=minute=>String(Math.floor(minute/60)%24).padStart(2,'0')+':'+String(Math.floor(minute%60)).padStart(2,'0');
export {sampleSchedule} from './npc-motion.js';
export async function createNpcDay({scene,objects,interactables,onFocus,onEvent,locations}) {
  const payload=await fetch('/data/npc-day-r20.json').then(r=>r.json());
  const state={minute:960,day:0,speed:NPC_TIME_SCALE,timeScale:NPC_TIME_SCALE,timeScaleUnit:'game-minutes-per-real-second',realSecondsPerGameDay:3600,paused:false,visible:true,selected:payload.profiles[0].id,editor:false,activeEvents:[],triggered:[]};
  const storageKey='qianyu-npc-day-clock-r20';
  let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey));}catch{}
  const compatibleSaved=!!saved&&[payload.version,'npc-day-r8'].includes(saved.version);
  if(compatibleSaved&&Number.isFinite(saved.minute)){state.minute=wrapMinute(saved.minute);state.day=Math.max(0,Number(saved.day)||0);if(payload.profiles.some(p=>p.id===saved.selected))state.selected=saved.selected;}
  try{state.visible=localStorage.getItem('qianyu-npc-visible-r21')!=='false';}catch{}
  // A new visit always runs; a timeline pause is local to the current edit session.
  const models=createNpcModels({scene,profiles:payload.profiles,interactables}),roots=models.roots;
  for(const mesh of models.batches)mesh.visible=state.visible;
  const hover=document.createElement('div');hover.id='npc-hover-r20';hover.hidden=true;document.getElementById('game-shell').append(hover);
  const validEvent=id=>payload.events.some(e=>e.id===id);
  const runtime=new Map(),triggered=new Set(compatibleSaved?(saved.triggered??[]).filter(validEvent):[]),shown=new Set(compatibleSaved?(saved.shown??[]).filter(validEvent):[]);
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify({version:payload.version,minute:state.minute,day:state.day,paused:state.paused,selected:state.selected,triggered:[...triggered],shown:[...shown]}));}catch{}}
  addEventListener('pagehide',persist);
  const route=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#d99b51',depthTest:false,transparent:true,opacity:.8}));
  route.visible=false;route.renderOrder=10;scene.add(route);
  const select=document.getElementById('day-character'),tracks=document.getElementById('day-tracks');
  for(const profile of payload.profiles){
    const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name+' · '+profile.occupation;select.append(option);
    const row=document.createElement('div');row.className='day-track';row.style.setProperty('--person-color',narrativeColors[payload.profiles.indexOf(profile)%narrativeColors.length]);
    const label=document.createElement('button');label.textContent=profile.name;label.onclick=()=>choose(profile.id);row.append(label);
    const rail=document.createElement('div');rail.className='day-rail';
    for(const segment of payload.schedules.find(s=>s.npcId===profile.id).timeline){
      const button=document.createElement('button');button.className='day-segment '+segment.state;
      button.style.left=segment.start/14.4+'%';button.style.width=(segment.end-segment.start)/14.4+'%';
      button.title=clockText(segment.start)+' '+segment.action;button.setAttribute('aria-label',profile.name+' '+button.title);
      button.onclick=()=>{seek(segment.start+.01);choose(profile.id);};rail.append(button);
    }
    row.append(rail);tracks.append(row);
  }
  function choose(id){
    state.selected=id;select.value=id;persist();
    const schedule=payload.schedules.find(s=>s.npcId===id);
    route.geometry.dispose();route.geometry=new THREE.BufferGeometry().setFromPoints(schedule.timeline.flatMap(t=>t.path.map(p=>new THREE.Vector3(p[0],p[1]+.04,p[2]))));
    onFocus(runtime.get(id)?.position??schedule.timeline[0].path[0]);render();
  }
  select.value=state.selected;
  select.onchange=()=>choose(select.value);
  document.getElementById('day-seek').oninput=e=>seek(Number(e.target.value));
  document.getElementById('day-play').onclick=()=>{state.paused=!state.paused;persist();render();};
  const speedControl=document.getElementById('day-speed');speedControl.value=String(NPC_TIME_SCALE);
  speedControl.onchange=()=>{state.speed=state.timeScale=NPC_TIME_SCALE;speedControl.value=String(NPC_TIME_SCALE);};
  function render(){
    tracks.style.setProperty('--time-progress',state.minute/14.4+'%');
    if(typeof view!=='undefined')view.render(state,runtime);
    document.getElementById('day-time').textContent=clockText(state.minute);
    document.getElementById('day-seek').value=state.minute;
    document.getElementById('day-play').textContent=state.paused?'播放':'暂停';
    const profile=payload.profiles.find(p=>p.id===state.selected),current=runtime.get(state.selected);
    document.getElementById('day-detail').textContent=profile.occupation+' · '+profile.personality+'。'+(current?.action??'');
    const list=document.getElementById('day-events');list.replaceChildren();
    for(const event of payload.events.filter(e=>e.participants.includes(state.selected))){
      const button=document.createElement('button');button.className='day-event';button.textContent=clockText(event.start)+' '+event.title;
      button.onclick=()=>{seek(event.start+.01);onFocus(event.position);openEvent(event);};list.append(button);
    }
  }
  function openEvent(event){onEvent({...event,participantNames:event.participants.map(id=>payload.profiles.find(p=>p.id===id)?.name??id),locationName:locations.get(event.locationId)?.name??'街区公共空间'});}
  const view=createNarrativeView(payload,{locations,choose,selectEvent:event=>{seek(event.start+.01);onFocus(event.position);openEvent(event);}});
  let lastUi=-1,persistSeconds=0;
  function update(dt,playerPosition){
    const clock=advanceClock(state.minute,dt,{paused:state.paused,timeScale:state.timeScale});
    if(clock.daysElapsed){state.day+=clock.daysElapsed;triggered.clear();shown.clear();}
    state.minute=clock.minute;
    persistSeconds+=Math.max(0,Number.isFinite(dt)?dt:0);if(persistSeconds>=5){persistSeconds=0;persist();}
    for(const schedule of payload.schedules){
      const sample=sampleSchedule(schedule,state.minute),object=roots.get(schedule.npcId);
      runtime.set(schedule.npcId,sample);
      if(object){object.position.fromArray(sample.position);object.userData.basePosition.copy(object.position);object.userData.scheduleHeading=sample.heading;}
    }
    if(state.visible)models.update(runtime,state.minute);
    const active=payload.events.filter(e=>{
      if(state.minute<e.start||state.minute>=e.end)return false;
      const arrived=e.participants.every(id=>{const p=runtime.get(id)?.position;return p&&Math.hypot(p[0]-e.position[0],p[2]-e.position[2])<(e.trigger?.allParticipantsWithinU??.4);});
      const nearby=e.type!=='immediate'||playerPosition&&Math.hypot(playerPosition[0]-e.position[0],playerPosition[2]-e.position[2])<(e.trigger?.playerWithinU??2.5);
      return arrived&&nearby;
    });
    state.activeEvents=active.map(e=>e.id);
    for(const event of active){
      triggered.add(event.id);
      // Social activity is ambient. It does not repeatedly interrupt a dice turn.
    }
    state.triggered=[...triggered];
    if(Math.floor(state.minute)!==lastUi){lastUi=Math.floor(state.minute);render();}
  }
  function seek(minute){if(!Number.isFinite(minute))return;state.minute=wrapMinute(minute);update(0,null);persist();render();}
  function restore(checkpoint){if(!checkpoint||!Number.isFinite(checkpoint.minute))return false;state.minute=wrapMinute(checkpoint.minute);state.day=Math.max(0,Number(checkpoint.day)||0);state.paused=!!checkpoint.paused;triggered.clear();shown.clear();for(const id of checkpoint.triggered??[])if(payload.events.some(e=>e.id===id))triggered.add(id);for(const id of checkpoint.shown??[])if(payload.events.some(e=>e.id===id))shown.add(id);update(0,null);persist();render();return true;}
  function describe(id){
    const current=runtime.get(id),event=payload.events.find(e=>state.activeEvents.includes(e.id)&&e.participants.includes(id));
    return current?clockText(state.minute)+' · '+current.action+(event?'\n'+event.cause+'\n'+event.revised:''):'';
  }
  function setEditor(value){state.editor=value;document.getElementById('day-panel').hidden=!value;route.visible=value&&state.visible;view.setEditor(value);render();}
  function setVisible(value){state.visible=!!value;for(const mesh of models.batches)mesh.visible=state.visible;route.visible=state.editor&&state.visible;if(!state.visible)hover.hidden=true;else models.update(runtime,state.minute);try{localStorage.setItem('qianyu-npc-visible-r21',String(state.visible));}catch{}return state.visible;}
  function hoverAt(id,camera,x,y){if(!state.visible){hover.hidden=true;return;}const p=payload.profiles.find(p=>p.id===id),r=runtime.get(id);if(!p||!r){hover.hidden=true;return;}const screen=new THREE.Vector3(r.position[0],r.position[1]+(models.heights.get(id)??.49),r.position[2]).project(camera),sx=(screen.x+1)*innerWidth/2,sy=(1-screen.y)*innerHeight/2;
   if(screen.z<0||screen.z>1||Math.hypot(x-sx,y-sy)>55){hover.hidden=true;return;}hover.replaceChildren();const title=document.createElement('strong'),status=document.createElement('span');title.textContent=p.name;const partners=(r.socialPartners??[]).map(other=>payload.profiles.find(q=>q.id===other)?.name).filter(Boolean);status.textContent=(r.microMovement?'慢走 · ':'')+r.action+(partners.length?' · '+partners.join('、'):'');hover.append(title,status);hover.style.left=Math.max(100,Math.min(innerWidth-100,sx))+'px';hover.style.top=Math.max(65,sy-10)+'px';hover.hidden=false;
  }
  update(0,null);render();
  return {update,seek,restore,persist,setEditor,setVisible,describe,payload,hoverAt,models,minute:()=>state.minute,project:camera=>view.project(camera),snapshot:()=>({...state,shown:[...shown],npcs:[...runtime].map(([id,r])=>({id,...r})),boundModels:roots.size,models:models.snapshot(),motionVersion:payload.version,minimumSocialMinutes:payload.motionPolicy.minimumSocialMinutes,minimumCenterSeparationU:payload.motionPolicy.minimumCenterSeparationU,scheduleUrl:'/data/npc-schedule-r20.html'})};
}
