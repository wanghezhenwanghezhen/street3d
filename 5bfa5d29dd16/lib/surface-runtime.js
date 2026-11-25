import {sourceGrassMaterial} from './grass-source-r21.js';
import {quality,textureUrl} from './quality.js';
import {ensureAnchorDisplay} from './anchor-readiness-r11.js';
import {loadSeasonGrass} from '/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/season-runtime.js';
import {loadSeasonTerrain} from '/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/terrain-season-runtime.js';
import {installPavingSeason} from '/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/paving-runtime.js';
/* Real latest terrain, native source material tiles, and saved Blender grass.
 * This module never constructs a replacement parcel plane or crops a map image.
 */
const TWO_PI=Math.PI*2;
const fetchedJSON=new Map();
let authoredGroupId=6100;
let failedTextureRouting=false,recoveredRouting=null;
const textureFailures=new Map();
export function resetSurfaceTextureFailures(){textureFailures.clear();}
function withAssetTimeout(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]).finally(()=>clearTimeout(timer));}
async function surfaceTextureUrl(url,timeoutMs){
 if(!failedTextureRouting){try{return await withAssetTimeout(textureUrl(url),timeoutMs,'Ground texture routing');}catch(error){failedTextureRouting=true;throw error;}}
 if(!recoveredRouting)recoveredRouting=fetch('/data/texture-routing.json').then(r=>{if(!r.ok)throw Error('Ground texture routing '+r.status);return r.json();}).catch(error=>{recoveredRouting=null;throw error;});
 let map;const pending=recoveredRouting;try{map=await withAssetTimeout(pending,timeoutMs,'Ground texture routing retry');}catch(error){if(recoveredRouting===pending)recoveredRouting=null;throw error;}const p=new URL(url,location.origin),profile=quality.profile==='mobile'?'mobile':'desktop';
 if(!map[profile]||typeof map[profile]!=='object'){recoveredRouting=null;throw Error('Invalid ground texture routing');}
 return p.origin===location.origin?(map[profile][decodeURI(p.pathname)]??map[profile][p.pathname]??url):url;
}
// Fetch goes through the bounded streaming transport, including partial-body retry.
// Decode only a complete Blob; HTMLImageElement retains the original UV/color behavior.
export async function loadSurfaceTexture(url,THREE,{signal,timeoutMs=30000}={}){
 const failed=textureFailures.get(url);if(failed?.attempts>=3)throw failed.error;
 try{return await fetchAndDecodeSurfaceTexture(url,THREE,{signal,timeoutMs});}
 catch(error){
  if(signal?.aborted||error.name==='AbortError')throw error;
  const attempts=error.transportExhausted||error.nonRetryable?3:(textureFailures.get(url)?.attempts??0)+1;
  if(attempts>=3)error.nonRetryable=true;
  textureFailures.set(url,{attempts,error});
  throw error;
 }
}
async function fetchAndDecodeSurfaceTexture(url,THREE,{signal,timeoutMs}){
 const response=await fetch(url,{signal});
 if(!response.ok){const error=Error('Ground texture HTTP '+response.status+' '+url);error.nonRetryable=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
 const blob=await response.blob();
 if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
 if(!blob.size)throw Error('Empty ground texture '+url);
 const objectUrl=URL.createObjectURL(blob),image=new Image();image.decoding='async';
 try{
  await new Promise((resolve,reject)=>{
   let timer;const cleanup=()=>{clearTimeout(timer);image.onload=image.onerror=null;signal?.removeEventListener('abort',abort);};
   const fail=error=>{cleanup();image.src='';reject(error);};
   const abort=()=>fail(signal.reason??new DOMException('Aborted','AbortError'));
   image.onload=()=>{cleanup();if(image.naturalWidth>0&&image.naturalHeight>0)resolve();else reject(Error('Undecoded ground texture '+url));};
   image.onerror=()=>fail(Error('Ground texture decode failed '+url));
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>fail(Error('Ground texture decode timed out '+url)),timeoutMs);
   image.src=objectUrl;if(signal?.aborted)abort();
  });
  if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
  textureFailures.delete(url);
  const texture=new THREE.Texture(image);texture.needsUpdate=true;texture.name=url;
  return texture;
 }catch(error){image.src='';throw error;}finally{URL.revokeObjectURL(objectUrl);}
}

async function sourceVertexColors(geometry,definition,THREE){
  const {planeColor,TONES,LIGHT}=await import('/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/source-shaders/h72-color.mjs');
  const normals=geometry.getAttribute('normal'),colors=new Float32Array(normals.count*3);
  for(let i=0;i<normals.count;i++){
    // This is the source viewer's Z-up -> Y-up normal convention, preserved
    // before applying its four-tone selection and exact OKLab display recipe.
    const n=[normals.getX(i),normals.getZ(i),-normals.getY(i)];
    const dot=n.reduce((s,v,k)=>s+v*LIGHT[k],0);
    const t=n.reduce((s,v,k)=>s+(v*LIGHT[k]<0?Math.abs(v):0),0)/n.reduce((s,v)=>s+Math.abs(v),0);
    let tone=dot>0?0:3;
    if(Math.max(...n.map(Math.abs))<.999)tone=t<.0001?0:t>.9999?3:t<.5?1:2;
    colors.set(planeColor(definition.anchors[TONES[tone]],tone,n),i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
}

async function readJSON(url,signal){
  if(!fetchedJSON.has(url))fetchedJSON.set(url,fetch(url,{signal}).then(r=>{if(!r.ok)throw Error(`${r.status} ${url}`);return r.json();}).catch(e=>{fetchedJSON.delete(url);throw e;}));
  const pending=fetchedJSON.get(url);if(fetchedJSON.size>12)fetchedJSON.delete(fetchedJSON.keys().next().value);return pending;
}

function colorFromSrgb(THREE,rgb){
  return new THREE.Color().setRGB(rgb[0],rgb[1],rgb[2],THREE.SRGBColorSpace);
}

function lowFieldMaterial(THREE,definition,{lit}){
  const Material=lit?THREE.MeshStandardMaterial:THREE.MeshBasicMaterial;
  const material=new Material({color:0xffffff,side:THREE.DoubleSide,...(lit?{roughness:1,metalness:0}:{})});
  material.toneMapped=false;material.userData.sourceDefinition=definition;
  material.onBeforeCompile=shader=>{
    shader.uniforms.qianyuCenter={value:new THREE.Vector3(...definition.centerSrgb255).multiplyScalar(1/255)};
    shader.uniforms.qianyuPhase={value:(definition.seed%997)/997*TWO_PI};
    shader.vertexShader='varying vec2 qianyuGroundXY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nqianyuGroundXY=(modelMatrix*vec4(transformed,1.)).xz*vec2(1.,-1.);');
    shader.fragmentShader='varying vec2 qianyuGroundXY;\nuniform vec3 qianyuCenter;\nuniform float qianyuPhase;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float qd=2.8*sin(6.28318530718*(qianyuGroundXY.x+.37*qianyuGroundXY.y)/1.4+qianyuPhase)
             +1.4*sin(6.28318530718*(-.23*qianyuGroundXY.x+qianyuGroundXY.y)/2.7+qianyuPhase*.618);
      vec3 qs=clamp(qianyuCenter+vec3(qd/255.0),0.0,1.0);
      vec3 qLinear=mix(qs/12.92,pow((qs+.055)/1.055,vec3(2.4)),step(vec3(.04045),qs));
      diffuseColor.rgb=qLinear;
    `);
  };
  material.customProgramCacheKey=()=>`qianyu-live-grass-field-r4-${lit}-${definition.id}-${definition.seed}`;
  return material;
}

async function makeMaterial(definition,THREE,renderer,baseUrl,{lit,signal,assetTimeoutMs=30000}){
  if(definition.style?.startsWith('grass:'))return applyCandidateTint(await sourceGrassMaterial(definition,THREE,renderer,{lit,loadTexture:loadSurfaceTexture}),definition,THREE);
  if(definition.shader==='source-four-tone'){
    const [{strictMaterial}]=await Promise.all([
      import('/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/source-shaders/modules/light-first-material.mjs'),
      ensureAnchorDisplay(THREE,{timeoutMs:Math.max(100000,assetTimeoutMs)})
    ]);
    const material=strictMaterial(definition.recipe,++authoredGroupId);const sourceCompile=material.onBeforeCompile;material.onBeforeCompile=(s,r)=>{sourceCompile.call(material,s,r);s.vertexShader=s.vertexShader.replace('qyWorld=(modelMatrix*vec4(transformed,1.)).xyz;','qyWorld=(modelMatrix*vec4(transformed,1.)).xyz;qyWorld=vec3(qyWorld.x,-qyWorld.z,qyWorld.y);');s.fragmentShader=s.fragmentShader.replace('vec3 qn=normalize(inverseTransformDirection(normal,viewMatrix));','vec3 qn=normalize(inverseTransformDirection(normal,viewMatrix));qn=vec3(qn.x,-qn.z,qn.y);').replace('vec3 qview=normalize(inverseTransformDirection(normalize(vViewPosition),viewMatrix));','vec3 qview=normalize(inverseTransformDirection(normalize(vViewPosition),viewMatrix));qview=vec3(qview.x,-qview.z,qview.y);');};material.customProgramCacheKey=()=> 'qianyu-game-native-Z-lighting-in-Y-world-v1';
    material.toneMapped=false;material.userData.sourceDefinition=definition;
    return applyCandidateTint(material,definition,THREE);
  }
  if(definition.shader==='source-h72-vertex-color'){
    const material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,toneMapped:false});
    material.userData.sourceDefinition=definition;
    return applyCandidateTint(material,definition,THREE);
  }
  const isTactile=definition.style?.startsWith('tactile:');
  const Material=(lit||isTactile)?THREE.MeshStandardMaterial:THREE.MeshBasicMaterial;
  const parameters={color:colorFromSrgb(THREE,definition.color||[1,1,1]),side:THREE.DoubleSide};
  if(lit||isTactile)Object.assign(parameters,{roughness:definition.roughness??1,metalness:definition.metalness??0});
  const material=new Material(parameters);
  material.toneMapped=false;
  try{
  if(definition.textureUrl){
    const texture=await loadSurfaceTexture(await surfaceTextureUrl(new URL(definition.textureUrl,baseUrl).href,assetTimeoutMs),THREE,{signal,timeoutMs:assetTimeoutMs});
    material.map=texture;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(Math.max(texture.image.width,texture.image.height)>quality.groundTexture){const image=texture.image,c=document.createElement('canvas'),s=quality.groundTexture/Math.max(image.width,image.height);c.width=Math.round(image.width*s);c.height=Math.round(image.height*s);c.getContext('2d').drawImage(image,0,0,c.width,c.height);texture.image=c;image.close?.();if(image instanceof HTMLImageElement)image.src='';texture.needsUpdate=true;}texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=THREE.LinearFilter;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.anisotropy=renderer?Math.min(4,renderer.capabilities.getMaxAnisotropy()):4;
    material.map=texture;
    // Source tile already contains target-colour transfer. Never multiply the
    // material's targetSrgb into that texture a second time.
    material.color.set(0xffffff);
    material.needsUpdate=true;
  }
  material.userData.sourceDefinition=definition;
  return applyCandidateTint(material,definition,THREE);
  }catch(error){material.map?.dispose();material.map?.image?.close?.();if(material.map)material.map.image=null;material.dispose();throw error;}
}

async function geometryFor(mesh,THREE,baseUrl,signal){
  const geometry=new THREE.BufferGeometry();
  if(mesh.positionsNormalsUrl){
    const response=await fetch(new URL(mesh.positionsNormalsUrl,baseUrl),{signal});
    if(!response.ok)throw Error(`Failed actual tactile buffer ${response.status}`);
    const values=new Float32Array(await response.arrayBuffer());
    if(values.length!==mesh.vertexCount*6)throw Error(`Invalid actual mesh buffer ${mesh.id}`);
    const interleaved=new THREE.InterleavedBuffer(values,6);
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
    geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(interleaved,3,3));
  }else{
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(mesh.normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(mesh.uv,2));
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

async function buildSurfaceGroup(payload,materials,THREE,baseUrl,signal){
  const group=new THREE.Group();
  group.name=payload.scope;let reliefMeshes=0,reliefTriangles=0,reliefPieces=0;
  // Bounded batches keep fetch and allocation pressure predictable on switching.
  for(let offset=0;offset<payload.meshes.length;offset+=12){window.loadingDiagnostics.surfacePhase='base-mesh-'+offset;
    const batch=await Promise.all(payload.meshes.slice(offset,offset+12).map(async row=>{
      const geometry=await geometryFor(row,THREE,baseUrl,signal);
      const mesh=new THREE.Mesh(geometry,materials.get(row.materialId));
      if(!mesh.material)throw Error(`Unresolved ground material ${row.materialId}`);
      const pavingRelief=false;
      if(mesh.material.userData.sourceDefinition?.shader==='source-h72-vertex-color')await sourceVertexColors(geometry,mesh.material.userData.sourceDefinition,THREE);
      mesh.name=row.id;
      mesh.receiveShadow=true;
      mesh.castShadow=false;
      mesh.userData={...row,pavingRelief,positions:undefined,normals:undefined,uv:undefined};
      return mesh;
    }));
    group.add(...batch);
  }
  group.userData={scope:payload.scope,triangleCount:payload.triangleCount,source:'real current terrain triangles',mapImageUsed:false,pavingReliefMeshes:reliefMeshes,reliefTriangles,reliefPieces,rimMeshes:payload.meshes.filter(m=>m.category==='rim').length};
  return group;
}

function buildGrassGroup(instances,definitions,THREE){
  const group=new THREE.Group();group.name='actual-live-grass';
  for(const definition of definitions){
    const rows=instances.filter(x=>x.modelId===definition.id);
    if(!rows.length)continue;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(definition.positions,3));
    geometry.setIndex(definition.indices);
    geometry.computeVertexNormals();
    // Live source explicitly has shared ground field colours and no independent
    // leaf PBR shading. Grass uses its actual source root albedo, not a new palette.
    const material=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
    material.toneMapped=false;
    const mesh=new THREE.InstancedMesh(geometry,material,rows.length);
    mesh.name=definition.id;
    const matrix=new THREE.Matrix4();
    rows.forEach((row,i)=>{matrix.set(...row.matrix);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,colorFromSrgb(THREE,row.colorSrgb));});
    mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();
    mesh.userData={actualHostPrototypeVerified:true,instanceIds:rows.map(x=>x.id),source:definition.source};
    group.add(mesh);
  }
  group.userData={count:instances.length,actualBlenderGeometry:true};
  return group;
}

/** Entry is one record from surfaces.json. All coordinates are Z-up WORLD.
 * Return groups separately: root, contextRoot, grassRoot, contextGrassRoot.
 * Call dispose() when switching. No shared render resources are disposed twice.
 */
export async function loadSurface(entry,{THREE,renderer,baseUrl=document.baseURI,signal,lit=false,seasonData=null,paving=null,season='spring_green'}={}){
  if(!THREE)throw Error('loadSurface requires the viewer THREE instance');
  const urls=[entry.geometryUrl,entry.contextGeometryUrl,entry.grass.instanceUrl,entry.grass.modelsUrl].map(u=>new URL(u,baseUrl).href);
  const [data,context,grass,models]=await Promise.all(urls.map(u=>readJSON(u,signal)));
  const materials=new Map();
  for(let offset=0;offset<entry.materials.length;offset+=6){
    await Promise.all(entry.materials.slice(offset,offset+6).map(async definition=>materials.set(definition.id,await makeMaterial(definition,THREE,renderer,baseUrl,{lit,signal}))));
  }
  const pavingControllers=paving?entry.materials.map(d=>installPavingSeason(materials.get(d.id),d,THREE,paving)):[];
  const candidateTints=Object.fromEntries(entry.materials.filter(d=>d.candidateColor).map(d=>[d.id,d.candidateColor]));
  const upgradedTerrain=seasonData?await loadSeasonTerrain(seasonData.entry,{THREE,renderer,baseUrl:seasonData.baseUrl,signal,season,candidateTints}):null;
  const retainedData=upgradedTerrain?{...data,meshes:data.meshes.filter(m=>!upgradedTerrain.replaceMeshIds.includes(m.id))}:data;
  const retainedContext=upgradedTerrain?{...context,meshes:context.meshes.filter(m=>!upgradedTerrain.contextReplaceMeshIds.includes(m.id))}:context;
  const root=await buildSurfaceGroup(retainedData,materials,THREE,baseUrl,signal);
  const contextRoot=await buildSurfaceGroup(retainedContext,materials,THREE,baseUrl,signal);
  if(upgradedTerrain){root.add(upgradedTerrain.root);contextRoot.add(upgradedTerrain.contextRoot);upgradedTerrain.contextRoot.visible=true;}
  const upgradedGrass=seasonData?await loadSeasonGrass(seasonData.entry,{THREE,renderer,baseUrl:seasonData.baseUrl,signal,season,shadows:true}):null;
  const grassRoot=upgradedGrass?.root||buildGrassGroup(grass.instances,models.models,THREE);
  const contextGrassRoot=upgradedGrass?.contextRoot||buildGrassGroup(grass.contextInstances,models.models,THREE);
  contextRoot.visible=false;contextGrassRoot.visible=false;
  const stats={parcelId:entry.parcelId,terrainTriangles:data.triangleCount,tactileTriangles:data.tactile?.triangles||0,contextTriangles:context.triangleCount,grassCount:grass.count,contextGrassCount:grass.contextCount,grassWholeMapCount:seasonData?.sourceTuftCount||5390,actualTerrainGeometry:true,mapImageUsed:false};
  if(upgradedGrass){stats.latestGrass=upgradedGrass.stats;stats.legacyGrassReplaced=true;stats.grassCount=seasonData.entry.core.tuftCount;stats.grassLeafCount=seasonData.entry.core.count;stats.contextGrassCount=seasonData.entry.context.tuftCount;}
  if(upgradedTerrain)stats.latestTerrain=upgradedTerrain.stats;
  stats.paving=pavingControllers.filter(c=>c.applied).map(c=>c.stats);
  function setSeason(value){pavingControllers.forEach(c=>c.setSeason(value));upgradedGrass?.setSeason(value);upgradedTerrain?.setSeason(value);stats.season=value;}
  setSeason(season);
  function dispose(){
    // Each upgraded module owns its resources; detach before the legacy sweep.
    if(upgradedTerrain){root.remove(upgradedTerrain.root);contextRoot.remove(upgradedTerrain.contextRoot);upgradedTerrain.dispose();}
    upgradedGrass?.dispose();pavingControllers.forEach(c=>c.dispose());
    const geometries=new Set(),ownedMaterials=new Set(),textures=new Set();
    for(const group of (upgradedGrass?[root,contextRoot]:[root,contextRoot,grassRoot,contextGrassRoot]))group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){for(const material of Array.isArray(o.material)?o.material:[o.material]){ownedMaterials.add(material);if(material.map)textures.add(material.map);}}});
    geometries.forEach(v=>v.dispose());ownedMaterials.forEach(v=>v.dispose());textures.forEach(v=>v.dispose());
  }
  return {root,contextRoot,grassRoot,contextGrassRoot,stats,dispose,setSeason,setShadows:enabled=>upgradedGrass?.setShadows(enabled)};
}

function applyCandidateTint(material,definition,THREE){
 if(!definition.candidateColor)return material;
 const multiplier=definition.candidateColor.linearMultiplier;
 if(!multiplier?.every(Number.isFinite))throw Error('Invalid candidate colour multiplier');
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  if(!shader.fragmentShader.includes('#include <opaque_fragment>'))throw Error('Candidate colour hook missing for '+definition.id);
  shader.uniforms.parcelCandidateMultiplier={value:new THREE.Vector3(...multiplier)};
  shader.fragmentShader='uniform vec3 parcelCandidateMultiplier;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight *= parcelCandidateMultiplier;\n#include <opaque_fragment>');
 };
 material.customProgramCacheKey=()=>cache()+'-parcel-candidate-tint-'+multiplier.join(',');
 material.userData.candidateColor=definition.candidateColor;return material;
}

export {makeMaterial,buildSurfaceGroup};
