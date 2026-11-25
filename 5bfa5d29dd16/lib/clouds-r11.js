import * as THREE from 'three';

const MAX_CLOUDS=24;
const STYLES=new Set(['none','cumulus','cirrus']);

// Distant, texture-free sky cards. Density only changes the instance count;
// the fixed buffer and shader are reused across every style/density change.
export function createSkyClouds(scene){
  const root=new THREE.Group();root.name='sky-clouds-r11';root.visible=false;
  root.userData.skipEnvironmentGrade=true;scene.add(root);
  const uniforms={uTop:{value:new THREE.Color('white')},uBottom:{value:new THREE.Color('white')},uStyle:{value:0},uOpacity:{value:.9}};
  const transform=new THREE.Object3D();
  let mesh=null,style='none',density=.5,activeClouds=0,disposed=false;
  let weather='sunny',lastStyle=null;
  function allocate(){
    if(mesh)return;
    const geometry=new THREE.PlaneGeometry(2,2);geometry.deleteAttribute('normal');
    const material=new THREE.ShaderMaterial({
      name:'sky-cloud-analytic-r11',uniforms,transparent:true,depthTest:true,depthWrite:false,
      fog:false,toneMapped:false,
      vertexShader:`
        varying vec2 vUv;
        void main(){
          vUv=uv;
          vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
          vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
          center.xy+=position.xy*size;
          gl_Position=projectionMatrix*center;
          // Render behind scene geometry, including objects beyond the cloud ring.
          gl_Position.z=gl_Position.w*.99999;
        }
      `,
      fragmentShader:`
        uniform vec3 uTop,uBottom;
        uniform float uStyle,uOpacity;
        varying vec2 vUv;
        float ellipse(vec2 p,vec2 center,vec2 radius){return length((p-center)/radius)-1.;}
        void main(){
          vec2 p=vUv*2.-1.;
          float d;
          if(uStyle<.5){
            d=ellipse(p,vec2(-.49,-.20),vec2(.43,.41));
            d=min(d,ellipse(p,vec2(0.,-.15),vec2(.65,.49)));
            d=min(d,ellipse(p,vec2(.49,-.21),vec2(.40,.37)));
            d=min(d,ellipse(p,vec2(-.20,.17),vec2(.40,.58)));
            d=min(d,ellipse(p,vec2(.30,.12),vec2(.37,.48)));
          }else{
            p.y+=p.x*.18;
            d=ellipse(p,vec2(-.30,-.12),vec2(.61,.35));
            d=min(d,ellipse(p,vec2(.20,.12),vec2(.68,.29)));
            d=min(d,ellipse(p,vec2(.61,.26),vec2(.29,.19)));
          }
          float alpha=(1.-smoothstep(-.08,.08,d))*uOpacity;
          if(alpha<.005)discard;
          gl_FragColor=vec4(mix(uBottom,uTop,smoothstep(.12,.88,vUv.y)),alpha);
          #include <colorspace_fragment>
        }
      `
    });
    mesh=new THREE.InstancedMesh(geometry,material,MAX_CLOUDS);
    mesh.name='sky-cloud-batch-r11';mesh.userData.skipEnvironmentGrade=true;
    mesh.frustumCulled=false;mesh.renderOrder=-1000;mesh.castShadow=false;mesh.receiveShadow=false;
    root.add(mesh);
  }
  function shapeInstances(){
    if(!mesh||lastStyle===style)return;
    const thin=style==='cirrus';
    for(let i=0;i<MAX_CLOUDS;i++){
      // Golden-angle order distributes even sparse density around the full sky.
      const angle=i*2.399963229728653;
      // The entrance looks down ~20 degrees and only shows the lowest ~10
      // degrees of sky. Interleave a horizon band with higher clouds so the
      // default first 12 instances contain visible clouds on phones as well.
      // Keep world azimuths stable: turning the camera does not drag the clouds.
      const elevation=i%3===0?28+(i*11%29):4+(i*7%11),radius=90+(i*11%13);
      transform.position.set(Math.cos(angle)*radius,elevation,Math.sin(angle)*radius);
      const variation=.8+(i*7%11)*.045;
      transform.scale.set((thin?18:10)*variation,(thin?3.6:6.5)*variation,1);
      transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;lastStyle=style;
  }
  function set({cloudStyle=style,cloudDensity=density,sky,weather:nextWeather=weather}={}){
    if(disposed)return snapshot();
    if(STYLES.has(cloudStyle))style=cloudStyle;
    if(Number.isFinite(cloudDensity))density=THREE.MathUtils.clamp(cloudDensity,0,1);
    weather=nextWeather;
    activeClouds=style==='none'||density===0?0:Math.ceil(density*MAX_CLOUDS);
    root.visible=activeClouds>0;
    if(activeClouds){allocate();shapeInstances();mesh.count=activeClouds;}
    else if(mesh)mesh.count=0;
    uniforms.uStyle.value=style==='cirrus'?1:0;
    if(sky){
      // Haze uses the same final weather-adjusted sky as scene fog.
      uniforms.uTop.value.copy(sky).lerp(new THREE.Color('white'),style==='cirrus'?.74:.94);
      uniforms.uBottom.value.copy(sky).lerp(new THREE.Color('white'),style==='cirrus'?.36:.65);
    }
    const weatherOpacity={sunny:1,fog:.28,rain:.62,snow:.65}[weather]??1;
    uniforms.uOpacity.value=(style==='cirrus'?.5:.91)*weatherOpacity;
    return snapshot();
  }
  function tick(camera,elapsedSeconds=0){
    if(disposed||!root.visible)return;
    camera.getWorldPosition(root.position);
    if(Number.isFinite(elapsedSeconds))root.rotation.y=(elapsedSeconds%72000)*.00035;
  }
  function snapshot(){
    const geometryBytes=mesh?Object.values(mesh.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,mesh.geometry.index?.array.byteLength??0):0;
    const instanceBytes=mesh?.instanceMatrix.array.byteLength??0;
    return {style,density,activeClouds,instances:activeClouds,visible:root.visible,
      drawCallsUpperBound:activeClouds?1:0,triangles:activeClouds*2,maxClouds:MAX_CLOUDS,
      geometries:mesh?1:0,materials:mesh?1:0,textures:0,geometryBytes,instanceBytes,bufferBytes:geometryBytes+instanceBytes,
      opacity:uniforms.uOpacity.value,weather,depthTest:true,depthWrite:false,castsShadow:false,
      representation:'single instanced batch; analytic elliptical cloud cards; no runtime textures',
      distribution:'r18 interleaved low-horizon 4-14U and upper-sky 28-56U bands',
      budgetScope:'CPU attribute/index/instance buffers and submitted triangles; not GPU allocation or device timing'};
  }
  function dispose(){
    if(disposed)return;disposed=true;root.removeFromParent();
    mesh?.geometry.dispose();mesh?.material.dispose();mesh?.dispose();
    root.clear();root.visible=false;mesh=null;activeClouds=0;
  }
  return {set,tick,snapshot,dispose};
}
