// r7 adds separate normalized typed attributes. Legacy float32 manifests remain supported.
// No Float32 position/color expansion occurs for r7; one decompressed buffer backs all views.
const typedArrays={int16:Int16Array,uint16:Uint16Array,uint32:Uint32Array,float32:Float32Array};
function typedView(raw,spec,count){
 const Type=typedArrays[spec.componentType];if(!Type)throw Error('Unsupported terrain component '+spec.componentType);
 if(!Number.isInteger(spec.itemSize)||spec.itemSize<1||spec.itemSize>4)throw Error('Invalid terrain attribute size');
 if(!Number.isInteger(spec.byteOffset)||spec.byteOffset<0||spec.byteOffset%Type.BYTES_PER_ELEMENT)throw Error('Unaligned terrain attribute');
 if(spec.count!==count||spec.byteLength!==count*spec.itemSize*Type.BYTES_PER_ELEMENT||spec.byteOffset+spec.byteLength>raw.byteLength)throw Error('Invalid terrain attribute range');
 const array=new Type(raw,spec.byteOffset,count*spec.itemSize);
 if(Type===Float32Array)for(const value of array)if(!Number.isFinite(value))throw Error('Non-finite terrain attribute');
 return array;
}
export async function loadGeometryChunk(manifest,chunk,materials,THREE,{kind='base',signal}={}){
 const part=chunk.standalone;if(!part)throw Error('No independent stream chunk');
 if(!Number.isInteger(chunk.vertices)||chunk.vertices<3||!Number.isInteger(chunk.indexCount)||chunk.indexCount<3||chunk.indexCount%3)throw Error('Invalid terrain vertex/index count');
 if(!['uint16','uint32'].includes(chunk.indexType))throw Error('Unsupported terrain index type');
 const response=await fetch(part.url,{signal});if(!response.ok)throw Error('Missing geometry chunk '+part.url);
 const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(raw.byteLength!==part.byteLength)throw Error('Stream chunk length mismatch');
 if(part.expandedSha256){
  if(!globalThis.crypto?.subtle)throw Error('Terrain integrity check requires Web Crypto');
  const digest=await crypto.subtle.digest('SHA-256',raw),hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==part.expandedSha256)throw Error('Stream chunk SHA-256 mismatch '+part.url);
 }
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const material=materials.get(chunk.materialId);if(!material)throw Error('Missing source material '+chunk.materialId);
 const quantized=chunk.transportEncoding==='separate-normalized-attributes-r7',geometry=new THREE.BufferGeometry();let geometryBytes=0,scale=1;
 try{
 if(quantized){
  scale=chunk.positionScale;if(!(Number.isFinite(scale)&&scale>0))throw Error('Invalid terrain position scale');
  for(const [name,spec]of Object.entries(chunk.quantizedAttributes)){
   const array=typedView(raw,spec,chunk.vertices);geometry.setAttribute(name,new THREE.BufferAttribute(array,spec.itemSize,spec.normalized));geometryBytes+=array.byteLength;
  }
  if(geometry.attributes.position?.itemSize!==3||geometry.attributes.normal?.itemSize!==3)throw Error('Missing terrain position/normal');
  geometry.userData={compacted:true,positionScale:scale,maximumLocalPositionError:chunk.maximumLocalPositionError,quantizedTransport:true};
 }else{
  const layout=manifest.geometryLayout,vertices=new Float32Array(raw,part.vertexByteOffset,chunk.vertices*layout.stride),buffer=new THREE.InterleavedBuffer(vertices,layout.stride);geometryBytes+=vertices.byteLength;
  for(const value of vertices)if(!Number.isFinite(value))throw Error('Non-finite terrain vertex');
  for(const [name,[size,offset]]of Object.entries(layout.attributes))geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,size,offset));
 }
 const Type=chunk.indexType==='uint16'?Uint16Array:Uint32Array;
 if(!Number.isInteger(part.indexByteOffset)||part.indexByteOffset<0||part.indexByteOffset%Type.BYTES_PER_ELEMENT||part.indexByteOffset+chunk.indexCount*Type.BYTES_PER_ELEMENT>raw.byteLength)throw Error('Invalid terrain index range');
 const indices=new Type(raw,part.indexByteOffset,chunk.indexCount);
 if(part.indexEncoding==='delta-modulo'){let value=0;for(let k=0;k<indices.length;k++){value=(value+indices[k])>>>0;indices[k]=value;if(Type===Uint16Array)value&=65535;}}
 for(const index of indices)if(index>=chunk.vertices)throw Error('Terrain index exceeds vertex count');
 geometry.setIndex(new THREE.BufferAttribute(indices,1));geometryBytes+=indices.byteLength;geometry.computeBoundingBox();geometry.computeBoundingSphere();
 if(!Number.isFinite(geometry.boundingSphere.radius))throw Error('Invalid terrain geometry bounds');
 const mesh=new THREE.Mesh(geometry,material);mesh.scale.setScalar(scale);mesh.castShadow=false;mesh.receiveShadow=true;
 mesh.name=(kind==='base'?'ground-':'pavers-')+chunk.materialId+(chunk.cell?'-'+chunk.cell.join(','):'');
 mesh.userData={sourceAligned:true,losslessIndexed:!quantized&&!chunk.lodCandidate,lodCandidate:!!chunk.lodCandidate,attributeQuantization:quantized,quantizedTransport:quantized,streamChunkUrl:part.url,streamIntegrity:part.expandedSha256?'sha256-and-structure':'structure',sourceExpandedSha256:chunk.sourceExpandedSha256,sourceTransportExpandedSha256:chunk.sourceTransportExpandedSha256,transportTopologyPreserved:quantized||undefined,retainedGeometryBytes:geometryBytes,retainedArrayBufferBytes:raw.byteLength,...(kind==='paving'?{reliefRange:[manifest.minRelief,manifest.maxRelief]}:{})};
 return mesh;
 }catch(error){geometry.dispose();throw error;}
}
