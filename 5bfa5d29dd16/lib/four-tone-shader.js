import * as THREE from 'three';

export const API_VERSION='qianyu-four-tone-role-runtime/1';
export const TONES=['bright','gray_1','gray_2','dark'];
export const MODES={lit:0,albedo:1,normal:2,regions:3,ids:4,tone:5,silhouette:6,shadow:7,achromatic:8};
export const DEFAULT_LIGHTING={direction:[-5,8,6],thresholds:[.6,.15,-.15],viewDirection:[1,1,1]};
const vector=v=>v?.isVector3?v.clone():new THREE.Vector3(...v);
export function linearColor(hex){
 if(!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Invalid sRGB HEX '+hex);
 return new THREE.Color().setRGB(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),THREE.SRGBColorSpace);
}
export function resolveRole(mesh,material,index=0){
 const role=material?.userData?.source_role ?? mesh?.userData?.material_roles?.[index] ?? mesh?.userData?.paint_role;
 if(typeof role!=='string'||!role)throw Error('Unmapped material role: '+(mesh?.name||'unknown')+' slot '+index);
 return role;
}
const vertex=`
varying vec3 vWorldN;varying vec3 vWorldP;
void main(){
 vec4 wp=modelMatrix*vec4(position,1.0);vWorldP=wp.xyz;
 vWorldN=normalize(transpose(mat3(viewMatrix))*normalize(normalMatrix*normal));
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const fragment=`
#include <packing>
varying vec3 vWorldN;varying vec3 vWorldP;
uniform vec3 uLight,uView,uThresholds,uBright,uGray1,uGray2,uDark,uRegion,uID,uSpecTint;
uniform int uMode;uniform float uFinish,uSpecStrength,uSpecPower,uFresnel;
uniform sampler2D uShadowMap;uniform mat4 uShadowMatrix;uniform vec2 uShadowTexel;
uniform float uShadowEnabled,uShadowBias,uNormalBias;
float visibleSun(vec3 n){
 if(uShadowEnabled<.5)return 1.;
 vec4 projected=uShadowMatrix*vec4(vWorldP+n*uNormalBias,1.);vec3 p=projected.xyz/projected.w;
 if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))return 1.;
 // Receiver-plane depth compensation: PCF taps cannot share one center depth
 // on sloped faces. This was the cause of diagonal self-shadow stripes.
 vec3 dx=dFdx(p),dy=dFdy(p);float det=dx.x*dy.y-dx.y*dy.x;
 vec2 slope=abs(det)>1.e-9?vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det:vec2(0.);
 slope=clamp(slope,vec2(-8.),vec2(8.));
 float visibility=0.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 tap=p.xy+vec2(float(x),float(y))*uShadowTexel;
  vec2 texelCenter=(floor(tap/uShadowTexel)+.5)*uShadowTexel;
  float receiver=p.z+dot(slope,texelCenter-p.xy);
  float z=unpackRGBAToDepth(textureLod(uShadowMap,texelCenter,0.));
  visibility+=step(receiver-uShadowBias,z);
 }
 return visibility/9.;
}
void main(){
 vec3 n=normalize(vWorldN);if(!gl_FrontFacing)n=-n;
 float visibility=visibleSun(n),ndl=dot(n,normalize(uLight));
 // One diffuse decision only: visibility reduces positive direct light before lookup.
 float level=min(ndl,0.)+max(ndl,0.)*visibility;
 int tier=level>=uThresholds.x?0:level>=uThresholds.y?1:level>=uThresholds.z?2:3;
 vec3 color=tier==0?uBright:tier==1?uGray1:tier==2?uGray2:uDark;
 if(uMode==0&&uFinish>.5){
  vec3 v=normalize(uView),h=normalize(uLight+v);
  float spec=pow(max(dot(n,h),0.),uSpecPower)*max(ndl,0.)*visibility;
  float fresnel=pow(1.-max(dot(n,v),0.),5.)*max(ndl,0.)*visibility;
  float weight=clamp(spec*uSpecStrength+fresnel*uFresnel,0.,.16);
  color=mix(color,uSpecTint,weight);
 }
 if(uMode==1)color=uBright;
 if(uMode==2)color=n*.5+.5;
 if(uMode==3)color=uRegion;
 if(uMode==4)color=uID;
 if(uMode==5)color=tier==0?vec3(1.,.3,.08):tier==1?vec3(.1,.7,.2):tier==2?vec3(.1,.3,.9):vec3(.35,.1,.5);
 if(uMode==6)color=vec3(0.);
 if(uMode==7)color=vec3(visibility);
 if(uMode==8)color=vec3(tier==0?.82:tier==1?.6:tier==2?.38:.2);
 gl_FragColor=vec4(color,1.);
 #include <colorspace_fragment>
}`;
const dummyTexture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);dummyTexture.needsUpdate=true;
function shadowUniforms(shadow){return {
 uShadowMap:{value:shadow?.map??dummyTexture},uShadowMatrix:{value:shadow?.matrix??new THREE.Matrix4()},
 uShadowTexel:{value:shadow?.texel??new THREE.Vector2(1,1)},uShadowEnabled:{value:shadow?.enabled?1:0},
 uShadowBias:{value:shadow?.bias??.00008},uNormalBias:{value:shadow?.normalBias??.002}
};}
export function createMaterial({role,mode='lit',palette,sourceMaterial,roleId,lighting={},shadow=null,finish={}}){
 if(mode==='source_pbr'){
  if(!sourceMaterial?.isMaterial)throw Error('source_pbr requires actual source material');
  const m=sourceMaterial.clone();m.userData={...m.userData,source_role:role,pipeline:'SOURCE_GLB_PBR_CLONE_NOT_CYCLES_PIXEL_MATCH'};return m;
 }
 const entry=palette?.[role];if(!entry)throw Error('Unknown palette role '+role);
 if(!(mode in MODES))throw Error('Unknown mode '+mode);
 const id=roleId??entry.role_id;if(!Number.isInteger(id)||id<1||id>255)throw Error('role_id must be integer1..255');
 const settings={...DEFAULT_LIGHTING,...lighting};if(settings.thresholds.length!==3||!(settings.thresholds[0]>settings.thresholds[1]&&settings.thresholds[1]>settings.thresholds[2]))throw Error('Thresholds must descend');
 const u={uLight:{value:vector(settings.direction).normalize()},uView:{value:vector(settings.viewDirection).normalize()},uThresholds:{value:new THREE.Vector3(...settings.thresholds)},uMode:{value:MODES[mode]},uRegion:{value:linearColor(entry.region_color??'#808080')},uID:{value:linearColor('#0000'+id.toString(16).padStart(2,'0'))},uFinish:{value:finish.enabled?1:0},uSpecStrength:{value:Math.min(Math.max(finish.strength??.08,0),.16)},uSpecPower:{value:finish.power??64},uFresnel:{value:Math.min(Math.max(finish.fresnel??.015,0),.04)},uSpecTint:{value:linearColor(finish.tint??'#FFFFFF')},...shadowUniforms(shadow)};
 ['uBright','uGray1','uGray2','uDark'].forEach((key,i)=>u[key]={value:linearColor(entry.tones[TONES[i]])});
 const m=new THREE.ShaderMaterial({name:'role-four-tone-'+role,vertexShader:vertex,fragmentShader:fragment,uniforms:u,toneMapped:false,side:THREE.DoubleSide});
 m.userData={source_role:role,role_id:id,pipeline:API_VERSION,palette_tones:{...entry.tones},input_transfer:'sRGB HEX to Linear-sRGB once',output_transfer:'colorspace_fragment once; no tone mapping/PBR diffuse multiplication',finish_model:'bounded N/L/V highlight and grazing response, not physical transmission'};return m;
}
export function updateMaterial(material,{mode,lighting,shadow,finish}={}){
 const u=material.uniforms;if(!u)throw Error('Only role shader update supported');
 if(mode!==undefined){if(!(mode in MODES))throw Error('Unknown mode');u.uMode.value=MODES[mode];}
 if(lighting?.direction)u.uLight.value.copy(vector(lighting.direction).normalize());
 if(lighting?.viewDirection)u.uView.value.copy(vector(lighting.viewDirection).normalize());
 if(lighting?.thresholds)u.uThresholds.value.set(...lighting.thresholds);
 if(shadow!==undefined){const v=shadowUniforms(shadow);for(const k in v)u[k].value=v[k].value;}
 if(finish){if(finish.enabled!==undefined)u.uFinish.value=finish.enabled?1:0;if(finish.strength!==undefined)u.uSpecStrength.value=Math.min(Math.max(finish.strength,0),.16);if(finish.power!==undefined)u.uSpecPower.value=finish.power;if(finish.fresnel!==undefined)u.uFresnel.value=Math.min(Math.max(finish.fresnel,0),.04);if(finish.tint)u.uSpecTint.value.copy(linearColor(finish.tint));}
}
export function createShadowPass(renderer,occluderRoot,{direction=DEFAULT_LIGHTING.direction,target=[0,2.2,0],span=8,mapSize=1024,bias=.00008,normalBias=.002}={}){
 if(!occluderRoot?.isObject3D)throw Error('Actual occluder Object3D required');
 occluderRoot.updateWorldMatrix(true,true);
 const scene=new THREE.Scene(),clone=occluderRoot.clone(true);clone.matrixAutoUpdate=false;clone.matrix.copy(occluderRoot.matrixWorld);scene.add(clone);
 const material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});scene.overrideMaterial=material;
 const camera=new THREE.OrthographicCamera(-span/2,span/2,span/2,-span/2,.01,Math.max(span*4,10)),center=vector(target),light=vector(direction).normalize();camera.position.copy(center).addScaledVector(light,Math.max(span*2,5));camera.lookAt(center);camera.updateMatrixWorld(true);
 const rt=new THREE.WebGLRenderTarget(mapSize,mapSize,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false});rt.texture.colorSpace=THREE.NoColorSpace;
 const matrix=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
 const uniforms={map:rt.texture,matrix,texel:new THREE.Vector2(1/mapSize,1/mapSize),bias,normalBias,enabled:true};let renders=0,lastInfo=null;
 function render(){const oldTarget=renderer.getRenderTarget(),oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha(),oldAuto=renderer.autoClear;renderer.setRenderTarget(rt);renderer.setClearColor(0xffffff,1);renderer.autoClear=true;renderer.render(scene,camera);lastInfo={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};renderer.setRenderTarget(oldTarget);renderer.setClearColor(oldColor,oldAlpha);renderer.autoClear=oldAuto;renders++;}
 function readback(){return {method:'actual RGBADepthPacking + receiver-plane-compensated 9 PCF taps; direct visibility participates once in tier lookup',renders,mapSize,span,bias,normalBias,direction:light.toArray(),camera_matrix:camera.matrixWorld.toArray(),projection_matrix:camera.projectionMatrix.toArray(),last_render_counts:lastInfo,limits:['Fixed static occluder clone; recreate if geometry/world transforms change.','PCF is shadow filtering, not physical area-light scattering.','Shader has no SSAO/GI/physical refraction.']};}
 return {uniforms,render,readback,camera,texture:rt.texture,dispose(){rt.dispose();material.dispose();}};
}
export function calibrate(renderer,palette,roles=Object.keys(palette)){
 const size=48,w=roles.length*size,h=4*size,rt=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});rt.texture.colorSpace=THREE.SRGBColorSpace;
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(0,roles.length,4,0,.1,10);camera.position.z=2;
 const light=vector(DEFAULT_LIGHTING.direction).normalize(),perp=new THREE.Vector3(1,0,0).addScaledVector(light,-light.x).normalize(),ds=[.85,.35,0,-.6],geometries=[],materials=[];
 roles.forEach((role,col)=>{const material=createMaterial({role,palette,roleId:palette[role].role_id??col+1});materials.push(material);ds.forEach((d,row)=>{const geometry=new THREE.PlaneGeometry(1,1),n=light.clone().multiplyScalar(d).addScaledVector(perp,Math.sqrt(1-d*d));for(let i=0;i<geometry.attributes.normal.count;i++)geometry.attributes.normal.setXYZ(i,n.x,n.y,n.z);geometry.attributes.normal.needsUpdate=true;const mesh=new THREE.Mesh(geometry,material);mesh.position.set(col+.5,3.5-row,0);scene.add(mesh);geometries.push(geometry);});});
 const prior=renderer.getRenderTarget();renderer.setRenderTarget(rt);renderer.render(scene,camera);const pixels=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(rt,0,0,w,h,pixels);renderer.setRenderTarget(prior);
 const checks=[];roles.forEach((role,col)=>TONES.forEach((tone,row)=>{const offset=4*((3-row)*size*w+(size/2)*w+col*size+size/2),actual=Array.from(pixels.slice(offset,offset+3)),hex=palette[role].tones[tone],expected=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));checks.push({role,tone,expected_hex:hex,expected,actual,max_abs_error:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))});}));geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());rt.dispose();return {width:w,height:h,pixels,report:{status:checks.every(c=>c.max_abs_error<=1)?'PASS_SWATCHES_WITHIN_1_BYTE':'FAIL_PIXEL_COLOR_CHAIN',method:'Actual same shader known-normal panels +readRenderTargetPixels; render target sRGB; shadow and finish off only for color-chain calibration',input_transfer:'sRGB to Linear-sRGB once',output_transfer:'Linear-sRGB to sRGB once; no filmic transform',checks}};
}
