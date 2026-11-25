import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {verifiedBytes} from './stream-contract.js';
import {createResourceCache} from './resource-cache.js';
import {createBuildingStream} from './building-stream.js';
import {createFurnitureBatches} from './furniture-batches.js';

// Frozen logical points/collision/story IDs outlive the geometry leases.
export function createFurnitureStream({payload,contract,scene,camera,interactables,environment,diagnostics,onRoot,onArrayRoot,onVisibility,onDirty,materialEditor,arrayManifest,inView,radius=18,keepRadius=24}){
 const loader=new GLTFLoader(),pins=new Map(contract.furnitureModels.map(m=>[m.key,m]));
 const specs=new Map(payload.rows.map(r=>[r.id,r])),rows=[],byId=new Map();
 const entries=[...contract.furniture,...(arrayManifest?.rows??[])];
 for(const saved of arrayManifest?.rows??[]){const template=specs.get(saved.templateId);if(!template)throw Error('Array template missing');specs.set(saved.id,{...template,id:saved.id,storySourceId:template.id,position:saved.actualPosition,yaw:saved.yaw,scale:saved.scale,arrayDisplay:true});}
 const requested={streetlight:arrayManifest?.originals.streetlight.length??38,sign:arrayManifest?.originals.sign.length??50},admitted=new Set();
 const cache=createResourceCache({
  async load(key){
   const pin=pins.get(key),model=payload.models.find(m=>m.key===key);
   if(!pin||pin.expectedSha256!==model.outputSha256)throw Error('Furniture model pin changed: '+key);
   const root=(await loader.parseAsync(await verifiedBytes(model.url,pin.actualSha256),'')).scene;
   const geometry=new Set(),materials=new Set();
   root.traverse(o=>{if(!o.isMesh)return;geometry.add(o.geometry);for(const m of [o.material].flat()){materials.add(m);if(Object.values(m).some(v=>v?.isTexture))throw Error('Unexpected furniture texture: '+key);m.roughness=.86;}if(!o.geometry.attributes.color)throw Error('Missing furniture vertex color: '+key);o.castShadow=true;o.receiveShadow=true;});
   environment.install(root);
   return {root,geometry,materials};
  },
  dispose(value){for(const g of value.geometry)g.dispose();for(const m of value.materials)m.dispose();value.root.clear();}
 });
 for(const saved of entries){
  const spec=specs.get(saved.id);if(!spec)throw Error('Missing furniture point: '+saved.id);
  const root=new THREE.Group();root.name='user-furniture:'+saved.id;root.position.fromArray(saved.actualPosition);root.scale.setScalar(saved.scale);root.userData.frozenWorldBounds=saved.bounds;root.userData.resident=false;scene.add(root);
  const row={spec,root,scale:saved.scale,initialScale:saved.initialScale,offset:[...saved.offset],adjustments:structuredClone(saved.adjustments),support:{...saved.support},box:new THREE.Box3(new THREE.Vector3(...saved.bounds.min),new THREE.Vector3(...saved.bounds.max))};
  rows.push(row);byId.set(saved.id,row);if(spec.arrayDisplay){root.userData.instanceId=spec.storySourceId;root.visible=false;onArrayRoot?.(spec,root,row.box);}else onRoot(spec,root,row.box);
 }
 let batches=null,dirty=true,disposed=false;
 function invalidate(){batches?.dispose();batches=null;dirty=true;onDirty?.();}
 const scheduler=createBuildingStream({entries:entries.map(r=>({...r,instanceId:r.id})),radius,keepRadius,concurrency:2,inView,
  isVisible:entry=>byId.get(entry.id).root.visible,
  async load(entry){
   const lease=await cache.acquire(entry.model,entry.model),root=lease.value.root.clone(true),ownedGeometry=[];root.rotation.y=entry.yaw;
   if(entry.baseFit)root.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.clone(),p=geometry.attributes.position;for(const [i,y]of entry.baseFit.positionY)p.setY(i,y);p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();o.geometry=geometry;ownedGeometry.push(geometry);});
   let live=true;return {root,dispose(){if(!live)return;live=false;root.removeFromParent();root.clear();for(const geometry of ownedGeometry)geometry.dispose();lease.release();}};
  },
  onAttach(entry,handle){
   const row=byId.get(entry.id);row.root.add(handle.root);row.root.updateMatrixWorld(true);
   const actual=new THREE.Box3().setFromObject(row.root);for(const side of ['min','max'])actual[side].toArray().forEach((v,k)=>{if(Math.abs(v-entry.bounds[side][k])>1e-6)throw Error('Frozen furniture bounds changed: '+entry.id);});
   materialEditor?.register(row.root,entry.id);row.root.userData.resident=true;invalidate();
  },
  onDetach(entry,handle){materialEditor?.unregister(byId.get(entry.id).root);handle.root.removeFromParent();byId.get(entry.id).root.userData.resident=false;invalidate();},
  onChange(state){diagnostics.furnitureStream={...state,sourceCache:cache.snapshot()};}
 });
 diagnostics.furniture={validationMode:'frozen-full-scene-and-resident-bounds-equivalence',validationReceipt:contract.fullSceneValidation,fullObstacleCollisionRecomputed:false,count:rows.length,modelCount:pins.size,textureImages:0,unresolvedIntersections:[],rows:structuredClone(contract.furniture),streamed:true};
 function applyVisibility(){
  for(const row of rows){const source=byId.get(row.spec.storySourceId??row.spec.id),eligible=source.root.userData.layerVisible??source.root.visible,controlled=arrayManifest?.order[row.spec.model]?.includes(row.spec.id);row.root.visible=eligible&&(!controlled||admitted.has(row.spec.id));onVisibility?.(row.spec.id,row.root.visible);}
 }
 function setCount(model,value){if(!arrayManifest?.order[model])return;requested[model]=Math.min(arrayManifest.order[model].length,Math.max(0,Math.round(value)));refreshAdmitted();applyVisibility();scheduler.update(camera.position,true);onDirty?.();}
 function refreshAdmitted(){admitted.clear();for(const model of ['streetlight','sign'])for(const id of arrayManifest?.order[model]?.slice(0,requested[model])??[])admitted.add(id);}
 const arrayController={setCount,reset(){for(const model of ['streetlight','sign'])requested[model]=arrayManifest?.originals[model].length??0;refreshAdmitted();applyVisibility();scheduler.update(camera.position,true);},snapshot(){return {requested:{...requested},actual:Object.fromEntries(['streetlight','sign'].map(model=>[model,[...admitted].filter(id=>byId.get(id)?.spec.model===model).length])),capacity:arrayManifest?.capacity??requested,fixedSigns:arrayManifest?.fixedSigns??25,originalCount:contract.furniture.length,extraCatalogue:arrayManifest?.rows.length??0,extraResident:rows.filter(r=>r.spec.arrayDisplay&&r.root.userData.resident).length,sourceBindingsUnchanged:true};}};
 refreshAdmitted();applyVisibility();
 function update(force=false){
  if(disposed)return false;scheduler.update(camera.position,force);
  if(dirty){batches=createFurnitureBatches({scene,rows:rows.filter(r=>r.root.userData.resident),interactables,camera,diagnostics});dirty=false;diagnostics.furnitureBatch.logicalInstances=rows.length;}
  return batches.update();
 }
 return {rows,update,arrayController,applyVisibility,rebuild:invalidate,async loadInitial(){const result=await scheduler.loadInitial(camera.position);update(true);return result;},snapshot:()=>({...scheduler.snapshot(),sourceCache:cache.snapshot(),array:arrayController.snapshot()}),settle:()=>scheduler.loadInitial(camera.position),retryErrors:()=>scheduler.retryErrors(camera.position),dispose(){disposed=true;scheduler.dispose();batches?.dispose();for(const row of rows)row.root.removeFromParent();}};
}
