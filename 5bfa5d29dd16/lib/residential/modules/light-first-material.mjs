import {responseGLSL,responseUniforms} from '../material-response.mjs';
import * as THREE from 'three';
import {anchorUniforms} from './palette-anchor-display.mjs';
export const TONES=['bright','gray_1','gray_2','dark'];
export const control={mode:{value:0},groups:new Map(),light:{value:new THREE.Vector3(-.4055798,-.4055798,.819152)},sun:{value:1},ambient:{value:1}};
export function illuminationForNormal(n,L,visibility=1){let d=n.dot(L);return (.17+.14*Math.max(n.z,0)+.055*(1+n.z)+.07*Math.max(d+.5,0))*control.ambient.value+.58*Math.max(d,0)*visibility*control.sun.value;}
export function toneForIllumination(v){return v>=.78?'bright':v>=.48?'gray_1':v>=.285?'gray_2':'dark';}
export function strictMaterial(row,groupId){
 const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:row.roughness,metalness:0,side:THREE.DoubleSide});
 const family=row.material_family,kind={wood:1,brick:2,rough_stone:3,ceramic:4,terracotta:4,glass_stylized:5,bare_metal:6,coated_metal:7,plastic:8}[family]||0;
 if(!control.groups.has(groupId))control.groups.set(groupId,{value:new THREE.Vector3(.78,.48,.285)});
 const u={qyMode:control.mode,qyThresholds:control.groups.get(groupId),qyLight:control.light,qySun:control.sun,qyAmbient:control.ambient,
 qyBright:{value:new THREE.Vector3(...row.calibrated_linear.bright)},qyGray1:{value:new THREE.Vector3(...row.calibrated_linear.gray_1)},qyGray2:{value:new THREE.Vector3(...row.calibrated_linear.gray_2)},qyDark:{value:new THREE.Vector3(...row.calibrated_linear.dark)},
 qyGroup:{value:groupId},qyKind:{value:kind},qyRough:{value:row.roughness},qySeed:{value:(row.texture.seed%65535)/100},qyPigment:{value:row.texture.enabled?row.texture.amplitude:0}};
 mat.name=row.target_id;mat.userData={material_family:family,slot:row.slot,domain:row.domain,identity_family:row.identity_family,pipeline:'LIGHT_FIRST_FOUR_TONE_V9',target_id:row.target_id};
 u.qyInternalAgx={value:row.internal_agx_v20?1:0};u.qyUseAnchor={value:row.display_target_mode?1:0};u.qyVerifyTone={value:row.gpu_verify_tone??-1};for(const [key,tone]of [['qyTargetBright','bright'],['qyTargetGray1','gray_1'],['qyTargetGray2','gray_2'],['qyTargetDark','dark']]){const c=new THREE.Color(row.requested_tones[tone]);u[key]={value:new THREE.Vector3(c.r,c.g,c.b)};}
 mat.onBeforeCompile=s=>{
  Object.assign(s.uniforms,u,anchorUniforms,responseUniforms(row));s.vertexShader='varying vec3 qyWorld;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nqyWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader=responseGLSL+`precision highp sampler3D;
uniform sampler3D qyAgxLut;uniform float qyAgxN,qyAgxScale,qyAgxLogmax,qyUseAnchor,qyVerifyTone,qyInternalAgx;
uniform vec3 qyTargetBright,qyTargetGray1,qyTargetGray2,qyTargetDark;
uniform float qyMode,qyGroup,qyKind,qyRough,qySeed,qyPigment,qySun,qyAmbient;
uniform vec3 qyBright,qyGray1,qyGray2,qyDark,qyThresholds,qyLight;varying vec3 qyWorld;
float qhash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+qySeed)*43758.5453);}
vec3 qdecode(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 qAgxDisplayLinear(vec3 linearColor){vec3 t=clamp(log2(1.+max(linearColor,vec3(0))/qyAgxScale)/qyAgxLogmax,0.,1.);return qdecode(texture(qyAgxLut,(t*(qyAgxN-1.)+.5)/qyAgxN).rgb);}
float qjoint(float x,float width){float a=max(fwidth(x),.006);float d=min(fract(x),1.-fract(x));return 1.-smoothstep(width,width+a,d);}
`+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
  s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>',`
// Stage 1: color-independent light regions; orientation and cast visibility are separate.
vec3 qn=normalize(inverseTransformDirection(normal,viewMatrix));float qdot=dot(qn,qyLight);
float qshadow=getShadowMask();
float qfill=(.17+.14*max(qn.z,0.)+.055*(1.+qn.z)+.07*max(qdot+.5,0.))*qyAmbient;
float qdirect=.58*max(qdot,0.)*qySun;
float qillum=qfill+qdirect*qshadow;
float qt=qillum>=qyThresholds.x?0.:qillum>=qyThresholds.y?1.:qillum>=qyThresholds.z?2.:3.;
if(qyVerifyTone>=0.)qt=qyVerifyTone;
// Stage 2/3: component intrinsic color selects a sourced four-tone ramp.
// One diffuse response. Four palette anchors remain the limits; curved edges interpolate.
float qblend0=smoothstep(.19,.43,qillum),qblend1=smoothstep(.43,.70,qillum),qblend2=smoothstep(.70,.96,qillum);
vec3 qc=qillum<.43?mix(qyDark,qyGray2,qblend0):qillum<.70?mix(qyGray2,qyGray1,qblend1):mix(qyGray1,qyBright,qblend2);
if(qyVerifyTone>=0.)qc=qt<.5?qyBright:qt<1.5?qyGray1:qt<2.5?qyGray2:qyDark;
// Stage 4: material finish, not reused to classify light regions.
vec3 qa=abs(qn);vec2 uv=qa.z>=max(qa.x,qa.y)?qyWorld.xy:qa.x>=qa.y?qyWorld.yz:qyWorld.xz;
float grain=qhash(floor(uv*34.))*2.-1.;float joint=0.;float detail=0.;
if(qyKind==1.){vec2 wood=vec2(uv.x*35.,uv.y*4.);grain=qhash(floor(wood))*2.-1.;detail=sin(uv.x*95.+sin(uv.y*8.))*.008;}
if(qyKind==2.){vec2 b=uv*vec2(9.,17.);b.x+=mod(floor(b.y),2.)*.5;joint=max(qjoint(b.x,.025),qjoint(b.y,.045));}
if(qyKind==3.){vec2 b=uv*vec2(5.,7.);joint=max(qjoint(b.x,.012),qjoint(b.y,.012))*.45;}
if(qyKind==4.){detail=sin(uv.x*70.)*.008;}
vec3 pigment=vec3(grain,-grain*.4,-grain*.6)*qyPigment;
vec3 qview=normalize(inverseTransformDirection(normalize(vViewPosition),viewMatrix));vec3 H=normalize(qyLight+qview);
float spec=pow(max(dot(qn,H),0.),mix(90.,16.,qyRough))*max(qdot,0.)*qshadow*qySun;
float fres=pow(1.-max(dot(qn,qview),0.),5.);vec3 finish=qc;
finish=mix(finish,mix(qyGray1,qyGray2,.5),joint*.16);
finish+=pigment*min(vec3(1.),qc)+detail*min(vec3(1.),qc);
float gloss=(qyKind==5.||qyKind==6.)?.24:(qyKind==4.||qyKind==7.||qyKind==8.)?.10:.035;
vec3 highlight=(qyKind==6.)?mix(qyBright,vec3(3.),.32):qyKind==5.?mix(qyBright,vec3(2.5),.23):qyBright;
finish=mix(finish,highlight,clamp(spec*gloss,0.,.24));
if(qyKind==5.){float panel=qhash(floor(uv*vec2(5.,9.)));float skyBand=.5+.5*sin(uv.y*4.5+uv.x*1.1);float reflection=clamp(.055*skyBand+.07*fres+(panel-.5)*.015,0.,.13);finish=mix(finish,mix(qyBright,qyGray1,.35),reflection);}
if(qyKind==6.)finish=mix(finish,mix(qyBright,qyGray1,.25),min(.13,fres*.13));
if(mrKind>.5){
vec3 fixedV=isOrthographic?normalize(vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):qview;
finish=mrResponse(qc,qyBright,qyDark,qyWorld,qn,qyLight,fixedV,qshadow,qyMode==4.?1.:qyMode==5.?2.:0.);
}
vec3 qtarget=qillum<.43?mix(qyTargetDark,qyTargetGray2,qblend0):qillum<.70?mix(qyTargetGray2,qyTargetGray1,qblend1):mix(qyTargetGray1,qyTargetBright,qblend2);
if(qyVerifyTone>=0.)qtarget=qt<.5?qyTargetBright:qt<1.5?qyTargetGray1:qt<2.5?qyTargetGray2:qyTargetDark;
outgoingLight=max(vec3(0.),finish);
if(qyUseAnchor>.5){outgoingLight=clamp(qtarget+qAgxDisplayLinear(finish)-qAgxDisplayLinear(qc),vec3(0),vec3(1));}
if(qyInternalAgx>.5)outgoingLight=qAgxDisplayLinear(finish);
 if(qyMode==1.)outgoingLight=qdecode(vec3((qt+1.)/255.,(mod(qyGroup-1.,255.)+1.)/255.,(floor((qyGroup-1.)/255.)+1.)/255.));
if(qyMode==2.)outgoingLight=qdecode(vec3((mod(qyGroup-1.,255.)+1.)/255.,(floor((qyGroup-1.)/255.)+1.)/255.,0.));
if(qyMode==3.)outgoingLight=qyUseAnchor>.5?qtarget:(qyInternalAgx>.5?qAgxDisplayLinear(qc):qc);
if(qyMode==4.)outgoingLight=mrKind>.5?finish:vec3(spec*gloss);
if(qyMode==5.)outgoingLight=mrKind>.5?finish:vec3(.5)+pigment*5.+vec3(detail-joint*.06);
if(qyMode==6.)outgoingLight=qdecode(vec3(qt<.5?.95:qt<1.5?.70:qt<2.5?.43:.20));
if(qyMode==7.)outgoingLight=qdecode(vec3(qshadow));
if(qyMode==8.)outgoingLight=qdecode(qn*.5+.5);
#include <opaque_fragment>`);
 };
 mat.customProgramCacheKey=()=> 'qianyu-reference-soft-volume-v4';return mat;
}
