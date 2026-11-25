// Viewer adapter: only Three.js import unified; authored H72 color algorithm unchanged.
import * as THREE from 'three';
export const TONES=['bright','gray_1','gray_2','dark'];
export const LIGHT=[-.405579835,.819152057,.405579746];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function labToLinear([L,a,b]) {
 const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
 return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
}
// Frozen OKLab -> sRGB gamut mapping -> linear shader color. No relative recoloring.
export function planeColor(anchor,tone,normal) {
 const dot=normal.reduce((s,n,i)=>s+n*LIGHT[i],0);
 const incidence=Math.round((dot+1)*127.5)/127.5-1;
 const dL=clamp((incidence-.60)*.14,-.028,.035)*(1-tone/3);
 const q=[...anchor.absolute_OKLab_before_local_shading],source=anchor.source_L_clamp_reference;
 q[0]=clamp(q[0]+clamp(source+dL,.02,.98)-source,.005,.995);
 let rgb=labToLinear(q);
 if(rgb.some(x=>x<0||x>1)) {
  let lo=0,hi=1;
  for(let i=0;i<7;i++){const mid=(lo+hi)/2,v=labToLinear([q[0],q[1]*mid,q[2]*mid]);if(v.every(x=>x>=0&&x<=1))lo=mid;else hi=mid;}
  rgb=labToLinear([q[0],q[1]*lo,q[2]*lo]);
 }
 // Preserve the same authored 8-bit sRGB display targets as the code previews.
 return rgb.map(x=>{x=clamp(x,0,1);let s=x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;s=Math.floor(clamp(s,0,1)*255+.5)/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
}
export function buildFrozenModel(meshData,anchors) {
 const pk=anchors[`${meshData.spec.palette}_${meshData.spec.plot}x${meshData.spec.plot}`]?`${meshData.spec.palette}_${meshData.spec.plot}x${meshData.spec.plot}`:meshData.spec.palette;
 if(!anchors[pk])throw Error(`Missing palette ${pk}`);
 const root=new THREE.Group();root.name=meshData.key;root.userData={scheme:'晴彩柔阶',palette_key:pk,reference_coordinates_only:true,source_axes:'Y up',source_metrics:meshData.metrics};
 for(const source of meshData.objects){
  const indices=source.indices?.length?source.indices:Array.from({length:source.positions.length/3},(_,i)=>i),positions=[],normals=[],colors=[];
  for(let i=0;i<indices.length;i+=3){
   let n=[0,0,0];for(let j=0;j<3;j++)for(let c=0;c<3;c++)n[c]+=source.normals[indices[i+j]*3+c]/3;
   const length=Math.hypot(...n);if(length<1e-6)continue;n=n.map(v=>v/length);
   const dot=n.reduce((s,v,k)=>s+v*LIGHT[k],0);let tone=dot>0?0:3;
   if(source.bevel&&Math.max(...n.map(Math.abs))<.999){const t=n.reduce((s,v,k)=>s+(v*LIGHT[k]<0?Math.abs(v):0),0)/n.reduce((s,v)=>s+Math.abs(v),0);tone=t<.0001?0:t>.9999?3:t<.5?1:2;}
   const rgb=planeColor(anchors[pk][source.paint][TONES[tone]],tone,n);
   for(let j=0;j<3;j++){const v=indices[i+j];positions.push(...source.positions.slice(v*3,v*3+3));normals.push(...source.normals.slice(v*3,v*3+3));colors.push(...rgb);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const material=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});const obj=new THREE.Mesh(geometry,material);obj.name=source.name;obj.userData={paint_role:source.paint,source_material:source.material_kind,bevel:source.bevel};root.add(obj);
 }
 return root;
}
export async function loadFrozenModel(meshGzipURL,anchorsURL) {
 const [raw,anchors]=await Promise.all([fetch(meshGzipURL),fetch(anchorsURL).then(r=>r.json())]);if(!raw.ok)throw Error(raw.statusText);
 const bytes=new Uint8Array(await raw.arrayBuffer());const stream=new Blob([bytes]).stream();
 const text=await new Response(bytes[0]===31&&bytes[1]===139?stream.pipeThrough(new DecompressionStream('gzip')):stream).text();
 return buildFrozenModel(JSON.parse(text),anchors);
}
