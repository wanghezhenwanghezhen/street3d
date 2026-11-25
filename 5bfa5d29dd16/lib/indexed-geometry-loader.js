// Lossless vertex deduplication only: original triangle order and all float32
// position/normal/UV/color bits are recoverable from each chunk's index array.
export async function loadIndexedGeometry(manifest, materials, THREE, {kind='base'}={}) {
 const layout=manifest.geometryLayout;
 if(manifest.schema!=='qianyu-lossless-indexed-geometry/1'||layout?.componentType!=='float32')throw Error('Unsupported indexed geometry manifest');
 const response=await fetch(manifest.pack.url);
 if(!response.ok)throw Error('Missing indexed geometry pack '+manifest.pack.url);
 const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(raw.byteLength!==manifest.pack.byteLength)throw Error('Indexed geometry pack length mismatch');
 const group=new THREE.Group();group.name=kind==='base'?'frozen-source-ground':'source-joint-paving-relief';
 let geometryBytes=0,triangles=0;
 for(const [i,chunk] of manifest.chunks.entries()) {
  if(globalThis.loadingDiagnostics)globalThis.loadingDiagnostics.surfacePhase=kind+'-indexed-'+i+'/'+manifest.chunks.length;
  const material=materials.get(chunk.materialId);
  if(!material)throw Error('Missing source material '+chunk.materialId);
  if(chunk.vertexByteOffset%4||chunk.vertexByteLength!==chunk.vertices*layout.stride*4)throw Error('Invalid indexed vertex range');
  const vertices=new Float32Array(raw,chunk.vertexByteOffset,chunk.vertices*layout.stride);
  const Type=chunk.indexType==='uint16'?Uint16Array:chunk.indexType==='uint32'?Uint32Array:null;
  if(!Type||chunk.indexByteOffset%Type.BYTES_PER_ELEMENT||chunk.indexByteLength!==chunk.indexCount*Type.BYTES_PER_ELEMENT||chunk.indexCount%3)throw Error('Invalid indexed triangle range');
  const indices=new Type(raw,chunk.indexByteOffset,chunk.indexCount),buffer=new THREE.InterleavedBuffer(vertices,layout.stride),geometry=new THREE.BufferGeometry();
  if(manifest.indexEncoding==='delta-modulo'){
   // In-place unsigned modular prefix sum restores source indices exactly.
   let value=0;for(let k=0;k<indices.length;k++){value=(value+indices[k])>>>0;indices[k]=value;if(Type===Uint16Array)value&=65535;}
  }
  for(const [name,[size,offset]] of Object.entries(layout.attributes))geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,size,offset));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.name=kind==='base'?'ground-'+chunk.materialId:'pavers-'+chunk.materialId+'-'+chunk.cell.join(',');
  mesh.userData={sourceAligned:true,losslessIndexed:true,sourceExpandedSha256:chunk.sourceExpandedSha256,...(kind==='paving'?{reliefRange:[manifest.minRelief,manifest.maxRelief],sha256:chunk.sourceExpandedSha256}:{})};
  group.add(mesh);geometryBytes+=vertices.byteLength+indices.byteLength;triangles+=indices.length/3;
 }
 return {group,geometryBytes,triangles,packBufferBytes:raw.byteLength};
}
