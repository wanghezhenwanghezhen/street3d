/* Material-only adapter for the frozen paving candidate.
 * Textures are already calibrated. Never multiply targetSrgb again.
 * Candidate-colour and existing material hooks are preserved.
 */
const REVISION='parcel-paving-season-20261107-r1';
const ALIASES={original:'spring_green',palette1:'dusk_cool',palette2:'autumn_warm'};
const DECLARATIONS=`
uniform float qPavingEnabled,qPavingMultiply,qPavingSaturation;
uniform vec3 qPavingAdd,qPavingLinearGain;
vec3 qPavingToSrgb(vec3 c){
 return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));
}
vec3 qPavingToLinear(vec3 c){
 return mix(c/12.92,pow((max(c,vec3(0.))+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
`;
const TRANSFORM=`
if(qPavingEnabled>.5){
 vec3 qPavingSrgb=clamp(qPavingToSrgb(diffuseColor.rgb)*qPavingMultiply+qPavingAdd,0.,1.);
 float qPavingY=dot(qPavingSrgb,vec3(.213,.715,.072));
 qPavingSrgb=clamp(vec3(qPavingY)+(qPavingSrgb-vec3(qPavingY))*qPavingSaturation,0.,1.);
 diffuseColor.rgb=qPavingToLinear(qPavingSrgb)*qPavingLinearGain;
}
`;

/** Update uniforms at a season switch; no geometry/texture reload is needed.
 * `palette` can be the complete paving-shadow.json or its `palette` property.
 * Deliberately preserves grass, tactile, source-four-tone, H72 and unknowns.
 */
export function installPavingSeason(material,definition,THREE,palette){
 if(!material||!THREE?.Vector3)throw Error('installPavingSeason requires material and viewer THREE');
 const data=palette?.palette||palette;
 if(!Array.isArray(data?.seasons)||!Array.isArray(data?.runtimeMaterials))throw Error('Missing frozen paving palette');
 const bySeason=new Map(data.seasons.map(row=>[row.id,row]));
 const source=data.runtimeMaterials.find(row=>row.key===definition.style);
 const family=source?.family;
 const excludedShader=['source-four-tone','source-h72-vertex-color'].includes(definition.shader);
 const applied=definition.shader==='source-tile-albedo'&&!excludedShader&&['tile','water'].includes(family)
   &&!data.protectedRuntimeIds.includes(source.id);
 let season='spring_green',disposed=false;
 const stats={revision:REVISION,materialId:definition.id,style:definition.style,runtimeMaterialId:source?.id??null,
  family:family||'unclassified-source-material',applied,protected:!applied,
  variant:applied?'calibrated-material-srgb-preset-then-linear-gain':'source-preserved',
  diffuseColorOnly:true,worldUVPreserved:true,candidateColorPreserved:true,textureTargetAppliedAgain:false,
  physicalRerenderClaimed:false,
  reason:applied?'Exact frozen tile/water semantic identity':excludedShader?'Recovered source shader preserved':definition.style?.startsWith('tactile:')?'Approved tactile colour preserved':'Outside explicit tile/water namespace'};
 const uniforms={qPavingEnabled:{value:0},qPavingMultiply:{value:1},qPavingSaturation:{value:1},
  qPavingAdd:{value:new THREE.Vector3(0,0,0)},qPavingLinearGain:{value:new THREE.Vector3(1,1,1)}};
 const previousCompile=material.onBeforeCompile,previousCache=material.customProgramCacheKey;
 let compileHook,cacheHook;
 if(applied){
  compileHook=function(shader,renderer){
   previousCompile?.call(this,shader,renderer);
   const marker='#include <color_fragment>';
   if(!shader.fragmentShader.includes(marker))throw Error('Paving diffuse hook missing for '+definition.id);
   const mapAt=shader.fragmentShader.indexOf('#include <map_fragment>');
   if(mapAt<0||mapAt>shader.fragmentShader.indexOf(marker))throw Error('Paving map/decode order unsupported for '+definition.id);
   Object.assign(shader.uniforms,uniforms);
   shader.fragmentShader=DECLARATIONS+shader.fragmentShader.replace(marker,marker+'\n'+TRANSFORM);
  };
  cacheHook=function(){return (previousCache?.call(this)||'')+'|'+REVISION;};
  material.onBeforeCompile=compileHook;material.customProgramCacheKey=cacheHook;
  material.needsUpdate=true;
 }
 function setSeason(value){
  if(disposed)throw Error('Paving season adapter has been disposed');
  const next=ALIASES[value]||value,row=bySeason.get(next);
  if(!row)throw Error('Unknown paving season: '+value);
  season=next;stats.season=next;
  if(applied){
   const r=row.rules[family];
   if(!r||![r.srgbMultiply,r.saturation,...r.srgbAdd,...r.linearGain].every(Number.isFinite))throw Error('Invalid paving rule: '+next+'/'+family);
   uniforms.qPavingMultiply.value=r.srgbMultiply;
   uniforms.qPavingSaturation.value=r.saturation;
   uniforms.qPavingAdd.value.set(...r.srgbAdd);
   uniforms.qPavingLinearGain.value.set(...r.linearGain);
   uniforms.qPavingEnabled.value=r.enabled&&(r.srgbMultiply!==1||r.saturation!==1||r.srgbAdd.some(x=>x!==0)||r.linearGain.some(x=>x!==1))?1:0;
  }
  return {...stats};
 }
 function dispose(){
  if(disposed)return;disposed=true;
  if(material.onBeforeCompile===compileHook)material.onBeforeCompile=previousCompile;
  if(material.customProgramCacheKey===cacheHook)material.customProgramCacheKey=previousCache;
  if(applied)material.needsUpdate=true;
 }
 material.userData=material.userData||{};material.userData.pavingSeason=stats;
 setSeason(season);
 return {applied,family:stats.family,variant:stats.variant,stats,uniforms,setSeason,dispose,get season(){return season;}};
}
