// Temporary, copy-on-edit polygon mesh operations. No asset data is rewritten.
// Coplanar triangles become polygon faces; concave outlines remain concave.
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a),unit=a=>mul(a,1/Math.max(len(a),1e-20));
const key=p=>p.map(x=>Math.round(x*1e7)).join(','),edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a;
const read=(a,i)=>Array.from({length:a.itemSize},(_,k)=>a.getComponent(i,k));

function topology(source){
 const p=source.attributes.position,points=[],lookup=new Map(),ids=[];
 for(let i=0;i<p.count;i++){const v=read(p,i),k=v.join(',');let id=lookup.get(k);if(id===undefined){id=points.length;lookup.set(k,id);points.push(v);}ids.push(id);}
 const tris=[],edges=new Map(),parents=points.map((_,i)=>i),find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let t=0;t<(source.index?.count??p.count)/3;t++){
  const src=[0,1,2].map(k=>source.index?source.index.getX(t*3+k):t*3+k),v=src.map(i=>ids[i]);
  const n=unit(cross(sub(points[v[1]],points[v[0]]),sub(points[v[2]],points[v[0]])));
  const tri={src,v,n,t,material:source.groups.find(g=>t*3>=g.start&&t*3<g.start+g.count)?.materialIndex??0};tris.push(tri);
  parents[find(v[1])]=find(v[0]);parents[find(v[2])]=find(v[0]);
  for(let i=0;i<3;i++){const a=v[i],b=v[(i+1)%3],k=edgeKey(a,b);if(!edges.has(k))edges.set(k,[]);edges.get(k).push({tri,a,b});}
 }
 const components=new Map();for(const t of tris){const k=find(t.v[0]);if(!components.has(k))components.set(k,[]);components.get(k).push(t);}
 return {points,edges,components:[...components.values()]};
}

function polygonFaces(tris,top){
 const {points,edges}=top,used=new Set(),faces=[],triFace=new Map();
 for(const seed of tris){
  if(used.has(seed))continue;
  const f={n:seed.n,triangles:[],loops:[],material:seed.material,src:new Map()},queue=[seed],offset=dot(seed.n,points[seed.v[0]]);used.add(seed);
  while(queue.length){const t=queue.pop();f.triangles.push(t);triFace.set(t,f);t.v.forEach((v,i)=>f.src.set(v,t.src[i]));
   for(let i=0;i<3;i++)for(const e of edges.get(edgeKey(t.v[i],t.v[(i+1)%3]))??[]){const next=e.tri;
    if(!used.has(next)&&next.material===seed.material&&dot(next.n,seed.n)>1-1e-7&&Math.abs(dot(seed.n,points[next.v[0]])-offset)<1e-6){used.add(next);queue.push(next);}
   }
  }
  faces.push(f);
 }
 for(const f of faces){
  const boundary=new Map();for(const t of f.triangles)for(let i=0;i<3;i++){
   const a=t.v[i],b=t.v[(i+1)%3],es=edges.get(edgeKey(a,b));
   if(es.length!==2||es[0].a===es[1].a)throw Error('open-or-nonmanifold');
   if(triFace.get(es.find(e=>e.tri!==t).tri)!==f){if(boundary.has(a))throw Error('branching-face-boundary');boundary.set(a,b);}
  }
  while(boundary.size){const start=boundary.keys().next().value,loop=[];let v=start;
   do{loop.push(v);const next=boundary.get(v);if(next===undefined)throw Error('open-face-boundary');boundary.delete(v);v=next;if(loop.length>10000)throw Error('face-size-limit');}while(v!==start);
   if(loop.length<3)throw Error('degenerate-face');f.loops.push(loop);
  }
  if(!f.loops.length)throw Error('no-face-boundary');
 }
 return {faces,triFace};
}

function bevelComponent(tris,top,source,settings,THREE){
 const {points,edges}=top,{faces,triFace}=polygonFaces(tris,top);
 if(faces.length>900)throw Error('curved-component-budget');
 const out=[],bands=new Map(),caps=new Map(),clamps=[];
 const attr=(f,v,p)=>{const values={};for(const [name,a]of Object.entries(source.attributes))if(name!=='position'&&name!=='normal')values[name]=read(a,f.src.get(v));return {p,values};};
 const addCap=(v,a,b)=>{if(len(sub(a.p,b.p))<1e-9)return;if(!caps.has(v))caps.set(v,[]);caps.get(v).push([a,b]);};
 function emit(a,b,c,material,normal=null,kind='bevel'){
  if(len(cross(sub(b.p,a.p),sub(c.p,a.p)))<1e-13)return;
  out.push({vertices:[a,b,c],material,normal,kind});
 }
 const width=new Map(),vertexDepth=new Map();
 for(const f of faces)for(const loop of f.loops)for(let i=0;i<loop.length;i++){
  const a=loop[i],b=loop[(i+1)%loop.length],d=len(sub(points[a],points[b]));
  for(const id of [a,b])vertexDepth.set(id,Math.min(vertexDepth.get(id)??Infinity,d));
 }
 for(const f of faces)for(const loop of f.loops)for(let i=0;i<loop.length;i++){
  const a=loop[i],b=loop[(i+1)%loop.length],k=edgeKey(a,b);if(width.has(k))continue;
  const es=edges.get(k),g=triFace.get(es.find(e=>triFace.get(e.tri)!==f)?.tri);if(!g)throw Error('missing-adjacent-face');
  const d=unit(sub(points[b],points[a]));
  const depth=h=>{const inward=unit(cross(h.n,d));return Math.max(...[...h.src.keys()].map(v=>Math.abs(dot(sub(points[v],points[a]),inward))));};
  const adjacent=Math.min(depth(f),depth(g));
  // Existing tiny fillet facets are protected from inversion. Local safety caps
  // are reported instead of pretending the requested radius was reached.
  const r=Math.min(settings.edge*adjacent,len(sub(points[b],points[a]))*.22);
  width.set(k,r);
 }
 for(const f of faces){
  f.corners=new Map();f.boundaries=[];
  const axis=Math.abs(f.n[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(axis,f.n)),v=cross(f.n,u);
  for(const loop of f.loops){
   const inset=[];
   for(let i=0;i<loop.length;i++){
    const a=loop[(i+loop.length-1)%loop.length],b=loop[i],c=loop[(i+1)%loop.length];
    const d1=unit(sub(points[b],points[a])),d2=unit(sub(points[c],points[b])),n1=cross(f.n,d1),n2=cross(f.n,d2);
    const w1=width.get(edgeKey(a,b)),w2=width.get(edgeKey(b,c)),q=dot(n1,n2),den=1-q*q;
    let delta=Math.abs(den)<1e-9?mul(n1,(w1+w2)/2):add(mul(n1,(w1-q*w2)/den),mul(n2,(w2-q*w1)/den));
    const cap=.28*Math.min(len(sub(points[b],points[a])),len(sub(points[c],points[b])));
    if(len(delta)>cap){clamps.push(b);delta=mul(unit(delta),cap);}
    inset.push(add(points[b],delta));
   }
   const polygon=[];
   for(let i=0;i<loop.length;i++){
    const id=loop[i],p=inset[i],before=inset[(i+loop.length-1)%loop.length],after=inset[(i+1)%loop.length];
    const depth=Math.min(len(sub(before,p)),len(sub(after,p))),cut=Math.min(settings.point*vertexDepth.get(id),depth*.22);
    const a=attr(f,id,add(p,mul(unit(sub(before,p)),cut))),b=attr(f,id,add(p,mul(unit(sub(after,p)),cut)));
    f.corners.set(id,{a,b});polygon.push(a);if(cut>1e-9)polygon.push(b);
    addCap(id,b,a);
   }
   f.boundaries.push(polygon);
   for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length],k=edgeKey(a,b);
    if(!bands.has(k))bands.set(k,[]);bands.get(k).push({f,a,b,start:f.corners.get(a).b,end:f.corners.get(b).a});
   }
  }
  const projected=f.boundaries.map(loop=>loop.map(x=>new THREE.Vector2(dot(x.p,u),dot(x.p,v))));
  const areas=projected.map(p=>THREE.ShapeUtils.area(p));let oi=areas.indexOf(Math.max(...areas));
  if(oi<0)oi=0;
  const loops=[f.boundaries[oi],...f.boundaries.filter((_,i)=>i!==oi)],poly=[projected[oi],...projected.filter((_,i)=>i!==oi)],verts=loops.flat();
  const triangles=THREE.ShapeUtils.triangulateShape(poly[0],poly.slice(1));
  for(const t of triangles){let [a,b,c]=t.map(i=>verts[i]);if(dot(cross(sub(b.p,a.p),sub(c.p,a.p)),f.n)<0)[b,c]=[c,b];emit(a,b,c,f.material,f.n,'face');}
 }
 for(const es of bands.values()){
  if(es.length!==2)throw Error('unpaired-band');const [a,b]=es;
  // Automatically miter the external junctions; one linear profile segment has
  // a uniform arc-length interval. No variable parameter-space sampling.
  emit(a.end,a.start,b.end,a.f.material);emit(a.end,b.end,b.start,a.f.material);
  addCap(a.a,b.end,a.start);addCap(a.b,a.end,b.start);
 }
 for(const [id,segments]of caps){
  const edgesByStart=new Map();for(const [a,b]of segments)edgesByStart.set(key(a.p),[a,b]);
  if(edgesByStart.size<3)continue;
  const loop=[],first=edgesByStart.keys().next().value;let k=first;
  while(edgesByStart.has(k)){const [a,b]=edgesByStart.get(k);edgesByStart.delete(k);loop.push(a);k=key(b.p);if(k===first)break;}
  if(k!==first||edgesByStart.size)throw Error('unclosed-corner-miter');
  const center=mul(loop.reduce((s,x)=>add(s,x.p),[0,0,0]),1/loop.length),c={p:center,values:loop[0].values};
  const material=tris.find(t=>t.v.includes(id)).material;
  for(let i=0;i<loop.length;i++)emit(c,loop[i],loop[(i+1)%loop.length],material);
 }
 return {triangles:out,faces:faces.length,clampedCorners:new Set(clamps).size};
}

function recoverExtrusion(tris,top,source,THREE){
 // Remove an existing export fillet before applying a new user radius. Only
 // symmetric constant-colour extrusions are admitted; never substitute an AABB.
 if(tris.length<300||new Set(tris.map(t=>t.material)).size!==1)return null;
 for(const [name,a]of Object.entries(source.attributes))if(name!=='position'&&name!=='normal'){
  const first=read(a,tris[0].src[0]);for(const t of tris)for(const i of t.src)if(read(a,i).some((v,k)=>Math.abs(v-first[k])>1e-6))return null;
 }
 const {faces}=polygonFaces(tris,top),f=faces.filter(f=>f.loops.length===1&&f.triangles.length>20).sort((a,b)=>b.triangles.length-a.triangles.length)[0];if(!f)return null;
 const n=f.n,verts=[...new Set(tris.flatMap(t=>t.v))],heights=verts.map(i=>dot(top.points[i],n)),lo=Math.min(...heights),hi=Math.max(...heights),depth=hi-lo;
 const opposite=faces.find(g=>dot(g.n,n)<-1+1e-7&&g.loops.length===1&&g.loops[0].length===f.loops[0].length);if(!opposite)return null;
 if(Math.abs(dot(top.points[f.loops[0][0]],n)-hi)>1e-5)return null;
 const levels=[...new Set(heights.map(v=>Math.round(v*1e7)/1e7))].sort((a,b)=>a-b);if(levels.length<4||levels.length>16)return null;
 const low=levels.filter(z=>z<lo+depth*.1),high=levels.filter(z=>z>hi-depth*.1);if(low.length+high.length!==levels.length)return null;
 const radius=Math.max(...low)-lo;if(radius<1e-5||Math.abs(radius-(hi-Math.min(...high)))>1e-5)return null;
 const axis=Math.abs(n[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(axis,n)),v=cross(n,u),origin=mul(n,lo);
 let profile=f.loops[0].map(id=>{const p=top.points[id];return [dot(p,u),dot(p,v)];});
 const match=new Set(opposite.loops[0].map(id=>[dot(top.points[id],u),dot(top.points[id],v)].map(x=>Math.round(x*1e5)).join(',')));
 if(profile.some(p=>!match.has(p.map(x=>Math.round(x*1e5)).join(','))))return null;
 if(THREE.ShapeUtils.area(profile.map(p=>new THREE.Vector2(...p)))<0)profile.reverse();
 const sharp=profile.map((p,i)=>{const a=profile[(i+profile.length-1)%profile.length],b=profile[(i+1)%profile.length],d1=unit([p[0]-a[0],p[1]-a[1],0]),d2=unit([b[0]-p[0],b[1]-p[1],0]),n1=[d1[1],-d1[0],0],n2=[d2[1],-d2[0],0],q=dot(n1,n2),den=1-q*q;
  const delta=Math.abs(den)<1e-9?mul(n1,radius):mul(add(n1,n2),radius/(1+q));return new THREE.Vector2(p[0]+delta[0],p[1]+delta[1]);});
 const shape=new THREE.Shape(sharp),g=new THREE.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:false,curveSegments:1});
 const p=g.attributes.position;for(let i=0;i<p.count;i++){const value=add(origin,add(mul(u,p.getX(i)),add(mul(v,p.getY(i)),mul(n,p.getZ(i)))));p.setXYZ(i,...value);}
 g.deleteAttribute('uv');g.computeVertexNormals();g.clearGroups();g.addGroup(0,p.count,tris[0].material);
 for(const [name,a]of Object.entries(source.attributes))if(name!=='position'&&name!=='normal'){const value=read(a,tris[0].src[0]),arr=new Float32Array(p.count*a.itemSize);for(let i=0;i<p.count;i++)arr.set(value,i*a.itemSize);g.setAttribute(name,new THREE.BufferAttribute(arr,a.itemSize));}
 return {geometry:g,radius,profilePoints:profile.length};
}

function finish(triangles,source,settings,THREE){
 const vertices=triangles.flatMap(t=>t.vertices),weld=new Map(),points=[],ids=[];
 for(const v of vertices){const k=key(v.p);let i=weld.get(k);if(i===undefined){i=points.length;weld.set(k,i);points.push([...v.p]);}ids.push(i);}
 if(settings.smooth>0&&settings.repeat>0){
  const adjacent=points.map(()=>new Set()),bounds=[0,1,2].map(k=>[Math.min(...points.map(p=>p[k])),Math.max(...points.map(p=>p[k]))]);
  for(let i=0;i<ids.length;i+=3)for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(a!==b)adjacent[ids[i+a]].add(ids[i+b]);
  const pass=factor=>{const next=points.map((p,i)=>{const ns=[...adjacent[i]];if(!ns.length)return p;const mean=mul(ns.reduce((s,j)=>add(s,points[j]),[0,0,0]),1/ns.length);return add(p,mul(sub(mean,p),factor));});for(let i=0;i<points.length;i++)points[i]=next[i];};
  for(let i=0;i<settings.repeat;i++){pass(settings.smooth*.28);pass(-settings.smooth*.29);}
  // Keep each component's original support envelope after smoothing.
  for(let k=0;k<3;k++){const lo=Math.min(...points.map(p=>p[k])),hi=Math.max(...points.map(p=>p[k]));if(hi-lo>1e-8)for(const p of points)p[k]=bounds[k][0]+(p[k]-lo)/(hi-lo)*(bounds[k][1]-bounds[k][0]);}
 }
 const accum=points.map(()=>[0,0,0]),normals=[];
 triangles.forEach((t,i)=>{const [a,b,c]=[0,1,2].map(k=>points[ids[i*3+k]]),n=cross(sub(b,a),sub(c,a));normals.push(unit(n));for(let k=0;k<3;k++)accum[ids[i*3+k]]=add(accum[ids[i*3+k]],n);});
 const arrays={position:[],normal:[]};for(const [name,a]of Object.entries(source.attributes))if(name!=='position'&&name!=='normal')arrays[name]=[];
 const g=new THREE.BufferGeometry();let group=null;
 triangles.forEach((t,i)=>{
  if(!group||group.materialIndex!==t.material){group={start:i*3,count:0,materialIndex:t.material};g.groups.push(group);}group.count+=3;
  for(let j=0;j<3;j++){const at=i*3+j,id=ids[at];arrays.position.push(...points[id]);arrays.normal.push(...(settings.harden&&t.kind==='face'?normals[i]:unit(accum[id])));for(const name of Object.keys(arrays))if(name!=='position'&&name!=='normal')arrays[name].push(...vertices[at].values[name]);}
 });
 for(const [name,values]of Object.entries(arrays))g.setAttribute(name,new THREE.Float32BufferAttribute(values,name==='position'||name==='normal'?3:source.attributes[name].itemSize));
 g.computeBoundingBox();g.computeBoundingSphere();g.userData={...source.userData,runtimeDeformable:true,temporaryMeshEdit:true};return g;
}

export function editGeometry(source,{THREE,edge=.06,point=0,harden=true,smooth=0,repeat=0,maxBytes=4*1024*1024}={}){
 const settings={edge:Math.max(0,Math.min(.2,edge)),point:Math.max(0,Math.min(.2,point)),harden:!!harden,smooth:Math.max(0,Math.min(1,smooth)),repeat:Math.max(0,Math.min(10,Math.round(repeat)))};
 const report={version:'polygon-mesh-editor-r17/1',settings,supported:0,skipped:0,reasons:{},clampedCorners:0,components:[],generatedBytes:0};
 if(!edge&&!point&&!smooth)return {geometry:null,report:{...report,restored:true}};
 const top=topology(source),all=[],remaining=[],stride=Object.values(source.attributes).reduce((n,a)=>n+a.itemSize,0)+(source.attributes.normal?0:3);
 const sourceTriangleCount=top.components.reduce((n,c)=>n+c.length,0);let replacedTriangles=0;
 const area=tris=>{const ps=[...new Set(tris.flatMap(t=>t.v))].map(i=>top.points[i]),d=[0,1,2].map(k=>Math.max(...ps.map(p=>p[k]))-Math.min(...ps.map(p=>p[k])));return d[0]*d[1]+d[0]*d[2]+d[1]*d[2];};
 for(const tris of top.components.sort((a,b)=>area(b)-area(a))){
  let result;
  try{if((all.length+Math.min(tris.length,24))*3*stride*4>maxBytes)throw Error('generated-memory-budget');
   try{if(tris.length>3000)throw Error('component-triangle-budget');const recovered=recoverExtrusion(tris,top,source,THREE);
    if(recovered){const rt=topology(recovered.geometry);result=bevelComponent(rt.components[0],rt,recovered.geometry,settings,THREE);result.recoveredExtrusion={sourceRadius:recovered.radius,profilePoints:recovered.profilePoints};recovered.geometry.dispose();}
    else result=bevelComponent(tris,top,source,settings,THREE);
   }catch(error){
    if(!settings.smooth||!settings.repeat||tris.length>50000)throw error;
    result={faces:tris.length,clampedCorners:0,smoothOnly:error.message,triangles:tris.map(t=>({material:t.material,kind:'face',vertices:t.src.map(i=>{const values={};for(const [n,a]of Object.entries(source.attributes))if(n!=='position'&&n!=='normal')values[n]=read(a,i);return {p:read(source.attributes.position,i),values};})}))};
   }
   if((all.length+result.triangles.length)*3*stride*4+(sourceTriangleCount-replacedTriangles-tris.length)*12>maxBytes)throw Error('generated-memory-budget');
   const part=finish(result.triangles,source,settings,THREE);const p=part.attributes.position;for(let i=0;i<p.count;i++)if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))throw Error('nonfinite-candidate');
   const converted=[];for(let i=0;i<p.count;i+=3){const vertices=[0,1,2].map(j=>{const values={};for(const [n,a]of Object.entries(part.attributes))if(n!=='position')values[n]=read(a,i+j);return {p:read(p,i+j),values};});converted.push({vertices,material:part.groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex??0});}
   all.push(...converted);replacedTriangles+=tris.length;part.dispose();report.supported++;report.clampedCorners+=result.clampedCorners;report.components.push({sourceTriangles:tris.length,outputTriangles:converted.length,faces:result.faces,recoveredExtrusion:result.recoveredExtrusion??null,operation:result.smoothOnly?'smooth-source-surface':'bevel-and-smooth',bevelLimit:result.smoothOnly??null});
  }catch(error){report.skipped++;report.reasons[error.message]=(report.reasons[error.message]??0)+1;remaining.push(...tris);}
 }
 if(!report.supported)return {geometry:null,report};
 const g=new THREE.BufferGeometry(),arrays={position:[],normal:[]};for(const n of Object.keys(source.attributes))if(!(n in arrays))arrays[n]=[];let group=null;
 all.forEach((t,i)=>{if(!group||group.materialIndex!==t.material){group={start:i*3,count:0,materialIndex:t.material};g.groups.push(group);}group.count+=3;for(const v of t.vertices){arrays.position.push(...v.p);for(const n of Object.keys(arrays))if(n!=='position')arrays[n].push(...v.values[n]);}});
 for(const [n,a]of Object.entries(arrays))g.setAttribute(n,new THREE.Float32BufferAttribute(a,n==='position'||n==='normal'?3:source.attributes[n].itemSize));
 g.computeBoundingBox();g.computeBoundingSphere();g.userData={...source.userData,runtimeDeformable:true,temporaryMeshEdit:true};report.generatedAttributeBytes=Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0);
 const remainder=[],remainderGroups=[];group=null;for(const t of remaining){if(!group||group.materialIndex!==t.material){group={start:remainder.length,count:0,materialIndex:t.material};remainderGroups.push(group);}group.count+=3;remainder.push(...t.src);}
 report.remainderIndexBytes=remainder.length*4;report.generatedBytes=report.generatedAttributeBytes+report.remainderIndexBytes;
 return {geometry:g,report,remainderIndex:new Uint32Array(remainder),remainderGroups};
}
