import * as THREE from 'three';
export function createSceneOutlines({renderer,scene,camera,classify}){
 let building=0,asset=0,selected=null,rt=null,passes=0;const cache=new Map(),perBuilding=new Map();
 const overlayScene=new THREE.Scene(),overlayCamera=new THREE.Camera();
 const uniforms={mask:{value:null},texel:{value:new THREE.Vector2()},buildingWidth:{value:0},assetWidth:{value:0},selectionWidth:{value:0}};
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false,uniforms,
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`varying vec2 vUv;uniform sampler2D mask;uniform vec2 texel;uniform float buildingWidth,assetWidth,selectionWidth;
 void main(){vec4 center=texture2D(mask,vUv);float ink=0.,selection=0.;
  for(int ring=1;ring<=6;ring++)for(int i=0;i<8;i++){
   float a=float(i)*.78539816339,r=float(ring);vec4 near=texture2D(mask,vUv+vec2(cos(a),sin(a))*texel*r);
   float different=step(.015,length(center.rgb-near.rgb));float packed=floor(near.a*32.+.1),category=floor(packed/8.);
   float width=mod(packed,8.);
   float hit=different*step(r,width)*step(.5,category);
   if(category>2.5)selection=max(selection,hit);else ink=max(ink,hit);
  }
  if(max(ink,selection)<.5)discard;gl_FragColor=vec4(mix(vec3(.10,.19,.20),vec3(.90,.09,.12),selection),.92);
  #include <colorspace_fragment>
 }`});
 const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);overlayScene.add(quad);
 function maskMaterial(id,kind,instanced,width){const k=id+'|'+kind+'|'+instanced;if(cache.has(k)){const m=cache.get(k);m.opacity=(kind*8+width)/32;return m;}let hash=2166136261;for(const c of id)hash=Math.imul(hash^c.charCodeAt(0),16777619);const color=new THREE.Color().setRGB(((hash>>>0)&255)/255,((hash>>>8)&255)/255,((hash>>>16)&255)/255);
  const m=new THREE.MeshBasicMaterial({color,opacity:(kind*8+width)/32,transparent:false,toneMapped:false,side:THREE.DoubleSide});m.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','gl_FragColor=vec4(diffuseColor.rgb,opacity);');if(instanced){s.vertexShader='varying vec3 qInstanceID;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfloat qId=float(gl_InstanceID)+1.;qInstanceID=fract(sin(vec3(qId,qId+32.,qId+79.))*43758.5453);');s.fragmentShader='varying vec3 qInstanceID;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('vec4(diffuseColor.rgb,opacity)','vec4(qInstanceID,opacity)');}};m.customProgramCacheKey=()=>`outline-mask-${kind}-${instanced}`;cache.set(k,m);return m;}
 function set(values,id=null){if('building'in values){const width=Math.max(0,Math.min(6,Math.round(Number(values.building)||0)));if(id)perBuilding.set(id,width);else{building=width;perBuilding.clear();}}if('asset'in values)asset=Math.max(0,Math.min(6,Math.round(Number(values.asset)||0)));if('selected'in values)selected=values.selected||null;}
 function render(){
  if(!building&&!asset&&!selected&&![...perBuilding.values()].some(Boolean)){if(rt){rt.dispose();rt=null;}renderer.render(scene,camera);return;}
  const size=renderer.getSize(new THREE.Vector2()),w=Math.round(size.x),h=Math.round(size.y);if(!rt)rt=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});else if(rt.width!==w||rt.height!==h)rt.setSize(w,h);
  const saved=[],bg=scene.background,fog=scene.fog,target=renderer.getRenderTarget(),color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear,shadow=renderer.shadowMap.needsUpdate;
  try{
   scene.traverse(o=>{if(!o.isMesh||!o.layers.test(camera.layers))return;saved.push([o,o.material,o.visible]);const info=classify(o),id=info?.id??o.uuid,kind=id===selected?3:info?.kind==='building'?1:info?.kind==='asset'?2:0;
    if(o.material?.transparent&&!info){o.visible=false;return;}const width=kind===3?2:kind===2?asset:kind===1?(perBuilding.get(id)??building):0;o.material=maskMaterial(kind?id:'occluder',kind,!!o.isInstancedMesh&&kind>0,width);
   });scene.background=null;scene.fog=null;renderer.setClearColor(0x000000,0);renderer.shadowMap.needsUpdate=false;renderer.setRenderTarget(rt);renderer.render(scene,camera);passes++;
  }finally{for(const [o,m,v]of saved){o.material=m;o.visible=v;}scene.background=bg;scene.fog=fog;renderer.setClearColor(color,alpha);renderer.setRenderTarget(target);renderer.shadowMap.needsUpdate=shadow;}
  renderer.render(scene,camera);uniforms.mask.value=rt.texture;uniforms.texel.value.set(1/w,1/h);uniforms.buildingWidth.value=building;uniforms.assetWidth.value=asset;uniforms.selectionWidth.value=selected?2:0;
  renderer.autoClear=false;renderer.render(overlayScene,overlayCamera);renderer.autoClear=auto;
 }
 return {set,render,getBuilding:id=>perBuilding.get(id)??building,snapshot:()=>({building,asset,selected,perBuilding:Object.fromEntries(perBuilding),passes,target:rt?[rt.width,rt.height]:null,estimatedTargetBytes:rt?rt.width*rt.height*8:0})};
}
