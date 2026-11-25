import * as THREE from 'three';
import meta from './agx-display-profile.json' with {type:'json'};
export {meta as AGX_DISPLAY};

// The LUT is baked with Blender's actual OCIO view AND look, not Three's AgX approximation.
export async function createAgxDisplay(renderer,width,height){
  const response=await fetch(new URL('../render-profiles/'+meta.filename,import.meta.url));
  if(!response.ok)throw Error('AgX 显示变换读取失败');
  const bytes=await response.arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.sha256||bytes.byteLength!==meta.size**3*4)throw Error('AgX 显示变换文件校验失败');
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('设备不支持线性 HDR 渲染，不能保存此 AgX 配色');
  const lut=new THREE.Data3DTexture(new Uint8Array(bytes),meta.size,meta.size,meta.size);
  lut.format=THREE.RGBAFormat;lut.type=THREE.UnsignedByteType;lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.unpackAlignment=1;lut.needsUpdate=true;
  const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,samples:4});
  target.texture.colorSpace=THREE.LinearSRGBColorSpace;
  const material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
    uniforms:{source:{value:target.texture},lut:{value:lut},n:{value:meta.size},scale:{value:meta.shaper_scale},logmax:{value:Math.log2(1+meta.max_linear/meta.shaper_scale)}},
    vertexShader:'in vec3 position; in vec2 uv; out vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    fragmentShader:`precision highp float;precision highp sampler3D;
      uniform sampler2D source;uniform sampler3D lut;uniform float n,scale,logmax;
      in vec2 vUv;out vec4 outputColor;
      void main(){vec4 p=texture(source,vUv);if(p.a<0.00001){outputColor=vec4(0);return;}
        vec3 linear=max(p.rgb/p.a,vec3(0));vec3 t=clamp(log2(1.0+linear/scale)/logmax,0.0,1.0);
        vec3 color=texture(lut,(t*(n-1.0)+0.5)/n).rgb;
        outputColor=vec4(color*p.a,p.a);}`});
  const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
  const camera=new THREE.Camera();
  return {target,render(view,camera){renderer.setRenderTarget(target);renderer.render(view,camera);renderer.setRenderTarget(null);renderer.render(scene,new THREE.Camera());},
    displayTexture(texture){material.uniforms.source.value=texture;renderer.setRenderTarget(null);renderer.render(scene,camera);material.uniforms.source.value=target.texture;},
    dispose(){target.dispose();geometry.dispose();material.dispose();lut.dispose();}};
}
