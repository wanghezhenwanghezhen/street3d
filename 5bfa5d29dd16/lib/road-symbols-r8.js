import * as THREE from 'three';

// Carry source UVs through each clip: changing roads never rotates or mirrors an A asset.
export function clipSymbolTriangle(subject,triangle){
 const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
 const area=cross(triangle[0],triangle[1],triangle[2]);if(Math.abs(area)<1e-12)return [];
 const sign=Math.sign(area);let poly=subject;
 for(let edge=0;edge<3&&poly.length;edge++){
  const a=triangle[edge],b=triangle[(edge+1)%3],out=[];
  for(let k=0;k<poly.length;k++){
   const p=poly[k],q=poly[(k+1)%poly.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign,insideP=dp>=-1e-10,insideQ=dq>=-1e-10;
   if(insideP)out.push(p);
   if(insideP!==insideQ){const t=dp/(dp-dq);out.push(p.map((v,j)=>v+(q[j]-v)*t));}
  }
  poly=out;
 }
 return poly;
}
export function collectAsphaltTop(geometry){
 const p=geometry.attributes.position,index=geometry.index,triangles=[];
 for(let i=0;i<(index?.count??p.count);i+=3){
  const tri=[0,1,2].map(k=>{const j=index?index.getX(i+k):i+k;return [p.getX(j),p.getY(j),p.getZ(j)];});
  if(tri.every(v=>Math.abs(v[1])<1e-6))triangles.push(tri.map(v=>[v[0],v[2]]));
 }
 return triangles;
}
function sourceMaterial(asset,map){
 const material=new THREE.MeshBasicMaterial({name:'source-symbol:'+asset.sourceSpriteId,map,color:asset.tint,transparent:true,alphaTest:.012,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false});
 // Match macaron-export-20261008's display-pixel HSV operation exactly once.
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>',`#include <colorspace_fragment>
   vec3 roadColor=gl_FragColor.rgb;
   float roadHi=max(roadColor.r,max(roadColor.g,roadColor.b)),roadLo=min(roadColor.r,min(roadColor.g,roadColor.b));
   float roadOldS=roadHi>0.?1.-roadLo/roadHi:0.;
   float roadNewS=min(1.,roadOldS*${Number(asset.saturation).toFixed(8)}),roadNewV=min(1.,roadHi*${Number(asset.valueGain).toFixed(8)});
   vec3 roadHue=roadHi>roadLo?(roadColor-vec3(roadLo))/(roadHi-roadLo):vec3(1.);
   gl_FragColor.rgb=roadNewV*(vec3(1.-roadNewS)+roadNewS*roadHue);`);
 };
 material.customProgramCacheKey=()=>`road-symbol-source-hsv-${asset.saturation}-${asset.valueGain}`;
 return material;
}
async function sourceTexture(asset,loader,maxTextureSize,optimized){
 const candidate=maxTextureSize===512?optimized[asset.url]:null;
 const map=await loader.loadAsync(candidate?.url??asset.url),source=map.image,expected=candidate?.size??asset.size;
 try{
 if(source.width!==expected[0]||source.height!==expected[1])throw Error('Road symbol image size changed: '+asset.url);
 // The 512 px derivative reproduces the former canvas upload; other limits use the source.
 if(maxTextureSize&&Math.max(source.width,source.height)>maxTextureSize&&typeof document!=='undefined'){
  const ratio=maxTextureSize/Math.max(source.width,source.height),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(source.width*ratio));canvas.height=Math.max(1,Math.round(source.height*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Road symbol resize canvas unavailable');
  ctx.drawImage(source,0,0,canvas.width,canvas.height);map.image=canvas;map.needsUpdate=true;
 }
 map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;map.flipY=true;map.anisotropy=4;map.name=asset.url;
 return map;
 }catch(error){map.dispose();throw error;}
}
export async function buildRoadSymbols(roads,surfaces,{textureLoader=new THREE.TextureLoader(),maxTextureSize=512}={}){
 const response=await fetch('/data/road-symbols-r8/manifest.json');if(!response.ok)throw Error('Road symbol bindings unavailable');const manifest=await response.json();
 if(manifest.schema!=='qianyu-road-symbols/1')throw Error('Unsupported source road symbols');
 const optimizedResponse=await fetch('/data/fast-r13/road-symbols.json');if(!optimizedResponse.ok)throw Error('Road texture derivatives unavailable');const optimized=await optimizedResponse.json();
 const rows=new Map(manifest.rows.map(r=>[r.roadId,r]));
 if(rows.size!==roads.length||roads.some(r=>!rows.has(r.id)))throw Error('Road symbol ID coverage mismatch');
 const group=new THREE.Group();group.name='source-road-symbols-r8';group.userData.roadSymbolLayer=true;
 const materials=new Map(),textureRows=[],batches=new Map(),placements=[];
 let complete=false;try{
 await Promise.all(Object.entries(manifest.assets).map(async([id,asset])=>{
  const map=await sourceTexture(asset,textureLoader,maxTextureSize,optimized);materials.set(id,sourceMaterial(asset,map));
  textureRows.push({assetId:id,url:asset.url,sourceSha256:asset.sha256,sourceSize:asset.size,uploadSize:[map.image.width,map.image.height],estimatedRGBABytes:map.image.width*map.image.height*4*(map.generateMipmaps?4/3:1),textureUuid:map.uuid,sourcePngUnchanged:true,transportUrl:maxTextureSize===512?optimized[asset.url]?.url:asset.url});
 }));
 let clippedPieces=0;
 for(const road of roads){
  const row=rows.get(road.id);if(row.visualOnlyBlocked)continue;
  if(JSON.stringify(row.cell_uv)!==JSON.stringify(road.cell_uv)||JSON.stringify(row.center)!==JSON.stringify(road.center))throw Error('Road symbol placement changed: '+road.id);
  const asset=manifest.assets[row.assetId],ground=surfaces.get(road.id);if(!asset||!ground?.length)throw Error('Road symbol has no source/asphalt: '+road.id);
  if(!batches.has(row.assetId))batches.set(row.assetId,{positions:[],uv:[],ids:[]});const batch=batches.get(row.assetId);let triangles=0;
  for(let i=0;i<asset.positionsNativeXY.length;i+=3){
   const tri=[0,1,2].map(k=>{const p=asset.positionsNativeXY[i+k],uv=asset.uv[i+k];return [road.center[0]+p[0]*asset.appliedScale,-road.center[1]-p[1]*asset.appliedScale,uv[0],uv[1]];});
   const bounds=[Math.min(...tri.map(p=>p[0])),Math.min(...tri.map(p=>p[1])),Math.max(...tri.map(p=>p[0])),Math.max(...tri.map(p=>p[1]))];
   for(const asphalt of ground){
    if(Math.max(...asphalt.map(p=>p[0]))<bounds[0]||Math.min(...asphalt.map(p=>p[0]))>bounds[2]||Math.max(...asphalt.map(p=>p[1]))<bounds[1]||Math.min(...asphalt.map(p=>p[1]))>bounds[3])continue;
    const poly=clipSymbolTriangle(tri,asphalt);
    for(let k=1;k+1<poly.length;k++){
     const a=poly[0],b=poly[k],c=poly[k+1];if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-12)continue;
     for(const p of [a,b,c]){batch.positions.push(p[0],.0004,p[1]);batch.uv.push(p[2],p[3]);}
     batch.ids.push(road.id);triangles++;clippedPieces++;
    }
   }
  }
  if(!triangles)throw Error('Road symbol clipped away: '+road.id);
  placements.push({roadId:road.id,assetId:row.assetId,glyph:row.glyph,center:road.center,orientation:'A',scale:asset.appliedScale,triangles,mappingPolicy:row.mappingPolicy});
 }
 for(const [assetId,batch] of batches){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uv,2));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,materials.get(assetId));mesh.name='road-symbol:'+assetId;mesh.renderOrder=3;mesh.castShadow=false;mesh.receiveShadow=false;mesh.raycast=()=>{};mesh.userData={roadSymbol:true,sourceAssetId:assetId,triangleRoadIds:batch.ids,visualOnly:true,excludedFromGroundSupport:true};group.add(mesh);
 }
 const starts=placements.filter(r=>r.glyph==='start');if(starts.length!==1||starts[0].roadId!==manifest.startRoadId)throw Error('Road start must be unique and match the player start');
 const stats={revision:manifest.revision,count:placements.length,drawMeshes:group.children.length,triangles:clippedPieces,startRoadId:manifest.startRoadId,startCount:starts.length,originalSourceImages:4,textureUploadLimit:maxTextureSize,textureRows,estimatedTextureRGBABytes:textureRows.reduce((sum,r)=>sum+r.estimatedRGBABytes,0),memoryMeasurement:'actual texture.image upload dimensions; RGBA+mipmap estimate, not driver-reported GPU residency',mappingStatus:manifest.mappingStatus,sourceSceneSha256:manifest.sourceScene.sha256,sourceGeometrySha256:manifest.sourceGeometry.sha256,geometryClippedToActualAsphalt:true,groundGeometryChanged:false,placements};
 group.userData.snapshot=stats;complete=true;return {group,stats};
 }finally{if(!complete){group.traverse(o=>o.geometry?.dispose());for(const material of materials.values()){material.map?.dispose();material.dispose();}}}
}
