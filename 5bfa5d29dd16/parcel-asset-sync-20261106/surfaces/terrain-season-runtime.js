/* Selected seasonal terrain, preserving the current parent's exact triangles.
 * This unlit albedo module does not create a shadow or replace an unverified mesh.
 * The viewer owns hiding the returned replacement IDs and its shadow receiver.
 */
export const TERRAIN_API_VERSION='qianyu-season-terrain-runtime/1';
const SEASONS=['spring_green','dusk_cool','autumn_warm'];
const ENTRY_SCHEMA='qianyu.latest-season-grass-entry/1';
const TERRAIN_SCHEMA='qianyu.latest-season-grass-surfaces/1';
const SHA=/^[a-f0-9]{64}$/i;

function assert(value,message){if(!value)throw Error('Season terrain: '+message);}
function seasonIndex(season){const i=SEASONS.indexOf(season);assert(i>=0,'unknown season '+season);return i;}
function validateIdentity(value,label){
  assert(SHA.test(value.sceneSha256||''),label+' sceneSha256 missing');
  assert(SHA.test(value.sourceManifestSha256||''),label+' sourceManifestSha256 missing');
}
function idSet(ids,label){
  assert(Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0),label+' must be an ID array');
  const result=new Set(ids);assert(result.size===ids.length,label+' contains duplicate IDs');return result;
}
function sameIds(a,b){return a.size===b.size&&[...a].every(id=>b.has(id));}
function multiplierFor(row,candidateTints){
  const read=id=>candidateTints instanceof Map?candidateTints.get(id):candidateTints?.[id];
  const value=read(row.replaceMeshId)??read(row.sourceMaterialId);
  if(value==null)return [1,1,1];
  const rgb=Array.isArray(value)||ArrayBuffer.isView(value)?value:value.linearMultiplier;
  assert(rgb?.length===3&&Array.from(rgb).every(v=>Number.isFinite(v)&&v>=0),'invalid candidate linear multiplier for '+row.replaceMeshId);
  return Array.from(rgb);
}
function validateRows(rows,replacements,role){
  assert(Array.isArray(rows),role+' meshes missing');
  const represented=new Set(),ids=new Set();
  for(const row of rows){
    assert(typeof row.id==='string'&&!ids.has(row.id),role+' duplicate/invalid mesh ID');ids.add(row.id);
    assert(replacements.has(row.replaceMeshId),'mesh is not admitted for whole-mesh replacement: '+row.id);
    assert(row.positionsPreservedFromCurrentParent===true,'source parent positions not confirmed: '+row.id);
    assert(row.strideFloats===8,'unsupported vertex stride: '+row.id);
    assert(Number.isInteger(row.vertexCount)&&row.vertexCount>0&&row.vertexCount%3===0,'invalid source vertex count: '+row.id);
    assert(row.triangleCount===row.vertexCount/3,'triangle count differs from source buffer: '+row.id);
    assert(Array.isArray(row.gains)&&row.gains.length===3&&row.gains.every(g=>Array.isArray(g)&&g.length===3&&g.every(v=>Number.isFinite(v)&&v>=0)),'three seasonal linear gains required: '+row.id);
    represented.add(row.replaceMeshId);
  }
  assert(sameIds(represented,replacements),role+' replacement IDs have missing geometry');
}
async function browserTexture(bytes,{THREE}){
  const blobUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  try{return await new THREE.TextureLoader().loadAsync(blobUrl);}
  finally{URL.revokeObjectURL(blobUrl);}
}

/**
 * entry: one generated/index.json entry. All resource URLs use that index URL.
 * candidateTints: Map or object, replaceMeshId first, sourceMaterialId second;
 * value is a linear RGB multiplier or {linearMultiplier:[r,g,b]}.
 * textureDecoder is an optional decoding adapter for non-browser integration.
 * The default decodes the SAME bytes whose SHA256 was verified, using a blob URL.
 */
export async function loadSeasonTerrain(entry,{THREE,renderer,baseUrl=globalThis.document?.baseURI,signal,season='spring_green',candidateTints=null,textureDecoder=null}={}){
  assert(THREE&&String(THREE.REVISION)==='185','requires the pinned Three.js r185 instance');
  assert(entry?.schema===ENTRY_SCHEMA,'unsupported entry schema '+entry?.schema);
  validateIdentity(entry,'entry');seasonIndex(season);
  assert(baseUrl,'baseUrl is required outside a document');
  assert(new Uint8Array(new Uint16Array([1]).buffer)[0]===1,'only little-endian resources are supported');
  const descriptor=entry.terrain;assert(descriptor,'terrain descriptor missing');
  const root=new THREE.Group(),contextRoot=new THREE.Group();
  root.name='selected-season-terrain:'+entry.parcelId;contextRoot.name='selected-season-terrain-context:'+entry.parcelId;contextRoot.visible=false;
  const resources=new Map(),textures=new Map(),materials=new Map(),ownedTextures=new Set(),geometries=new Set();
  const stats={apiVersion:TERRAIN_API_VERSION,parcelId:entry.parcelId,sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256,season,meshCount:0,contextMeshCount:0,triangleCount:0,contextTriangleCount:0,replacedMeshCount:0,contextReplacedMeshCount:0,heldMeshCount:0,verifiedResources:0,verifiedBytes:0,textureCount:0,materialCount:0,rawNormalLengthMin:Infinity,rawNormalLengthMax:0,normalValuesChanged:false,textureDecodeMode:textureDecoder?'provided-decoder':'verified-PNG-bytes-blob-TextureLoader',lightingRepresentation:'unlit-source-linear-albedo-times-season-gain',shadowRepresentation:'caller-owned-separate-receiver',sourceParentGeometryPreserved:true};
  let disposed=false;
  function resourceUrl(row,key){assert(typeof row[key+'Url']==='string','missing '+key+'Url');return new URL(row[key+'Url'],baseUrl).href;}
  async function verified(row,key){
    const url=resourceUrl(row,key),expected=row[key+'Sha256'];
    assert(SHA.test(expected||''),'resource SHA256 required: '+url);
    if(resources.has(url)){
      const previous=resources.get(url);assert(previous.sha256===expected.toLowerCase(),'one URL has different declared hashes: '+url);return previous.promise;
    }
    const promise=(async()=>{
      const response=await fetch(url,{signal});assert(response.ok,`HTTP ${response.status}: ${url}`);
      const bytes=await response.arrayBuffer();
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      assert(actual===expected.toLowerCase(),'resource hash mismatch: '+url);
      stats.verifiedResources++;stats.verifiedBytes+=bytes.byteLength;return bytes;
    })();
    resources.set(url,{sha256:expected.toLowerCase(),promise});return promise;
  }
  async function textureFor(row){
    const key=resourceUrl(row,'texture');
    if(textures.has(key)){
      assert(textures.get(key).sha256===row.textureSha256,'texture hash changed within one entry');return textures.get(key).promise;
    }
    const promise=(async()=>{
      const bytes=await verified(row,'texture');
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const texture=await (textureDecoder||browserTexture)(bytes,{THREE,url:key,sha256:row.textureSha256,signal});
      assert(texture?.isTexture,'texture decoder did not return a Three Texture');ownedTextures.add(texture);
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
      texture.anisotropy=renderer?Math.min(16,renderer.capabilities.getMaxAnisotropy()):4;
      texture.flipY=true;texture.needsUpdate=true;
      texture.userData={sourceUrl:key,sourceSha256:row.textureSha256,uvContract:'unchanged-source-world-UV',colorSpace:'sRGB'};
      stats.textureCount++;return texture;
    })();
    textures.set(key,{sha256:row.textureSha256,promise});return promise;
  }
  function dispose(){
    if(disposed)return;disposed=true;
    root.removeFromParent();contextRoot.removeFromParent();root.clear();contextRoot.clear();
    geometries.forEach(g=>g.dispose());for(const record of materials.values())record.material.dispose();ownedTextures.forEach(t=>t.dispose());
    resources.clear();textures.clear();materials.clear();geometries.clear();ownedTextures.clear();stats.disposed=true;
  }
  try{
    const terrain=JSON.parse(new TextDecoder().decode(await verified(descriptor,'geometry')));
    assert(terrain.schema===TERRAIN_SCHEMA,'unsupported terrain schema '+terrain.schema);validateIdentity(terrain,'terrain');
    assert(terrain.sceneSha256===entry.sceneSha256&&terrain.sourceManifestSha256===entry.sourceManifestSha256&&terrain.parcelId===entry.parcelId,'terrain and entry source identities differ');
    assert(terrain.coordinateSystem==='MAP_Z_UP','terrain coordinate system changed');
    const replace=idSet(terrain.replaceMeshIds,'terrain replaceMeshIds'),contextReplace=idSet(terrain.contextReplaceMeshIds,'terrain contextReplaceMeshIds');
    assert(sameIds(replace,idSet(descriptor.replaceMeshIds,'entry replaceMeshIds'))&&sameIds(contextReplace,idSet(descriptor.contextReplaceMeshIds,'entry contextReplaceMeshIds')),'entry and terrain replacement admission differ');
    validateRows(terrain.core,replace,'core');validateRows(terrain.context,contextReplace,'context');
    assert(Array.isArray(terrain.heldMeshes),'held mesh evidence missing');
    for(const held of terrain.heldMeshes){
      assert(held.role==='core'||held.role==='context','unknown held mesh scope');
      assert(!(held.role==='core'?replace:contextReplace).has(held.meshId),'held mesh must remain on parent: '+held.meshId);
    }
    stats.replacedMeshCount=replace.size;stats.contextReplacedMeshCount=contextReplace.size;stats.heldMeshCount=terrain.heldMeshes.length;
    async function build(row,group,context){
      const [bytes,sourceIdsBytes]=await Promise.all([verified(row,'geometry'),verified(row,'sourceTriangleIds')]);
      assert(bytes.byteLength===row.vertexCount*8*4,'source geometry stride/length mismatch: '+row.id);
      assert(sourceIdsBytes.byteLength===row.triangleCount*4,'source triangle ID count mismatch: '+row.id);
      const values=new Float32Array(bytes),sourceTriangleIds=new Uint32Array(sourceIdsBytes);
      for(let i=0;i<values.length;i++)assert(Number.isFinite(values[i]),'non-finite source vertex: '+row.id);
      for(let i=0;i<row.vertexCount;i++){
        const o=i*8+3,length=Math.hypot(values[o],values[o+1],values[o+2]);assert(length>1e-10,'zero source shading normal: '+row.id);
        stats.rawNormalLengthMin=Math.min(stats.rawNormalLengthMin,length);stats.rawNormalLengthMax=Math.max(stats.rawNormalLengthMax,length);
      }
      const texture=await textureFor(row),tint=multiplierFor(row,candidateTints);
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const materialKey=JSON.stringify([row.textureSha256,row.gains,tint]);
      let record=materials.get(materialKey);
      if(!record){
        const material=new THREE.MeshBasicMaterial({color:0xffffff,map:texture,side:THREE.DoubleSide,toneMapped:false});
        material.name='source-season-terrain-albedo';
        material.userData={seasonTerrain:true,seasonGains:row.gains,candidateLinearMultiplier:tint,sourceTextureSha256:row.textureSha256,normalContract:'raw interpolated source normals preserved; unlit material does not evaluate lighting normals'};
        record={material,gains:row.gains,tint};materials.set(materialKey,record);stats.materialCount++;
      }
      const interleaved=new THREE.InterleavedBuffer(values,8),geometry=new THREE.BufferGeometry();geometries.add(geometry);
      geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
      geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(interleaved,3,3));
      geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,6));
      // Do not normalize clipped corner normals. Their raw values must interpolate
      // before fragment normalization in any separately supplied lit receiver.
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      geometry.userData={sourceGeometrySha256:row.geometrySha256,sourceNormalContract:row.normalContract};
      const mesh=new THREE.Mesh(geometry,record.material);mesh.name=row.id;
      mesh.castShadow=false;mesh.receiveShadow=false;
      mesh.userData={seasonTerrain:true,context,replaceMeshId:row.replaceMeshId,sourceMaterialId:row.sourceMaterialId,sourceDomain:row.sourceDomain,sourceObjectId:row.sourceObjectId,familyIndex:row.familyIndex,tier:row.tier,sourceTriangleIds,sourceGeometrySha256:row.geometrySha256,positionsPreservedFromCurrentParent:true,normalContract:row.normalContract};
      group.add(mesh);stats[context?'contextMeshCount':'meshCount']++;stats[context?'contextTriangleCount':'triangleCount']+=row.triangleCount;
    }
    const jobs=[...terrain.core.map(row=>({row,group:root,context:false})),...terrain.context.map(row=>({row,group:contextRoot,context:true}))];
    for(let i=0;i<jobs.length;i+=8){
      const settled=await Promise.allSettled(jobs.slice(i,i+8).map(({row,group,context})=>build(row,group,context)));
      const failure=settled.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    }
    assert(stats.triangleCount===descriptor.triangleCount&&stats.contextTriangleCount===descriptor.contextTriangleCount,'entry triangle counts differ from actual buffers');
    if(stats.rawNormalLengthMin===Infinity)stats.rawNormalLengthMin=null;
    function setSeason(next){
      assert(!disposed,'cannot change disposed terrain');const si=seasonIndex(next);
      for(const {material,gains,tint} of materials.values()){
        // map is decoded from sRGB by Three; this color is explicitly LINEAR.
        // Gains already include texture -> source season -> selected tier once.
        material.color.setRGB(gains[si][0]*tint[0],gains[si][1]*tint[1],gains[si][2]*tint[2],THREE.LinearSRGBColorSpace);
        material.userData.season=next;material.userData.appliedLinearGain=gains[si].map((v,k)=>v*tint[k]);
      }
      stats.season=next;root.userData.season=contextRoot.userData.season=next;return stats;
    }
    root.userData={sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256,replaceMeshIds:[...replace]};
    contextRoot.userData={sceneSha256:entry.sceneSha256,sourceManifestSha256:entry.sourceManifestSha256,replaceMeshIds:[...contextReplace]};
    setSeason(season);
    return {root,contextRoot,replaceMeshIds:[...replace],contextReplaceMeshIds:[...contextReplace],setSeason,stats,dispose};
  }catch(error){dispose();throw error;}
}
