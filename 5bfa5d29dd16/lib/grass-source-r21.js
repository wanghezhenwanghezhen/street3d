import {quality} from './quality.js';
import {createResourceCache} from './resource-cache.js';

// Four source images shared across material recipes. A material owns a lease;
// terrain detail/far clones never own or prematurely dispose the shared image.
let cache;
export async function sourceGrassMaterial(definition,THREE,renderer,{lit,loadTexture}){
 if(!cache)cache=createResourceCache({async load({url}){
  const t=await loadTexture(url,THREE);
  t.colorSpace=THREE.NoColorSpace; // original sRGB recipe below decodes exactly once
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;
  t.anisotropy=Math.min(4,renderer?.capabilities.getMaxAnisotropy()??1);t.userData.sharedGrassR21=true;t.needsUpdate=true;return t;
 },dispose(t){t.dispose();if(t.image instanceof HTMLImageElement)t.image.src='';t.image?.close?.();t.image=null;}});
 const family=definition.style.match(/GRASS_[ABCD]1_P20/)?.[0];if(!family)throw Error('Unknown source grass family');
 const recipe=definition.sourceField?.source_recipe,profile=recipe?.profile??definition.sourceField?.actual_sampler_profile??definition.sourceProfile;
 if(!profile?.reference_srgb)throw Error('Missing source grass recipe '+definition.id);
 const url=`/assets/grass-r21/${quality.profile==='mobile'?256:512}/${family}.webp`,lease=await cache.acquire(url,{url});
 const Material=lit?THREE.MeshStandardMaterial:THREE.MeshBasicMaterial;
 const material=new Material({color:0xffffff,map:lease.value,side:THREE.DoubleSide,toneMapped:false,...(lit?{roughness:1,metalness:0}:{})});
 material.userData.sourceDefinition=definition;
 material.userData.grassSource={family,periodU:2,projection:'world-triplanar',recipe:'original-ground-shade',shared:true};
 material.addEventListener('dispose',()=>lease.release());
 const target=recipe?.target_srgb??definition.sourceField?.target_srgb??definition.targetSrgb??profile.target_srgb;
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,{qGrassMap:{value:lease.value},qGrassTarget:{value:new THREE.Vector3(...target)},qGrassReference:{value:new THREE.Vector3(...profile.reference_srgb)},qGrassGain:{value:recipe?.gain??definition.sourceField?.gain??definition.gain??1},qGrassContrast:{value:profile.contrast??.9}});
  shader.vertexShader='varying vec3 qGrassWorld;varying vec3 qGrassNormal;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nqGrassWorld=(modelMatrix*vec4(transformed,1.)).xyz;qGrassNormal=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader=`varying vec3 qGrassWorld;varying vec3 qGrassNormal;
uniform sampler2D qGrassMap;uniform vec3 qGrassTarget;uniform vec3 qGrassReference;uniform float qGrassGain;uniform float qGrassContrast;
vec3 qGrassDecode(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 qGrassEncode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
vec3 qw=pow(abs(normalize(qGrassNormal)),vec3(8.));qw/=max(qw.x+qw.y+qw.z,.00001);
// Top uses source X,-Z. Side samples include height, so zero-area source UVs
// cannot stretch a single image row across the entire retaining face.
vec3 qc=texture2D(qGrassMap,qGrassWorld.zy*vec2(-.5,.5)).rgb*qw.x
       +texture2D(qGrassMap,qGrassWorld.xz*vec2(.5,-.5)).rgb*qw.y
       +texture2D(qGrassMap,qGrassWorld.xy*.5).rgb*qw.z;
vec3 qlin=qGrassDecode(qc);float qlum=dot(qlin,vec3(.2126,.7152,.0722));qc=qGrassEncode(mix(vec3(qlum),qlin,.9));
qc=${definition.sideRecipe?'qc*qGrassTarget/max(qGrassReference,vec3(.01))':'qGrassTarget+(qc-qGrassReference)*qGrassContrast'};
qc=min(qc,vec3(.96))+.04*(1.-exp(-max(qc-.96,vec3(0.))/.04));
diffuseColor.rgb*=qGrassDecode(clamp(qc*qGrassGain,0.,1.));
`);
 };
 material.customProgramCacheKey=()=>`source-grass-r21-${!!lit}-${!!definition.sideRecipe}-${definition.id}`;
 return material;
}
export function grassSourceCacheState(){return cache?.snapshot()??{entries:0,rows:[]};}
