import {verifiedBytes} from './stream-contract.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// The entire real mesh is enclosed in each tested box. Non-overlapping boxes prove non-intersection;
// an overlap is conservative and is resolved before display, never called an exact mesh collision.
export async function addFurniture({payload,scene,floorHeight,obstacles,onRoot,diagnostics,finalPlacement=null}) {
 const templates=new Map(),loader=new GLTFLoader(),rows=[],margin=.012;
 for(const model of payload.models){const pin=finalPlacement?.furnitureModels.find(m=>m.key===model.key);if(finalPlacement&&(!pin||pin.expectedSha256!==model.outputSha256))throw Error('Furniture model pin changed: '+model.key);const template=(pin?await loader.parseAsync(await verifiedBytes(model.url,pin.actualSha256),''):await loader.loadAsync(model.url)).scene;template.traverse(o=>{if(o.isMesh){if(o.material.map)throw Error('Unexpected texture in '+model.key);if(!o.geometry.attributes.color)throw Error('Missing vertex color in '+model.key);o.castShadow=true;o.receiveShadow=true;o.material.roughness=.86;}});templates.set(model.key,template);}
 for(const spec of payload.rows){
   const root=new THREE.Group();root.name='user-furniture:'+spec.id;root.position.fromArray(spec.position);
   const model=templates.get(spec.model).clone(true);root.add(model);model.rotation.y=spec.yaw;root.scale.setScalar(spec.scale);scene.add(root);
   rows.push({spec,root,scale:spec.scale,initialScale:spec.scale,offset:[0,0],adjustments:[],box:new THREE.Box3()});
 }
 function refresh(row){row.root.scale.setScalar(row.scale);row.root.position.set(row.spec.position[0]+row.offset[0],0,row.spec.position[2]+row.offset[1]);row.root.updateMatrixWorld(true);row.box.setFromObject(row.root);const b=row.box;
   const support=[floorHeight(row.root.position.x,row.root.position.z),...[[b.min.x,b.min.z],[b.max.x,b.min.z],[b.min.x,b.max.z],[b.max.x,b.max.z]].map(([x,z])=>floorHeight(x,z))];
   const ground=Math.max(...support);row.root.position.y=ground+.002-b.min.y;row.root.updateMatrixWorld(true);row.box.setFromObject(row.root);row.support={center:support[0],maximum:ground,range:Math.max(...support)-Math.min(...support),bottom:row.box.min.y};
 }
 if(finalPlacement){
  const finalRows=new Map(finalPlacement.furniture.map(r=>[r.id,r]));
  for(const row of rows){const saved=finalRows.get(row.spec.id);if(!saved)throw Error('Missing final furniture '+row.spec.id);
   Object.assign(row,{scale:saved.scale,initialScale:saved.initialScale,offset:[...saved.offset],adjustments:structuredClone(saved.adjustments),support:{...saved.support}});
   row.root.position.fromArray(saved.actualPosition);row.root.scale.setScalar(saved.scale);row.root.updateMatrixWorld(true);row.box.setFromObject(row.root);
   for(const side of ['min','max'])row.box[side].toArray().forEach((value,k)=>{if(Math.abs(value-saved.bounds[side][k])>1e-6)throw Error('Frozen furniture bounds changed: '+row.spec.id);});
  }
 }else rows.forEach(refresh);
 function intersects(a,b){return a.min.x<b.max.x+margin&&a.max.x>b.min.x-margin&&a.min.z<b.max.z+margin&&a.max.z>b.min.z-margin&&a.min.y<b.max.y-.005&&a.max.y>b.min.y+.005;}
 function conflicts(row){return [...obstacles.filter(o=>o.id!==row.spec.id&&intersects(row.box,o.box)),...rows.filter(r=>r!==row&&intersects(row.box,r.box)).map(r=>({id:r.spec.id,box:r.box}))];}
 // Keep the source contact point whenever possible. Small deterministic offsets are only used
 // if that exact point is already inside another entity; source point/IDs remain in the receipt.
 for(let pass=0;!finalPlacement&&pass<9;pass++){
   let changed=false;
   for(const row of rows){
     const hits=conflicts(row);if(!hits.length)continue;
     if(row.scale>row.initialScale*.58){row.scale*=.9;row.adjustments.push({type:'uniform-clearance-fit',against:hits.map(h=>h.id)});refresh(row);changed=true;continue;}
     let solved=false;const original=[...row.offset];
     for(const distance of [.08,.16,.24,.36,.5]){if(solved)break;for(let direction=0;direction<16;direction++){
       const angle=direction*Math.PI/8;row.offset=[Math.sin(angle)*distance,Math.cos(angle)*distance];refresh(row);
       if(!conflicts(row).length){row.adjustments.push({type:'local-clearance-offset',offset:[...row.offset],against:hits.map(h=>h.id)});solved=true;changed=true;break;}
     }}
     if(!solved){row.offset=original;refresh(row);}
   }
   if(!changed)break;
 }
 const unresolved=finalPlacement?[]:rows.flatMap(row=>conflicts(row).map(o=>({id:row.spec.id,other:o.id})));
 for(const row of rows){onRoot(row.spec,row.root);}
 const geometries=new Set(),materials=new Set();for(const t of templates.values())t.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
 const geometryBytes=[...geometries].reduce((sum,g)=>sum+Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(g.index?.array.byteLength??0),0);
 diagnostics.furniture={validationMode:finalPlacement?'frozen-full-scene-and-bounds-equivalence':'live-full-scene',validationReceipt:finalPlacement?.fullSceneValidation??null,fullObstacleCollisionRecomputed:!finalPlacement,count:rows.length,modelCount:templates.size,sharedGeometryCount:geometries.size,sharedMaterials:materials.size,geometryBytes,textureImages:0,unresolvedIntersections:unresolved,
   rows:rows.map(r=>({id:r.spec.id,model:r.spec.model,sourcePosition:r.spec.position,actualPosition:r.root.position.toArray(),scale:r.scale,initialScale:r.initialScale,scaleRatio:r.scale/r.initialScale,yaw:r.spec.yaw,offset:r.offset,adjustments:r.adjustments,support:r.support,bounds:{min:r.box.min.toArray(),max:r.box.max.toArray()},storyIds:r.spec.storyIds}))};
 return rows;
}
