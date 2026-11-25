import * as THREE from 'three';

// Fixed GPU buffers: precipitation stays near the camera, with no image textures.
export function createWeather({scene,environment,mobile=false}) {
  const count=mobile?380:850,span=22,height=13;
  const seeds=new Float32Array(count*3);let randomState=13821;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  for(let i=0;i<seeds.length;i++)seeds[i]=random();
  const rainPositions=new Float32Array(count*6),snowPositions=new Float32Array(count*3);
  const rainGeometry=new THREE.BufferGeometry(),snowGeometry=new THREE.BufferGeometry();
  rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3).setUsage(THREE.DynamicDrawUsage));
  snowGeometry.setAttribute('position',new THREE.BufferAttribute(snowPositions,3).setUsage(THREE.DynamicDrawUsage));
  const rain=new THREE.LineSegments(rainGeometry,new THREE.LineBasicMaterial({color:'#a9cfdf',transparent:true,opacity:.48,depthWrite:false,fog:true}));
  const snow=new THREE.Points(snowGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{size:{value:mobile?3:4}},vertexShader:'uniform float size;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*5./max(1.,-p.z),1.5,7.);}',fragmentShader:'void main(){float r=length(gl_PointCoord-.5);float a=1.-smoothstep(.28,.5,r);gl_FragColor=vec4(.94,.97,1.,a*.82);}'}));
  rain.name='Weather rain';snow.name='Weather snow';rain.frustumCulled=snow.frustumCulled=false;rain.visible=snow.visible=false;scene.add(rain,snow);
  let mode='sunny',elapsed=0;
  function setMode(value){if(!['sunny','fog','rain','snow'].includes(value))return false;mode=value;rain.visible=value==='rain';snow.visible=value==='snow';environment.setWeather(value);return true;}
  function update(dt,camera){if(mode!=='rain'&&mode!=='snow')return;elapsed+=Math.min(dt,.1);const p=camera.position;const positions=mode==='rain'?rainPositions:snowPositions;
    for(let i=0;i<count;i++){
      const phase=seeds[i*3+2],y=(phase*height-elapsed*(mode==='rain'?8:1.1))%height;
      const x=p.x+(seeds[i*3]-.5)*span+(mode==='snow'?Math.sin(elapsed*.6+phase*20)*.45:0),z=p.z+(seeds[i*3+1]-.5)*span;
      const yy=p.y-5+(y+height)%height;
      if(mode==='rain'){positions.set([x,yy,z,x-.07,yy+.36,z+.02],i*6);}else positions.set([x,yy,z],i*3);
    }
    (mode==='rain'?rainGeometry:snowGeometry).attributes.position.needsUpdate=true;
  }
  setMode('sunny');
  return {setMode,update,snapshot:()=>({mode,particleCount:mode==='rain'||mode==='snow'?count:0,bufferBytes:rainPositions.byteLength+snowPositions.byteLength+seeds.byteLength,textureCount:0}),dispose(){scene.remove(rain,snow);for(const o of [rain,snow]){o.geometry.dispose();o.material.dispose();}}};
}
