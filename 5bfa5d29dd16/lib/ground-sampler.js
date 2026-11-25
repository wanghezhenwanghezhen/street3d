import * as THREE from 'three';
// Build an XZ spatial index once, then query only triangles under the contact point.
// This evaluates the real CPU geometry, including holes, without whole-city raycasts per prop.
export function createGroundSampler(roots){
 const cellSize=1,bins=new Map(),chunks=[],cache=new Map(),v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];let count=0,released=false;
 for(const root of roots){root.updateMatrixWorld(true);root.traverse(mesh=>{
   if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,index=mesh.geometry.index,n=Math.floor((index?.count??p.count)/3),chunk=new Float32Array(n*9),chunkId=chunks.length;chunks.push(chunk);
   for(let t=0;t<n;t++){
     for(let k=0;k<3;k++){v[k].fromBufferAttribute(p,index?index.getX(t*3+k):t*3+k).applyMatrix4(mesh.matrixWorld);chunk.set(v[k].toArray(),t*9+k*3);}
     const area=(v[1].x-v[0].x)*(v[2].z-v[0].z)-(v[2].x-v[0].x)*(v[1].z-v[0].z);if(Math.abs(area)<1e-9)continue;
     const x0=Math.floor(Math.min(...v.map(p=>p.x))/cellSize),x1=Math.floor(Math.max(...v.map(p=>p.x))/cellSize),z0=Math.floor(Math.min(...v.map(p=>p.z))/cellSize),z1=Math.floor(Math.max(...v.map(p=>p.z))/cellSize);
     for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(chunkId,t*9);}count++;
   }
 });}
 function heightAt(x,z){const key=x.toFixed(6)+','+z.toFixed(6);if(cache.has(key))return cache.get(key);if(released)return null;let height=-Infinity;const list=bins.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))??[];
   for(let j=0;j<list.length;j+=2){const p=chunks[list[j]],i=list[j+1],ax=p[i],az=p[i+2],bx=p[i+3],bz=p[i+5],cx=p[i+6],cz=p[i+8];
     const denom=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denom,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denom,c=1-a-b;
     if(a>=-1e-6&&b>=-1e-6&&c>=-1e-6)height=Math.max(height,a*p[i+1]+b*p[i+4]+c*p[i+7]);
   }
   const result=Number.isFinite(height)?height:0;cache.set(key,result);return result;
 }
 const stats={triangles:count,cells:bins.size,buildBytes:chunks.reduce((n,c)=>n+c.byteLength,0),retainedTriangleBytes:chunks.reduce((n,c)=>n+c.byteLength,0),cachedSamples:0};
 return {heightAt,stats,dump(){return Object.fromEntries(cache);},remember(x,z,y){cache.set(x.toFixed(6)+','+z.toFixed(6),y);stats.cachedSamples=cache.size;},release(){chunks.length=0;bins.clear();released=true;stats.retainedTriangleBytes=0;stats.cachedSamples=cache.size;}};
}

export async function loadGroundSampler(roots){
 try{
 const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const roads=await fetch('/data/scene.json').then(r=>{if(!r.ok)throw Error('Road source missing');return r.json();});
 const roadDigest=await sha(new TextEncoder().encode(JSON.stringify(roads.roads)));
 const pin=await fetch('/data/floor-support-r5.json').then(r=>r.json());
 if(roadDigest!==pin.roadLayoutSha256)throw Error('Authoritative road layout changed; regenerate support samples');
 const response=await fetch('/data/floor-support-r5.json');if(!response.ok)throw Error('No cache');const c=await response.json();for(const [url,expected] of Object.entries(c.inputs)){const bytes=await fetch(url).then(r=>r.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw Error('Floor source changed '+url);}const cache=new Map(Object.entries(c.samples));return {stats:{...c.stats,buildBytes:0,retainedTriangleBytes:0,cacheVerified:true,cachedSamples:cache.size},heightAt:(x,z)=>cache.get(x.toFixed(6)+','+z.toFixed(6))??null,remember:(x,z,y)=>cache.set(x.toFixed(6)+','+z.toFixed(6),y),dump:()=>Object.fromEntries(cache),release(){}};
 }catch(error){if(!new URLSearchParams(location.search).has('fullTerrain'))throw new Error('Authoritative ground cache rejected: '+error.message);const sampler=createGroundSampler(roots);sampler.stats.cacheReason=error.message;return sampler;}
}
