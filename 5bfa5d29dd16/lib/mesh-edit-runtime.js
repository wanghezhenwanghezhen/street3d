// Per-instance generated geometry is released before the source lease. Parameter
// records survive streaming; original attribute buffers are never mutated.
export const GEOMETRY_DEFAULTS={edge:.06,point:0,harden:true,smooth:0,repeat:1};
export function createMeshEditRuntime({THREE,maxRetainedBytes=12*1024*1024,onChange=()=>{}}){
 const roots=new Map(),parameters=new Map();let defaults={...GEOMETRY_DEFAULTS},worker=null,job=null,sequence=0,preparing=null,disposed=false,retained=0,activeId=null;
 const stats={jobs:0,failures:0,staleResults:0,workerMs:0};
 const get=id=>({...defaults,...parameters.get(id)});
 function clear(record){if(record.candidate){retained-=record.bytes;record.candidate.dispose();record.candidate=null;}record.overlay?.removeFromParent();record.overlay=null;record.remainder?.dispose();record.remainder=null;record.mesh.geometry=record.source;record.bytes=0;}
 function register(root,{assetKey,kind='landmark'}={}){
  if(kind!=='landmark'||roots.has(root))return;
  const entry={assetKey,root,revision:0,records:[]};root.traverse(mesh=>{
   if(!mesh.isMesh||mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.userData.is_environment||mesh.userData.excluded_ground||!mesh.visible)return;
   const source=mesh.geometry;if(!source.boundingBox)source.computeBoundingBox();const size=source.boundingBox.getSize(new THREE.Vector3()),area=size.x*size.y+size.x*size.z+size.y*size.z;
   mesh.updateWorldMatrix(true,false);const matrix=mesh.matrixWorld.clone(),a=matrix.elements,scales=[Math.hypot(a[0],a[1],a[2]),Math.hypot(a[4],a[5],a[6]),Math.hypot(a[8],a[9],a[10])],nonuniform=Math.max(...scales)-Math.min(...scales)>Math.max(...scales)*1e-6;
   entry.records.push({mesh,source,candidate:null,bytes:0,state:'pending',report:null,area,metricMatrix:nonuniform?matrix:null});
  });roots.set(root,entry);onChange();
 }
 function unregister(root){const entry=roots.get(root);if(!entry)return;entry.revision++;for(const r of entry.records)clear(r);roots.delete(root);onChange();}
 function setSettings(values,id=null){
  if(id)activeId=id;
  const valid={};for(const [k,lo,hi]of [['edge',0,.2],['point',0,.2],['smooth',0,1],['repeat',0,10]])if(Number.isFinite(values[k]))valid[k]=Math.min(hi,Math.max(lo,k==='repeat'?Math.round(values[k]):values[k]));if('harden'in values)valid.harden=!!values.harden;
  if(id)parameters.set(id,{...get(id),...valid});else{defaults={...defaults,...valid};for(const [key,p]of parameters)parameters.set(key,{...p,...valid});}
  for(const e of roots.values())if(!id||e.assetKey===id){e.revision++;const p=get(e.assetKey);for(const r of e.records){r.state='pending';if(!p.edge&&!p.point&&(!p.smooth||!p.repeat)){clear(r);r.state='restored';r.report={restored:true};}}}
  onChange();return snapshot();
 }
 function ensureWorker(){if(worker)return worker;worker=new Worker(new URL('./mesh-edit-worker.js',import.meta.url),{type:'module',name:'qianyu-building-editor'});
  worker.onmessage=({data})=>{if(!job||job.id!==data.id)return;const j=job;job=null;clearTimeout(j.timer);data.error?j.reject(Error(data.error)):j.resolve(data);};
  worker.onerror=e=>{e.preventDefault();if(job){clearTimeout(job.timer);job.reject(Error(e.message));job=null;}worker?.terminate();worker=null;};return worker;
 }
 async function generate(record,settings){
  const attributes={},transfer=[];for(const [name,a]of Object.entries(record.source.attributes)){
   const array=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let k=0;k<a.itemSize;k++)array[i*a.itemSize+k]=a.getComponent(i,k);attributes[name]={array,itemSize:a.itemSize};transfer.push(array.buffer);
  }
  if(record.metricMatrix){const p=attributes.position.array,n=attributes.normal?.array,v=new THREE.Vector3(),normalMatrix=new THREE.Matrix3().getNormalMatrix(record.metricMatrix);for(let i=0;i<p.length;i+=3){v.fromArray(p,i).applyMatrix4(record.metricMatrix).toArray(p,i);if(n)v.fromArray(n,i).applyNormalMatrix(normalMatrix).toArray(n,i);}}
  const index=record.source.index?new Uint32Array(record.source.index.array):null;if(index)transfer.push(index.buffer);
  const id=++sequence,instance=ensureWorker();stats.jobs++;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker?.terminate();worker=null;job=null;reject(Error('Geometry worker timeout'));},30000);job={id,resolve,reject,timer};instance.postMessage({id,source:{attributes,index,groups:record.source.groups},settings},transfer);});
 }
 async function prepare({camera}={}){
  if(preparing)return preparing;
  preparing=(async()=>{
   for(let cycle=0;cycle<4&&!disposed;cycle++){
    const list=[...roots.values()];let total=0;
    const frustum=camera?new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)):null;
    for(const e of list){e.root.updateWorldMatrix(true,true);const box=new THREE.Box3();for(const r of e.records)box.union(r.source.boundingBox.clone().applyMatrix4(r.mesh.matrixWorld));const sphere=box.getBoundingSphere(new THREE.Sphere()),distance=camera?Math.max(sphere.radius,camera.position.distanceTo(sphere.center)):1;
     e.weight=frustum?.intersectsBox(box)===false?.12:1+8*Math.min(2,sphere.radius*sphere.radius/(distance*distance));total+=e.weight;
    }
    for(const e of list){e.budget=Math.max(0,Math.floor(maxRetainedBytes*e.weight/Math.max(total,1)))+(e.assetKey===activeId?Math.max(0,maxRetainedBytes-retained):0);let sum=0;for(const r of e.records){r.weight=Math.sqrt(Math.max(r.area,.01))*(/wall|body|facade/i.test(r.mesh.name)?2.5:1);sum+=r.weight;}
     for(const r of e.records){r.budget=Math.max(r.bytes,Math.floor(e.budget*r.weight/sum));if(r.state==='skipped'&&r.report?.reasons?.['generated-memory-budget']&&r.budget>(r.previousBudget??0)*1.3)r.state='pending';r.previousBudget=r.budget;}
    }
    list.sort((a,b)=>(b.assetKey===activeId)-(a.assetKey===activeId)||b.weight-a.weight);let work=0;
    for(const e of list)for(const r of e.records.sort((a,b)=>b.area-a.area)){
     if(!roots.has(e.root)||r.state!=='pending')continue;const revision=e.revision,p=get(e.assetKey);work++;
     if(!p.edge&&!p.point&&(!p.smooth||!p.repeat)){clear(r);r.state='restored';continue;}
     const triangles=(r.source.index?.count??r.source.attributes.position.count)/3;
     if(triangles>75000){r.state='skipped';r.report={reasons:{'source-triangle-budget':1}};continue;}
     r.state='preparing';onChange();
     try{
      const maxBytes=Math.max(0,Math.min(4*1024*1024,maxRetainedBytes-retained+r.bytes,r.budget));if(maxBytes<1024){clear(r);r.state='skipped';r.report={supported:0,reasons:{'generated-memory-budget':1}};continue;}
      const data=await generate(r,{...p,maxBytes});stats.workerMs+=data.elapsedMs??0;
      if(!roots.has(e.root)||revision!==e.revision){stats.staleResults++;continue;}
      if(data.result&&data.report.generatedBytes<=maxBytes){const g=new THREE.BufferGeometry();for(const [name,a]of Object.entries(data.result.attributes))g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize));g.groups=data.result.groups;if(r.metricMatrix)g.applyMatrix4(r.metricMatrix.clone().invert());g.computeBoundingBox();g.computeBoundingSphere();g.userData={...r.source.userData,runtimeDeformable:true,temporaryMeshEdit:true};clear(r);r.candidate=g;
       const remainder=new THREE.BufferGeometry();for(const [name,a]of Object.entries(r.source.attributes))remainder.setAttribute(name,a);remainder.setIndex(new THREE.BufferAttribute(data.result.remainderIndex,1));remainder.groups=data.result.remainderGroups;remainder.boundingBox=r.source.boundingBox;remainder.boundingSphere=r.source.boundingSphere;r.remainder=remainder;r.mesh.geometry=remainder;
       const overlay=new THREE.Mesh(g,r.mesh.material);overlay.name=(r.mesh.name||'building')+' edited geometry';overlay.userData={...r.mesh.userData,temporaryEditOverlay:true};overlay.castShadow=r.mesh.castShadow;overlay.receiveShadow=r.mesh.receiveShadow;overlay.layers.mask=r.mesh.layers.mask;r.mesh.add(overlay);r.overlay=overlay;
       r.bytes=data.report.generatedBytes;retained+=r.bytes;r.state='prepared';}
      else{clear(r);r.state='skipped';if(data.result)data.report.reasons['global-memory-budget']=1;}
      r.report=data.report;
     }catch(error){if(roots.has(e.root)&&e.revision===revision){clear(r);stats.failures++;r.state='failed';r.report={error:String(error.message)};}}
     onChange();await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!work)break;
   }
   return snapshot();
  })().finally(()=>{preparing=null;worker?.terminate();worker=null;onChange();});return preparing;
 }
 function snapshot(){return {version:'building-instance-editor-r17/1',preparing:!!preparing,ratio:defaults.edge,parameters:Object.fromEntries(parameters),defaults:{...defaults},scope:'landmark-only',roots:roots.size,retainedCPUBytes:retained,generatedGPUBytes:retained,maxRetainedBytes,worker:{...stats,active:!!worker},appliedComponents:[...roots.values()].reduce((n,e)=>n+e.records.reduce((s,r)=>s+(r.candidate?r.report?.supported??0:0),0),0),pendingGeometries:[...roots.values()].reduce((n,e)=>n+e.records.filter(r=>r.state==='pending'||r.state==='preparing').length,0),rows:[...roots.values()].map(e=>({assetKey:e.assetKey,settings:get(e.assetKey),geometries:e.records.map(r=>({meshName:r.mesh.name,state:r.state,applied:!!r.candidate,...r.report}))}))};}
 function inspect(id){return [...roots.values()].filter(e=>!id||e.assetKey===id).map(e=>({assetKey:e.assetKey,settings:get(e.assetKey),meshes:e.records.map(r=>({meshName:r.mesh.name,state:r.state,sourceReferenceRestored:r.mesh.geometry===r.source,sourceVertices:r.source.attributes.position.count,currentVertices:(r.candidate??r.mesh.geometry).attributes.position.count,weightedPositionProbe:Array.from((r.candidate??r.mesh.geometry).attributes.position.array).reduce((n,x,i)=>n+x*(1+i%13),0)}))}));}
 return {register,unregister,prepare,setSettings,setActive:id=>{activeId=id;},getSettings:get,setRatio:value=>setSettings({edge:value}),snapshot,inspect,reviewTargets:()=>[],dispose(){disposed=true;for(const root of [...roots.keys()])unregister(root);worker?.terminate();worker=null;}};
}
