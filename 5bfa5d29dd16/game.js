import {createHud} from './lib/hud-r20.js';
import {createMobileFrameBudget} from './lib/mobile-frame-budget.js';
import './lib/load-transport.js';
import {checkStartup} from './lib/startup-readiness.js';
import {createBuildingStream} from './lib/building-stream.js';
import {verifiedJSON,verifiedBytes,validateContract} from './lib/stream-contract.js';
import {createSpriteBatches} from './lib/sprite-batch.js';
import {createFurnitureStream} from './lib/furniture-stream.js';
import {createTerrainStream} from './lib/terrain-stream.js';
import {compactMesh} from './lib/compact-geometry.js';
import {quality,textureUrl} from './lib/quality.js';
import {loadBakedBase} from './lib/base-loader.js';
import {buildV5Roads} from './lib/road-v5-runtime.js';
import {loadPavingRelief} from './lib/paving-loader.js';
import {loadGroundSampler} from './lib/ground-sampler.js';
import {createPlayerBoard} from './lib/player-board.js';
import {createNpcDay} from './lib/npc-day.js';
import {createEnvironment} from './lib/environment.js';
import {createWeather} from './lib/weather.js';
import {createMeshEditRuntime} from './lib/mesh-edit-runtime.js';
import {createBuildingMaterialEditor} from './lib/building-material-editor.js';
import {createSceneOutlines} from './lib/scene-outlines.js';
import {createBuildingEditorUI} from './lib/building-editor-ui.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {loadBuilding} from './lib/building-runtime.js';
import {makeMaterial,buildSurfaceGroup} from './lib/surface-runtime.js';
import {loadSourceInstance,sourceModelCacheState,addTrees,addGrass,updateVegetation,setGrassShadows,r2State} from './lib/r2-runtime.js';
import {buildShopModel,buildStreetlightModel,buildSignModel,buildGraffitiModel,buildRoadEdge,buildRoadGraffiti} from './lib/procedural-r3.js';
const $=id=>document.getElementById(id),canvas=$('world');
const hud=createHud();
let soloRestore=null,soloId=null;
let pinkRoadCells=new Set();
let npcDay=null,playerBoard=null,editorMode=false,groundSampler=null,terrainStream=null,furnitureStream=null,spriteBatches=null,buildingStream=null;
const diagnostics={startedAt:new Date().toISOString(),errors:[],buildings:[],events:[],frameTimes:[],loading:true,source:'map_grass_scale_20261107/r1'};
window.loadingDiagnostics=diagnostics;
const event=(type,data={})=>{diagnostics.events.push({at:new Date().toISOString(),type,...data});if(diagnostics.events.length>1000)diagnostics.events.shift();};
const fail=(scope,e)=>{diagnostics.errors.push({scope,message:e.message});console.error(scope,e);};
window.addEventListener('error',e=>fail('window',e.error??Error(e.message)));
window.addEventListener('unhandledrejection',e=>fail('promise',e.reason));
const renderer=new THREE.WebGLRenderer({canvas,stencil:true,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:false});
renderer.setPixelRatio(quality.pixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
const scene=new THREE.Scene();scene.background=new THREE.Color('#c5dfe4');scene.fog=new THREE.Fog('#c5dfe4',33,95);
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.025,180);camera.rotation.order='YXZ';
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
const world=new THREE.Group();world.rotation.x=-Math.PI/2;scene.add(world);world.updateMatrixWorld(true);
const hemi=new THREE.HemisphereLight('#ffffff','#8b9c89',2.1);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff5df',2.0);sun.position.set(-22,38,17);sun.castShadow=true;sun.shadow.mapSize.set(quality.shadowMap,quality.shadowMap);Object.assign(sun.shadow.camera,{left:-46,right:46,top:46,bottom:-46,near:.1,far:130});sun.target.position.set(13,0,-14);sun.shadow.bias=-.00025;sun.shadow.normalBias=.012;scene.add(sun,sun.target);
const baseGround=new THREE.Mesh(new THREE.PlaneGeometry(110,110),new THREE.MeshStandardMaterial({color:'#c6d4b1',roughness:1}));baseGround.rotation.x=-Math.PI/2;baseGround.position.set(15,-.045,-16);baseGround.receiveShadow=true;scene.add(baseGround);
const streamingContract=await verifiedJSON('/data/building-stream-contract.json');
const data=await verifiedJSON('/data/scene.json',streamingContract.inputs['/data/scene.json']);
const furniturePayload=await verifiedJSON('/data/furniture-placement.json',streamingContract.inputs['/data/furniture-placement.json']),furnitureIds=new Set(furniturePayload.rows.map(r=>r.id));
validateContract(streamingContract,data,furniturePayload);
await Promise.all(['/data/floor-support-r5.json','/data/trees-r2.json'].map(url=>verifiedBytes(url,streamingContract.inputs[url])));
let furnitureRows=[];
const plazaPayload=await fetch('/data/plaza-narratives.json').then(r=>{if(!r.ok)throw Error('景观广场文档未找到');return r.json();});
const plazaDocs=new Map((plazaPayload.plazas??[]).map(x=>[x.id,x]));
diagnostics.plazaDocs={schema:plazaPayload.schema,revision:plazaPayload.revision,count:plazaDocs.size,withImages:[...plazaDocs.values()].filter(x=>x.assets?.length).length,withJokes:[...plazaDocs.values()].filter(x=>x.two_lines?.length===2).length,status:'loaded'};
const landscapeLayerPayload=await fetch('/data/landscape-visibility.json').then(r=>{if(!r.ok)throw Error('景观图层契约未找到');return r.json();});
const landscapeLayer=new Map((landscapeLayerPayload.instances??[]).map(x=>[x.instanceId,x]));
diagnostics.landscapeLayer={schema:landscapeLayerPayload.schema,revision:landscapeLayerPayload.revision,instances:landscapeLayer.size,positionLayerImmutable:landscapeLayerPayload.rules?.positionLayerImmutable===true};
const instanceMap=new Map(data.instances.map(i=>[i.instanceId,i])),storyMap=new Map(data.stories.map(s=>[s.storyId,s]));
const parcelMap=new Map(data.parcels.map(p=>[p.parcelId,p]));
const interactables=[],billboards=[],colliders=[],extraLandscapeRoots=[],groundRoots=[],reliefRoots=[],loadedBuildings=[],storyMarkers=[],proxyRoots=[],landscapeVisuals=new Map(),landscapePointMeshes=new Map(),r3Roots=[],buildingVisuals=new Map(),buildingLogicalRoots=new Map();
let landscapeCategoryFilter='all',showLandscapeAll=true,showLandscapeOptional=false,showLandscapePoints=true,showLandscapeUnresolved=true,showShopBuildings=true,showLandmarkBuildings=true;
const environment=createEnvironment(scene,sun,hemi,renderer);
const lightingSettings=environment.settings;
const weather=createWeather({scene,environment,mobile:quality.profile==='mobile'});
let buildingEditor=null;
const bevel=createMeshEditRuntime({THREE,maxRetainedBytes:12*1024*1024,onChange:()=>{buildingEditor?.updateStatus();renderer.shadowMap.needsUpdate=true;}});
const materialEditor=createBuildingMaterialEditor({renderer,scene,camera,environment,sun});
const outlines=createSceneOutlines({renderer,scene,camera,classify:o=>{
 if(o.userData.furnitureBatch)return {kind:'asset',id:o.uuid};
 let root=o;while(root){const id=root.userData.instanceId;if(id){if(buildingLogicalRoots.has(id))return {kind:'building',id};if(landscapeLayer.has(id))return {kind:'asset',id};}root=root.parent;}
 if(r2State.treeMeshes.includes(o))return {kind:'asset',id:o.uuid};return null;
}});
function updateBevelStatus(){buildingEditor?.updateStatus();}
async function prepareBevel(){try{await bevel.prepare({camera});updateBevelStatus();renderer.shadowMap.needsUpdate=true;}catch(e){fail('bevel',e);$('bevel-status').textContent='倒角准备失败，原模型已保留。';}}
buildingEditor=createBuildingEditorUI({geometry:bevel,materials:materialEditor,outlines,entries:streamingContract.buildings,names:instanceMap,
 onPickStart:()=>setSettingsOpen(false),onPicked:()=>setSettingsOpen(true),ensure:ids=>buildingStream?.ensure(ids,camera.position),prepare:prepareBevel,arrayController:()=>furnitureStream?.arrayController,
 focus:id=>{const e=streamingContract.buildings.find(r=>r.instanceId===id),box=new THREE.Box3(new THREE.Vector3(...e.bounds.min),new THREE.Vector3(...e.bounds.max)),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),d=Math.max(size.x,size.y,size.z)*1.6;camera.position.copy(center).add(new THREE.Vector3(d*.7,d*.6,d));camera.lookAt(center);yaw=camera.rotation.y;pitch=camera.rotation.x;free=true;setModeUI();},
 onChange:materialChanged=>{if(materialChanged)furnitureStream?.rebuild();renderer.shadowMap.needsUpdate=true;}
});
const representations={true3d:0,proxy:0,billboard:0};
const storageKey='qianyu-street3d:progress:v1';
let progress;try{progress=JSON.parse(localStorage.getItem(storageKey))??{};}catch{progress={};}
progress.visited??={};progress.completed??={};progress.bookmarks??={};progress.nodes??={};progress.choices??={};
const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(progress));$('progress').textContent=Object.keys(progress.completed).length;}catch(e){toast('浏览器无法保存进度');fail('storage',e);}};persist();
let started=false,free=false,yaw=0,pitch=0,activeStory=null,currentNode=null,hovered=null,keys=new Set(),filter='all',previousFocus=null;
// Fixed entrance: stand south of Tiananmen and look north, independent of pawn saves.
const entranceAnchor=instanceMap.get('FINAL:tiananmen').position;
let entranceViewActive=true;
function setEntrancePose(){
 const [x,y,z]=entranceAnchor;
 camera.position.set(x+3.7,y+4.7,z+8.2);camera.lookAt(x,y+1.2,z-.5);
 yaw=camera.rotation.y;pitch=camera.rotation.x;
}
setEntrancePose();
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,2700);}
let loadPercent=0;
const loading=(text,percent=loadPercent)=>{loadPercent=Math.max(loadPercent,Math.min(100,percent));$('load-status').textContent=text;$('load-progress').value=loadPercent;$('load-percent').textContent=Math.floor(loadPercent)+'%';diagnostics.loadProgress={percent:loadPercent,stage:text};};
function refreshCoreProgress(){
 const jobs=diagnostics.coreJobs;if(!jobs?.length||jobs.every(r=>r.state==='loaded'))return;
 const stream=diagnostics.buildingStream;
 const fraction=jobs.reduce((sum,row,k)=>sum+(row.state==='loaded'?1:k===1&&stream?.loaded?Math.min(.95,stream.loaded/Math.max(1,stream.loaded+stream.pending+stream.errors)):0),0);
 loading('正在加载'+jobs.filter(r=>r.state==='loading').map(r=>r.name).join('、'),5+fraction*10);
}
loading('地图与故事已读取',5);
function applyLightingSettings(){
 const state=environment.update(lightingSettings);
 $('lighting-time-value').textContent=state.timeName;
 for(const key of ['time','intensity','shadow','ground','scatter','distanceFog','shadowTint','skyHue','skySaturation','skyLightness'])$('lighting-'+key).value=lightingSettings[key];
 for(const key of ['intensity','ground','scatter','distanceFog','shadowTint'])$('lighting-'+key+'-value').textContent=lightingSettings[key].toFixed(2);
 $('lighting-shadow-value').textContent=Math.round(state.shadow*100)+'%';
 for(const key of ['skyHue','skySaturation','skyLightness'])$('lighting-'+key+'-value').textContent=(lightingSettings[key]>0?'+':'')+lightingSettings[key]+(key==='skyHue'?'°':'%');
 $('cloud-style').value=lightingSettings.cloudStyle;$('cloud-density').value=lightingSettings.cloudDensity;$('cloud-density-value').textContent=Math.round(lightingSettings.cloudDensity*100)+'%';
 event('lighting-change',state);
}
function bindObject(object,id){object.userData.instanceId=id;interactables.push(object);}
function reduceDrawCalls(root){
 root.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(root.matrixWorld).invert(),groups=new Map(),retired=new Set();
 root.traverse(o=>{if(!o.isMesh||Array.isArray(o.material)||!o.visible)return;const g=o.geometry.clone();g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));const key=Boolean(o.userData.is_environment)+'|'+o.material.uuid+'|'+Object.keys(g.attributes).sort().join();if(!groups.has(key))groups.set(key,{mat:o.material,environment:!!o.userData.is_environment,geometries:[],originals:[]});const group=groups.get(key);group.geometries.push(g);group.originals.push(o);});
 for(const {mat,environment:embeddedEnvironment,geometries,originals} of groups.values()){
  let g;try{g=mergeGeometries(geometries);}finally{geometries.forEach(x=>x.dispose());}
  if(!g)continue; // A failed batch retains its original meshes.
  const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;m.userData.is_environment=embeddedEnvironment;m.userData.sourceElements=originals.map(o=>({name:o.name,elementId:o.userData.element_id??null,role:o.userData.paint_role??mat.userData.source_role??null}));m.name=mat.userData.source_role??originals[0]?.name??'building-part';root.add(m);
  for(const o of originals){o.removeFromParent();retired.add(o.geometry);}
 }
 const kept=new Set();root.traverse(o=>{if(o.isMesh)kept.add(o.geometry);});for(const g of retired)if(!kept.has(g))g.dispose();
 root.updateMatrixWorld(true);
}
async function loadStreamBuilding(entry){
 const i=instanceMap.get(entry.instanceId);
 if(i.representation==='source-model-r2')return loadSourceInstance(i);
 const handle=await loadBuilding(i.model,{THREE,GLTFLoader});
 try{
  const rotation=new THREE.Matrix4().makeRotationX(-Math.PI/2),rotated=new Set();
  handle.root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.uniforms?.uLight&&!rotated.has(m)){m.uniforms.uLight.value.transformDirection(rotation);rotated.add(m);}});
  reduceDrawCalls(handle.root);handle.root.traverse(o=>{if(o.isMesh)compactMesh(o);});
  const originalDispose=handle.dispose;let disposed=false;
  handle.dispose=()=>{if(disposed)return;disposed=true;handle.root.removeFromParent();originalDispose();handle.root.clear();};
  return handle;
 }catch(error){handle.dispose();throw error;}
}
function updateBuildingStatus(){
 const shops=[...buildingVisuals.values()].filter(v=>v.category==='shop').length,landmarks=buildingVisuals.size-shops,stream=diagnostics.buildingStream;
 $('building-status').textContent=`商店 ${showShopBuildings?'显示':'隐藏'} · ${shops} 个；地标 ${showLandmarkBuildings?'显示':'隐藏'} · ${landmarks} 个`+(stream?`；模型已载 ${stream.loaded}/${stream.total} · 待载 ${stream.pending} · 失败 ${stream.errors}`:'');
}
const streamFrustum=new THREE.Frustum(),streamVP=new THREE.Matrix4(),streamBox=new THREE.Box3();
function inStreamView(entry){camera.updateMatrixWorld();streamVP.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);streamFrustum.setFromProjectionMatrix(streamVP);streamBox.min.fromArray(entry.bounds.min);streamBox.max.fromArray(entry.bounds.max);streamBox.expandByScalar(3);return streamFrustum.intersectsBox(streamBox);}
function initBuildingStream(){
 for(const entry of streamingContract.buildings){
  const root=new THREE.Group();root.name='building-logical:'+entry.instanceId;root.userData.frozenWorldBounds=entry.bounds;root.userData.loadState='unloaded';world.add(root);bindObject(root,entry.instanceId);buildingLogicalRoots.set(entry.instanceId,root);
  if(entry.kind==='landmark'||entry.kind==='shop')buildingVisuals.set(entry.instanceId,{root,category:entry.kind});
 }
 if(buildingVisuals.size!==streamingContract.expectedBuildingVisibilityCount)throw Error('Building visibility registry changed');
 colliders.push(...streamingContract.buildingWalkColliders.map(row=>({...row})));
 const mobile=quality.profile==='mobile';environment.setStreamFog(mobile?{near:11,far:18}:{near:18,far:26});
 buildingStream=createBuildingStream({entries:streamingContract.buildings,radius:mobile?18:26,keepRadius:mobile?22:30,inView:inStreamView,concurrency:2,load:loadStreamBuilding,
  isVisible:entry=>buildingLogicalRoots.get(entry.instanceId).visible,
  onAttach(entry,handle){
   const root=buildingLogicalRoots.get(entry.instanceId);root.add(handle.root);root.updateMatrixWorld(true);
   const box=new THREE.Box3().setFromObject(root);for(const side of ['min','max'])box[side].toArray().forEach((value,k)=>{if(Math.abs(value-entry.bounds[side][k])>1e-5)throw Error('Building bounds changed: '+entry.instanceId);});
   if(handle.record){handle.record();diagnostics.r2Buildings=r2State.buildings;}else{loadedBuildings.push(handle);diagnostics.buildings.push({...handle.stats,instanceId:entry.instanceId,box:{min:box.min.toArray(),max:box.max.toArray()},size:box.getSize(new THREE.Vector3()).toArray()});}
   bevel.register(handle.root,{assetKey:entry.instanceId,kind:entry.kind});if(entry.kind==='landmark'&&!diagnostics.loading)prepareBevel();environment.install(handle.root);materialEditor.register(handle.root,entry.instanceId);handle.setEmbeddedLandscapeVisible?.(showLandscapeAll);applyBuildingLayer();renderer.shadowMap.needsUpdate=true;
  },
  onDetach(entry,handle){
   materialEditor.unregister(handle.root);bevel.unregister(handle.root);handle.root.removeFromParent();const at=loadedBuildings.indexOf(handle);if(at>=0)loadedBuildings.splice(at,1);
   const stat=diagnostics.buildings.findIndex(row=>row.instanceId===entry.instanceId);if(stat>=0)diagnostics.buildings.splice(stat,1);renderer.shadowMap.needsUpdate=true;
  },
  onChange(state){diagnostics.buildingStream=state;for(const row of state.rows)buildingLogicalRoots.get(row.id).userData.loadState=row.state;updateBuildingStatus();refreshCoreProgress();}
 });
 diagnostics.buildingCatalogue=streamingContract.buildings.map(r=>({id:r.instanceId,representation:r.representation,kind:r.kind,bounds:r.bounds}));
 applyBuildingLayer();return buildingStream.loadInitial(camera.position);
}
const textureCache=new Map();
async function texture(url){if(!textureCache.has(url))textureCache.set(url,textureUrl(url).then(u=>new THREE.TextureLoader().loadAsync(u)).then(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=2;return t;}));return textureCache.get(url);}
async function spriteFor(i){
 const layer=landscapeLayer.get(i.instanceId),display=layer?.displayBinding?.representation==='billboard'?layer.displayBinding.path:i.image;
 const map=new THREE.Texture(),w=i.body.size[0]/254.558441227,h=i.body.size[1]/254.558441227;
 const geometry=new THREE.PlaneGeometry(w,h);const ax=i.body.anchor[0]/i.body.size[0],ay=i.body.anchor[1]/i.body.size[1];geometry.translate((.5-ax)*w,(ay-.5)*h,0);
 const material=new THREE.MeshBasicMaterial({map,transparent:false,alphaTest:.2,side:THREE.DoubleSide,toneMapped:false});
 const mesh=new THREE.Mesh(geometry,material);mesh.position.fromArray(i.position);mesh.position.y+=.005;mesh.userData.basePosition=mesh.position.clone();if(i.representation==='proxy-pending-model'&&i.bounds)mesh.userData.proxyOffset=Math.max(i.bounds[2]-i.bounds[0],i.bounds[3]-i.bounds[1])*.32+.04;mesh.userData.sourceImage=display;mesh.userData.imageSize=[w,h];mesh.userData.alphaAnchor=[ax,ay];mesh.userData.landscapeLayer=layer??null;scene.add(mesh);billboards.push(mesh);bindObject(mesh,i.instanceId);if(layer)landscapeVisuals.set(i.instanceId,mesh);representations.billboard++;
 return mesh;
}
function proxyFor(i){
 const b=i.bounds;if(!b)return;
 const width=(b[2]-b[0])*.62,depth=(b[3]-b[1])*.62,height=Math.max(.5,Math.min(2.5,i.body.size[1]/254.558*.6));
 const group=new THREE.Group();group.position.set((b[0]+b[2])/2,height/2+.015,-(b[1]+b[3])/2);
 const colors=['#c3d5d1','#e6d2b4','#bdcad5','#d7c5b1'];const n=[...i.instanceId].reduce((a,c)=>a+c.charCodeAt(0),0);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),new THREE.MeshStandardMaterial({color:colors[n%4],roughness:1}));mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 const roof=new THREE.Mesh(new THREE.BoxGeometry(width+.08,.09,depth+.08),new THREE.MeshStandardMaterial({color:'#657d87',roughness:1}));roof.position.y=height/2;roof.castShadow=true;group.add(roof);scene.add(group);proxyRoots.push(group);bindObject(group,i.instanceId);
 colliders.push({id:i.instanceId,minX:group.position.x-width/2,maxX:group.position.x+width/2,minZ:group.position.z-depth/2,maxZ:group.position.z+depth/2});representations.proxy++;
}
function isProceduralLandscape(i){return !furnitureIds.has(i.instanceId)&&i.kind==='landscape'&&(/^(streetlight_|sign_)/i.test(i.sourceAssetId??'')||(i.sourceAssetId??'')==='story-graffiti');}
function addR3Root(i,built){const {group,width,depth}=built;group.userData.landscapeLayer=landscapeLayer.get(i.instanceId)??null;scene.add(group);bindObject(group,i.instanceId);r3Roots.push(group);if(i.kind==='shop'||i.kind==='landmark')buildingVisuals.set(i.instanceId,{root:group,category:i.kind});if(group.userData.landscapeLayer)landscapeVisuals.set(i.instanceId,group);if(width&&depth)colliders.push({id:i.instanceId,minX:group.position.x-width/2-.04,maxX:group.position.x+width/2+.04,minZ:group.position.z-depth/2-.04,maxZ:group.position.z+depth/2+.04});return group;}
function proceduralModels(){let shops=0,streetlights=0,signs=0,graffiti=0;for(const i of data.instances){if(i.kind==='shop'&&i.representation!=='source-model-r2'){addR3Root(i,buildShopModel(THREE,i));shops++;continue;}if(!isProceduralLandscape(i))continue;const built=/^streetlight_/i.test(i.sourceAssetId??'')?buildStreetlightModel(THREE,i):/^sign_/i.test(i.sourceAssetId??'')?buildSignModel(THREE,i):buildGraffitiModel(THREE,i);addR3Root(i,built);if(/^streetlight_/i.test(i.sourceAssetId??''))streetlights++;else if(/^sign_/i.test(i.sourceAssetId??''))signs++;else graffiti++;}diagnostics.r3Models={shops,streetlights,signs,graffiti,materials:'MeshStandardMaterial only; source image planes retired for these instances'};}
async function pictures(){const list=data.instances.filter(i=>(i.representation==='billboard'||i.representation==='image-pending-model')&&i.visible&&!furnitureIds.has(i.instanceId)&&i.kind!=='shop'&&i.kind!=='npc'&&!isProceduralLandscape(i));let done=0;
 for(let n=0;n<list.length;n+=12){await Promise.all(list.slice(n,n+12).map(async i=>{try{if(i.representation==='proxy-pending-model')proxyFor(i);await spriteFor(i);done++;}catch(e){fail(i.instanceId,e);}}));loading(`街边的人与物 ${done} / ${list.length}`);}
}
function pointUnresolved(record){return record.category==='unresolved'&&!furnitureIds.has(record.instanceId);}
function createLandscapePoints(){
 const groups=new Map();
 for(const record of landscapeLayer.values()){const unresolved=pointUnresolved(record),key=record.category+':'+unresolved;if(!groups.has(key))groups.set(key,{category:record.category,unresolved,rows:[]});groups.get(key).rows.push(record);}
 const colors={tree:'#5e986f',shrub:'#88a65f',flower:'#d68a98','street-furniture':'#7b8fa3',sign:'#d2a33e',lamp:'#d2b05f',seating:'#a8785b','paving-detail':'#9da8b2','water-edge':'#5aa7b5','npc-support':'#876e9d',unresolved:'#c7655e',landscape:'#547e8d'};
 for(const [key,{category,unresolved,rows}] of groups){
  const geometry=unresolved?new THREE.RingGeometry(.031,.049,16):new THREE.SphereGeometry(.045,6,4);
  const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color:colors[category]??colors.unresolved,side:THREE.DoubleSide,transparent:true,opacity:.9}),rows.length);
  mesh.userData={landscapeRows:rows,category,unresolved,markerShape:unresolved?'hollow-ring':'solid-sphere'};scene.add(mesh);landscapePointMeshes.set(key,mesh);
 }
 updateLandscapePointFacing();
}
const pointTransform=new THREE.Object3D(),pointFacing=new THREE.Quaternion(),identityPointRotation=new THREE.Quaternion();let pointFacingReady=false;
function updateLandscapePointFacing(){
 if(pointFacingReady&&pointFacing.equals(camera.quaternion))return;pointFacing.copy(camera.quaternion);
 for(const mesh of landscapePointMeshes.values()){
  if(pointFacingReady&&!mesh.userData.unresolved)continue;
  mesh.userData.landscapeRows.forEach((record,k)=>{pointTransform.position.fromArray(record.point.game_position);pointTransform.position.y+=.06;pointTransform.quaternion.copy(mesh.userData.unresolved?camera.quaternion:identityPointRotation);pointTransform.updateMatrix();mesh.setMatrixAt(k,pointTransform.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
 }
 pointFacingReady=true;
}
function applyBuildingLayer(){for(const {root,category} of buildingVisuals.values())root.visible=category==='shop'?showShopBuildings:showLandmarkBuildings;renderer.shadowMap.needsUpdate=true;updateBuildingStatus();}
function applyLandscapeLayer(){for(const handle of loadedBuildings)handle.setEmbeddedLandscapeVisible?.(showLandscapeAll);for(const [id,mesh]of landscapeVisuals){const r=landscapeLayer.get(id),categoryOk=landscapeCategoryFilter==='all'||r.category===landscapeCategoryFilter,optionalOk=showLandscapeOptional||r.visibilityPolicy!=='optional';mesh.visible=showLandscapeAll&&r.visibility!=='hidden'&&r.visibility!=='asset-missing'&&categoryOk&&optionalOk;mesh.userData.layerVisible=mesh.visible;}
 furnitureStream?.applyVisibility();
 for(const mesh of landscapePointMeshes.values())mesh.visible=showLandscapePoints&&(landscapeCategoryFilter==='all'||mesh.userData.category===landscapeCategoryFilter)&&(!mesh.userData.unresolved||showLandscapeUnresolved);
 for(const mesh of r2State.treeMeshes){const categoryOk=landscapeCategoryFilter==='all'||landscapeCategoryFilter==='tree';mesh.visible=showLandscapeAll&&categoryOk;}
 for(const mesh of r2State.grassMeshes){mesh.userData.layerVisible=showLandscapeAll;mesh.visible=showLandscapeAll;}
 for(const root of extraLandscapeRoots)root.visible=showLandscapeAll&&(landscapeCategoryFilter==='all'||landscapeCategoryFilter==='paving-detail');
 renderer.shadowMap.needsUpdate=true;
 const visible=showLandscapeAll?[...landscapeLayer.values()].filter(r=>r.visibility!=='hidden'&&r.visibility!=='asset-missing'&&(landscapeCategoryFilter==='all'||r.category===landscapeCategoryFilter)&&(!r.visibilityPolicy||showLandscapeOptional||r.visibilityPolicy!=='optional')).length:0;const unresolved=[...landscapeLayer.values()].filter(pointUnresolved).length;$('landscape-status').textContent=`${visible} 个显示项 · ${landscapeLayer.size} 个保留点位 · ${unresolved} 个待解析素材`;
}
function renderLandscapePanel(){const select=$('landscape-category');if(select.options.length===1){const cats=[...new Set([...landscapeLayer.values()].map(r=>r.category))].sort();for(const c of cats){const o=document.createElement('option');o.value=c;o.textContent=({tree:'树',shrub:'灌木','street-furniture':'街景家具',sign:'标牌',lamp:'路灯',seating:'座椅','npc-support':'行人支承',unresolved:'未解析'}[c]??c);select.append(o);}}select.value=landscapeCategoryFilter;$('building-shops').checked=showShopBuildings;$('building-landmarks').checked=showLandmarkBuildings;$('landscape-all').checked=showLandscapeAll;$('landscape-optional').checked=showLandscapeOptional;$('landscape-points').checked=showLandscapePoints;$('landscape-unresolved').checked=showLandscapeUnresolved;applyBuildingLayer();applyLandscapeLayer();}
async function roads(){
 const built=await buildV5Roads(data.roads);scene.add(built.group);groundRoots.push(built.group);
 scene.add(built.symbols);diagnostics.roads={...built.stats};
}
async function surfaces(){diagnostics.surfacePhase='ground-manifest';
 const [payload,publicPayload]=await Promise.all(['/data/base-indexed-r5/manifest.json','/data/public-base-indexed-r5/manifest.json'].map(u=>fetch(new URLSearchParams(location.search).has('fullTerrain')?u:u.replace('/manifest.json','.json').replace('/data/','/data/fast-r13/')).then(r=>r.json()))),mats=new Map(),url=new URL(payload.baseUrl,location.origin).href;
 payload.materials=publicPayload.materials;
 if(!new URLSearchParams(location.search).has('fullTerrain')){terrainStream=await createTerrainStream({loadMaterial:id=>{const def=payload.materials.find(d=>d.id===id);if(!def)throw Error("Missing ground material "+id);return makeMaterial(def,THREE,renderer,url,{lit:true});},world,camera,environment,diagnostics,stencilEnabled:renderer.getContext().getContextAttributes().stencil});groundRoots.push(...terrainStream.roots);diagnostics.ground={sourceMeshes:payload.sourceMeshes,recoveredPublicSurfaces:publicPayload.sourceMeshes,sourceGroundSha256:payload.sourceSha256,sourceGrassFields:payload.materials.filter(m=>m.shader==='grass-low-field').length,streamed:true,geometryLOD:'source boundary-preserving far geometry plus original near geometry',paving:'original indexed geometry streamed near camera'};diagnostics.surfacePhase='done';return;}
 for(let offset=0;offset<payload.materials.length;offset+=6){diagnostics.surfacePhase='materials-'+offset;await Promise.all(payload.materials.slice(offset,offset+6).map(async def=>{const material=await makeMaterial(def,THREE,renderer,url,{lit:true});mats.set(def.id,material);}));}
 const base=await loadBakedBase(payload,mats,THREE);world.add(base.group);groundRoots.push(base.group);
 const publicBase=await loadBakedBase(publicPayload,mats,THREE);world.add(publicBase.group);groundRoots.push(publicBase.group);
 const relief=await loadPavingRelief(mats,THREE);world.add(relief.group);groundRoots.push(relief.group);reliefRoots.push(relief.group);
 const recovered=await loadPavingRelief(mats,THREE,'/data/public-paving-indexed-r5/manifest.json');world.add(recovered.group);groundRoots.push(recovered.group);reliefRoots.push(recovered.group);
 diagnostics.surfacePhase='done';diagnostics.ground={...base.stats,...relief.stats,recoveredPublicSurfaces:publicPayload.sourceMeshes,recoveredSha256:publicPayload.sourceSha256,recoveredPaving:recovered.stats};
}
async function grasses(){
 const g=await fetch('/data/grass.json').then(r=>r.json()),matrix=new THREE.Matrix4();
 for(const model of g.models){const rows=g.tufts.filter(t=>t.modelId===model.id),geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(model.vertices.flat(),3));geom.setIndex(model.triangles.flat());geom.computeVertexNormals();const mat=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});const mesh=new THREE.InstancedMesh(geom,mat,rows.length);rows.forEach((t,k)=>{matrix.set(...t.matrix);mesh.setMatrixAt(k,matrix);mesh.setColorAt(k,new THREE.Color().setRGB(...(t.color??[.56,.75,.49]),THREE.SRGBColorSpace));});mesh.computeBoundingSphere();world.add(mesh);}
 diagnostics.grass={tufts:g.tufts.length,models:g.models.length};
}
function markers(){
 const mat=new THREE.MeshBasicMaterial({color:'#ebc977',side:THREE.DoubleSide});
 for(const s of data.stories.filter(s=>s.kind==='road')){const marker=new THREE.Mesh(new THREE.RingGeometry(.07,.105,24),mat);marker.rotation.x=-Math.PI/2;marker.position.fromArray(s.position);marker.position.y=.004;marker.userData.storyId=s.storyId;scene.add(marker);interactables.push(marker);storyMarkers.push(marker);}
}
function openRoadEncounter(cell,position){
 const id='r20-road-'+cell;const nearest=npcDay?.snapshot().npcs.slice().sort((a,b)=>Math.hypot(a.position[0]-position[0],a.position[2]-position[2])-Math.hypot(b.position[0]-position[0],b.position[2]-position[2]))[0],profile=npcDay?.payload.profiles.find(p=>p.id===nearest?.id);
 const source=profile?`${profile.name} · ${nearest.action}`:'街角的人们正在交换今天的小发现。';
 storyMap.set(id,{storyId:id,kind:'road',title:'街角相遇',status:'authored-draft',sourceStatus:'road-glyph-linked-draft',parcelIds:[],memberIds:profile?[profile.id]:[],entryNodeId:'start',nodes:[{nodeId:'start',text:source+'。\n停一停，听听这条街今天发生了什么。',choices:[{choiceId:'listen',text:'听听今天的故事',nextNodeId:'talk'},{choiceId:'leave',text:'继续前进',effects:[]}]},{nodeId:'talk',text:profile?(profile.sourceBehavior??profile.personality):'有人打了个招呼，有人笑着让出一小块阴凉。',choices:[{choiceId:'leave',text:'记下这次相遇',effects:[]}]}]});
 try{localStorage.setItem('qianyu-pending-road-r20',JSON.stringify({cell,position}));}catch{}openStory(id);
}
function setDialogOpen(open){document.body.classList.toggle('dialog-open',open);keys.clear();if(open&&$('npc-hover-r20'))$('npc-hover-r20').hidden=true;hud.state(open?'interaction':editorMode?'edit':'play');playerBoard?.setEnabled(started&&!open&&!editorMode);}
function resetStoryFollowup(){const box=$('story-followup');if(!box)return;box.hidden=true;$('story-media').hidden=true;$('story-image').removeAttribute('src');$('story-joke').textContent='';$('story-media-caption').textContent='';}
function showStoryFollowup(){const s=activeStory,doc=plazaDocs.get(s?.storyId),box=$('story-followup');if(!box)return;box.hidden=false;const image=doc?.assets?.[0];$('story-image-open').hidden=!image;$('story-joke-open').hidden=!doc?.two_lines?.length;$('story-image-open').onclick=()=>{if(!image)return;$('story-media').hidden=false;$('story-image').src=window.qianyuAssetUrl(image.url);$('story-image').alt=doc.name+' · 景观素材图';$('story-joke').textContent='';$('story-media-caption').textContent=`素材图：${image.name||'现场景观'} · ${doc.source_document?.selector??'景观文档'}`;event('plaza-image-open',{storyId:s.storyId,image:image.url});};$('story-joke-open').onclick=()=>{if(!doc)return;$('story-media').hidden=false;$('story-image').removeAttribute('src');$('story-joke').textContent=(doc.two_lines??[]).join('\n');$('story-media-caption').textContent=`两行冷笑话 · ${doc.name} · ${doc.source_document?.selector??'景观文档'}`;event('plaza-joke-open',{storyId:s.storyId});};$('story-followup-close').onclick=closeStory;}
function closeStory(){if(activeStory?.storyId?.startsWith('r20-road-')){try{localStorage.removeItem('qianyu-pending-road-r20');}catch{}}if(activeStory)event('dialogue-close',{storyId:activeStory.storyId,node:currentNode});resetStoryFollowup();$('dialogue').hidden=true;activeStory=null;setDialogOpen(false);previousFocus?.focus?.();}
function openStory(storyId){const s=storyMap.get(storyId);if(!s)return;previousFocus=document.activeElement;activeStory=s;currentNode=progress.nodes[storyId]??s.entryNodeId;if(!s.nodes.some(n=>n.nodeId===currentNode))currentNode=s.entryNodeId;progress.visited[storyId]=new Date().toISOString();persist();$('dialogue').hidden=false;$('book').hidden=true;$('help-panel').hidden=true;setDialogOpen(true);event('dialogue-open',{storyId,kind:s.kind,sourceStatus:s.sourceStatus});renderStory();}
function renderStory(){const s=activeStory,n=s.nodes.find(n=>n.nodeId===currentNode);resetStoryFollowup();$('story-label').textContent=s.status==='source-content'?(plazaDocs.has(s.storyId)?'景观广场文档 · 原叙事提案':'街角故事 · 原叙事提案'):'漫游对白 · 演示草稿';$('story-title').textContent=s.title;$('story-place').textContent=s.parcelIds.map(id=>parcelMap.get(id)?.name).filter(Boolean).slice(0,2).join(' / ')||'街区公共空间';$('story-text').textContent=n.text;$('choices').replaceChildren();
 for(const c of n.choices??[]){const b=document.createElement('button');b.textContent=c.text;b.dataset.choiceId=c.choiceId;b.onclick=()=>choose(c);$('choices').append(b);}
 const actor=activeStory.memberIds?.find(id=>id.startsWith('npc-'))??activeStory.source?.instanceId;
 $('story-day').textContent=npcDay?.describe(actor)?.split('\n')[0]??'';
 $('story-day').hidden=!$('story-day').textContent;
 $('story-source').querySelector('p').textContent=s.status==='source-content'?(plazaDocs.has(s.storyId)?`已调用景观广场文档（${plazaDocs.get(s.storyId).source_document?.selector??'当前条目'}），对话完成后可查看现场图和两行冷笑话。源状态：叙事提案，几何未改变。`:`标题与短句来自现行地图叙事（${s.source.current.selector}）。源状态：叙事提案，几何未改变。选项与进度效果为本原型演示草稿。`):'这段对白是本游戏的演示草稿，不是原地图已有的角色剧情；只记录本地漫游选择。';if(s.source?.npcLibrary){$('story-label').textContent='人物原设定 · NPC库';$('story-source').querySelector('p').textContent='身份、职业、驱动力和默认行为来自 NPC库-20261113-025322.xlsx（'+s.source.cell+' 对应行）。具体日程与可玩对白连接句为新增设计草稿。';}$('story-source').open=false;$('choices').firstElementChild?.focus();
}
function choose(c){if(activeStory.storyId.startsWith('r20-road-')&&!c.nextNodeId){closeStory();return;}const id=activeStory.storyId;progress.choices[id]??=[];progress.choices[id].push(c.choiceId);for(const effect of c.effects??[]){if(effect.type==='complete')progress.completed[id]=new Date().toISOString();if(effect.type==='bookmark')progress.bookmarks[id]=true;}
 event('choice',{storyId:id,choiceId:c.choiceId,effects:c.effects,next:c.nextNodeId});if(c.nextNodeId){currentNode=c.nextNodeId;progress.nodes[id]=currentNode;persist();renderStory();}else{progress.nodes[id]='start';persist();$('choices').replaceChildren();$('story-text').textContent=progress.completed[id]?'已收进漫游手记。':'已记下这个地方。';showStoryFollowup();toast(progress.completed[id]?'已收进漫游手记':'已记下这个地方');}renderBook();
}
function openInstance(id){const i=instanceMap.get(id);if(!i)return;event('object-click',{instanceId:id,kind:i.kind,parcelIds:i.parcelIds,representation:i.representation});if(i.storyIds.length){openStory(i.storyIds[0]);return;}toast(i.name+'：故事还在编写中');}
const kindLabel={building:'建筑',npc:'行人',landscape:'街角',road:'道路'};
function renderBook(){const q=$('search').value.trim().toLowerCase(),items=[...storyMap.values()].filter(s=>(filter==='all'||s.kind===filter||filter==='saved'&&(progress.completed[s.storyId]||progress.bookmarks[s.storyId]))&&(!q||(s.title+' '+s.nodes[0].text).toLowerCase().includes(q)));$('entries').replaceChildren();for(const s of items){const row=document.createElement('div');row.className='entry';const text=document.createElement('button');text.className='entry-text';const title=document.createElement('b');title.textContent=(progress.completed[s.storyId]?'✓ ':'')+s.title;const small=document.createElement('small');small.textContent=kindLabel[s.kind]+' · '+(s.status==='source-content'?'叙事提案':'演示草稿');text.append(title,small);text.onclick=()=>openStory(s.storyId);const go=document.createElement('button');go.className='go';go.textContent='去这里';go.dataset.story=s.storyId;go.onclick=()=>travel(s);row.append(text,go);$('entries').append(row);}$('book-count').textContent=items.length+' 处可停留';}
function isBlocked(x,z){if(free)return false;const r=.075;return colliders.some(b=>!b.disabled&&x>b.minX-r&&x<b.maxX+r&&z>b.minZ-r&&z<b.maxZ+r);}
function floorHeight(x,z){if(groundSampler){const cached=groundSampler.heightAt(x,z);if(cached!==null)return cached;}const ray=new THREE.Raycaster(new THREE.Vector3(x,5,z),new THREE.Vector3(0,-1,0),0,5.1);const height=ray.intersectObjects(groundRoots,true)[0]?.point.y??0;groundSampler?.remember(x,z,height);return height;}
function safeNear(pos,dist=1.8){for(const d of [dist,dist+1,dist+2,dist+4])for(let a=0;a<Math.PI*2;a+=Math.PI/4){const x=pos[0]+Math.sin(a)*d,z=pos[2]+Math.cos(a)*d;if(!isBlocked(x,z))return [x,floorHeight(x,z)+.60,z];}return [...data.spawn];}
function travel(s){free=false;const moving=s.kind==='npc'?billboards.find(o=>s.memberIds?.includes(o.userData.instanceId)):null,target=moving?.position.toArray()??s.position;const p=safeNear(target,s.kind==='building'?2.7:1.2);camera.position.fromArray(p);yaw=Math.atan2(p[0]-target[0],p[2]-target[2]);pitch=-.06;camera.rotation.set(pitch,yaw,0,'YXZ');$('book').hidden=true;setModeUI();buildingStream?.update(camera.position,true);event('travel',{storyId:s.storyId,position:p});toast(s.title);canvas.focus();}
function setModeUI(){hud.refreshButton('mode','camera',free?'返回街景':'自由观察');$('walk-mode').textContent=free?'自由观察':'街景漫游';}
function toggleMode(){free=!free;if(free){camera.position.y+=7;pitch=-.65;}else{if(isBlocked(camera.position.x,camera.position.z))camera.position.fromArray(safeNear(camera.position.toArray()));camera.position.y=floorHeight(camera.position.x,camera.position.z)+.6;pitch=-.06;}setModeUI();event('mode',{free});}
$('start').onclick=()=>{if(window.mobileLandscape?.blocked||!diagnostics.startupCheck?.ready||$('start').disabled)return;started=true;playerBoard?.setEnabled(!editorMode);$('welcome').hidden=true;try{const pending=JSON.parse(localStorage.getItem('qianyu-pending-road-r20'));if(pending)openRoadEncounter(pending.cell,pending.position);}catch{}canvas.focus();event('start');};$('mode').onclick=toggleMode;$('home').onclick=()=>{closeStory();focusPlayer();event('home');};$('journal').onclick=()=>{$('book').hidden=!$('book').hidden;renderBook();if(!$('book').hidden)$('search').focus();};$('book-close').onclick=()=>$('book').hidden=true;$('dialogue-close').onclick=closeStory;$('help').onclick=()=>$('help-panel').hidden=!$('help-panel').hidden;$('help-close').onclick=()=>$('help-panel').hidden=true;$('search').oninput=renderBook;
function setSettingsOpen(open){$('landscape-panel').hidden=!open;$('landscape-toggle').setAttribute('aria-expanded',String(open));if(open){$('book').hidden=true;renderLandscapePanel();}else $('landscape-toggle').focus();}
$('landscape-toggle').onclick=()=>setSettingsOpen($('landscape-panel').hidden);$('landscape-close').onclick=()=>setSettingsOpen(false);
$('player-visible').onchange=async e=>{const wanted=e.target.checked;$('player-visibility-status').textContent=wanted?'正在加载棋子…':'';try{await playerBoard?.setVisible(wanted);$('player-visibility-status').textContent=playerBoard?.snapshot().modelState==='error'?'棋子加载失败，请取消后重新勾选。':'';hud.refreshButton('home','home',playerBoard?.snapshot().visible?'找到棋子':'返回落点');}catch(error){$('player-visibility-status').textContent='棋子加载失败，请取消后重新勾选。';event('pawn-load-failed',{message:String(error)});}};
for(const key of ['skyHue','skySaturation','skyLightness'])$('lighting-'+key).oninput=e=>{lightingSettings[key]=Number(e.target.value);applyLightingSettings();};
$('cloud-style').onchange=e=>{lightingSettings.cloudStyle=e.target.value;applyLightingSettings();};$('cloud-density').oninput=e=>{lightingSettings.cloudDensity=Number(e.target.value);applyLightingSettings();};

for(const button of document.querySelectorAll('[data-weather]'))button.onclick=()=>{weather.setMode(button.dataset.weather);document.querySelectorAll('[data-weather]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));event('weather-change',weather.snapshot());};
$('landscape-category').onchange=e=>{landscapeCategoryFilter=e.target.value;applyLandscapeLayer();};$('building-shops').onchange=e=>{showShopBuildings=e.target.checked;applyBuildingLayer();};$('building-landmarks').onchange=e=>{showLandmarkBuildings=e.target.checked;applyBuildingLayer();};$('landscape-all').onchange=e=>{showLandscapeAll=e.target.checked;applyLandscapeLayer();};$('landscape-optional').onchange=e=>{showLandscapeOptional=e.target.checked;applyLandscapeLayer();};$('landscape-points').onchange=e=>{showLandscapePoints=e.target.checked;applyLandscapeLayer();};$('landscape-unresolved').onchange=e=>{showLandscapeUnresolved=e.target.checked;applyLandscapeLayer();};
for(const id of ['lighting-time','lighting-intensity','lighting-shadow','lighting-ground','lighting-scatter','lighting-distanceFog','lighting-shadowTint'])$(id).addEventListener('input',e=>{const key={ 'lighting-time':'time','lighting-intensity':'intensity','lighting-shadow':'shadow','lighting-ground':'ground','lighting-scatter':'scatter','lighting-distanceFog':'distanceFog','lighting-shadowTint':'shadowTint'}[id];lightingSettings[key]=Number(e.target.value);applyLightingSettings();});
$('filters').onclick=e=>{if(!e.target.dataset.filter)return;filter=e.target.dataset.filter;for(const b of $('filters').children)b.setAttribute('aria-pressed',b===e.target);renderBook();};
$('reset').onclick=()=>{if($('reset').dataset.confirm!=='yes'){$('reset').dataset.confirm='yes';$('reset').textContent='再次点击，清空记录';setTimeout(()=>{$('reset').dataset.confirm='';$('reset').textContent='重置漫游记录';},4000);return;}progress={visited:{},completed:{},bookmarks:{},nodes:{},choices:{}};persist();closeStory();renderBook();$('reset').textContent='重置漫游记录';$('reset').dataset.confirm='';event('reset');toast('漫游记录已重置');};
window.addEventListener('qianyu-orientation',()=>{keys.clear();pointer.down=false;orbit.pivot=null;});
window.addEventListener('keydown',e=>{if(window.mobileLandscape?.blocked)return;if(activeStory&&e.key==='Tab'){const items=[...$('dialogue').querySelectorAll('button,summary')].filter(x=>x.offsetParent!==null);let index=items.indexOf(document.activeElement);index=(index+(e.shiftKey?-1:1)+items.length)%items.length;items[index]?.focus();e.preventDefault();return;}if(e.key==='Escape'){buildingEditor?.cancelPick();if(!$('landscape-panel').hidden)setSettingsOpen(false);closeStory();$('book').hidden=true;$('help-panel').hidden=true;return;}if(e.target.tagName==='INPUT')return;if(['Tab','Enter',' '].includes(e.key)&&e.target!==canvas)return;const k=e.key.toLowerCase();if(!e.repeat&&k==='f')toggleMode();if(!e.repeat&&k==='e'&&hovered)activateHit(hovered);if(['w','a','s','d','q','r','shift','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault();}});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());
 let pointer={x:0,y:0,down:false,moved:0,startX:0,startY:0,button:0};
 let orbit={pivot:null,radius:0,azimuth:0,elevation:0};
canvas.addEventListener('contextmenu',e=>e.preventDefault());
  function orbitPivotAt(x,y){
   raycaster.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,-y/innerHeight*2+1),camera);
   const targets=[...groundRoots,...interactables];
   const hit=raycaster.intersectObjects(targets,true).find(h=>isDisplayed(h.object)&&alphaHit(h));
   if(hit)return hit.point.clone();
   const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),fallback=new THREE.Vector3();
   return raycaster.ray.intersectPlane(plane,fallback)??camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),4);
  }
  function beginOrbit(x,y){
   const pivot=orbitPivotAt(x,y),offset=camera.position.clone().sub(pivot),radius=Math.max(.25,offset.length());
   orbit={pivot,radius,azimuth:Math.atan2(offset.x,offset.z),elevation:Math.asin(THREE.MathUtils.clamp(offset.y/radius,-1,1))};
  }
  function updateOrbit(dx,dy){
   if(!orbit.pivot)return;
   orbit.azimuth-=dx*.003;
   orbit.elevation=THREE.MathUtils.clamp(orbit.elevation+dy*.003,-1.35,1.15);
   const horizontal=orbit.radius*Math.cos(orbit.elevation);
   camera.position.set(orbit.pivot.x+horizontal*Math.sin(orbit.azimuth),orbit.pivot.y+orbit.radius*Math.sin(orbit.elevation),orbit.pivot.z+horizontal*Math.cos(orbit.azimuth));
   const direction=orbit.pivot.clone().sub(camera.position);
   yaw=Math.atan2(-direction.x,-direction.z);
   pitch=Math.atan2(direction.y,Math.hypot(direction.x,direction.z));
  }
  canvas.addEventListener('pointerdown',e=>{pointer={...pointer,down:true,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moved:0,button:e.button};if(e.button===2&&started&&!activeStory)beginOrbit(e.clientX,e.clientY);canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(pointer.down&&started&&!activeStory){const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.moved+=Math.abs(dx)+Math.abs(dy);if(pointer.button===2)updateOrbit(dx,dy);else if(pointer.button===0){yaw-=dx*.003;pitch=THREE.MathUtils.clamp(pitch-dy*.003,-1.4,1.2);}}pointer.x=e.clientX;pointer.y=e.clientY;});
  canvas.addEventListener('pointerup',e=>{if(pointer.down&&pointer.moved<6&&e.button===0&&started){const hit=pick(e.clientX,e.clientY);if(hit)activateHit(hit);}pointer.down=false;if(e.button===2)orbit.pivot=null;});
canvas.addEventListener('wheel',e=>{if(!started||activeStory)return;e.preventDefault();camera.fov=THREE.MathUtils.clamp(camera.fov+e.deltaY*.035,35,82);camera.updateProjectionMatrix();event('camera-zoom',{fov:camera.fov});},{passive:false});
for(const b of document.querySelectorAll('[data-key]')){b.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(b.dataset.key);b.setPointerCapture(e.pointerId);});b.addEventListener('pointerup',()=>keys.delete(b.dataset.key));b.addEventListener('pointercancel',()=>keys.delete(b.dataset.key));}
const raycaster=new THREE.Raycaster();
function alphaHit(hit){const batched=spriteBatches?.alphaHit(hit);if(batched!==undefined)return batched;const m=hit.object.material;if(!m?.map||!hit.uv)return true;const img=m.map.image;if(!img)return true;if(!m.userData.pixels){try{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);m.userData.pixels=ctx.getImageData(0,0,c.width,c.height);}catch{return true;}}const p=m.userData.pixels,x=THREE.MathUtils.clamp(Math.floor(hit.uv.x*p.width),0,p.width-1),y=THREE.MathUtils.clamp(Math.floor((1-hit.uv.y)*p.height),0,p.height-1);return p.data[(y*p.width+x)*4+3]>50;}
function isDisplayed(object){for(let current=object;current;current=current.parent)if(!current.visible)return false;return true;}
function pick(x,y){raycaster.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,-y/innerHeight*2+1),camera);const hits=raycaster.intersectObjects(interactables,true);return hits.find(h=>isDisplayed(h.object)&&h.distance<(free?80:12)&&alphaHit(h))??null;}
function hitIdentity(hit){let o=hit.object;while(o&&!o.userData.instanceId&&!o.userData.storyId&&!o.userData.instanceIds)o=o.parent;if(o?.userData?.instanceIds&&hit.instanceId!=null)return {instanceId:o.userData.instanceIds[hit.instanceId]};return o?.userData??{};}
function activateHit(hit){const id=hitIdentity(hit);if(id.instanceId&&buildingEditor.consumeHit(id.instanceId))return;if(id.instanceId)openInstance(id.instanceId);else if(id.storyId){event('road-click',{storyId:id.storyId});openStory(id.storyId);}}
const mini=$('minimap').getContext('2d');
function drawMap(){const c=$('minimap'),scale=2.35,cx=c.width/2,cy=c.height/2,x=playerBoard?.position()[0]??camera.position.x,z=playerBoard?.position()[2]??camera.position.z;mini.clearRect(0,0,c.width,c.height);mini.save();mini.translate(cx,cy);mini.fillStyle='#aebdbb';for(const r of data.roads)mini.fillRect((r.center[0]-x)*scale,(-r.center[1]-z)*scale,3,3);for(const p of data.parcels.filter(p=>p.type!=='public-ground')){const b=p.bounds;mini.fillStyle=p.type==='landmark'?'#7da2a7':'#c5c9b5';mini.fillRect((b[0]-x)*scale,(-b[3]-z)*scale,(b[2]-b[0])*scale,(b[3]-b[1])*scale);}mini.rotate(-yaw);mini.fillStyle='#2b6489';mini.beginPath();mini.moveTo(0,-8);mini.lineTo(-5,6);mini.lineTo(5,6);mini.closePath();mini.fill();mini.restore();}
const frameBudget=createMobileFrameBudget(renderer,{enabled:quality.profile==='mobile',maxRatio:quality.pixelRatio});
let last=performance.now(),frame=0,lastFloor=0,lastHover=0;
function animate(now){requestAnimationFrame(animate);if(document.hidden)return;const elapsed=now-last,dt=Math.min(elapsed/1000,.05);last=now;if(window.mobileLandscape?.blocked)return;frame++;if(frame>30){diagnostics.frameTimes.push(elapsed);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();}
 if(diagnostics.loading)return;
 frameBudget.sample(elapsed,now,{active:started,busy:!!(diagnostics.buildingStream?.pending||diagnostics.terrainStream?.queued||diagnostics.terrainStream?.farStreaming?.pending)});
 if(started&&editorMode&&!activeStory&&$('book').hidden&&$('help-panel').hidden){const speed=(keys.has('shift')?3:1.5)*(free?3:1)*dt;let f=Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown')),r=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));if(f&&r){f*=Math.SQRT1_2;r*=Math.SQRT1_2;}const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*speed,dz=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*speed;if(!isBlocked(camera.position.x+dx,camera.position.z))camera.position.x+=dx;if(!isBlocked(camera.position.x,camera.position.z+dz))camera.position.z+=dz;if(free)camera.position.y=THREE.MathUtils.clamp(camera.position.y+(Number(keys.has('r'))-Number(keys.has('q')))*speed,.15,60);else if((f||r)&&now-lastFloor>150){camera.position.y=floorHeight(camera.position.x,camera.position.z)+.60;lastFloor=now;}camera.position.x=THREE.MathUtils.clamp(camera.position.x,-20,52);camera.position.z=THREE.MathUtils.clamp(camera.position.z,-48,20);}
 hud.update(Math.min(elapsed/1000,.25),npcDay?.minute()??480);
 playerBoard?.update(activeStory?0:Math.min(elapsed/1000,.25));
 npcDay?.update(elapsed/1000, playerBoard?.position()??camera.position.toArray());
 weather.update(dt,camera);environment.tick?.(camera,now/1000);
 camera.rotation.set(pitch,yaw,0,'YXZ');for(const mesh of billboards){const base=mesh.userData.basePosition;mesh.rotation.y=Math.atan2(camera.position.x-base.x,camera.position.z-base.z);if(mesh.userData.proxyOffset)mesh.position.set(base.x+Math.sin(mesh.rotation.y)*mesh.userData.proxyOffset,base.y,base.z+Math.cos(mesh.rotation.y)*mesh.userData.proxyOffset);}for(const b of loadedBuildings)b.updateCamera(camera);if(frame%6===0){updateVegetation(camera,diagnostics);npcDay?.project(camera);}
 if(now-lastHover>750&&started&&!activeStory){lastHover=now;hovered=pick(innerWidth/2,innerHeight/2);const h=hovered?hitIdentity(hovered):{};$('hover').hidden=!hovered;$('hover').textContent=(instanceMap.get(h.instanceId)?.name??storyMap.get(h.storyId)?.title??'')+'　E 交谈';const nearby=data.parcels.filter(p=>p.type!=='public-ground').find(p=>camera.position.x>=p.bounds[0]&&camera.position.x<=p.bounds[2]&&-camera.position.z>=p.bounds[1]&&-camera.position.z<=p.bounds[3]);$('location').textContent=nearby?.name??'在街区里，慢慢走。';drawMap();}
 if(frame%6===0){let visible=0,total=0;for(const group of reliefRoots)for(const mesh of group.children){const sphere=mesh.geometry.boundingSphere,dx=sphere.center.x-camera.position.x,dy=sphere.center.y+camera.position.z;const reach=18+sphere.radius;mesh.visible=dx*dx+dy*dy<reach*reach;if(mesh.visible)visible++;total++;}diagnostics.reliefLod={nearDistanceU:18,visible,total,farSurfaceRetained:true};}buildingStream?.update(camera.position);terrainStream?.update();if(furnitureStream?.update())renderer.shadowMap.needsUpdate=true;if(spriteBatches)diagnostics.spriteBatch=spriteBatches.update();updateLandscapePointFacing();if(soloId)for(const o of soloRestore.keys())if(o!==world&&!o.isLight)o.visible=o.userData.instanceId===soloId;materialEditor.beforeRender(now);outlines.render();
}
 requestAnimationFrame(animate);markers();drawMap();
proceduralModels();
 const coreNames=['道路','建筑','街边素材','地面','树木','草地'];
 diagnostics.coreJobs=coreNames.map(name=>({name,state:'loading',startedAt:performance.now()}));refreshCoreProgress();
 const jobs=await Promise.allSettled([roads(),initBuildingStream(),pictures(),surfaces(),addTrees({world,interactables,diagnostics}),addGrass({world,diagnostics})].map((job,k)=>job.then(value=>{Object.assign(diagnostics.coreJobs[k],{state:'loaded',finishedAt:performance.now()});refreshCoreProgress();return value;},error=>{Object.assign(diagnostics.coreJobs[k],{state:'failed',finishedAt:performance.now(),error:String(error)});refreshCoreProgress();throw error;})));jobs.forEach((r,k)=>{if(r.status==='rejected')fail('load-job-'+k,r.reason);});
 loading('正在检查落点支承面',65);
const furnitureObstacles=[];
scene.updateMatrixWorld(true);
groundSampler=await loadGroundSampler(groundRoots);diagnostics.groundSampler=groundSampler.stats;
// Full-scene placement was validated before streaming; only restore its frozen transforms here.
const arrayManifest=await fetch('/data/street-arrays-r17.json').then(r=>{if(!r.ok)throw Error('Street array catalogue missing');return r.json();});
furnitureStream=createFurnitureStream({materialEditor,arrayManifest,onArrayRoot:(spec,root,box)=>{colliders.push({id:spec.id,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z,disabled:true});},onVisibility:(id,visible)=>{const c=colliders.find(c=>c.id===id);if(c)c.disabled=!visible;},payload:furniturePayload,contract:streamingContract,scene,camera,interactables,environment,diagnostics,inView:inStreamView,radius:quality.profile==='mobile'?18:26,keepRadius:quality.profile==='mobile'?22:30,onDirty:()=>{renderer.shadowMap.needsUpdate=true;},onRoot:(spec,root,box)=>{
 root.userData.landscapeLayer=landscapeLayer.get(spec.id);bindObject(root,spec.id);landscapeVisuals.set(spec.id,root);
 colliders.push({id:spec.id,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z});
}});
furnitureRows=furnitureStream.rows;applyLandscapeLayer();buildingEditor.updateArray();await furnitureStream.loadInitial();
loading('附近景观模型已加载',75);
diagnostics.furniture.retiredProcedural=furniturePayload.rows.filter(r=>/^(streetlight_|sign_)/.test(r.sourceAssetId)).length;diagnostics.furniture.retiredBillboards=furniturePayload.rows.length-diagnostics.furniture.retiredProcedural;diagnostics.furniture.obstacleBoxes=streamingContract.fullSceneValidation.obstacleBoxes;diagnostics.furniture.activeObstacleBoxesRecomputed=0;
if(colliders.filter(c=>!c.id.startsWith('array:')).length!==streamingContract.expectedWalkColliders)throw Error('Walk collider count changed: '+colliders.length);
for(const road of data.roads)groundSampler.heightAt(road.center[0],-road.center[1]);groundSampler.release();
for(const root of groundRoots)environment.install(root,true);environment.install(baseGround,true);environment.install(scene);
applyLandscapeLayer();
spriteBatches=await createSpriteBatches({scene,billboards,interactables,profile:quality.profile,camera,radius:quality.profile==='mobile'?18:26,keepRadius:quality.profile==='mobile'?22:30});if(spriteBatches.skipped.length)throw Error('Sprite atlas missing '+JSON.stringify(spriteBatches.skipped));diagnostics.spriteBatch=spriteBatches.visibleCounts();
loading('场景图集已加载',85);
createLandscapePoints();applyBuildingLayer();applyLandscapeLayer();applyLightingSettings();
for(const key of Object.keys(representations))representations[key]=0;for(const i of data.instances)representations[i.representation]=(representations[i.representation]??0)+1;
npcDay=await createNpcDay({scene,objects:billboards,interactables,locations:instanceMap,onFocus:position=>{
 camera.position.set(position[0]+4,position[1]+5,position[2]+5);camera.lookAt(...position);yaw=camera.rotation.y;pitch=camera.rotation.x;free=true;setModeUI();buildingStream?.update(camera.position,true);
},onEvent:entry=>{
 event('npc-event-card',{id:entry.id,type:entry.type,participants:entry.participants,position:entry.position,minute:npcDay?.snapshot().minute});
 $('day-event-title').textContent=entry.title;
 $('day-event-context').textContent=(entry.participantNames??[]).join(' · ')+'\n'+entry.locationName+' · '+String(Math.floor(entry.start/60)).padStart(2,'0')+':'+String(entry.start%60).padStart(2,'0')+' — '+String(Math.floor(entry.end/60)).padStart(2,'0')+':'+String(entry.end%60).padStart(2,'0');$('day-event-text').textContent=entry.cause+'\n'+entry.original+'\n'+entry.revised;$('day-event-card').hidden=false;
}});
// Old appearance-only draft people are retained in the source data, not reassigned to the new identities.
for(const [id,story] of storyMap)if(story.kind==='npc')storyMap.delete(id);
for(const profile of npcDay.payload.profiles){
 const id='r20-person-'+profile.id,position=profile.sourcePosition;
 instanceMap.set(profile.id,{instanceId:profile.id,kind:'npc',name:profile.name,position,storyIds:[id],parcelIds:[],representation:'code-model-r20'});
 storyMap.set(id,{storyId:id,kind:'npc',title:profile.name+' · '+profile.occupation,status:'authored-draft',sourceStatus:'user-workbook-with-draft-dialogue',position,memberIds:[profile.id],parcelIds:[],entryNodeId:'start',source:{npcLibrary:true,cell:profile.sourceCell},nodes:[{nodeId:'start',text:profile.sourceBehavior,choices:[{choiceId:'ask',text:'今天想做些什么？',nextNodeId:'today'},{choiceId:'bye',text:'下次再聊',effects:[]}]},{nodeId:'today',text:'「'+profile.personality+'」\n今天先把手边的事做好，再去广场见见熟悉的街坊。（对白连接句为新增草稿）',choices:[{choiceId:'bye',text:'祝你今天顺利',effects:[]}]}]});
}
for(const profile of npcDay.payload.profiles){
 const story=storyMap.get('r20-person-'+profile.id),relationships=npcDay.payload.relationships.filter(r=>r.participants.includes(profile.id));
 if(relationships.length){story.nodes[0].choices.splice(1,0,{choiceId:'relations',text:'你和街坊们的关系',nextNodeId:'relations'});story.nodes.push({nodeId:'relations',text:relationships.map(r=>r.source.a+' ↔ '+r.source.b+'：'+r.source.fields['关系描述'].value).join('\n\n')+'\n（人物按关系键对应；原文中的旧称保留在出处记录中。）',choices:[{choiceId:'back',text:'再聊聊今天',nextNodeId:'today'}]});}
}
for(const mesh of npcDay.models.batches)environment.install(mesh);
$('npc-visible').checked=npcDay.snapshot().visible;$('npc-visible').onchange=e=>{npcDay.setVisible(e.target.checked);renderer.shadowMap.needsUpdate=true;event('npc-visibility',{visible:e.target.checked});};
let npcHoverTime=0;canvas.addEventListener('pointermove',e=>{if(!started||activeStory||e.buttons||performance.now()-npcHoverTime<80)return;npcHoverTime=performance.now();const hit=pick(e.clientX,e.clientY),id=hit?hitIdentity(hit).instanceId:null;npcDay.hoverAt(id,camera,e.clientX,e.clientY);});canvas.addEventListener('pointerleave',()=>npcDay.hoverAt(null,camera,0,0));
pinkRoadCells=new Set((await fetch('/data/road-symbols-r8/manifest.json').then(r=>r.json())).rows.filter(r=>r.assetId==='road_symbol_07_exclamation_a'&&!r.visualOnlyBlocked).map(r=>r.roadId));
loading('人物日程已加载',90);
$('day-toggle').onclick=()=>npcDay.setEditor($('day-panel').hidden);
$('day-event-close').onclick=()=>$('day-event-card').hidden=true;
function focusEntrance(){entranceViewActive=true;setEntrancePose();free=true;setModeUI();buildingStream?.update(camera.position,true);}
function focusPlayer(){
 if(!playerBoard)return;entranceViewActive=false;const p=playerBoard.position();camera.position.set(p[0]+3.2,p[1]+4.7,p[2]+5.2);camera.lookAt(p[0],p[1]+.25,p[2]);yaw=camera.rotation.y;pitch=camera.rotation.x;free=true;setModeUI();buildingStream?.update(camera.position,true);
}
function setEditor(value){editorMode=value;document.body.classList.toggle('editor-mode',value);hud.refreshButton('play-mode',value?'play':'edit',value?'开始玩耍':'引导编辑');hud.state(activeStory?'interaction':value?'edit':'play');playerBoard?.setEnabled(started&&!value&&!activeStory);$('play-mode').setAttribute('aria-pressed',String(value));npcDay.setEditor(value);if(!value){if(started)focusPlayer();else focusEntrance();}}
playerBoard=await createPlayerBoard({scene,roads:data.roads,spawn:data.spawn,floorHeight,onMove:delta=>{if(!editorMode){if(entranceViewActive)focusPlayer();else camera.position.add(delta);}},onRoll:n=>hud.roll(n),onLand:(cell,position)=>{event('player-land',{cell,position});drawMap();if(pinkRoadCells.has(cell))openRoadEncounter(cell,position);},onSaveError:e=>fail('player-storage',e),onModelReady:root=>{environment.install(root);renderer.shadowMap.needsUpdate=true;}});
environment.install(playerBoard.root);applyLightingSettings();buildingEditor.sync();updateBevelStatus();
$('play-mode').onclick=()=>setEditor(!editorMode);setEditor(false);
renderer.shadowMap.enabled=true;renderer.shadowMap.needsUpdate=true;
let admissionRunning=false;
async function admitStart(retry=false){
 if(admissionRunning)return;admissionRunning=true;diagnostics.loading=true;
 $('start').disabled=true;$('load-retry').hidden=true;loading('正在核验附近地面与贴图',95);
 const coreFailures=jobs.flatMap((r,k)=>r.status==='rejected'?[coreNames[k]]:[]);
 const report=await checkStartup({THREE,renderer,scene,camera,terrain:terrainStream,buildings:buildingStream,furniture:furnitureStream,sprites:spriteBatches,bevel,environment,retry,coreFailures});
 diagnostics.startupCheck=report;(diagnostics.startupAttempts??=[]).push(report);updateBevelStatus();admissionRunning=false;
 if(report.ready){diagnostics.loading=false;diagnostics.readyAt=report.finishedAt;$('start').disabled=false;$('start').hidden=false;loading('检查通过',100);event('ready',{representations,attempt:diagnostics.startupAttempts.length});}
 else{$('load-retry').hidden=false;$('load-retry').textContent=coreFailures.length?'重新加载':'重新检查加载';$('load-retry').onclick=()=>coreFailures.length?location.reload():admitStart(true);loading('地面与资源检查未通过，请重试',95);event('startup-check-failed',{error:report.error});}
 return report;
}
// Read-only observability plus explicit local review controls. No editor API.
window.game={buildingEditor:{select:id=>buildingEditor.select(id),state:()=>buildingEditor.snapshot(),geometry:(values,id=null)=>{bevel.setSettings(values,id);return prepareBevel();},materials:(values,id=null,role="*")=>{materialEditor.set(values,id,role);furnitureStream?.rebuild();},outlines:(v,id=null)=>outlines.set(v,id),array:(model,count)=>{furnitureStream.arrayController.setCount(model,count);buildingEditor.updateArray();return furnitureStream.arrayController.snapshot();},snapshot:()=>({selection:buildingEditor.snapshot(),geometry:bevel.snapshot(),materials:materialEditor.snapshot(),outlines:outlines.snapshot(),array:furnitureStream?.arrayController?.snapshot()})},mobileFrameBudget:()=>frameBudget.snapshot(),bevelInspect:id=>bevel.inspect(id),terrainReadiness:()=>terrainStream?.snapshot(),retryStartup:()=>admitStart(true),furnitureStreaming:()=>furnitureStream.snapshot(),spriteStreaming:()=>spriteBatches.snapshot(),bevelReviewTargets:()=>bevel.reviewTargets(),embeddedLandscapeState(){const rows=[];for(const h of loadedBuildings)h.root.traverse(o=>{if(o.isMesh&&o.userData.is_environment)rows.push({name:o.name,visible:isDisplayed(o)});});return rows;},compileResident:()=>renderer.compileAsync(scene,camera),buildingStreaming:()=>({...buildingStream.snapshot(),sourceCache:sourceModelCacheState()}),retryBuildingLoads(){buildingStream.retryErrors(camera.position);},loadBuildingIds(ids){return buildingStream.ensure(ids,camera.position);},profileOverrides(v={}){if(v.pixelRatio)renderer.setPixelRatio(v.pixelRatio);if(v.ground!==undefined)for(const r of groundRoots)r.visible=v.ground;if(v.buildings!==undefined)for(const r of buildingVisuals.values())r.root.visible=v.buildings;if(v.pictures!==undefined)for(const r of billboards)r.visible=v.pictures;if(v.trees!==undefined)for(const r of r2State.treeMeshes)r.visible=v.trees;return this.snapshot().renderer;},renderCosts(){const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),groups={};scene.traverse(o=>{if(!o.isMesh||!isDisplayed(o)||!frustum.intersectsObject(o))return;let r=o;while(r.parent&&r.parent!==scene&&r.parent!==world)r=r.parent;const key=r.userData.instanceId??r.name??'unnamed';const g=groups[key]??={calls:0,triangles:0};g.calls++;g.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});return Object.entries(groups).sort((a,b)=>b[1].triangles-a[1].triangles);},shaderDiagnostics(){const gl=renderer.getContext();return renderer.info.programs.map(p=>({name:p.name,used:p.usedTimes,link:gl.getProgramParameter(p.program,gl.LINK_STATUS),log:gl.getProgramInfoLog(p.program),shaders:gl.getAttachedShaders(p.program).map(s=>({compiled:gl.getShaderParameter(s,gl.COMPILE_STATUS),log:gl.getShaderInfoLog(s),source:gl.getShaderInfoLog(s)?gl.getShaderSource(s):null}))}));},groundCache:()=>groundSampler.dump(),resourceMemory(){const geometries=new Set(),buffers=new Set(),textures=new Set();let geometryBytes=0,textureBytes=0;scene.traverse(o=>{if(!o.layers.test(camera.layers))return;if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat().filter(Boolean)){for(const v of Object.values(m)){if(v?.isTexture)textures.add(v);}for(const u of Object.values(m.uniforms??{})){if(u.value?.isTexture)textures.add(u.value);}}});for(const g of geometries){for(const a of [...Object.values(g.attributes),g.index].filter(Boolean)){const array=a.data?.array??a.array;if(array&&!buffers.has(array)){buffers.add(array);geometryBytes+=array.byteLength;}}}for(const t of environment.compiledTextures())textures.add(t);const images=[...textures].map(t=>{const w=t.image?.width??0,h=t.image?.height??0,d=t.image?.depth??1,bytes=w*h*d*4*(t.generateMipmaps?4/3:1);textureBytes+=bytes;return {name:t.name||t.image?.currentSrc||'',width:w,height:h,depth:d,estimatedBytes:bytes};});return {geometryBytes,textureBytes,estimatedShadowBytes:sun.shadow.mapSize.x*sun.shadow.mapSize.y*8,geometries:geometries.size,textures:textures.size,images,measurement:'Geometry attribute/index byte count and RGBA texture estimate; actual GPU resident memory unavailable'};},landscapeState(){return {all:showLandscapeAll,optional:showLandscapeOptional,filter:landscapeCategoryFilter,visuals:[...landscapeVisuals].map(([id,root])=>({id,visible:root.visible,category:landscapeLayer.get(id)?.category,policy:landscapeLayer.get(id)?.visibilityPolicy})),oldReplacementSprites:billboards.filter(o=>furnitureIds.has(o.userData.instanceId)).map(o=>o.userData.instanceId),oldReplacementProcedural:r3Roots.filter(o=>furnitureIds.has(o.userData.instanceId)).map(o=>o.userData.instanceId),treeVisible:r2State.treeMeshes.filter(o=>o.visible).length,grassVisible:r2State.grassMeshes.filter(o=>o.visible).length,extraVisible:extraLandscapeRoots.filter(o=>o.visible).length,pointGroups:[...landscapePointMeshes.values()].map(m=>({category:m.userData.category,unresolved:m.userData.unresolved,shape:m.userData.markerShape,count:m.count,visible:m.visible})),pointCount:[...landscapePointMeshes.values()].reduce((n,m)=>n+m.count,0),pointVisible:[...landscapePointMeshes.values()].filter(m=>m.visible).reduce((n,m)=>n+m.count,0),bindings:[...landscapeLayer.values()].map(r=>({id:r.instanceId,point:r.point,protected:r.protected,storyIds:r.storyIds,parcelIds:r.parcelIds}))};},furnitureState(){return furnitureRows.map(r=>({id:r.spec.id,visible:r.root.visible,resident:r.root.userData.resident,position:r.root.position.toArray()}));},seekDay(minute){npcDay.seek(minute);},restoreDay(state){return npcDay.restore(state);},npcRenderState(){return billboards.filter(o=>o.userData.instanceId?.startsWith('npc-')).map(o=>({id:o.userData.instanceId,position:o.position.toArray(),hitPoint:spriteBatches?.getHitPoint(o.userData.instanceId)?.toArray()??null}));},get ready(){return !diagnostics.loading;},snapshot(){const samples=diagnostics.frameTimes.slice();return {...diagnostics,hud:hud.snapshot(),quality,representations,buildingVisibility:{shops:showShopBuildings,landmarks:showLandmarkBuildings,registered:buildingVisuals.size,rows:[...buildingVisuals].map(([id,v])=>({id,category:v.category,visible:v.root.visible,loadState:v.root.userData.loadState,resident:v.root.children.length>0}))},lighting:environment.snapshot(),weather:weather.snapshot(),bevel:bevel.snapshot(),npcDay:npcDay?.snapshot(),board:playerBoard?.snapshot(),editorMode,renderer:{glError:renderer.getContext().getError(),webgl:renderer.getContext().getParameter(renderer.getContext().VERSION),size:renderer.getSize(new THREE.Vector2()).toArray(),pixelRatio:renderer.getPixelRatio(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},camera:{position:camera.position.toArray(),rotation:camera.rotation.toArray(),fov:camera.fov,free,orbit:{pivot:orbit.pivot?.toArray()??null,radius:orbit.radius}},progress:structuredClone(progress),performance:{samples,medianMs:samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)]},collisionCount:colliders.length};},projectInstance(id){const obj=interactables.find(o=>o.userData.instanceId===id);if(!obj)return null;const frozen=obj.userData.frozenWorldBounds,box=frozen&&!obj.children.length?new THREE.Box3(new THREE.Vector3(...frozen.min),new THREE.Vector3(...frozen.max)):new THREE.Box3().setFromObject(obj),v=box.getCenter(new THREE.Vector3()).project(camera);return {x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight,inView:Math.abs(v.x)<1&&Math.abs(v.y)<1};},reviewCamera(position,target){camera.position.fromArray(position);camera.lookAt(...target);yaw=camera.rotation.y;pitch=camera.rotation.x;free=true;setModeUI();buildingStream?.update(camera.position,true);},reviewPass(mode){for(const obj of [...loadedBuildings.map(b=>b.root),...groundRoots])obj.traverse(o=>{if(!o.isMesh)return;if(!o.userData.originalMaterial)o.userData.originalMaterial=o.material;if(mode==='normal'){o.material=o.userData.originalMaterial;return;}o.material=mode==='wire'?new THREE.MeshBasicMaterial({color:'#224650',wireframe:true}):mode==='silhouette'?new THREE.MeshBasicMaterial({color:'#263e48',side:THREE.DoubleSide}):new THREE.MeshBasicMaterial({color:o.userData.originalMaterial.uniforms?.uRegion?.value??o.userData.originalMaterial.color??'#8eaab1',map:o.userData.originalMaterial.map??null,vertexColors:!!o.userData.originalMaterial.vertexColors,side:THREE.DoubleSide});});event('review-pass',{mode});},collisionAt:(x,z)=>isBlocked(x,z),collisionBounds:()=>structuredClone(colliders),toggleGrassShadows(on=true){setGrassShadows(on);renderer.shadowMap.needsUpdate=true;event('grass-shadow-toggle',{on});},projectHitPoint(id){const batched=spriteBatches?.getHitPoint(id);if(batched)return this.projectPoint(batched.toArray());const mesh=interactables.find(o=>o.userData.instanceId===id&&o.material?.map);if(!mesh?.material?.map?.image)return this.projectInstance(id);const img=mesh.material.map.image,c=document.createElement('canvas');c.width=img.width;c.height=img.height;const cx=c.getContext('2d');cx.drawImage(img,0,0);const rgba=cx.getImageData(0,0,c.width,c.height).data;let best=null,dist=Infinity;for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2){const d=(x/c.width-.5)**2+(y/c.height-.5)**2;if(rgba[(y*c.width+x)*4+3]>220&&d<dist){dist=d;best=[x/c.width,y/c.height];}}const [w,h]=mesh.userData.imageSize,[ax,ay]=mesh.userData.alphaAnchor;const v=mesh.localToWorld(new THREE.Vector3((best[0]-ax)*w,(ay-best[1])*h,0));return this.projectPoint(v.toArray());},projectPoint(p){const v=new THREE.Vector3(...p).project(camera);return {x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight};},reviewSolo(id){if(soloRestore){for(const [o,v] of soloRestore)o.visible=v;soloRestore=null;soloId=null;environment.update();return;}soloId=id;soloRestore=new Map();for(const o of [...scene.children,...world.children]){soloRestore.set(o,o.visible);if(o!==world&&!o.isLight)o.visible=o.userData.instanceId===id;}world.visible=true;scene.background=new THREE.Color('white');scene.fog=null;},data:()=>({counts:{instances:data.instances.length,stories:data.stories.length},stories:data.stories.map(s=>({id:s.storyId,title:s.title,kind:s.kind,position:s.position})),instances:data.instances.map(i=>({id:i.instanceId,kind:i.kind,name:i.name,position:i.position}))})};

await admitStart();
