// Own a retryable load while sharing the original shader module's uniforms.
// The frozen source prepareAnchorDisplay caches a rejected promise forever.
let pending=null;
export async function ensureAnchorDisplay(THREE,{timeoutMs=30000}={}){
 const {anchorUniforms}=await import('/street3d/5bfa5d29dd16/parcel-asset-sync-20261106/surfaces/source-shaders/modules/palette-anchor-display.mjs');
 const old=anchorUniforms.qyAgxLut.value,image=old?.image;
 if(old?.isData3DTexture&&image?.width>0&&image?.height>0&&image?.depth>0&&image.data?.length===image.width*image.height*image.depth*4)return old;
 if(!pending){
  pending=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('Ground LUT load timed out')),timeoutMs);
   try{
    const profileURL=new URL('/parcel-asset-sync-20261106/surfaces/source-shaders/modules/agx-display-profile.json',location.origin);
    const response=await fetch(profileURL,{signal:controller.signal});if(!response.ok)throw Error('Ground LUT profile '+response.status);
    const meta=await response.json();if(!Number.isInteger(meta.size)||meta.size<2||meta.size>256||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('Invalid ground LUT profile');
    const result=await fetch(new URL('../render-profiles/'+meta.filename,profileURL),{signal:controller.signal});if(!result.ok)throw Error('Ground LUT '+result.status);
    const bytes=await result.arrayBuffer();if(bytes.byteLength!==meta.size**3*4)throw Error('Ground LUT length mismatch');
    const digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    if(sha!==meta.sha256)throw Error('Ground LUT hash mismatch');if(controller.signal.aborted)throw controller.signal.reason;
    const lut=new THREE.Data3DTexture(new Uint8Array(bytes),meta.size,meta.size,meta.size);
    lut.format=THREE.RGBAFormat;lut.type=THREE.UnsignedByteType;lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.unpackAlignment=1;lut.needsUpdate=true;
    old?.dispose();anchorUniforms.qyAgxLut.value=lut;anchorUniforms.qyAgxN.value=meta.size;anchorUniforms.qyAgxScale.value=meta.shaper_scale;anchorUniforms.qyAgxLogmax.value=Math.log2(1+meta.max_linear/meta.shaper_scale);
    return lut;
   }finally{clearTimeout(timer);}
  })().finally(()=>{pending=null;});
 }
 return pending;
}
