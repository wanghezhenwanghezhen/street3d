import * as THREE from 'three';
import meta from './agx-display-profile.json' with {type:'json'};
import {createAgxDisplay} from './agx-display.mjs';
export const anchorUniforms={qyAgxLut:{value:null},qyAgxN:{value:meta.size},qyAgxScale:{value:meta.shaper_scale},qyAgxLogmax:{value:Math.log2(1+meta.max_linear/meta.shaper_scale)}};
let ready;
export function prepareAnchorDisplay(){return ready??=(async()=>{
 const res=await fetch(new URL('../render-profiles/'+meta.filename,import.meta.url));if(!res.ok)throw Error('AgX LUT missing');const bytes=await res.arrayBuffer();
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==meta.sha256||bytes.byteLength!==meta.size**3*4)throw Error('AgX LUT hash mismatch');
 const lut=new THREE.Data3DTexture(new Uint8Array(bytes),meta.size,meta.size,meta.size);lut.format=THREE.RGBAFormat;lut.type=THREE.UnsignedByteType;lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.unpackAlignment=1;lut.needsUpdate=true;anchorUniforms.qyAgxLut.value=lut;
 })();}
// AgX is evaluated inside the material. The original display palette is restored
// after that view transform, and only the material response delta is added.
// The default framebuffer applies exactly one Linear-sRGB -> display-sRGB encode.
export async function createPaletteDisplay(renderer,width,height,recipe){
 await prepareAnchorDisplay();if(!recipe?.display_target_mode)return createAgxDisplay(renderer,width,height);
 return {render(scene,camera){renderer.setRenderTarget(null);renderer.render(scene,camera);},dispose(){}};
}
