import * as THREE from 'three';
// Bounded attribute quantization. Original source artifacts remain unchanged.
// A uniform child scale restores positions and leaves normals/UVs invariant.
export function compactMesh(mesh){
 const source=mesh.geometry;if(!source?.attributes.position||source.userData.compacted)return;
 const p=source.attributes.position;let extent=0;
 for(let i=0;i<p.count;i++)extent=Math.max(extent,Math.abs(p.getX(i)),Math.abs(p.getY(i)),Math.abs(p.getZ(i)));
 const scale=2**Math.ceil(Math.log2(Math.max(extent,.0001))),g=new THREE.BufferGeometry();
 for(const [name,a] of Object.entries(source.attributes)){
  if(a.isInstancedBufferAttribute){g.setAttribute(name,a);continue;}
  const bounded=name==='position'||name==='normal'||name==='color';
  const Type=name==='position'||name==='normal'?Int16Array:name==='color'?Uint16Array:Float32Array;
  const values=new Type(a.count*a.itemSize);
  for(let i=0;i<a.count;i++)for(let k=0;k<a.itemSize;k++){
   const v=a.getComponent(i,k),factor=name==='position'?32767/scale:name==='normal'?32767:name==='color'?65535:1;
   values[i*a.itemSize+k]=bounded?Math.round(v*factor):v;
  }
  g.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize,bounded));
 }
 if(source.index)g.setIndex(new THREE.BufferAttribute(source.index.array.slice(),1));
 g.groups=source.groups.map(x=>({...x}));g.computeBoundingBox();g.computeBoundingSphere();g.userData={...source.userData,compacted:true,positionScale:scale,maximumLocalPositionError:Math.sqrt(3)*scale/65534};
 mesh.geometry=g;mesh.scale.multiplyScalar(scale);source.dispose();
}
