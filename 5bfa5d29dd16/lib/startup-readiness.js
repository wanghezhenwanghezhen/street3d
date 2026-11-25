// Admission is based on the final entry camera and live resources, not job completion.
export async function checkStartup({THREE,renderer,scene,camera,terrain,buildings,furniture,sprites,bevel,environment,retry=false,coreFailures=[]}){
 const report={startedAt:new Date().toISOString(),ready:false,retry,checks:{}};
 const deadline=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]).finally(()=>clearTimeout(timer));};
 try{
  if(coreFailures.length)throw Error('Core loading failed; reload required: '+coreFailures.join(', '));
  if(!terrain)throw Error('Terrain stream is unavailable');
  report.checks.terrain=await terrain.settle({retry,timeoutMs:120000});
  if(retry){buildings.retryErrors(camera.position);furniture.retryErrors?.();await sprites.retry();}
  await deadline(Promise.all([buildings.loadInitial(camera.position),furniture.settle(),sprites.settle()]),120000,'Nearby resources');
  for(const [name,stream]of [['buildings',buildings],['furniture',furniture]]){
   const state=stream.snapshot(),missing=state.rows.filter(r=>r.wanted&&r.state!=='loaded');
   report.checks[name]={wanted:state.rows.filter(r=>r.wanted).length,resident:state.loaded,missing};
   if(missing.length)throw Error(name+' is incomplete');
  }
  const spriteState=sprites.snapshot();report.checks.sprites={failedPages:spriteState.failedPages};
  if(spriteState.failedPages.length)throw Error('Visible sprite atlas failed');
  await deadline(bevel.prepare({camera}),120000,'Building bevel');report.checks.bevel=bevel.snapshot();
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const textures=new Set(),errors=[];let meshes=0;
  scene.traverseVisible(object=>{
   if(!object.isMesh||!object.layers.test(camera.layers))return;meshes++;
   if(!object.geometry?.attributes.position?.count)errors.push('Empty geometry '+object.name);
   for(const material of [object.material].flat().filter(Boolean)){
    if(material.userData.sourceDefinition?.textureUrl&&!material.map)errors.push('Missing tile '+object.name);
    for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    for(const uniform of Object.values(material.uniforms??{}))if(uniform.value?.isTexture)textures.add(uniform.value);
   }
  });
  await deadline(renderer.compileAsync(scene,camera),60000,'GPU shader compilation');
  renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
  for(const texture of environment.compiledTextures())textures.add(texture);
  for(const texture of textures){const image=texture.image;if(!texture.isRenderTargetTexture&&(!image||!(image.width>0)||!(image.height>0)||image.complete===false))errors.push('Undecoded texture '+texture.name);}
  const gl=renderer.getContext(),programs=renderer.info.programs.map(p=>({name:p.name,linked:gl.getProgramParameter(p.program,gl.LINK_STATUS),shaders:gl.getAttachedShaders(p.program).map(s=>gl.getShaderParameter(s,gl.COMPILE_STATUS))}));
  if(programs.some(p=>!p.linked||p.shaders.some(ok=>!ok)))errors.push('GPU shader compilation failed');
  const glError=gl.getError();if(gl.isContextLost()||glError!==gl.NO_ERROR)errors.push('WebGL context/error '+glError);
  report.checks.gpu={meshes,textures:textures.size,programs:programs.length,allProgramsLinked:programs.every(p=>p.linked&&p.shaders.every(Boolean)),glError,errors};
  if(errors.length)throw Error(errors.join('; '));
  report.ready=true;
 }catch(error){report.error=error.message;if(error.report)report.terrainFailure=error.report;}
 report.finishedAt=new Date().toISOString();return report;
}
