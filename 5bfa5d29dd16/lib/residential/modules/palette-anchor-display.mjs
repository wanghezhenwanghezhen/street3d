import * as THREE from 'three';
import meta from './agx-display-profile.json' with {type:'json'};
import {createAgxDisplay} from './agx-display.mjs';
export const anchorUniforms={qyAgxLut:{value:null},qyAgxN:{value:meta.size},qyAgxScale:{value:meta.shaper_scale},qyAgxLogmax:{value:Math.log2(1+meta.max_linear/meta.shaper_scale)}};
let current=null,sequence=0;
const counters={loads:0,releases:0,disposals:0,failures:0,cancelled:0};
const abortError=()=>new DOMException('AgX LUT consumer cancelled','AbortError');
function retire(entry){
 if(entry.refs)return;
 if(current===entry)current=null;
 entry.controller.abort();
 if(entry.texture){
  const texture=entry.texture;entry.texture=null;
  if(anchorUniforms.qyAgxLut.value===texture)anchorUniforms.qyAgxLut.value=null;
  texture.dispose();if(texture.image)texture.image.data=null;
  counters.disposals++;
 }
}
function begin(){
 const entry={id:++sequence,refs:0,texture:null,controller:new AbortController(),state:'loading',promise:null};
 current=entry;counters.loads++;
 // Resolve to void: a settled promise must not retain the LUT's ArrayBuffer.
 entry.promise=(async()=>{
  const res=await fetch(new URL('../render-profiles/'+meta.filename,import.meta.url),{signal:entry.controller.signal});
  if(!res.ok)throw Error('AgX LUT missing');const bytes=await res.arrayBuffer();
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(sha!==meta.sha256||bytes.byteLength!==meta.size**3*4)throw Error('AgX LUT hash mismatch');
  if(entry.controller.signal.aborted||!entry.refs||current!==entry)throw abortError();
  const lut=new THREE.Data3DTexture(new Uint8Array(bytes),meta.size,meta.size,meta.size);
  lut.format=THREE.RGBAFormat;lut.type=THREE.UnsignedByteType;lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.unpackAlignment=1;lut.needsUpdate=true;
  entry.texture=lut;entry.state='resident';anchorUniforms.qyAgxLut.value=lut;
 })().catch(error=>{entry.state='error';if(entry.controller.signal.aborted)counters.cancelled++;else counters.failures++;throw error;});
 return entry;
}
export async function acquireAnchorDisplay({signal}={}){
 if(signal?.aborted)throw abortError();
 const entry=current??begin();entry.refs++;let active=true;
 const release=()=>{if(!active)return;active=false;entry.refs--;counters.releases++;retire(entry);};
 let cancel;
 try{
  if(signal){
   await new Promise((resolve,reject)=>{cancel=()=>{release();reject(abortError());};signal.addEventListener('abort',cancel,{once:true});entry.promise.then(resolve,reject);if(signal.aborted)cancel();});
   signal.removeEventListener('abort',cancel);
  }else await entry.promise;
  if(!active)throw abortError();
  return {release};
 }catch(error){if(cancel)signal.removeEventListener('abort',cancel);release();throw error;}
}
// Compatibility name now returns an owned lease. Callers must release it.
export const prepareAnchorDisplay=acquireAnchorDisplay;
export function anchorDisplayState(){
 const texture=current?.texture,bytes=texture?.image?.data?.byteLength??0;
 return {users:current?.refs??0,resident:!!texture,pending:current?.state==='loading',generation:current?.id??null,cpuBytes:bytes,estimatedGpuBytes:bytes,size:meta.size,...counters,measurement:'Owned 129^3 RGBA8 data; GPU bytes are an allocation estimate, not measured residency'};
}
// AgX is evaluated inside the material. The original display palette is restored
// after that view transform, and only the material response delta is added.
// The default framebuffer applies exactly one Linear-sRGB -> display-sRGB encode.
export async function createPaletteDisplay(renderer,width,height,recipe){
 if(!recipe?.display_target_mode)return createAgxDisplay(renderer,width,height);
 const lease=await acquireAnchorDisplay();
 return {render(scene,camera){renderer.setRenderTarget(null);renderer.render(scene,camera);},dispose(){lease.release();}};
}
