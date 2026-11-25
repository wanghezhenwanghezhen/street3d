/* Seasonal grass from the selected, hash-pinned source leaf attributes.
 * Geometry is Z-up and already contains the source 0.85 scale. No extra fitting,
 * scaling, normal smoothing, target-vertex colour interpolation, or wind is used.
 * MeshStandardMaterial supplies new WebGL lighting, not the frozen Cycles image.
 */
export const SEASONS=Object.freeze(['spring_green','dusk_cool','autumn_warm']);
export const API_VERSION='qianyu-season-grass-runtime/1';
const SCHEMA='qianyu.latest-season-grass/1',ENTRY_SCHEMA='qianyu.latest-season-grass-entry/1',STRIDE=55,SEASON_STRIDE=13;
const SHA=/^[a-f0-9]{64}$/i;

function assert(value,message){if(!value)throw Error('Season grass: '+message);}
function canonicalSeason(value){assert(SEASONS.includes(value),'unknown season '+value);return value;}
function finiteArray(value,length,label){
  assert(value?.length===length,`${label} length ${value?.length}; expected ${length}`);
  for(let i=0;i<length;i++)assert(Number.isFinite(value[i]),`${label}[${i}] is not finite`);
}
function sourceIdentity(value,label){
  assert(SHA.test(value.sceneSha256||''),label+' sceneSha256 missing');
  assert(SHA.test(value.sourceManifestSha256||''),label+' sourceManifestSha256 missing');
}
async function readBytes(url,sha256,signal){
  const response=await fetch(url,{signal});
  assert(response.ok,`HTTP ${response.status} for ${url}`);
  const bytes=await response.arrayBuffer();
  if(sha256){
    assert(SHA.test(sha256),'invalid resource hash for '+url);
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    assert(actual===sha256.toLowerCase(),'resource hash mismatch '+url);
  }
  return bytes;
}
function pinUrl(record,key,baseUrl){
  const value=record[key+'Url'];
  assert(typeof value==='string'&&value.length>0,'missing '+key+'Url');
  return new URL(value,baseUrl).href;
}

const VERTEX_DECLARATIONS=`
attribute float qLeafHeightT;
attribute vec3 qLeafSourceRoot;
attribute vec3 qLeafSourceMid;
attribute vec3 qLeafSourceTip;
attribute vec3 qLeafTierGain;
attribute float qLeafDesiredHue;
varying vec3 qLeafSourceLinear;
flat varying vec4 qLeafGainHue;
`;
const VERTEX_SOURCE=`
// Only the original, unlit source vertex albedo is interpolated by rasterization.
qLeafSourceLinear=qLeafHeightT<=0.5
  ?mix(qLeafSourceRoot,qLeafSourceMid,qLeafHeightT*2.0)
  :mix(qLeafSourceMid,qLeafSourceTip,(qLeafHeightT-0.5)*2.0);
qLeafGainHue=vec4(qLeafTierGain,qLeafDesiredHue);
`;
const FRAGMENT_DECLARATIONS=`
varying vec3 qLeafSourceLinear;
flat varying vec4 qLeafGainHue;
float qLeafSrgb(float c){return c<=0.0031308?c*12.92:1.055*pow(max(c,0.0),1.0/2.4)-0.055;}
float qLeafLinear(float c){return c<=0.04045?c/12.92:pow((c+0.055)/1.055,2.4);}
vec3 qLeafTargetIntrinsic(vec3 sourceLinear,vec3 tierGain,float desiredHue){
  vec3 mapped=sourceLinear*tierGain;
  mapped=vec3(qLeafSrgb(mapped.r),qLeafSrgb(mapped.g),qLeafSrgb(mapped.b));
  float hi=max(mapped.r,max(mapped.g,mapped.b));
  float lo=min(mapped.r,min(mapped.g,mapped.b));
  float saturation=hi!=0.0?(hi-lo)/hi:0.0;
  float h=fract(desiredHue)*6.0;
  float sector=floor(h),f=h-sector;
  float p=hi*(1.0-saturation),q=hi*(1.0-saturation*f),t=hi*(1.0-saturation*(1.0-f));
  vec3 target;
  if(sector<1.0)target=vec3(hi,t,p);
  else if(sector<2.0)target=vec3(q,hi,p);
  else if(sector<3.0)target=vec3(p,hi,t);
  else if(sector<4.0)target=vec3(p,q,hi);
  else if(sector<5.0)target=vec3(t,p,hi);
  else target=vec3(hi,p,q);
  // No intermediate gamut clamp: the source evaluator permits values above 1.
  return vec3(qLeafLinear(target.r),qLeafLinear(target.g),qLeafLinear(target.b));
}
`;

/** CPU counterpart for numeric contract checks; receives interpolated SOURCE RGB. */
export function targetIntrinsic(sourceLinear,tierGain,desiredHue){
  finiteArray(sourceLinear,3,'sourceLinear');finiteArray(tierGain,3,'tierGain');
  assert(sourceLinear.every(v=>v>0)&&tierGain.every(v=>v>=0),'source must be positive and gain nonnegative');
  assert(Number.isFinite(desiredHue),'desiredHue is not finite');
  const mapped=Array.from(sourceLinear,(v,i)=>{const c=v*tierGain[i];return c<=.0031308?c*12.92:1.055*Math.pow(Math.max(c,0),1/2.4)-.055;});
  const hi=Math.max(...mapped),lo=Math.min(...mapped),s=hi!==0?(hi-lo)/hi:0;
  const h=((desiredHue%1)+1)%1*6,sector=Math.floor(h),f=h-sector;
  const p=hi*(1-s),q=hi*(1-s*f),t=hi*(1-s*(1-f));
  const target=[[hi,t,p],[q,hi,p],[p,hi,t],[p,q,hi],[t,p,hi],[hi,p,q]][sector%6];
  return target.map(c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4));
}

function makeMaterial(THREE,stats){
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0,side:THREE.DoubleSide});
  material.name='source-season-leaf-continuous-intrinsic';
  material.toneMapped=false;
  // Duplicated triangle corners carry their original flat face normals. Setting
  // flatShading=true would instead select Three's dFdx/dFdy normal reconstruction.
  material.flatShading=false;
  material.shadowSide=THREE.DoubleSide;
  material.onBeforeCompile=shader=>{
    assert(shader.vertexShader.includes('#include <begin_vertex>'),'r185 vertex hook missing');
    assert(shader.fragmentShader.includes('#include <color_fragment>'),'r185 fragment hook missing');
    shader.vertexShader=VERTEX_DECLARATIONS+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+VERTEX_SOURCE);
    shader.fragmentShader=FRAGMENT_DECLARATIONS+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=qLeafTargetIntrinsic(qLeafSourceLinear,qLeafGainHue.rgb,qLeafGainHue.a);');
    stats.shaderHookApplications++;
  };
  material.customProgramCacheKey=()=>API_VERSION+'-continuous-hsv-r185';
  material.userData={sourceNormalMode:'source-triangle-flat-corner-normals',intrinsicContract:'source-linear-vertex-interpolation-then-fragment-continuous-HSV',roughness:.9,metalness:0};
  return material;
}

function prototypeGeometry(prototype,THREE){
  const positions=prototype.positions,vertexCount=positions?.length/3;
  assert(Number.isInteger(vertexCount)&&vertexCount>0&&vertexCount%3===0,'prototype must contain non-indexed source triangles: '+prototype.id);
  finiteArray(positions,vertexCount*3,prototype.id+' positions');
  finiteArray(prototype.normals,vertexCount*3,prototype.id+' flat normals');
  finiteArray(prototype.heightT,vertexCount,prototype.id+' heightT');
  assert(!prototype.indices||prototype.indices.every((v,i)=>v===i),'prototype indices must be absent or sequential: '+prototype.id);
  for(let i=0;i<vertexCount;i++){
    assert(prototype.heightT[i]>=0&&prototype.heightT[i]<=1,'source heightT outside [0,1]');
    const n=prototype.normals.slice(i*3,i*3+3);
    assert(Math.abs(Math.hypot(...n)-1)<1e-4,'source normal is not unit length');
    const first=Math.floor(i/3)*9;
    assert(n.every((v,k)=>Math.abs(v-prototype.normals[first+k])<1e-6),'source corner normals are not flat within a triangle');
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(prototype.normals,3));
  geometry.setAttribute('qLeafHeightT',new THREE.Float32BufferAttribute(prototype.heightT,1));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

async function readInstances(record,baseUrl,signal,prototypeCount){
  assert(Number.isInteger(record?.count)&&record.count>=0,'invalid core/context leaf count');
  if(record.count===0)return {count:0,values:new Float32Array(),prototypeIndices:new Uint8Array(),globalLeafIndices:new Uint32Array()};
  const [instanceBytes,prototypeBytes,leafBytes]=await Promise.all(['instances','prototypeIndices','globalLeafIndices'].map(key=>readBytes(pinUrl(record,key,baseUrl),record[key+'Sha256'],signal)));
  assert(instanceBytes.byteLength===record.count*STRIDE*4,'instance stride/count mismatch');
  assert(prototypeBytes.byteLength===record.count,'prototype index/count mismatch');
  assert(leafBytes.byteLength===record.count*4,'global leaf index/count mismatch');
  const values=new Float32Array(instanceBytes),prototypeIndices=new Uint8Array(prototypeBytes),globalLeafIndices=new Uint32Array(leafBytes);
  finiteArray(values,record.count*STRIDE,'instance data');
  for(let i=0;i<record.count;i++){
    const offset=i*STRIDE;
    assert(prototypeIndices[i]<prototypeCount,'unknown source prototype index');
    assert(Math.abs(values[offset+3])+Math.abs(values[offset+7])+Math.abs(values[offset+11])<1e-6&&Math.abs(values[offset+15]-1)<1e-6,'invalid column-major affine source matrix');
    for(let si=0;si<SEASONS.length;si++){
      const start=offset+16+si*SEASON_STRIDE;
      for(let c=0;c<9;c++)assert(values[start+c]>0,'source gradient must be positive');
      for(let c=9;c<12;c++)assert(values[start+c]>=0,'tier gain must be nonnegative');
      assert(values[start+12]>=0&&values[start+12]<1,'desired hue must be in [0,1)');
    }
  }
  return {count:record.count,values,prototypeIndices,globalLeafIndices};
}

/**
 * entry: generated index.entries[parcelId], schema qianyu.latest-season-grass-entry/1.
 * baseUrl: URL of generated/index.json; each resource URL is relative to it.
 * The caller owns adding roots to the scene and enabling a real shadow light.
 */
export async function loadSeasonGrass(entry,{THREE,renderer,baseUrl=globalThis.document?.baseURI,signal,season='spring_green',shadows=true}={}){
  assert(THREE&&String(THREE.REVISION)==='185','requires the pinned Three.js r185 instance');
  assert(entry?.schema===ENTRY_SCHEMA,'unsupported entry schema '+entry?.schema);
  sourceIdentity(entry,'entry');canonicalSeason(season);
  assert(baseUrl,'baseUrl is required outside a document');
  assert(new Uint8Array(new Uint16Array([1]).buffer)[0]===1,'only little-endian float resources are supported');
  assert(!entry.seasons||entry.seasons.join('|')===SEASONS.join('|'),'season order differs from binary schema');
  const prototypeBytes=await readBytes(pinUrl(entry,'prototypes',baseUrl),entry.prototypesSha256,signal);
  const prototypeDocument=JSON.parse(new TextDecoder().decode(prototypeBytes));
  sourceIdentity(prototypeDocument,'prototypes');
  assert(prototypeDocument.sceneSha256===entry.sceneSha256&&prototypeDocument.sourceManifestSha256===entry.sourceManifestSha256,'geometry and seasonal color source identities differ');
  const prototypes=prototypeDocument.prototypes;
  assert(Array.isArray(prototypes)&&prototypes.length>0&&prototypes.length<=256,'invalid source prototypes');
  const [coreData,contextData]=await Promise.all([entry.core,entry.context].map(record=>readInstances(record,baseUrl,signal,prototypes.length)));
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const root=new THREE.Group(),contextRoot=new THREE.Group();
  root.name='selected-season-grass:'+entry.parcelId;contextRoot.name='selected-season-grass-context:'+entry.parcelId;
  contextRoot.visible=false;
  const stats={apiVersion:API_VERSION,schema:SCHEMA,parcelId:entry.parcelId,sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256,season,leafCount:coreData.count,contextLeafCount:contextData.count,grassCount:entry.core.tuftCount??null,contextGrassCount:entry.context.tuftCount??null,wholeMapTuftCount:entry.wholeMapTuftCount??null,wholeMapLeafCount:entry.wholeMapLeafCount??null,prototypeCount:prototypes.length,batches:0,triangles:0,contextTriangles:0,shaderHookApplications:0,requestedShadows:!!shadows,rendererShadowMapEnabledAtLoad:!!renderer?.shadowMap?.enabled,normalMode:'source-triangle-flat-corner-normals',colorEvaluation:'fragment-continuous-HSV-after-source-linear-interpolation',lightingRepresentation:'new-WebGL-standard-lighting-not-Cycles-pixel-equivalence'};
  const material=makeMaterial(THREE,stats),batches=[],geometries=new Set();
  let disposed=false;
  try{
    for(const [group,data,context] of [[root,coreData,false],[contextRoot,contextData,true]]){
      const byPrototype=Array.from({length:prototypes.length},()=>[]);
      for(let i=0;i<data.count;i++)byPrototype[data.prototypeIndices[i]].push(i);
      byPrototype.forEach((sourceRows,prototypeIndex)=>{
        if(!sourceRows.length)return;
        const prototype=prototypes[prototypeIndex],geometry=prototypeGeometry(prototype,THREE);geometries.add(geometry);
        const attributes={};
        for(const [name,size] of [['qLeafSourceRoot',3],['qLeafSourceMid',3],['qLeafSourceTip',3],['qLeafTierGain',3],['qLeafDesiredHue',1]]){
          const attribute=new THREE.InstancedBufferAttribute(new Float32Array(sourceRows.length*size),size);
          attribute.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,attribute);attributes[name]=attribute;
        }
        const mesh=new THREE.InstancedMesh(geometry,material,sourceRows.length);
        mesh.name=prototype.id+(context?':context':':parcel');
        sourceRows.forEach((sourceRow,i)=>mesh.instanceMatrix.array.set(data.values.subarray(sourceRow*STRIDE,sourceRow*STRIDE+16),i*16));
        mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=!!shadows;mesh.receiveShadow=!!shadows;
        mesh.computeBoundingBox();mesh.computeBoundingSphere();
        mesh.userData={seasonGrass:true,context,prototypeId:prototype.id,modelId:prototype.modelId,leafLocalId:prototype.leafLocalId,sourceGlobalLeafIndices:sourceRows.map(i=>data.globalLeafIndices[i]),sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256};
        group.add(mesh);batches.push({mesh,attributes,data,sourceRows});stats.batches++;
        stats[context?'contextTriangles':'triangles']+=prototype.positions.length/9*sourceRows.length;
      });
    }
    function setSeason(next){
      assert(!disposed,'cannot change a disposed grass set');canonicalSeason(next);
      const seasonalOffset=16+SEASONS.indexOf(next)*SEASON_STRIDE;
      for(const {attributes,data,sourceRows} of batches){
        sourceRows.forEach((sourceRow,i)=>{
          const start=sourceRow*STRIDE+seasonalOffset;
          attributes.qLeafSourceRoot.array.set(data.values.subarray(start,start+3),i*3);
          attributes.qLeafSourceMid.array.set(data.values.subarray(start+3,start+6),i*3);
          attributes.qLeafSourceTip.array.set(data.values.subarray(start+6,start+9),i*3);
          attributes.qLeafTierGain.array.set(data.values.subarray(start+9,start+12),i*3);
          attributes.qLeafDesiredHue.array[i]=data.values[start+12];
        });
        Object.values(attributes).forEach(attribute=>{attribute.needsUpdate=true;});
      }
      stats.season=next;material.userData.season=next;
      root.userData.season=contextRoot.userData.season=next;
      return stats;
    }
    function setShadows(enabled){
      assert(!disposed,'cannot change a disposed grass set');
      for(const {mesh} of batches){mesh.castShadow=!!enabled;mesh.receiveShadow=!!enabled;}
      stats.requestedShadows=!!enabled;
      stats.rendererShadowMapEnabled=!!renderer?.shadowMap?.enabled;
      return stats;
    }
    function dispose(){
      if(disposed)return;disposed=true;
      for(const {mesh} of batches)mesh.dispose();
      geometries.forEach(geometry=>geometry.dispose());material.dispose();
      root.removeFromParent();contextRoot.removeFromParent();root.clear();contextRoot.clear();
      batches.length=0;stats.disposed=true;
    }
    root.userData={sourceIdentity:{sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256},leafCount:coreData.count};
    contextRoot.userData={sourceIdentity:root.userData.sourceIdentity,leafCount:contextData.count};
    setSeason(season);setShadows(shadows);
    return {root,contextRoot,setSeason,setShadows,stats,dispose};
  }catch(error){
    geometries.forEach(geometry=>geometry.dispose());material.dispose();
    for(const {mesh} of batches)mesh.dispose();
    throw error;
  }
}
