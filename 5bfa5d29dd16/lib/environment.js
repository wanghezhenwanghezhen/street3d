import * as THREE from 'three';
import {createSkyClouds} from './clouds-r11.js';
import {createSkyAtmosphere} from './sky-atmosphere.js';

const presets = [
  {name:'清晨', sky:'#dce1dc', light:'#ffe5cb', shadow:'#849ca9', ground:'#efe3ca', sun:1.6, fill:1.9},
  {name:'白天', sky:'#c5dfe4', light:'#ffffff', shadow:'#9cacb2', ground:'#ffffff', sun:2, fill:2.1},
  {name:'傍晚', sky:'#c7bed9', light:'#ffd8be', shadow:'#8a81b1', ground:'#cec2e1', sun:1.5, fill:1.8}
];
export function createEnvironment(scene, sun, hemi, renderer) {
  const settings = {time:.56,intensity:1.3,shadow:.9,ground:1.15,scatter:.25,distanceFog:.3,shadowTint:.2,
    skyHue:5,skySaturation:29,skyLightness:0,cloudStyle:'none',cloudDensity:.5};
  const clouds=createSkyClouds(scene),atmosphere=createSkyAtmosphere(scene),skyHSL={h:0,s:0,l:0};
  const uniforms = {
    qEnvLight:{value:new THREE.Color('white')},qEnvShadow:{value:new THREE.Color('white')},
    qEnvGround:{value:new THREE.Color('white')},qEnvIntensity:{value:1},
    qEnvShadowStrength:{value:.45},qDistanceFog:{value:0},qAirDensity:{value:.01},qAirColor:{value:new THREE.Color('#c5dfe4')}
  };
  const materials = new WeakSet(),compiledTextures=new Set();let materialCount=0,streamFog=null,weather='sunny';
  const declarations = 'uniform vec3 qEnvLight,qEnvShadow,qEnvGround,qAirColor;\nuniform float qEnvIntensity,qEnvShadowStrength,qAirDensity,qDistanceFog;\n';
  function install(root, ground=false) {
    root.traverse(object=>{
      if(!object.isMesh||object.userData.skipEnvironmentGrade)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(materials.has(material))continue;
        materials.add(material);materialCount++;let live=true;material.addEventListener('dispose',()=>{if(live){live=false;materialCount--;}});
        const priorCompile=material.onBeforeCompile,priorKey=material.customProgramCacheKey();
        material._qBeforeEnvironment=priorCompile;material._qBeforeEnvironmentKey=priorKey;
        material.onBeforeCompile=function(shader,context){
          priorCompile.call(this,shader,context);
          Object.assign(shader.uniforms,uniforms);
          for(const uniform of Object.values(shader.uniforms))if(uniform.value?.isTexture&&!compiledTextures.has(uniform.value)){const texture=uniform.value;compiledTextures.add(texture);texture.addEventListener('dispose',()=>compiledTextures.delete(texture));}
          // Use the same linear-colour atmosphere for native and custom materials.
          // Perspective fragment depth includes the actual instanced/deformed vertex;
          // the previous custom path measured the untransformed vertex instead.
          shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>','');
          shader.fragmentShader=declarations+shader.fragmentShader;
          const grading=`
            float qEnvLuma=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
            float qEnvDark=1.-smoothstep(.06,.55,qEnvLuma);
            gl_FragColor.rgb*=mix(qEnvLight,qEnvShadow,qEnvDark*qEnvShadowStrength);
            gl_FragColor.rgb*=qEnvIntensity;
            ${ground?'gl_FragColor.rgb*=qEnvGround;':''}
            float qAirDepth=1./max(gl_FragCoord.w,.000001);
            float qAirFog=1.-exp(-qAirDensity*qAirDensity*qAirDepth*qAirDepth);
            float qDistanceAmount=qDistanceFog*smoothstep(18.,70.,qAirDepth);
            qAirFog=1.-(1.-qAirFog)*(1.-qDistanceAmount);
            gl_FragColor.rgb=mix(gl_FragColor.rgb,qAirColor,qAirFog);
          `;
          shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>',grading+'\n#include <colorspace_fragment>');
        };
        material.customProgramCacheKey=()=>priorKey+'-environment-v4-distance-fog-'+ground;
        material.needsUpdate=true;
      }
    });
  }
  function update(values={}) {
    // Keep invalid console/saved values from poisoning shared uniforms.
    const ranges={time:[0,2],intensity:[0,3],shadow:[0,1],ground:[0,3],scatter:[0,2],distanceFog:[0,1],shadowTint:[0,1],skyHue:[-180,180],skySaturation:[-100,100],skyLightness:[-100,100],cloudDensity:[0,1]};
    for(const [key,[min,max]]of Object.entries(ranges))if(Number.isFinite(values[key]))settings[key]=THREE.MathUtils.clamp(values[key],min,max);
    if(['none','cumulus','cirrus'].includes(values.cloudStyle))settings.cloudStyle=values.cloudStyle;
    const index=Math.min(1,Math.floor(settings.time)),t=settings.time-index,a=presets[index],b=presets[index+1];
    const color=key=>new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),t);
    const sky=color('sky');
    if(settings.skyHue||settings.skySaturation||settings.skyLightness){
      sky.getHSL(skyHSL,THREE.SRGBColorSpace);
      sky.setHSL(THREE.MathUtils.euclideanModulo(skyHSL.h+settings.skyHue/360,1),THREE.MathUtils.clamp(skyHSL.s+settings.skySaturation/100,0,1),THREE.MathUtils.clamp(skyHSL.l+settings.skyLightness/100,0,1),THREE.SRGBColorSpace);
    }
    if(!scene.background?.isColor)scene.background=new THREE.Color();
    scene.background.copy(sky);
    if(!scene.fog?.isFogExp2)scene.fog=new THREE.FogExp2(sky,.01);
    scene.fog.color.copy(sky);
    // Streaming radius is an allocation budget, never an opaque fog boundary.
    // 0 is clear in sunny weather; larger scatter means more aerial haze.
    scene.fog.density=.04*settings.scatter;
    const weatherStyle={sunny:null,fog:{color:'#d0d8d6',density:.065,sun:.55,fill:.92,grade:.98},rain:{color:'#9aaebf',density:.018,sun:.55,fill:.85,grade:.83},snow:{color:'#dce7ee',density:.015,sun:.8,fill:1.05,grade:1.03}}[weather];
    if(weatherStyle){scene.background.lerp(new THREE.Color(weatherStyle.color),.72);scene.fog.color.copy(scene.background);scene.fog.density=Math.max(scene.fog.density,weatherStyle.density);}
    clouds.set({...settings,sky:scene.background,weather});
    atmosphere.set({sky:scene.background,scatter:1.2,weather});
    uniforms.qDistanceFog.value=settings.distanceFog;uniforms.qAirDensity.value=scene.fog.density;uniforms.qAirColor.value.copy(scene.fog.color);
    sun.color.copy(color('light'));hemi.color.set('white');hemi.groundColor.copy(color('shadow'));
    sun.intensity=THREE.MathUtils.lerp(a.sun,b.sun,t);
    hemi.intensity=THREE.MathUtils.lerp(a.fill,b.fill,t);
    if(weatherStyle){sun.intensity*=weatherStyle.sun;hemi.intensity*=weatherStyle.fill;}
    uniforms.qEnvLight.value.copy(color('light'));
    uniforms.qEnvShadow.value.copy(color('shadow'));
    uniforms.qEnvGround.value.set('white').lerp(color('ground'),settings.ground);
    uniforms.qEnvIntensity.value=settings.intensity*(weatherStyle?.grade??1);
    settings.shadow=THREE.MathUtils.clamp(settings.shadow,0,1);
    sun.shadow.intensity=settings.shadow;
    uniforms.qEnvShadowStrength.value=settings.shadowTint;
    renderer.shadowMap.needsUpdate=true;
    return snapshot();
  }
  function snapshot(){
    return {...settings,shadowOpacity:sun.shadow.intensity,shadowControl:'native LightShadow.intensity; no full-frame contrast transform',weather,timeName:presets[Math.round(settings.time)].name,materials:materialCount,streamFog,
      sky:scene.background.getHexString(),shadowColor:uniforms.qEnvShadow.value.getHexString(),
      groundColor:uniforms.qEnvGround.value.getHexString(),fogType:'exp2',fogDensity:scene.fog?.density,
      airScattering:{control:'scatter -> density .04 * value; unified native/custom fragment haze',streamingClamp:false,opacityAtDepth:[20,30,50].map(depth=>({depth,opacity:1-Math.exp(-((uniforms.qAirDensity.value*depth)**2))}))},
      distanceFogControl:{strength:settings.distanceFog,near:18,far:70,default:.3,control:'independent smoothstep distance haze; 0 preserves R15 appearance'},
      skyControl:'HSL offsets and independent sky gradient; scatter controls scene aerial haze',atmosphere:atmosphere.snapshot(),clouds:clouds.snapshot()};
  }
  return {settings,install,update,snapshot,tick(camera,time){atmosphere.tick(camera);clouds.tick(camera,time);},dispose(){atmosphere.dispose();clouds.dispose();},compiledTextures:()=>[...compiledTextures],forgetTexture:texture=>compiledTextures.delete(texture),setWeather(value){if(['sunny','fog','rain','snow'].includes(value))weather=value;return update();},setStreamFog(value){streamFog=value;return update();}};
}
