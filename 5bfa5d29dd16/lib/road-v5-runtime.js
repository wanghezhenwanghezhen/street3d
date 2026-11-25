import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildRoadSymbols,collectAsphaltTop} from './road-symbols-r8.js';

// Clip a triangle's full position/normal/UV tuple against a half-plane.
function split(poly,axis,value){
 const inside=[],outside=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=a[axis]-value,db=b[axis]-value;
  (da>=-1e-8?inside:outside).push(a);
  if((da>=0)!==(db>=0)){const t=da/(da-db),v=a.map((x,k)=>x+(b[k]-x)*t);inside.push(v);outside.push(v);}
 }
 return [inside,outside];
}
function subtractRect(poly,r){
 let remaining=poly;const keep=[];
 for(const [axis,value,positive] of [[0,r[0],true],[0,r[2],false],[2,r[1],true],[2,r[3],false]]){
  if(remaining.length<3)break;
  const [a,b]=split(remaining,axis,value);keep.push(positive?b:a);remaining=positive?a:b;
 }
 return keep.filter(p=>p.length>=3);
}
function clipCurbs(geometry,rectangles){
 const src=geometry.index?geometry.toNonIndexed():geometry,attrs=src.attributes,p=attrs.position,n=attrs.normal,u=attrs.uv,out=[];
 for(let i=0;i<p.count;i+=3){let polys=[Array.from({length:3},(_,j)=>{const k=i+j;return [p.getX(k),p.getY(k),p.getZ(k),n.getX(k),n.getY(k),n.getZ(k),u.getX(k),u.getY(k)];})];
  for(const r of rectangles)polys=polys.flatMap(poly=>subtractRect(poly,r));
  for(const poly of polys)for(let k=1;k<poly.length-1;k++)out.push(...poly[0],...poly[k],...poly[k+1]);
 }
 const result=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(new Float32Array(out),8);
 result.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));result.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));result.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,6));
 // mergeGeometries expects non-interleaved attributes.
 for(const [name,size,offset] of [['position',3,0],['normal',3,3],['uv',2,6]])result.setAttribute(name,new THREE.Float32BufferAttribute(Array.from({length:out.length/8},(_,i)=>out.slice(i*8+offset,i*8+offset+size)).flat(),size));
 return result;
}

export async function buildV5Roads(roads){
 const [gltf,manifest]=await Promise.all([new GLTFLoader().loadAsync('/data/road-v5/tiles.glb'),fetch('/data/road-v5/manifest.json').then(r=>r.json())]);
 const templates=new Map();gltf.scene.traverse(o=>{const m=o.name.match(/^RoadTile_(\d\d)_V5$/);if(m)templates.set(Number(m[1]),o);});
 if(templates.size!==16)throw Error('V5 template count mismatch');
 const loader=new THREE.TextureLoader(),materials=new Map();
 for(const [name,config] of Object.entries(manifest.materials)){
  const [map,bumpMap]=await Promise.all([loader.loadAsync(config.albedo.url),loader.loadAsync(config.height.url)]);
  map.colorSpace=THREE.SRGBColorSpace;for(const t of [map,bumpMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.flipY=false;t.anisotropy=8;}
  materials.set(name,new THREE.MeshStandardMaterial({name,map,bumpMap,bumpScale:config.bumpScale,roughness:config.roughness,metalness:0}));
 }
 const cells=new Set(roads.map(r=>r.cell_uv.join(','))),corners=[[1,1],[-1,1],[-1,-1],[1,-1]],connections=[[1,0],[0,1],[-1,0],[0,-1]];
 const has=(x,y)=>cells.has(x+','+y),mask=(x,y)=>(has(x,y+1)?1:0)|(has(x+1,y)?2:0)|(has(x,y-1)?4:0)|(has(x-1,y)?8:0);
 const cornerEnabled=(x,y,sx,sy)=>has(x+sx,y)&&has(x,y+sy)&&!has(x+sx,y+sy);
 const cuts=[];let enabledCorners=0,removedCorners=0;
 for(const r of roads){const [x,y]=r.cell_uv;for(const [sx,sy] of corners)if(cornerEnabled(x,y,sx,sy)){const cx=r.center[0]+sx*.5,cy=r.center[1]+sy*.5;cuts.push([Math.min(cx,cx+sx*.12),-Math.max(cy,cy+sy*.12),Math.max(cx,cx+sx*.12),-Math.min(cy,cy+sy*.12)]);enabledCorners++;}}
 const group=new THREE.Group();group.name='source-v5-road-network';const batches=new Map(),maskCounts={},asphaltSurfaces=new Map();let clippedCurbs=0;
 for(const r of roads){const [x,y]=r.cell_uv,m=mask(x,y);maskCounts[m]=(maskCounts[m]??0)+1;const template=templates.get(m);template.updateMatrixWorld(true);
  template.traverse(o=>{if(!o.isMesh)return;const corner=o.name.match(/Corner_(\d)_/);if(corner){const [sx,sy]=corners[Number(corner[1])];if(!cornerEnabled(x,y,sx,sy)){removedCorners++;return;}}
   let geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);geo.translate(r.center[0],0,-r.center[1]);
   if(o.material.name==='Corrected_Asphalt')asphaltSurfaces.set(r.id,[...(asphaltSurfaces.get(r.id)??[]),...collectAsphaltTop(geo)]);
   if(/Curb/.test(o.name)){geo.computeBoundingBox();const b=geo.boundingBox,near=cuts.filter(c=>b.min.x<c[2]-1e-7&&b.max.x>c[0]+1e-7&&b.min.z<c[3]-1e-7&&b.max.z>c[1]+1e-7);if(near.length){const old=geo;geo=clipCurbs(geo,near);old.dispose();clippedCurbs++;}}
   if(geo.index){const old=geo;geo=geo.toNonIndexed();old.dispose();}
   for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key);
   const mat=materials.get(o.material.name)??o.material;const key=mat.uuid;
   if(!batches.has(key))batches.set(key,{mat,geometries:[]});batches.get(key).geometries.push(geo);
  });
 }
 for(const {mat,geometries} of batches.values()){const merged=mergeGeometries(geometries);if(!merged)throw Error('V5 merge failed');const mesh=new THREE.Mesh(merged,mat);mesh.receiveShadow=true;mesh.castShadow=false;group.add(mesh);geometries.forEach(g=>g.dispose());}
 const stats={count:roads.length,sourcePrefabLoaded:true,sourceMaskCount:templates.size,maskCounts,bakedSourceTextures:materials.size*2,sourceSha256:manifest.sourceSha256,enabledCorners,removedCornerParts:removedCorners,clippedCurbs,drawMeshes:group.children.length,triangles:group.children.reduce((sum,m)=>sum+m.geometry.attributes.position.count/3,0),roadWidth:1,shoulderWidth:.12,shoulderHeight:.025};
 const symbols=await buildRoadSymbols(roads,asphaltSurfaces);stats.symbols=symbols.stats;
 stats.textureRows=[...materials].map(([name,material])=>({material:name,albedo:{url:manifest.materials[name].albedo.url,sha256:manifest.materials[name].albedo.sha256,uploadSize:[material.map.image.width,material.map.image.height]},height:{url:manifest.materials[name].height.url,sha256:manifest.materials[name].height.sha256,uploadSize:[material.bumpMap.image.width,material.bumpMap.image.height]}}));
 // Return separately: symbols are paint, never physical ground or contact support.
 return {group,stats,symbols:symbols.group};
}
