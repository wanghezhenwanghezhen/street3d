import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRoadGraph} from './road-navigation.js';
import {createBoardState} from './board-state.js';
export async function createPlayerBoard({scene,roads,spawn,floorHeight,onMove,onLand,onSaveError,onRoll=()=>{},onModelReady=()=>{}}) {
  const graph=createRoadGraph(roads),storageKey='qianyu-street3d:board:v1';
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey))??{};}catch{}
  const board=createBoardState(graph,graph.nearest(spawn).id,saved),state=board.state;
  const root=new THREE.Group();root.name='Player bottom-center anchor';root.visible=false;scene.add(root);
  const facing=new THREE.Group();root.add(facing);
  let model=null,modelPromise=null,modelBounds=null,modelState='idle',modelError=null,visibleWanted=false;
  function retireModel(value){if(!value)return;value.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set();value.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))materials.add(m);});for(const m of materials){for(const t of Object.values(m))if(t?.isTexture)textures.add(t);m.dispose();}for(const g of geometries)g.dispose();for(const t of textures){t.dispose();t.image?.close?.();t.image=null;}value.clear();}
  async function setVisible(value){
    visibleWanted=Boolean(value);root.visible=visibleWanted&&!!model;
    if(!visibleWanted){retireModel(model);model=null;if(!modelPromise)modelState='idle';return false;}
    if(model)return true;
    if(!modelPromise){modelState='loading';modelError=null;modelPromise=(async()=>{
      let next=null;
      try{next=(await new GLTFLoader().loadAsync('/data/player-pawn.glb')).scene;
        const bounds=new THREE.Box3().setFromObject(next),size=bounds.getSize(new THREE.Vector3());
        if(![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite)||size.y<=0)throw Error('Invalid player bounds');
        modelBounds={min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray()};
        next.position.set(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,-(bounds.min.z+bounds.max.z)/2);
        next.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
        if(!visibleWanted){retireModel(next);next=null;modelState='idle';return false;}
        model=next;facing.add(next);onModelReady(next);root.visible=true;modelState='ready';return true;
      }catch(error){retireModel(next);model=null;root.visible=false;modelState='error';modelError=String(error?.message??error);throw error;}
      finally{modelPromise=null;}
    })();}
    return modelPromise;
  }
  const halo=new THREE.Mesh(new THREE.RingGeometry(.29,.34,40),new THREE.MeshBasicMaterial({color:'#46bfd0',side:THREE.DoubleSide}));
  halo.rotation.x=-Math.PI/2;halo.position.y=.006;root.add(halo);
  const contact=new THREE.Mesh(new THREE.CircleGeometry(.25,32),new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;void main(){float a=(1.-smoothstep(.1,.5,length(v-.5)))*.25;gl_FragColor=vec4(.12,.22,.28,a);}'}));
  contact.rotation.x=-Math.PI/2;contact.position.y=.005;root.add(contact);
  const markers=new THREE.Group();scene.add(markers);
  let hop=null,rolling=0,enabled=false,rollPending=false;
  const $=id=>document.getElementById(id),dice=$('dice-roll'),status=$('dice-status'),directions=$('dice-directions');
  function location(id){const p=[...graph.nodes.get(id).position];p[1]=floorHeight(p[0],p[2])+.003;return p;}
  root.position.fromArray(location(state.cell));
  const faceDirection=(dx,dz)=>{facing.rotation.y=Math.atan2(dx,dz)-Math.PI/2;};
  faceDirection(...state.heading);
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify({...state,landings:undefined}));}catch(e){onSaveError(e);}}
  function render(){
    dice.disabled=!enabled||!!hop||!!rolling||state.remaining>0;
    dice.setAttribute('aria-label','掷骰子'+(state.value?'，上次 '+state.value+' 点':''));
    $('dice-value').textContent=state.value?state.value+' 点':'掷骰子';
    status.textContent=!enabled?'进入街区后开始':rolling?'骰子转动中…':hop?'跳向下一格 · 余 '+state.remaining+' 格':state.remaining?'自动前进 · 余 '+state.remaining+' 格':'点击骰子，自动沿道路前进';
    directions.replaceChildren();while(markers.children.length){const m=markers.children[0];markers.remove(m);m.geometry.dispose();m.material.dispose();}
  }

  function startHop(id){if(!enabled||rolling||hop||!state.remaining||!board.choices().includes(id))return false;
    hop={id,from:root.position.clone(),to:new THREE.Vector3(...location(id)),elapsed:0};
    faceDirection(hop.to.x-hop.from.x,hop.to.z-hop.from.z);render();return true;
  }
  function continueTurn(){const next=board.forward();if(enabled&&state.remaining&&next)startHop(next);else render();}
  dice.onclick=()=>{
    if(!enabled||hop||rolling||state.remaining)return;
    const bytes=new Uint8Array(1);do{crypto.getRandomValues(bytes);}while(bytes[0]>=252);
    if(!board.roll(bytes[0]%6+1))return;persist();rolling=1.05;onRoll(state.value);rollPending=true;dice.classList.add('rolling');render();
  };
  function update(dt){
    if(!enabled)return;
    if(rolling){rolling=Math.max(0,rolling-dt);if(!rolling){rollPending=false;dice.classList.remove('rolling');continueTurn();}}
    if(!hop)return;
    hop.elapsed+=dt;const t=Math.min(1,hop.elapsed/.38),prior=root.position.clone();
    const rise=Math.sin(Math.PI*t)*.24;root.position.lerpVectors(hop.from,hop.to,t);root.position.y+=rise;halo.position.y=.006-rise;contact.position.y=.005-rise;
    onMove(root.position.clone().sub(prior));
    if(t===1){board.land(hop.id);hop=null;persist();onLand(state.cell,root.position.toArray());continueTurn();}
  }
  function setEnabled(value){enabled=value;if(value)continueTurn();else render();}
  render();
  return {root,update,setEnabled,setVisible,position:()=>root.position.toArray(),snapshot:()=>({...state,choices:board.choices(),next:board.forward(),navigation:'automatic-forward',sourceForward:'+X',facing:[Math.cos(facing.rotation.y),0,-Math.sin(facing.rotation.y)],destination:hop?.id??null,hopping:!!hop,rolling:rollPending,enabled,visible:root.visible,visibleWanted,modelState,modelError,position:root.position.toArray(),supportHeight:location(state.cell)[1],modelBounds,anchor:'bottom-center',modelUrl:'/data/player-pawn.glb'})};
}
