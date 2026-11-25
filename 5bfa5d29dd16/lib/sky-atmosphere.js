import * as THREE from 'three';

// One texture-free sky dome. Air scattering changes the vertical colour depth,
// independently of the ground-distance mask required by model streaming.
export function createSkyAtmosphere(scene){
 const uniforms={uHorizon:{value:new THREE.Color()},uZenith:{value:new THREE.Color()},uScatter:{value:1.2}};
 const geometry=new THREE.SphereGeometry(120,24,12);
 const material=new THREE.ShaderMaterial({name:'sky-atmosphere-r14',uniforms,side:THREE.BackSide,depthWrite:false,depthTest:true,fog:false,toneMapped:false,
  vertexShader:`varying vec3 vSkyDirection;void main(){vSkyDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w;}`,
  fragmentShader:`uniform vec3 uHorizon,uZenith;uniform float uScatter;varying vec3 vSkyDirection;
   void main(){float height=max(normalize(vSkyDirection).y,0.);float blend=1.-exp(-height*(2.4+uScatter*2.2));gl_FragColor=vec4(mix(uHorizon,uZenith,blend),1.);#include <colorspace_fragment>}`.replace(';#include',';\n#include')
 });
 const mesh=new THREE.Mesh(geometry,material);mesh.name='sky-atmosphere-r14';mesh.userData.skipEnvironmentGrade=true;mesh.frustumCulled=false;mesh.renderOrder=-2000;scene.add(mesh);
 let weather='sunny';
 function set({sky,scatter,weather:nextWeather}){
  weather=nextWeather;uniforms.uScatter.value=scatter;uniforms.uHorizon.value.copy(sky);
  const hsl={};sky.getHSL(hsl,THREE.SRGBColorSpace);
  const clarity=weather==='fog'?.16:weather==='rain'?.5:weather==='snow'?.5:1;
  uniforms.uZenith.value.setHSL(hsl.h,THREE.MathUtils.clamp(hsl.s+.12*scatter*clarity,0,1),THREE.MathUtils.clamp(hsl.l-.16*scatter*clarity,0,1),THREE.SRGBColorSpace);
 }
 function tick(camera){camera.getWorldPosition(mesh.position);}
 function snapshot(){return {horizon:uniforms.uHorizon.value.getHexString(),zenith:uniforms.uZenith.value.getHexString(),scatter:uniforms.uScatter.value,weather,drawCalls:1,textures:0,triangles:geometry.index.count/3,representation:'analytic vertical air-scattering gradient; no texture or volume ray marching'};}
 return {set,tick,snapshot,dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
