import {loadIndexedGeometry} from './indexed-geometry-loader.js';
// Source files store display sRGB in their float32 color channel. Convert at the
// same point as THREE.Color.setRGB(..., SRGBColorSpace), on the GPU instead of
// duplicating millions of vertex floats into JS number arrays during loading.
export function installSrgbVertexColors(material){
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey();
 material.onBeforeCompile=function(shader,renderer){
  previous.call(this,shader,renderer);
  shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
   #ifdef USE_COLOR
   vColor.rgb=mix(vColor.rgb*0.07739938080495357,pow(vColor.rgb*0.9478672985781991+0.05213270142180095,vec3(2.4)),step(vec3(0.04045),vColor.rgb));
   #endif`);
 };
 material.customProgramCacheKey=()=>previousKey+'-source-srgb-vertex-gpu-v1';material.needsUpdate=true;
 return material;
}
export async function loadIndexedShop(url,material,THREE){
 const response=await fetch(url);if(!response.ok)throw Error('Missing shop manifest '+url);const manifest=await response.json();
 if(manifest.geometryLayout?.stride!==9||manifest.geometryLayout?.colorEncoding!=='srgb-display')throw Error('Unexpected source shop format');
 const built=await loadIndexedGeometry(manifest,new Map([['shop-vertex',material]]),THREE,{kind:'base'});
 return {parts:built.group.children.map(mesh=>({g:mesh.geometry,m:mesh.material})),stats:{triangles:built.triangles,geometryBytes:built.geometryBytes,sourceArtApproved:manifest.sourceArtApproved,sourceStatus:manifest.sourceStatus}};
}
