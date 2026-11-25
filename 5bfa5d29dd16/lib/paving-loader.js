import {loadIndexedGeometry} from './indexed-geometry-loader.js';
export async function loadPavingRelief(materials,THREE,manifestUrl='/data/paving-indexed-r5/manifest.json'){
 const response=await fetch(manifestUrl);if(!response.ok)throw Error('Paving manifest missing');const manifest=await response.json();
 const built=await loadIndexedGeometry(manifest,materials,THREE,{kind:'paving'});
 return {group:built.group,stats:{pavingReliefMeshes:manifest.sourceMeshes,reliefTriangles:manifest.triangles,reliefPieces:manifest.pieces,reliefChunks:manifest.chunks.length,offlineBaked:true,sourceGroundSha256:manifest.sourceSha256,losslessIndexed:true,geometryBytes:built.geometryBytes,geometryPackBufferBytes:built.packBufferBytes}};
}
