// Real, bounded, inset geometry for verified closed cuboid components.
// Register AFTER merging/quantization; unregister BEFORE source handle disposal.
// Zero restores the exact original geometry reference. No source/material mutation.
export const BEVEL_VERSION = 'rounded-building-geometry-r11/2';
const AXES = [0, 1, 2];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a,b) => a.map((v,k)=>v-b[k]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = a => Math.hypot(...a);
const unit = a => { const l=length(a); return a.map(v=>v/l); };
const read = (a,i) => Array.from({length:a.itemSize},(_,k)=>a.getComponent(i,k));
const fail = reason => { throw Error(reason); };
const byteSize = g => Object.values(g.attributes).reduce((n,a)=>n+a.count*a.itemSize*a.array.BYTES_PER_ELEMENT,0)+(g.index?.array.byteLength??0);
const faceKey = (a,s) => a*2+(s>0?1:0);

function splitComponents(g, maxTriangles) {
 const p=g.attributes.position,n=(g.index?.count??p.count)/3;
 if(!Number.isInteger(n)||n>maxTriangles)fail('source-triangle-budget');
 const positions=[],weld=new Map(),ids=new Int32Array(p.count),parents=[];
 // Exact welding: no topology repair or accidental welding of thin neighbouring faces.
 for(let i=0;i<p.count;i++){
  const v=read(p,i);if(!v.every(Number.isFinite))fail('nonfinite-position');
  const key=v.join(',');let id=weld.get(key);
  if(id===undefined){id=positions.length;weld.set(key,id);positions.push(v);parents.push(id);}ids[i]=id;
 }
 const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 const triangles=[];
 for(let t=0;t<n;t++){
  const src=[0,1,2].map(k=>g.index?g.index.getX(t*3+k):t*3+k);
  if(src.some(i=>!Number.isInteger(i)||i<0||i>=p.count))fail('index-range');
  const v=src.map(i=>ids[i]);parents[find(v[1])]=find(v[0]);parents[find(v[2])]=find(v[0]);
  const group=g.groups.find(row=>t*3>=row.start&&t*3<row.start+row.count);
  triangles.push({src,v,material:group?.materialIndex??0});
 }
 const components=new Map();for(const t of triangles){const key=find(t.v[0]);if(!components.has(key))components.set(key,[]);components.get(key).push(t);}
 return {positions,components:[...components.values()]};
}

function identifyBox(tris,points,g,maxComponentTriangles) {
 if(tris.length>maxComponentTriangles)fail('component-triangle-budget');
 const edges=new Map(),verts=[...new Set(tris.flatMap(t=>t.v))],planes=[];
 const lo=AXES.map(a=>Math.min(...verts.map(i=>points[i][a]))),hi=AXES.map(a=>Math.max(...verts.map(i=>points[i][a])));
 const extent=Math.max(...sub(hi,lo)),tol=Math.max(extent*2e-6,1e-9);
 if(!(extent>1e-7))fail('unrepresentable-thin-component');
 for(const t of tris){
  const [a,b,c]=t.v.map(i=>points[i]),cr=cross(sub(b,a),sub(c,a));
  if(length(cr)<extent*extent*1e-12)fail('degenerate-source-face');
  t.normal=unit(cr);
  for(let k=0;k<3;k++){const a=t.v[k],b=t.v[(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push(a<b?1:-1);}
  const offset=dot(t.normal,a);let plane=planes.find(f=>dot(f.normal,t.normal)>1-1e-8&&Math.abs(f.offset-offset)<tol);
  if(!plane){plane={normal:t.normal,offset,triangles:[]};planes.push(plane);}plane.triangles.push(t);
 }
 if([...edges.values()].some(e=>e.length!==2||e[0]+e[1]!==0))fail('open-nonmanifold-or-winding');
 if(planes.length!==6)fail('not-six-planar-faces');
 const u=planes[0].normal,v=planes.find(p=>Math.abs(dot(p.normal,u))<1e-6)?.normal;
 if(!v)fail('not-orthogonal-cuboid');
 const basis=[u,v,unit(cross(u,v))],coords=new Map(verts.map(i=>[i,basis.map(b=>dot(points[i],b))]));
 const local=[...coords.values()],min=AXES.map(a=>Math.min(...local.map(c=>c[a]))),max=AXES.map(a=>Math.max(...local.map(c=>c[a])));
 const dims=sub(max,min),center=min.map((x,k)=>(x+max[k])/2);
 if(Math.min(...dims)<Math.max(...dims)*1e-4)fail('unrepresentable-thin-component');
 const faces=new Map();let maximumPlanarityError=0;
 for(const f of planes){
  const dots=basis.map(b=>dot(b,f.normal)),axis=dots.findIndex(x=>Math.abs(x)>1-1e-8);if(axis<0)fail('not-orthogonal-cuboid');
  const sign=Math.sign(dots[axis]),level=sign>0?max[axis]:min[axis],key=faceKey(axis,sign);if(faces.has(key))fail('not-six-planar-faces');
  for(const t of f.triangles)for(const i of t.v){const error=Math.abs(coords.get(i)[axis]-level);maximumPlanarityError=Math.max(maximumPlanarityError,error);if(error>tol)fail('nonplanar-quantized-face');}
  for(const i of verts)if(dot(f.normal,points[i])-f.offset>tol)fail('nonconvex-source');
  const materials=new Set(f.triangles.map(t=>t.material));if(materials.size!==1)fail('coplanar-material-seam');
  const tangents=AXES.filter(a=>a!==axis),seed=f.triangles[0],[q0,q1,q2]=seed.v.map(i=>coords.get(i));
  const [s,t]=tangents,ds1=q1[s]-q0[s],dt1=q1[t]-q0[t],ds2=q2[s]-q0[s],dt2=q2[t]-q0[t],det=ds1*dt2-ds2*dt1;
  const maps={};
  for(const [name,attr]of Object.entries(g.attributes)){
   if(name==='position'||name==='normal')continue;
   if(attr.isInstancedBufferAttribute||attr.itemSize>4)fail('unsupported-attribute');
   const values=seed.src.map(i=>read(attr,i));
   maps[name]=values[0].map((z,k)=>{const d1=values[1][k]-z,d2=values[2][k]-z,a=(d1*dt2-d2*dt1)/det,b=(ds1*d2-ds2*d1)/det;return [z-a*q0[s]-b*q0[t],a,b];});
   for(const triangle of f.triangles)for(let j=0;j<3;j++){
    const q=coords.get(triangle.v[j]),value=read(attr,triangle.src[j]);
    for(let k=0;k<value.length;k++){const [c,a,b]=maps[name][k];if(!Number.isFinite(value[k])||Math.abs(c+a*q[s]+b*q[t]-value[k])>2e-5)fail('nonaffine-'+name);}
   }
  }
  // Weighted/smooth source normals cannot be discarded as if they were hard faces.
  if(g.attributes.normal)for(const triangle of f.triangles)for(const i of triangle.src){const n=read(g.attributes.normal,i);if(length(n)<.9||dot(unit(n),f.normal)<1-2e-4)fail('nonflat-source-normal');}
  faces.set(key,{axis,sign,material:[...materials][0],maps,tangents});
 }
 return {basis,min,max,dims,center,faces,maximumPlanarityError};
}


// Source exports already contain small bevels. Recognize their six support faces
// rather than claiming that only an exactly six-plane cuboid can be adjusted.
function identifyRoundedBox(tris,points,g,maxComponentTriangles) {
 if(tris.length>maxComponentTriangles)fail('component-triangle-budget');
 if(new Set(tris.map(t=>t.material)).size>1)fail('rounded-component-material-seam');
 const verts=[...new Set(tris.flatMap(t=>t.v))],edges=new Map(),rank=[];
 for(const t of tris){
  const [a,b,c]=t.v.map(i=>points[i]),cr=cross(sub(b,a),sub(c,a)),area=length(cr);
  if(area<1e-15)fail('degenerate-source-face');t.normal=unit(cr);rank.push({normal:t.normal,area});
  for(let k=0;k<3;k++){const a=t.v[k],b=t.v[(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push(a<b?1:-1);}
 }
 if([...edges.values()].some(e=>e.length!==2||e[0]+e[1]!==0))fail('open-nonmanifold-or-winding');
 rank.sort((a,b)=>b.area-a.area);const u=rank[0].normal,v=rank.find(p=>Math.abs(dot(p.normal,u))<.002)?.normal;
 if(!v)fail('not-rounded-cuboid');
 const basis=[u,unit(sub(v,u.map(x=>x*dot(v,u)))),null];basis[2]=unit(cross(basis[0],basis[1]));
 const coords=new Map(verts.map(i=>[i,basis.map(b=>dot(points[i],b))])),local=[...coords.values()];
 const min=AXES.map(a=>Math.min(...local.map(c=>c[a]))),max=AXES.map(a=>Math.max(...local.map(c=>c[a]))),dims=sub(max,min),center=min.map((v,a)=>(v+max[a])/2),extent=Math.max(...dims);
 const quant=g.attributes.position.array instanceof Int16Array?1/32767:extent*1e-6,tol=Math.max(extent*3e-6,quant*2);
 if(Math.min(...dims)<Math.max(tol*4,extent*1e-4))fail('unrepresentable-thin-component');
 const faces=new Map();
 for(const axis of AXES)for(const sign of [-1,1]){
  const level=sign>0?max[axis]:min[axis],faceTris=tris.filter(t=>t.v.every(i=>Math.abs(coords.get(i)[axis]-level)<tol)&&dot(t.normal,basis[axis])*sign>.998);
  if(!faceTris.length)fail('missing-rounded-box-support-face');
  faces.set(faceKey(axis,sign),{axis,sign,triangles:faceTris,material:faceTris[0].material});
 }
 // Every vertex of a rounded box lies in a corner patch. Reject cylinders,
 // roof profiles, hollow walls and general meshes instead of replacing their form.
 const gaps=local.map(p=>p.map((v,a)=>Math.min(v-min[a],max[a]-v))),radii=AXES.map(a=>Math.max(...gaps.map(p=>p[a]))),radius=Math.max(...radii);
 if(radius>Math.min(...dims)*.46||radius<tol*1.5)fail('not-rounded-cuboid');
 if(Math.max(...radii)-Math.min(...radii)>Math.max(tol*3,radius*.08))fail('unequal-source-bevel-or-nonbox');
 for(const t of tris){
  const a=points[t.v[0]];
  if(verts.some(i=>dot(t.normal,sub(points[i],a))>tol*3))fail('nonconvex-source');
 }
 for(const [name,a]of Object.entries(g.attributes))if(a.isInstancedBufferAttribute||a.itemSize>4)fail('unsupported-attribute');
 return {basis,min,max,dims,center,faces,maximumPlanarityError:tol,sourceRadius:radius,sourceTriangles:tris,sourcePoints:points,roundedSource:true};
}

function closestSample(p,triangle,points){
 const [a,b,c]=triangle.v.map(i=>points[i]),ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d00=dot(ab,ab),d01=dot(ab,ac),d11=dot(ac,ac),den=d00*d11-d01*d01;
 let y=(d11*dot(ap,ab)-d01*dot(ap,ac))/den,z=(d00*dot(ap,ac)-d01*dot(ap,ab))/den;
 y=Math.max(0,y);z=Math.max(0,z);if(y+z>1){const sum=y+z;y/=sum;z/=sum;}
 const w=[1-y-z,y,z],q=AXES.map(k=>a[k]*w[0]+b[k]*w[1]+c[k]*w[2]);return {weights:w,distance:length(sub(q,p))};
}
function roundedAttribute(box,source,name,point,normal){
 const probe=AXES.map(a=>box.basis.reduce((s,b,k)=>s+b[a]*(point.base[k]+point.delta[k]*Math.min(.2,box.sourceRadius/Math.max(...box.dims))),0));
 let best=null;
 for(const triangle of box.sourceTriangles){
  const alignment=dot(triangle.normal,normal);if(alignment<.65)continue;
  const sample=closestSample(probe,triangle,box.sourcePoints),score=sample.distance+Math.max(...box.dims)*.02*(1-alignment);
  if(!best||score<best.score)best={triangle,...sample,score};
 }
 if(!best){const triangle=box.sourceTriangles[0];best={triangle,weights:[1,0,0]};}
 return Array.from({length:source.attributes[name].itemSize},(_,a)=>best.triangle.src.reduce((sum,i,k)=>sum+read(source.attributes[name],i)[a]*best.weights[k],0));
}

// Twelve circular arc strips, planar interiors and convex faceted corner caps.
// Unequal edge radii are not claimed to produce a constant-radius spherical cap.
function topology(box,segments) {
 const {dims,center}=box,radius=AXES.map(a=>Math.min(...dims.filter((_,b)=>b!==a))),cap=AXES.map(a=>Math.max(...radius.filter((_,b)=>b!==a)));
 const faces=new Map([...box.faces.keys()].map(k=>[k,[]])),corners=new Map(),out=[];
 const at=(v,k)=>v.base.map((x,a)=>x+k*v.delta[a]);
 const normal=(tri,k)=>cross(sub(at(tri[1],k),at(tri[0],k)),sub(at(tri[2],k),at(tri[0],k)));
 const emit=(tri,want)=>{if(length(normal(tri,.2))<1e-12)return;if(dot(normal(tri,.2),want)<0)[tri[1],tri[2]]=[tri[2],tri[1]];out.push(tri);};
 for(const a of AXES){const [b,c]=AXES.filter(x=>x!==a);
  for(const sb of [-1,1])for(const sc of [-1,1]){
   const ends=[];
   for(const sa of [-1,1]){
    const signs=[];signs[a]=sa;signs[b]=sb;signs[c]=sc;const cornerKey=signs.join();if(!corners.has(cornerKey))corners.set(cornerKey,{signs,vertices:[]});
    const arc=[];
    for(let j=0;j<=segments;j++){
     const theta=j*Math.PI/(2*segments),base=center.map((x,k)=>x+signs[k]*dims[k]/2),delta=[0,0,0];
     delta[a]=-sa*cap[a];delta[b]=sb*radius[a]*(Math.cos(theta)-1);delta[c]=sc*radius[a]*(Math.sin(theta)-1);
     const point={base,delta};arc.push(point);corners.get(cornerKey).vertices.push(point);
     if(j===0)faces.get(faceKey(b,sb)).push(point);if(j===segments)faces.get(faceKey(c,sc)).push(point);
    }ends.push(arc);
   }
   const want=[0,0,0];want[b]=sb;want[c]=sc;
   for(let j=0;j<segments;j++){emit([ends[0][j],ends[1][j],ends[1][j+1]],want);emit([ends[0][j],ends[1][j+1],ends[0][j+1]],want);}
  }
 }
 function fan(points,want){
  const unique=new Map(points.map(v=>[at(v,.2).map(x=>x.toFixed(10)).join(),v])),list=[...unique.values()];
  const normal=unit(want),ref=Math.abs(normal[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(normal,ref)),v=cross(normal,u);
  const mid={base:AXES.map(a=>list.reduce((s,p)=>s+p.base[a],0)/list.length),delta:AXES.map(a=>list.reduce((s,p)=>s+p.delta[a],0)/list.length)},q=at(mid,.2);
  list.sort((a,b)=>Math.atan2(dot(sub(at(a,.2),q),v),dot(sub(at(a,.2),q),u))-Math.atan2(dot(sub(at(b,.2),q),v),dot(sub(at(b,.2),q),u)));
  for(let j=0;j<list.length;j++)emit([mid,list[j],list[(j+1)%list.length]],want);
 }
 for(const [key,vertices]of faces){const f=box.faces.get(key),want=[0,0,0];want[f.axis]=f.sign;fan(vertices,want);}
 for(const corner of corners.values()){
  // Tiny bounded convex hull, only for the <= 12 points of one cuboid corner.
  // All share an original corner anchor, so topology is invariant for k > 0.
  const unique=new Map(corner.vertices.map(p=>[p.delta.map(x=>x.toFixed(10)).join(),p])),points=[...unique.values()],planes=new Map(),tol=Math.max(...dims)*1e-8;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
   let n=cross(sub(points[j].delta,points[i].delta),sub(points[k].delta,points[i].delta));if(length(n)<tol*tol)continue;n=unit(n);
   let ds=points.map(p=>dot(n,sub(p.delta,points[i].delta)));
   if(Math.max(...ds)>tol&&Math.min(...ds)<-tol)continue;
   if(Math.max(...ds)>tol){n=n.map(x=>-x);ds=ds.map(x=>-x);}
   if(n.some((x,a)=>x*corner.signs[a]<-1e-7))continue;
   const ids=ds.flatMap((d,a)=>Math.abs(d)<=tol?[a]:[]),key=ids.join();if(!planes.has(key))planes.set(key,{n,ids});
  }
  for(const {n,ids}of planes.values()){
   const ref=Math.abs(n[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(n,ref)),v=cross(n,u),mid=AXES.map(a=>ids.reduce((s,i)=>s+points[i].delta[a],0)/ids.length);
   ids.sort((a,b)=>Math.atan2(dot(sub(points[a].delta,mid),v),dot(sub(points[a].delta,mid),u))-Math.atan2(dot(sub(points[b].delta,mid),v),dot(sub(points[b].delta,mid),u)));
   for(let i=1;i<ids.length-1;i++)emit([points[ids[0]],points[ids[i]],points[ids[i+1]]],n);
  }
 }
 return {triangles:out,radiusCoefficients:radius,capCoefficients:cap};
}

export function prepareBevelGeometry(source,{THREE,maxSourceTriangles=250000,maxComponentTriangles=1024,maxGeneratedBytes=8*1024*1024,segments=2}={}) {
 if(!THREE)throw Error('THREE required');
 if(!Number.isInteger(segments)||segments<1||segments>4)throw Error('Bevel segments must be an integer from 1 to 4');
 const report={version:BEVEL_VERSION,status:'skipped',sourceTriangles:(source.index?.count??source.attributes.position?.count??0)/3,sourceBytes:byteSize(source),supportedComponents:0,skippedComponents:0,reasons:{},boxes:[],generatedBytes:0};
 const reject=reason=>{report.reasons[reason]=(report.reasons[reason]??0)+1;};
 let split;try {if(!source.attributes.position||Object.keys(source.morphAttributes).length)fail('unsupported-morph-or-position');split=splitComponents(source,maxSourceTriangles);}catch(e){reject(e.message);return {report,geometry:null};}
 const names=Object.keys(source.attributes),items=Object.fromEntries(names.map(n=>[n,source.attributes[n].itemSize]));if(!names.includes('normal')){names.push('normal');items.normal=3;}
 const rows=[],remaining=[],stride=names.reduce((sum,n)=>sum+items[n]*4,0),bytesPerVertex=stride+(items.position+(items.uv??0))*8;
 // Largest components first makes a small budget visibly useful rather than
 // spending it on thousands of microscopic details encountered first in a merge.
 const candidates=[];
 for(const component of split.components){
  let box;try{box=identifyBox(component,split.positions,source,maxComponentTriangles);}catch(strictError){
   try{box=identifyRoundedBox(component,split.positions,source,maxComponentTriangles);}catch(error){reject(error.message);report.skippedComponents++;}
  }
  if(!box){remaining.push(...component);continue;}
  candidates.push({box,component,score:box.dims[0]*box.dims[1]+box.dims[1]*box.dims[2]+box.dims[0]*box.dims[2]});
 }
 candidates.sort((a,b)=>b.score-a.score);
 const reserve=report.sourceTriangles*3*4;let retained=reserve;
 report.eligibleComponents=candidates.length;report.maximumComponentArea=candidates[0]?.score??0;
 for(const candidate of candidates){candidate.shape=topology(candidate.box,segments);candidate.cost=candidate.shape.triangles.length*3*bytesPerVertex;}
 report.minimumCandidateBytes=candidates.length?reserve+candidates[0].cost:0;
 report.desiredRetainedBytes=candidates.length?reserve+candidates.reduce((n,c)=>n+c.cost,0):0;
 for(const {box,component,shape,cost}of candidates){
  if(retained+cost>maxGeneratedBytes){reject('generated-memory-budget');report.skippedComponents++;remaining.push(...component);continue;}
  retained+=cost;report.supportedComponents++;
  report.boxes.push({dimensions:box.dims,center:box.center,basis:box.basis,radiusCoefficients:shape.radiusCoefficients,capCoefficients:shape.capCoefficients,maximumPlanarityError:box.maximumPlanarityError,sourceRadius:box.sourceRadius??0,roundedSource:!!box.roundedSource,sourceTriangles:component.length,vertexStart:rows.length*3,triangles:shape.triangles.length});
  for(const tri of shape.triangles){
   const q=tri.map(p=>p.base.map((v,a)=>v+.2*p.delta[a])),n=unit(cross(sub(q[1],q[0]),sub(q[2],q[0]))),axis=AXES.reduce((a,b)=>Math.abs(n[b])>Math.abs(n[a])?b:a,0),face=box.faces.get(faceKey(axis,Math.sign(n[axis])));
   rows.push({tri,box,face,normal:AXES.map(a=>box.basis.reduce((sum,b,k)=>sum+b[a]*n[k],0))});
  }
 }
 if(!report.supportedComponents)return {report,geometry:null};
 const geometry=new THREE.BufferGeometry(),bases={},deltas={};
 for(const name of names){const count=rows.length*3*items[name];geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(count),items[name]));if(name==='position'||name==='uv'){bases[name]=new Float32Array(count);deltas[name]=new Float32Array(count);}}
 let offset=0,lastMaterial=-1;
 for(const row of rows){
  const material=row.face.material;if(material!==lastMaterial){geometry.addGroup(offset,3,material);lastMaterial=material;}else geometry.groups.at(-1).count+=3;
  for(let j=0;j<3;j++)for(const name of names){
   let base,delta;
   if(name==='position'){base=AXES.map(a=>row.box.basis.reduce((sum,b,k)=>sum+b[a]*row.tri[j].base[k],0));delta=AXES.map(a=>row.box.basis.reduce((sum,b,k)=>sum+b[a]*row.tri[j].delta[k],0));}
   else if(name==='normal'){base=row.normal;delta=[0,0,0];}
   else if(row.box.roundedSource){base=roundedAttribute(row.box,source,name,row.tri[j],row.normal);delta=base.map(()=>0);}
   else {const [s,t]=row.face.tangents,p=row.tri[j];base=row.face.maps[name].map(([c,a,b])=>c+a*p.base[s]+b*p.base[t]);delta=row.face.maps[name].map(([,a,b])=>a*p.delta[s]+b*p.delta[t]);}
   geometry.attributes[name].array.set(base,(offset+j)*items[name]);if(bases[name]){bases[name].set(base,(offset+j)*items[name]);deltas[name].set(delta,(offset+j)*items[name]);}
  }offset+=3;
 }
 remaining.sort((a,b)=>a.src[0]-b.src[0]);const remainderIndex=new Uint32Array(remaining.flatMap(t=>t.src)),remainderGroups=[];
 let group=null;remaining.forEach((t,k)=>{if(!group||group.materialIndex!==t.material){group={start:k*3,count:0,materialIndex:t.material};remainderGroups.push(group);}group.count+=3;});
 geometry.userData={...source.userData,compacted:true,runtimeDeformable:true,bevelGenerated:BEVEL_VERSION,bevelBoxes:report.boxes};
 let previous=null;const update=ratio=>{if(previous===ratio)return;previous=ratio;for(const name of Object.keys(bases)){const out=geometry.attributes[name].array,a=bases[name],b=deltas[name];for(let i=0;i<out.length;i++)out[i]=a[i]+ratio*b[i];geometry.attributes[name].needsUpdate=true;}if(!geometry.boundingBox){geometry.computeBoundingBox();geometry.computeBoundingSphere();}};
 report.status='prepared';report.generatedTriangles=rows.length;report.remainderTriangles=remaining.length;report.replacedSourceTriangles=report.sourceTriangles-remaining.length;report.generatedBytes=byteSize(geometry)+remainderIndex.byteLength;report.retainedCPUBytes=report.generatedBytes+Object.values(bases).reduce((n,a)=>n+a.byteLength*2,0);report.expansion=(rows.length+remaining.length)/report.sourceTriangles;
 report.roundedSourceComponents=report.boxes.filter(b=>b.roundedSource).length;report.attributePolicy='source attributes shared on untouched triangles; interpolated source UV/color on replacement corners; new geometric normals; material references unchanged';
 update(.2);return {geometry,report,update,buffers:{bases,deltas},remainderIndex,remainderGroups};
}

function copyGeometryForWorker(source) {
 const arrays=new Map(),transfer=[];
 const copy=view=>{let value=arrays.get(view);if(!value){value=view.slice();arrays.set(view,value);transfer.push(value.buffer);}return value;};
 const attributes={};
 for(const [name,a]of Object.entries(source.attributes)){
  attributes[name]={array:copy(a.array),itemSize:a.itemSize,normalized:a.normalized,instanced:!!a.isInstancedBufferAttribute,...(a.isInterleavedBufferAttribute?{stride:a.data.stride,offset:a.offset}:{} )};
 }
 return {payload:{attributes,index:source.index?{array:copy(source.index.array),itemSize:1}:null,groups:source.groups.map(g=>({...g})),hasMorph:Object.keys(source.morphAttributes).length>0},transfer};
}

function hydrateWorkerCandidate(payload,source,THREE) {
 if(!payload.geometry)return {geometry:null,report:payload.report};
 const geometry=new THREE.BufferGeometry(),{bases,deltas}=payload.buffers;
 for(const [name,a]of Object.entries(payload.geometry.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize));
 geometry.groups=payload.geometry.groups;
 geometry.userData={...source.userData,compacted:true,runtimeDeformable:true,bevelGenerated:BEVEL_VERSION,bevelBoxes:payload.report.boxes};
 geometry.boundingBox=new THREE.Box3(new THREE.Vector3(...payload.geometry.boundingBox.min),new THREE.Vector3(...payload.geometry.boundingBox.max));
 geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(...payload.geometry.boundingSphere.center),payload.geometry.boundingSphere.radius);
 let previous=.2;
 const update=ratio=>{if(previous===ratio)return;previous=ratio;for(const [name,base]of Object.entries(bases)){const a=geometry.attributes[name],values=a.array,delta=deltas[name];for(let i=0;i<values.length;i++)values[i]=base[i]+ratio*delta[i];a.needsUpdate=true;}if(!geometry.boundingBox){geometry.computeBoundingBox();geometry.computeBoundingSphere();}};
 return {geometry,report:payload.report,update,remainderIndex:payload.remainderIndex,remainderGroups:payload.remainderGroups};
}

export function createBevelRuntime({THREE,maxRatio=.2,minPositiveRatio=.005,maxRetainedBytes=24*1024*1024,workerFactory,workerTimeoutMs=30000,...options}={}) {
 if(!THREE)throw Error('THREE required');
 maxRatio=Math.min(.2,Math.max(0,maxRatio));
 const roots=new Map(),records=new Map();let ratio=.06,preparing=null,disposed=false,rosterVersion=0,viewCamera=null,retainedBytes=0,worker=null,activeJob=null,jobSequence=0;
 const workerStats={jobs:0,cancelled:0,failures:0,copiedSourceBytes:0,workerComputeMs:0};
 function stopWorker(reason){
  const current=worker;worker=null;current?.terminate();
  if(activeJob){const job=activeJob;activeJob=null;clearTimeout(job.timer);job.reject(reason??new Error('Bevel worker terminated'));}
 }
 function ensureWorker(){
  if(worker)return worker;
  const factory=workerFactory??((url)=>new Worker(url,{type:'module',name:'qianyu-bevel'}));
  const instance=factory(new URL('./bevel-worker.js',import.meta.url));worker=instance;
  instance.onmessage=event=>{
   if(worker!==instance||!activeJob||event.data.id!==activeJob.id)return;
   const job=activeJob;activeJob=null;clearTimeout(job.timer);
   if(event.data.error)job.reject(new Error('Bevel worker: '+event.data.error));
   else {workerStats.workerComputeMs+=event.data.elapsedMs??0;job.resolve(event.data.result);}
  };
  instance.onerror=event=>{if(worker===instance){event.preventDefault?.();stopWorker(new Error('Bevel worker failed: '+(event.message??'module loading/execution')));}};
  instance.onmessageerror=()=>{if(worker===instance)stopWorker(new Error('Bevel worker message could not be decoded'));};
  return instance;
 }
 async function prepareInWorker(record,budget){
  // Admission before copy keeps large unsupported meshes off both transfer and CPU paths.
  const triangles=(record.source.index?.count??record.source.attributes.position.count)/3;
  if(triangles>(options.maxSourceTriangles??250000))return {geometry:null,report:{version:BEVEL_VERSION,status:'skipped',sourceTriangles:triangles,sourceBytes:byteSize(record.source),supportedComponents:0,skippedComponents:0,reasons:{'source-triangle-budget':1},boxes:[],generatedBytes:0}};
  const instance=ensureWorker(),{payload,transfer}=copyGeometryForWorker(record.source),id=++jobSequence;
  workerStats.jobs++;workerStats.copiedSourceBytes+=transfer.reduce((n,b)=>n+b.byteLength,0);
  const result=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{if(activeJob?.id===id)stopWorker(new Error('Bevel worker timed out'));},workerTimeoutMs);
   activeJob={id,record,resolve,reject,timer};
   try{instance.postMessage({id,source:payload,options:{maxSourceTriangles:options.maxSourceTriangles??250000,maxComponentTriangles:options.maxComponentTriangles??1024,maxGeneratedBytes:budget,segments:options.segments??2}},transfer);}catch(error){stopWorker(error);}
  });
  if(disposed||!records.has(record.source)||!record.meshes.size)return null;
  return hydrateWorkerCandidate(result,record.source,THREE);
 }
 function register(root,{assetKey=root.name}={}){
  if(disposed)throw Error('Bevel runtime disposed');if(roots.has(root))return;
  root.updateWorldMatrix(true,true);const list=[],skipped=[];root.traverse(mesh=>{
   if(!mesh.isMesh||mesh.userData.bevelOverlay||mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.userData.is_environment||mesh.userData.excluded_ground||!mesh.visible)return;
   const e=mesh.matrixWorld.elements,columns=[[e[0],e[1],e[2]],[e[4],e[5],e[6]],[e[8],e[9],e[10]]],scales=columns.map(length),scale=Math.max(...scales);
   if(!Number.isFinite(scale)||scale<=1e-12||Math.min(...scales)/scale<1-1e-6||[[0,1],[0,2],[1,2]].some(([a,b])=>Math.abs(dot(columns[a],columns[b]))>scale*scale*1e-6)){
    skipped.push({state:'skipped',reasons:{'nonuniform-world-scale-or-shear':1},supportedComponents:0,meshName:mesh.name});return;
   }
   const source=mesh.geometry;let record=records.get(source);if(!record){record={source,meshes:new Set(),overlays:new Map(),candidate:null,state:'pending'};records.set(source,record);}record.meshes.add(mesh);list.push({mesh,record});
   list.at(-1).worldScale=scale;
  });roots.set(root,{assetKey,list,skipped});rosterVersion++;apply();
 }
 function detachOverlay(record,mesh){const overlay=record.overlays.get(mesh);if(overlay){overlay.removeFromParent();record.overlays.delete(mesh);}}
 function apply(){for(const record of records.values()){
  const candidate=record.candidate;
  if(ratio>0&&candidate?.geometry){
   candidate.update(ratio);
   if(!candidate.remainder){const g=new THREE.BufferGeometry();for(const [name,a]of Object.entries(record.source.attributes))g.setAttribute(name,a);g.setIndex(new THREE.BufferAttribute(candidate.remainderIndex,1));g.groups=candidate.remainderGroups;g.boundingBox=record.source.boundingBox?.clone()??null;g.boundingSphere=record.source.boundingSphere?.clone()??null;g.userData={...record.source.userData,bevelRemainder:BEVEL_VERSION};candidate.remainder=g;}
   for(const mesh of record.meshes){mesh.geometry=candidate.remainder;let overlay=record.overlays.get(mesh);if(!overlay){overlay=new THREE.Mesh(candidate.geometry,mesh.material);overlay.name=mesh.name+' temporary bevel';overlay.userData={...mesh.userData,bevelOverlay:true};overlay.layers.mask=mesh.layers.mask;overlay.castShadow=mesh.castShadow;overlay.receiveShadow=mesh.receiveShadow;overlay.renderOrder=mesh.renderOrder;overlay.frustumCulled=mesh.frustumCulled;overlay.customDepthMaterial=mesh.customDepthMaterial;overlay.customDistanceMaterial=mesh.customDistanceMaterial;record.overlays.set(mesh,overlay);mesh.add(overlay);}}
  }else for(const mesh of record.meshes){detachOverlay(record,mesh);mesh.geometry=record.source;}
 }}
 function releaseCandidate(record){
  for(const mesh of record.meshes){detachOverlay(record,mesh);mesh.geometry=record.source;}
  retainedBytes-=record.candidate?.report.retainedCPUBytes??0;record.candidate?.geometry?.dispose();record.candidate?.remainder?.dispose();record.candidate=null;record.state='pending';retainedBytes=Math.max(0,retainedBytes);
 }
 function allocations(){
  const result=new Map(),cap=options.maxGeneratedBytes??2*1024*1024,priority=new Map();
  let frustum=null,cameraPosition=null;
  if(viewCamera){viewCamera.updateMatrixWorld(true);frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(viewCamera.projectionMatrix,viewCamera.matrixWorldInverse));cameraPosition=new THREE.Vector3().setFromMatrixPosition(viewCamera.matrixWorld);}
  const desired=r=>Math.min(cap,r.candidate?.report.desiredRetainedBytes??cap),minimum=r=>r.candidate?.report.minimumCandidateBytes??0;
  const viable=r=>r.state!=='failed'&&(r.candidate?.report.eligibleComponents!==0)&&(r.state!=='skipped'||r.candidate?.report.reasons?.['generated-memory-budget']);
  const weight=r=>r.candidate?.report.maximumComponentArea!==undefined?Math.sqrt(r.candidate.report.maximumComponentArea)*Math.max(...[...r.meshes].map(m=>Math.hypot(...m.matrixWorld.elements.slice(0,3)))):Math.sqrt((r.source.index?.count??r.source.attributes.position.count)/3+64);
  // Bounded water filling: unused demand is returned to the other owners.
  function share(budget,entries){
   const grants=new Map(entries.map(e=>[e.key,0]));let active=entries.filter(e=>e.limit>0);
   while(budget>1&&active.length){const total=active.reduce((n,e)=>n+e.weight,0);let used=0;for(const e of active){const add=Math.min(e.limit-grants.get(e.key),budget*e.weight/total);grants.set(e.key,grants.get(e.key)+add);used+=add;}budget-=used;active=active.filter(e=>e.limit-grants.get(e.key)>1);if(used<1)break;}return grants;
  }
  const owners=[];
  for(const entry of roots.values()){
   const unique=[...new Set(entry.list.map(e=>e.record))].filter(viable);if(!unique.length)continue;
   let importance=1;
   if(frustum){
    const bounds=new THREE.Box3();for(const {mesh,record}of entry.list){mesh.updateWorldMatrix(true,false);if(!record.source.boundingBox)record.source.computeBoundingBox();bounds.union(record.source.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}
    const sphere=bounds.getBoundingSphere(new THREE.Sphere()),distance=Math.max(sphere.radius,cameraPosition.distanceTo(sphere.center));
    importance=.25+(frustum.intersectsSphere(sphere)?64*Math.min(2,sphere.radius*sphere.radius/(distance*distance)):0);
   }
   owners.push({key:entry,records:unique,weight:importance,limit:unique.reduce((n,r)=>n+desired(r),0)});
   for(const r of unique)priority.set(r,Math.max(priority.get(r)??0,importance*Math.max(weight(r),.001)));
  }
  const ownerGrants=share(maxRetainedBytes,owners);
  for(const owner of owners){
   let budget=ownerGrants.get(owner.key);const records=owner.records.sort((a,b)=>weight(b)-weight(a));
   // Do not reserve unusable tiny allocations below index + first corner cost.
   for(const r of records){const floor=minimum(r);if(floor<=budget){result.set(r,(result.get(r)??0)+floor);budget-=floor;}}
   const active=records.filter(r=>minimum(r)===0||(result.get(r)??0)>=minimum(r)),extras=share(budget,active.map(r=>({key:r,weight:Math.max(weight(r),.001),limit:Math.max(0,desired(r)-(result.get(r)??0))})));
   for(const [r,extra]of extras)result.set(r,(result.get(r)??0)+extra);
  }
  for(const [r,value]of result)result.set(r,Math.min(desired(r),Math.floor(value)));
  let spare=maxRetainedBytes-[...result.values()].reduce((n,x)=>n+x,0);
  // Shared geometry and non-admissible owners can leave a large free pool.
  // Offer it to the largest in-view components before retaining it unused.
  const needy=[...records.values()].filter(r=>viable(r)&&desired(r)>(result.get(r)??0)).sort((a,b)=>(priority.get(b)??0)-(priority.get(a)??0));
  for(const r of needy){const current=result.get(r)??0,add=Math.min(spare,desired(r)-current);if(current+add<minimum(r))continue;result.set(r,current+Math.floor(add));spare-=Math.floor(add);if(spare<1)break;}
  return result;
 }
 async function prepare({camera}={}){
  if(camera)viewCamera=camera;
  if(preparing)return preparing;
  preparing=(async()=>{
   // Reallocate after unsupported records are known, and after streaming adds
   // or removes an owner. A new visible asset receives its own bounded share.
   for(let pass=0;pass<4&&!disposed;pass++){
    const version=rosterVersion,budgets=allocations();let work=0;
    for(const [record,budget]of budgets){
     const cost=record.candidate?.report.retainedCPUBytes??0,limited=record.candidate?.report.reasons?.['generated-memory-budget'];
     if(cost>budget*1.05||(limited&&budget>(record.budget??0)*1.25))releaseCandidate(record);
    }
    for(const record of records.values()){
     if(disposed)break;if(record.state!=='pending')continue;
     await new Promise(resolve=>setTimeout(resolve,0));if(!records.has(record.source))continue;
     const budget=Math.min(budgets.get(record)??0,Math.max(0,maxRetainedBytes-retainedBytes));record.budget=budget;work++;
     try{const candidate=await prepareInWorker(record,budget);if(!candidate)continue;record.candidate=candidate;record.state=candidate.geometry?'prepared':'skipped';retainedBytes+=candidate.report.retainedCPUBytes??0;apply();}
     catch(e){if(!records.has(record.source)||disposed)continue;workerStats.failures++;record.state='failed';record.candidate={report:{status:'failed',reasons:{[String(e.message)]:1},supportedComponents:0}};}
    }
    if(!work&&version===rosterVersion)break;
   }
   apply();return snapshot();
  })().finally(()=>{preparing=null;stopWorker();});return preparing;
 }
 function setRatio(value){if(!Number.isFinite(value))throw Error('Finite bevel ratio required');ratio=Math.min(maxRatio,Math.max(0,value));if(ratio>0&&ratio<minPositiveRatio)ratio=0;apply();return snapshot();}
 function unregister(root){const entry=roots.get(root);if(!entry)return;for(const {mesh,record}of entry.list){detachOverlay(record,mesh);mesh.geometry=record.source;record.meshes.delete(mesh);if(!record.meshes.size){record.candidate?.geometry?.dispose();record.candidate?.remainder?.dispose();retainedBytes-=record.candidate?.report.retainedCPUBytes??0;records.delete(record.source);if(activeJob?.record===record){workerStats.cancelled++;stopWorker(new Error('Bevel preparation cancelled: source unloaded'));}}}roots.delete(root);rosterVersion++;retainedBytes=Math.max(0,retainedBytes);for(const r of records.values())if(r.state==='skipped'&&r.candidate?.report.reasons?.['generated-memory-budget']){r.state='pending';r.candidate=null;}}
 function snapshot(){return {version:BEVEL_VERSION,preparationMode:'module-worker-no-main-thread-fallback',allocation:'bounded owner shares, minimum admissible geometry cost, unused global pool to largest projected components',viewAware:!!viewCamera,worker:{...workerStats,active:!!worker},ratio,maxRatio,minPositiveRatio,appliedComponents:ratio>0?[...roots.values()].reduce((n,e)=>n+e.list.reduce((s,{record,mesh})=>s+(record.overlays.has(mesh)?record.candidate.report.supportedComponents:0),0),0):0,pendingGeometries:[...records.values()].filter(r=>r.state==='pending').length,overlayMeshes:[...records.values()].reduce((n,r)=>n+r.overlays.size,0),roots:roots.size,uniqueGeometries:records.size,retainedCPUBytes:retainedBytes,generatedGPUBytes:[...records.values()].reduce((n,r)=>n+(r.candidate?.report.generatedBytes??0),0),zeroRetainsPreparedCache:true,maxRetainedBytes,sourceAttributesShared:true,metric:'r = ratio * min(adjacent perpendicular face depths); world lengths = local lengths * verified uniform worldScale',preparing:!!preparing,rows:[...roots.values()].map(e=>({assetKey:e.assetKey,geometries:[...e.list.map(({record,mesh,worldScale})=>({state:record.state,allocatedBytes:record.budget,worldScale,applied:ratio>0&&record.overlays.has(mesh),...record.candidate?.report})),...e.skipped],supportedComponents:e.list.reduce((n,{record})=>n+(record.candidate?.report.supportedComponents??0),0)}))};}
 function inspect(assetKey){
  const probe=g=>{if(!g)return null;const p=g.attributes.position;let weightedSum=0;const step=Math.max(1,Math.floor(p.count/4096));for(let i=0;i<p.count;i+=step)weightedSum+=(p.getX(i)*3+p.getY(i)*5+p.getZ(i)*7)*(1+i%17);return {vertices:p.count,triangles:(g.index?.count??p.count)/3,weightedPositionProbe:weightedSum};};
  return [...roots.values()].filter(e=>assetKey===undefined||e.assetKey===assetKey).map(e=>({assetKey:e.assetKey,ratio,meshes:e.list.map(({mesh,record})=>{const overlay=record.overlays.get(mesh);return {meshName:mesh.name,state:record.state,sourceReferenceRestored:mesh.geometry===record.source,overlayAttached:overlay?.parent===mesh,materialReferencePreserved:!overlay||overlay.material===mesh.material,source:probe(record.source),remainder:overlay?probe(mesh.geometry):null,bevel:probe(overlay?.geometry),components:overlay?record.candidate.report.supportedComponents:0};})}));
 }
 function reviewTargets(){
  const result=[];for(const entry of roots.values())for(const {mesh,record,worldScale}of entry.list){
   mesh.updateWorldMatrix(true,false);for(const [boxIndex,box]of (record.candidate?.report.boxes??[]).entries()){
    if(!record.candidate.geometry)continue;
    const localCenter=new THREE.Vector3(...AXES.map(a=>box.basis.reduce((s,b,k)=>s+b[a]*box.center[k],0))),worldCenter=localCenter.applyMatrix4(mesh.matrixWorld);
    result.push({assetKey:entry.assetKey,meshName:mesh.name,boxIndex,worldCenter:worldCenter.toArray(),worldDimensions:box.dimensions.map(x=>x*worldScale),sourceRadius:box.sourceRadius,roundedSource:box.roundedSource,worldRadiusCoefficients:box.radiusCoefficients.map(x=>x*worldScale),worldAxes:box.basis.map(b=>new THREE.Vector3(...b).transformDirection(mesh.matrixWorld).toArray()),ratio});
   }
  }return result;
 }
 return {register,prepare,setRatio,snapshot,inspect,reviewTargets,unregister,dispose(){disposed=true;for(const root of [...roots.keys()])unregister(root);stopWorker(new Error('Bevel runtime disposed'));}};
}
