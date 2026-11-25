import * as THREE from 'three';
export const RESPONSE_REVISION='residential-material-response-v4-20261009';
export function responseUniforms(row){
 const p=row.material_response||row.response||{},f=row.finish||{};
 return {mrKind:{value:p.kind||0},mrRough:{value:row.roughness??p.roughness??.85},mrSpec:{value:(p.specular||0)*(f.highlight??1)},mrReflect:{value:(p.reflection||0)*(f.reflection??1)},mrDetail:{value:(p.detail||0)*(row.texture?.enabled===false?1:Math.min(3,(row.texture?.amplitude??.006)/.006))},mrDensity:{value:(p.density||12)*(f.density??1)},mrSeed:{value:(row.texture?.seed??row.seed??1)%65535},mrUp:{value:row.response_up??2},mrDebug:{value:0}};
}
// Fragment-only surface response. Does not alter positions, normals, light regions,
// topology, shadow caster geometry, source palette, or camera. All colors below
// are derived from the existing material; no reference-photo RGB is imported.
export const responseGLSL=`
uniform float mrKind,mrRough,mrSpec,mrReflect,mrDetail,mrDensity,mrSeed,mrUp,mrDebug;
float mrHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+mrSeed*.013)*43758.5453);}
float mrNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mrHash(i),mrHash(i+vec2(1,0)),f.x),mix(mrHash(i+vec2(0,1)),mrHash(i+vec2(1,1)),f.x),f.y)*2.-1.;}
float mrLine(float p,float width){float aa=max(fwidth(p),.012);float d=abs(fract(p+.5)-.5);return (1.-smoothstep(width,width+aa,d))*clamp(1.-aa*1.5,0.,1.);}
vec3 mrAxes(vec3 p){return mrUp<1.5?vec3(p.x,-p.z,p.y):p;}
vec3 mrResponse(vec3 base,vec3 bright,vec3 dark,vec3 world,vec3 normalWorld,vec3 lightWorld,vec3 viewWorld,float visibility,float debugMode){
 if(mrKind<.5)return base;
 vec3 p=mrAxes(world),N=normalize(mrAxes(normalWorld)),L=normalize(mrAxes(lightWorld)),V=normalize(mrAxes(viewWorld));vec3 A=abs(N);
 vec2 uv=A.z>=max(A.x,A.y)?p.xy:A.x>=A.y?p.yz:p.xz;
 float density=mrDensity,grain=mrNoise(uv*density),joint=0.,relief=0.;
 float lod=clamp(1.-max(length(dFdx(uv*density)),length(dFdy(uv*density)))*.5,0.,1.);
 if(mrKind==2.){joint=mrLine(uv.x*density,.014)*.45;grain=mrNoise(vec2(uv.x*density,uv.y*2.));}
 if(mrKind==3.){grain=mrNoise(uv*density)*.7+mrNoise(uv*3.)*.3;}
 if(mrKind==6.){vec2 t=uv*vec2(density,density*.65);joint=max(mrLine(t.x,.019),mrLine(t.y,.014)*.65);grain=mrHash(floor(t))*2.-1.;relief=sin(t.x*6.283)*.012*lod;}
 if(mrKind==7.){vec2 b=uv*vec2(density*.8,density*1.5);b.x+=mod(floor(b.y),2.)*.5;joint=max(mrLine(b.x,.013),mrLine(b.y,.021));grain=mrHash(floor(b))*2.-1.;}
 if(mrKind==8.){grain=mrNoise(vec2(uv.x*density*1.6,uv.y*density*.14));relief=sin(uv.x*density*6.283+mrNoise(uv*2.)*2.)*.004*lod;}
 if(mrKind==9.){grain=mrNoise(uv*density)*.55+mrNoise(uv*3.)*.45;}
 if(mrKind==10.){grain=mrNoise(vec2(uv.x*density*.15,uv.y*density));joint=mrLine(uv.y*density,.008)*.14;}
 if(mrKind==11.){grain=mrNoise(uv*density)*.35;}
 if(mrKind==14.){grain=mrNoise(uv*7.)*.75+mrNoise(uv*38.)*.25;}
 if(mrKind==15.){vec2 t=uv*vec2(density,density*1.6);t.x+=mod(floor(t.y),2.)*.5;joint=max(mrLine(t.x,.012),mrLine(t.y,.018));grain=mrHash(floor(t))*2.-1.;}
 vec3 pigment=vec3(grain,-grain*.35,-grain*.65)*mrDetail*lod;
 vec3 surface=base+min(base,vec3(1.))*pigment;
 // Shallow seams stay in the same color family. No black outlines or all-over AO.
 surface=mix(surface,mix(base,dark,.32),joint*(mrKind==15.?.32:mrKind==7.?.22:.09));
 vec3 T=normalize(abs(N.z)<.93?cross(vec3(0,0,1),N):cross(vec3(0,1,0),N));
 vec3 responseN=normalize(N+T*relief);vec3 H=normalize(L+V);
 float ndl=max(dot(responseN,L),0.),ndv=max(dot(responseN,V),0.);
 float power=mix(112.,9.,mrRough),spec=pow(max(dot(responseN,H),0.),power)*ndl*visibility;
 float fres=pow(1.-ndv,5.);vec3 reflected=reflect(-V,responseN);
 float sky=smoothstep(-.12,.8,reflected.z),cloud=smoothstep(.35,.88,dot(reflected,normalize(L+vec3(0,0,.8))));
 float refl=mrReflect*(.22+.48*sky+.30*cloud)*(.45+.55*fres);
 float sw=clamp(spec*mrSpec,0.,.23);vec3 highlight=bright;
 if(mrKind==4.||mrKind==5.||mrKind==16.||mrKind==12.)highlight=mix(bright,vec3(max(max(bright.r,bright.g),bright.b)),.24);
 else highlight=bright*(mrKind==1.?1.24:1.10);
 surface=mix(surface,highlight,sw);
 if(mrKind==4.||mrKind==5.||mrKind==16.){
  float band=smoothstep(-.55,.3,reflected.z+.14*sin(reflected.x*5.+reflected.y*3.));
  float interior=mrNoise(uv*vec2(density*.6,density));
  float wideReflection=smoothstep(.72,.98,.5+.5*sin(uv.x*1.35+uv.y*.72+reflected.x*2.));
  surface=mix(surface,bright*1.30,wideReflection*.19*(.45+.55*sky));
  if(mrKind==16.){float floorBand=mrLine(p.z/0.58,.035);surface=mix(surface,dark,floorBand*.19);float flute=.5+.5*cos(uv.x*26.);surface=mix(surface,bright,flute*.035);}
  surface=mix(surface,mix(base,bright,.70+.18*band),clamp(refl*(.60+.40*band),0.,.42));
  float streak=smoothstep(.78,.93,.5+.5*sin(uv.x*1.8+uv.y*2.3+mrSeed*.01));
  surface=mix(surface,bright,streak*.035*visibility);
  surface+=min(base,vec3(1.))*interior*(mrKind==4.?.008:.003);
 }else if(mrKind==1.||mrKind==2.||mrKind==12.||mrKind==13.)surface=mix(surface,mix(base,highlight,.75),clamp(refl,0.,.20));
 if(debugMode==1.)return vec3(sw+refl);
 if(debugMode==2.)return vec3(.5)+pigment*8.+vec3(relief-joint*.03);
 return max(surface,vec3(0));
}
`;

export function shopResponseMaterial(row,enabled=true){
 const mat=new THREE.MeshLambertMaterial({vertexColors:true});const u=responseUniforms({...row,response_up:1});u.mrPaletteBright={value:new THREE.Vector3(...(row.bright_linear||[.5,.5,.5]))};
 mat.userData={response:row.response,materialRole:row.paint_role,responseUniforms:u};
 mat.onBeforeCompile=s=>{
  Object.assign(s.uniforms,u);s.vertexShader='varying vec3 mrWorld;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nmrWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader='varying vec3 mrWorld;\nuniform vec3 mrPaletteBright;\n'+responseGLSL+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('void main() {','#include <shadowmask_pars_fragment>\nvoid main() {');
  s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>',`
   float visibility=getShadowMask();vec3 source=diffuseColor.rgb*mix(.72,1.,visibility);
   vec3 fixedView=normalize(vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]));
   outgoingLight=${enabled?'mrResponse(source,max(mrPaletteBright,diffuseColor.rgb),source*.90,mrWorld,normalize(inverseTransformDirection(normal,viewMatrix)),normalize(vec3(-.405579835,.819152057,.405579746)),fixedView,visibility,mrDebug)':'source'};
   #include <opaque_fragment>`);
 };
 mat.customProgramCacheKey=()=>RESPONSE_REVISION+':shop:'+enabled;return mat;
}
