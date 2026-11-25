import {loadIndexedGeometry} from './indexed-geometry-loader.js';
export async function loadBakedBase(manifest,materials,THREE){
 const built=await loadIndexedGeometry(manifest,materials,THREE,{kind:'base'});
 return {group:built.group,stats:{sourceMeshes:manifest.sourceMeshes,drawMeshes:built.group.children.length,materials:materials.size,rimMeshes:manifest.rimMeshes,retainedGrassSideTextures:manifest.materials.filter(d=>d.shader==='source-tile-albedo'&&d.style?.startsWith('grass:')).length,sourceGrassFields:manifest.materials.filter(d=>d.shader==='grass-low-field').length,sourceGroundSha256:manifest.sourceSha256,bakedBaseGeometry:true,losslessIndexed:true,geometryBytes:built.geometryBytes,geometryPackBufferBytes:built.packBufferBytes,triangles:built.triangles}};
}
