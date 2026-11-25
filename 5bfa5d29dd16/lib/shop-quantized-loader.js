import * as THREE from 'three';
export async function loadQuantizedShop(url,material){
 const m=await fetch(url).then(r=>{if(!r.ok)throw Error(url);return r.json();});
 const r=await fetch(m.pack.url);if(!r.ok)throw Error(m.pack.url);
 const raw=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(raw.byteLength!==m.pack.byteLength)throw Error('Shop buffer length mismatch');
 const types={int16:Int16Array,uint8:Uint8Array,uint16:Uint16Array,uint32:Uint32Array},g=new THREE.BufferGeometry();
 for(const [name,a] of Object.entries(m.attributes))g.setAttribute(name,new THREE.BufferAttribute(new types[a.componentType](raw,a.byteOffset,a.count*a.itemSize),a.itemSize,a.normalized));
 const a=m.index,index=new types[a.componentType](raw,a.byteOffset,a.count);let value=0;for(let k=0;k<index.length;k++){value=(value+index[k])>>>0;index[k]=value;if(a.componentType==='uint16')value&=65535;}
 g.setIndex(new THREE.BufferAttribute(index,1));g.computeBoundingBox();g.computeBoundingSphere();
 return [{g,m:material,positionScale:m.positionScale}];
}
