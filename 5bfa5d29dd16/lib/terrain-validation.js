// CPU dependency checks complement (and do not replace) the startup GPU check.
export function inspectTerrainTexture(texture,label='terrain texture'){
 if(!texture?.isTexture)throw Error('Missing '+label);
 const image=texture.image;
 if(!image||!(image.width>0)||!(image.height>0)||image.complete===false)throw Error('Undecoded '+label);
 if(texture.isData3DTexture&&!(image.depth>0))throw Error('Invalid volume '+label);
 if((texture.isDataTexture||texture.isData3DTexture)&&!(image.data?.length>=image.width*image.height*(image.depth??1)))throw Error('Incomplete data '+label);
 return {label,width:image.width,height:image.height,depth:image.depth??1};
}

export function inspectTerrainMaterial(material,THREE){
 if(!material?.isMaterial)throw Error('Missing terrain material');
 const definition=material.userData.sourceDefinition??{},textures=[],seen=new Set();
 const check=(value,label)=>{if(value?.isTexture&&!seen.has(value)){seen.add(value);textures.push(inspectTerrainTexture(value,label));}};
 if(definition.textureUrl&&!material.map)throw Error('Missing source tile '+definition.textureUrl);
 for(const [name,value]of Object.entries(material))check(value,name);
 const template=material.isShaderMaterial?material:THREE.ShaderLib[material.isMeshStandardMaterial?'standard':material.isMeshBasicMaterial?'basic':''];
 if(!template)throw Error('Unsupported terrain shader '+material.type);
 const shader={vertexShader:template.vertexShader,fragmentShader:template.fragmentShader,uniforms:THREE.UniformsUtils.clone(template.uniforms)};
 material.onBeforeCompile.call(material,shader,null);
 for(const [name,uniform]of Object.entries(shader.uniforms))check(uniform.value,name);
 if(definition.shader==='source-four-tone'){
  const lut=shader.uniforms.qyAgxLut?.value;inspectTerrainTexture(lut,'source four-tone LUT');
  if(lut.image.data.length!==lut.image.width*lut.image.height*lut.image.depth*4)throw Error('Incomplete source four-tone LUT');
 }
 if(material.userData.grassSource&&(!shader.uniforms.qGrassMap?.value||!shader.vertexShader.includes('qGrassWorld=')||!shader.fragmentShader.includes('qGrassDecode')))throw Error('Source grass projection was not installed');
 if(material.userData.terrainMaskVariant){
  if(!shader.uniforms.qDetailMask?.value||!shader.vertexShader.includes('qDetailWorld=')||!shader.fragmentShader.includes('float qDetail='))throw Error('Terrain mask shader hook was not installed');
 }
 return {materialId:definition.id??null,shader:definition.shader??material.type,textures,grassSource:material.userData.grassSource??null,shaderHookExpanded:true,gpuCompile:'pending'};
}

export function inspectTerrainMesh(mesh){
 const geometry=mesh?.geometry,p=geometry?.attributes.position,n=geometry?.attributes.normal,index=geometry?.index;
 if(!p||!n||!index||p.count<3||n.count!==p.count||index.count<3||index.count%3)throw Error('Incomplete terrain geometry');
 if(!geometry.boundingSphere||!Number.isFinite(geometry.boundingSphere.radius))throw Error('Invalid terrain bounds');
 if(mesh.material?.map&&!geometry.attributes.uv)throw Error('Textured terrain is missing UVs');
 return {vertices:p.count,triangles:index.count/3,integrity:mesh.userData.streamIntegrity??'structural'};
}
