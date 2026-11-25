import * as THREE from 'three';
export const narrativeColors=['#4e83b7','#b9655b','#5f986c','#bd963e','#8d77b0','#4b999c','#aa7452'];
const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(Math.floor(m%60)).padStart(2,'0');
export function createNarrativeView(payload,{selectEvent,choose,locations}){
 const panel=document.createElement('aside');panel.id='scene-list';panel.className='paper';panel.hidden=true;
 const title=document.createElement('h3');title.textContent='今天的场景';panel.append(title);
 const note=document.createElement('p');note.className='scene-note';note.textContent='人物设定来自 NPC 库 · 日程与对白为新增草稿';panel.append(note);
 const list=document.createElement('div');list.className='scene-items';panel.append(list);
 for(const event of [...payload.events].sort((a,b)=>a.start-b.start)){
  const button=document.createElement('button');button.className='scene-entry';button.dataset.event=event.id;
  const heading=document.createElement('strong');heading.textContent=event.title;button.append(heading);
  const meta=document.createElement('small');meta.textContent=`${clock(event.start)}–${clock(event.end)} · ${event.participants.length}人 · ${locations.get(event.locationId)?.name??'街区公共空间'}`;button.append(meta);
  button.onclick=()=>selectEvent(event);list.append(button);
 }
 const layer=document.createElement('div');layer.id='narrative-labels';layer.hidden=true;
 document.body.append(panel,layer);let labels=[],currentState=null,currentRuntime=null;
 function render(state,runtime){currentState=state;currentRuntime=runtime;
  for(const button of list.children)button.setAttribute('aria-current',String(state.activeEvents.includes(button.dataset.event)));
  layer.replaceChildren();labels=[];
  const profile=payload.profiles.find(p=>p.id===state.selected),sample=runtime.get(state.selected);
  if(profile&&sample){const button=document.createElement('button');button.className='map-person-label';button.textContent=profile.name+' · '+sample.action;button.onclick=()=>choose(profile.id);layer.append(button);labels.push({button,personId:profile.id,position:sample.position});}
  for(const event of payload.events.filter(e=>state.activeEvents.includes(e.id)).slice(0,6)){
   const button=document.createElement('button');button.className='map-event-label';button.textContent=event.title;button.onclick=()=>selectEvent(event);layer.append(button);labels.push({button,position:event.position});
  }
 }
 function project(camera){if(!currentState?.editor)return;for(const item of labels){const position=currentRuntime?.get(item.personId)?.position??item.position;const p=new THREE.Vector3(position[0],position[1]+.65,position[2]).project(camera);item.button.hidden=p.z>1||p.z<-1||Math.abs(p.x)>1||Math.abs(p.y)>1;item.button.style.transform=`translate(${(p.x+1)*innerWidth/2}px,${(1-p.y)*innerHeight/2}px) translate(-50%,-100%)`;}}
 return {render,project,setEditor(value){panel.hidden=!value;layer.hidden=!value;}};
}
