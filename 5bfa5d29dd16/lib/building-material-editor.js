import * as THREE from 'three';
const clamp=x=>Math.max(0,Math.min(1,Number(x)||0));
export function createBuildingMaterialEditor({renderer,scene,camera,environment,sun}){
 const roots=new Map(),saved=new Map(),cloneCache=new Map();let defaults={},rt=null,lastCapture=-Infinity,captures=0;
 const shared={qRefractScene:{value:null},qRefractVP:{value:new THREE.Matrix4()}};
 const role=m=>m.userData.source_role||m.name||'未命名材质';
 function state(id,name){return {...defaults['*'],...defaults[name],...saved.get(id)?.['*'],...saved.get(id)?.[name]};}
 function install(source,values,thickness){
  const material=source.clone();if(source.uniforms)material.uniforms={...source.uniforms};
  // clone() intentionally does not carry onBeforeCompile. Rebuild the chain
  // from the hook before environment grading; shared uniforms remain shared.
  material.onBeforeCompile=source._qBeforeEnvironment??source.onBeforeCompile;
  material.customProgramCacheKey=()=>source._qBeforeEnvironmentKey??source.customProgramCacheKey();
  const holder=new THREE.Mesh(new THREE.BufferGeometry(),material);environment.install(holder);holder.geometry.dispose();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey();
  const uniforms={...shared,qSurfaceScatter:{value:clamp(values.scatter)},qRefraction:{value:clamp(values.refraction)},qSurfaceLight:{value:sun.position.clone().sub(sun.target.position).normalize()},qRefractThickness:{value:thickness}};
  material.onBeforeCompile=function(shader,context){
   prior.call(this,shader,context);Object.assign(shader.uniforms,uniforms);
   const declaration='varying vec3 qEditWorldP; varying vec3 qEditWorldN;\n';
   shader.vertexShader=declaration+shader.vertexShader;
   const vertex=`vec4 qLocalP=vec4(position,1.);vec3 qLocalN=normal;
    #ifdef USE_INSTANCING
      qLocalP=instanceMatrix*qLocalP;qLocalN=mat3(instanceMatrix)*qLocalN;
    #endif
    qEditWorldP=(modelMatrix*qLocalP).xyz;qEditWorldN=normalize(transpose(mat3(viewMatrix))*normalize(normalMatrix*qLocalN));\n`;
   if(shader.vertexShader.includes('#include <project_vertex>'))shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',vertex+'#include <project_vertex>');
   else shader.vertexShader=shader.vertexShader.replace('gl_Position=',vertex+'gl_Position=');
   shader.fragmentShader=declaration+'uniform sampler2D qRefractScene; uniform mat4 qRefractVP; uniform vec3 qSurfaceLight; uniform float qSurfaceScatter,qRefraction,qRefractThickness;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>',`
    vec3 qN=normalize(qEditWorldN);if(!gl_FrontFacing)qN=-qN;
    float qWrap=(max(dot(qN,qSurfaceLight)+.55,0.)/1.55-max(dot(qN,qSurfaceLight),0.));
    // Bounded artist-controlled diffuse wrap, not a volumetric SSS solver.
    gl_FragColor.rgb+=gl_FragColor.rgb*qSurfaceScatter*qWrap*.65;
    if(qRefraction>0.){
      vec3 qIncident=normalize(qEditWorldP-cameraPosition);
      vec3 qRay=refract(qIncident,qN,1./1.45);
      vec4 qClip=qRefractVP*vec4(qEditWorldP+qRay*qRefractThickness,1.);
      vec2 qUV=qClip.xy/qClip.w*.5+.5;
      float qValid=step(0.,qUV.x)*step(qUV.x,1.)*step(0.,qUV.y)*step(qUV.y,1.)*step(0.,qClip.w);
      float qFresnel=.0337+.9663*pow(1.-max(dot(-qIncident,qN),0.),5.);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,texture2D(qRefractScene,clamp(qUV,0.,1.)).rgb,qRefraction*(1.-qFresnel)*qValid);
    }
    #include <colorspace_fragment>`);
  };
  material.customProgramCacheKey=()=>priorKey+'-surface-refraction-r17-v1';material.needsUpdate=true;material.userData={...material.userData,temporaryMaterialEdit:true};material._qEditorUniforms=uniforms;return {material,uniforms};
 }
 function syncOverlays(entry){entry.root.traverse(o=>{if(o.userData.temporaryEditOverlay&&o.parent?.isMesh)o.material=o.parent.material;});}
 function restore(entry){for(const row of entry.meshes){row.mesh.material=row.source;for(const item of row.clones){item.refs--;if(!item.refs){item.material.dispose();cloneCache.delete(item.key);}}row.clones=[];}entry.active=0;syncOverlays(entry);}
 function apply(entry){
  restore(entry);const box=new THREE.Box3().setFromObject(entry.root),size=box.getSize(new THREE.Vector3()),thickness=Math.max(.03,Math.min(size.x,size.y,size.z)*.25);
  for(const row of entry.meshes){const sources=[row.source].flat(),mats=sources.map(m=>{const p=state(entry.id,role(m));if(!p.scatter&&!p.refraction)return m;const key=m.uuid+'|'+(p.scatter??0)+'|'+(p.refraction??0)+'|'+(p.refraction?thickness:0);let clone=cloneCache.get(key);if(!clone){clone={...install(m,p,thickness),key,refs:0};cloneCache.set(key,clone);}clone.refs++;row.clones.push(clone);entry.active++;return clone.material;});row.mesh.material=Array.isArray(row.source)?mats:mats[0];}syncOverlays(entry);
 }
 function register(root,id){if(roots.has(root))return;const entry={root,id,meshes:[],active:0};root.traverse(mesh=>{if(mesh.isMesh&&!mesh.userData.is_environment)entry.meshes.push({mesh,source:mesh.material,clones:[]});});roots.set(root,entry);apply(entry);}
 function unregister(root){const e=roots.get(root);if(e){restore(e);roots.delete(root);}}
 function set(values,id=null,material='*'){const v={};for(const k of ['scatter','refraction'])if(k in values)v[k]=clamp(values[k]);if(id){const record=saved.get(id)??{};record[material]={...record[material],...v};saved.set(id,record);}else{defaults[material]={...defaults[material],...v};for(const record of saved.values())record[material]={...record[material],...v};}for(const e of roots.values())if(!id||e.id===id)apply(e);return snapshot();}
 function beforeRender(now){
  const meshes=[];scene.traverse(m=>{if(m.isMesh&&[m.material].flat().some(mat=>mat?._qEditorUniforms?.qRefraction.value>0))meshes.push(m);});
  if(!meshes.length){if(rt){environment.forgetTexture?.(rt.texture);rt.dispose();rt=null;shared.qRefractScene.value=null;}return;}
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),scale=Math.min(.5,720/size.x,450/size.y),w=Math.max(1,Math.round(size.x*scale)),h=Math.max(1,Math.round(size.y*scale));
  if(!rt)rt=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});else if(rt.width!==w||rt.height!==h)rt.setSize(w,h);
  shared.qRefractScene.value=rt.texture;
  if(now-lastCapture<32)return;
  const visibility=meshes.map(m=>m.visible),target=renderer.getRenderTarget(),shadow=renderer.shadowMap.autoUpdate,needs=renderer.shadowMap.needsUpdate;
  try{for(const m of meshes)m.visible=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.setRenderTarget(rt);renderer.render(scene,camera);camera.updateMatrixWorld();shared.qRefractVP.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);lastCapture=now;captures++;}
  finally{meshes.forEach((m,i)=>m.visible=visibility[i]);renderer.setRenderTarget(target);renderer.shadowMap.autoUpdate=shadow;renderer.shadowMap.needsUpdate=needs;}
 }
 function materials(id=null){return [...new Set([...roots.values()].filter(e=>!id||e.id===id).flatMap(e=>e.meshes.flatMap(r=>[r.source].flat().map(role))))].sort();}
 function snapshot(){return {defaults,saved:Object.fromEntries(saved),residentRoots:roots.size,clonedMaterials:[...roots.values()].reduce((n,e)=>n+e.active,0),refraction:{method:'Screen-space Snell refraction, IOR 1.45, Schlick Fresnel; visible background capture only; not offline path-traced BSDF',captures,target:rt?[rt.width,rt.height]:null},scatter:'bounded diffuse wrap; not volumetric SSS'};}
 return {register,unregister,set,beforeRender,materials,get:(id,material='*')=>state(id,material),snapshot};
}
