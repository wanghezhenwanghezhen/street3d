import * as Shader from './four-tone-shader.js';

const PACKAGE = new URL('/landmark-current-web3d-20261106/', location.origin);
const decoder = new TextDecoder();
export const API_VERSION = 'qianyu-latest-building-loader/1';

async function pinned(pin, receipts) {
  const response = await fetch(new URL(pin.url, PACKAGE), {cache:'force-cache'});
  if (!response.ok) throw Error(`建筑资源 HTTP ${response.status}: ${pin.url}`);
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if (sha256 !== pin.sha256) throw Error('建筑资源哈希不符: '+pin.url);
  receipts.push({url:pin.url, sha256, bytes:bytes.byteLength});
  return bytes;
}

function makeRoot(entry, THREE) {
  const root = new THREE.Group();
  root.name = entry.label;
  root.matrixAutoUpdate = false;
  root.matrix.set(...entry.matrix_world_rows.flat());
  root.updateMatrixWorld(true);
  root.userData = {asset_id:entry.id, parcel_id:entry.parcel_id, representation:entry.representation, source_pins:entry.source_pins};
  return root;
}

function windowCorrection(g, key, spans, THREE) {
  const a = new Float32Array(g.attributes.position.count), banks = new Map();
  for (const s of spans) {
    a.fill(1,s.start,s.start+s.count);
    let bank=null;
    if(key.startsWith('L18/'))bank=s.name.match(/Library_window\(\d+, (\d+)\)/)?.[1];
    else if(s.name.startsWith('Hall_'))bank='Hall';
    else if(s.name.startsWith('Wing_'))bank=s.name.slice(0,6);
    if(bank!==null&&bank!==undefined){if(!banks.has(bank))banks.set(bank,[]);banks.get(bank).push(s);}
  }
  const p=g.attributes.position,n=g.attributes.normal;
  for(const rows of banks.values()){
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const s of rows)for(let i=s.start;i<s.start+s.count;i++){
      const v=[p.getX(i),p.getY(i),p.getZ(i)];for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}
    }
    const y=lo[1]-.001,q=[[lo[0],y,lo[2]],[hi[0],y,lo[2]],[hi[0],y,hi[2]],[lo[0],y,lo[2]],[hi[0],y,hi[2]],[lo[0],y,hi[2]]];
    let j=0;for(const s of rows)for(let i=s.start;i<s.start+s.count;i++){p.setXYZ(i,...(j<6?q[j]:q[0]));n.setXYZ(i,0,-1,0);j++;}
  }
  p.needsUpdate=n.needsUpdate=true;
  g.setAttribute('curtainGlass',new THREE.BufferAttribute(a,1));
}

function curtainMaterial(material, spans) {
  if(!spans.length)return;
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float curtainGlass;varying float vCurtainGlass;varying vec3 curtainN;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCurtainGlass=curtainGlass;curtainN=normal;');
    shader.fragmentShader='varying float vCurtainGlass;varying vec3 curtainN;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\nif(vCurtainGlass>.5){float light=.82+.18*max(0.,dot(normalize(curtainN),normalize(vec3(-.31,-.31,.9))));gl_FragColor.rgb=vec3(.34,.51,.58)*light;}');
  };
  material.customProgramCacheKey=()=> 'latest-retained-continuous-glass-v1';
}

async function texture(pin, THREE, receipts) {
  const bytes=await pinned(pin,receipts),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  try {
    const tex=await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace=THREE.SRGBColorSpace;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;
    return tex;
  } finally { URL.revokeObjectURL(url); }
}

function nativeMaterial(role, palette, THREE, lighting) {
  const cfg=palette[role];
  const material=Shader.createMaterial({role,palette,lighting,mode:'lit',finish:{enabled:!!cfg.finish_enabled,strength:cfg.finish_strength??.08}});
  const needle='float level=min(ndl,0.)+max(ndl,0.)*visibility;';
  if(!material.fragmentShader.includes(needle))throw Error('原四阶公式移植入口失配');
  material.fragmentShader=material.fragmentShader.replace(needle,
    'float level=.17+.14*max(n.y,0.)+.055*(n.y+1.)+.07*max(ndl+.5,0.)+.58*max(ndl,0.)*visibility;');
  material.userData.pipeline='preserved-native-four-tone-WebGL-port';
  material.userData.native_formula='fill=.17+.14*max(nz,0)+.055*(nz+1)+.07*max(NL+.5,0); direct=.58*max(NL,0)*visibility; thresholds .78/.48/.285';
  material.userData.finish_limit='Bounded GPU highlight retains material roughness/metalness metadata; not offline glossy BRDF pixel equivalence';
  material.userData.roughness=cfg.roughness;material.userData.metalness=cfg.metalness??0;
  return material;
}

async function loadBuffers(entry, root, THREE, receipts, shaderMaterials) {
  const bytes=await pinned(entry.geometry,receipts),arr=new Float32Array(bytes),stride=entry.stride_floats;
  const palette=entry.palette?JSON.parse(decoder.decode(await pinned(entry.palette,receipts))):null;
  const lighting={...entry.lighting,viewDirection:[1,-1,1]};
  const materials=new Map();
  for(const row of entry.objects){
    const buffer=new THREE.InterleavedBuffer(arr.subarray(row.start*stride,(row.start+row.count)*stride),stride);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));
    geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));
    let material;
    if(entry.material_pipeline==='monument-vertex-color'){
      const color=new THREE.Color(entry.palette_values[row.paint_role]),colors=new Float32Array(row.count*3);
      const n=new THREE.Vector3(),sun=new THREE.Vector3(...lighting.direction).normalize(),normal=geometry.attributes.normal;
      for(let i=0;i<row.count;i++){
        n.fromBufferAttribute(normal,i);const k=.72+.28*Math.max(0,n.dot(sun));colors.set([color.r*k,color.g*k,color.b*k],i*3);
      }
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));material=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
    }else{
      if(!materials.has(row.material_role))materials.set(row.material_role,nativeMaterial(row.material_role,palette,THREE,lighting));
      material=materials.get(row.material_role);shaderMaterials.add(material);
    }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=row.id;
    mesh.userData={element_id:row.id,paint_role:row.paint_role,domain:row.domain,representation:'actual-source-triangles'};
    root.add(mesh);
  }
  if(entry.inscription){
    const map=await texture(entry.inscription,THREE,receipts),mat=new THREE.MeshBasicMaterial({map,transparent:true,alphaTest:.05,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const g=new THREE.PlaneGeometry(.16,.85);g.rotateX(Math.PI/2);g.scale(-1,1,1);
    const text=new THREE.Mesh(g,mat);text.position.set(0,.132,1.11);text.name='人民英雄永垂不朽';text.userData.inscription=true;root.add(text);
  }
  return palette;
}

async function loadLegacy(entry, root, THREE, receipts) {
  const raw=new Float32Array(await pinned(entry.geometry,receipts)),b=new THREE.InterleavedBuffer(raw,8),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.InterleavedBufferAttribute(b,3,0));g.setAttribute('normal',new THREE.InterleavedBufferAttribute(b,3,3));g.setAttribute('uv',new THREE.InterleavedBufferAttribute(b,2,6));
  const mat=new THREE.MeshBasicMaterial({map:await texture(entry.texture,THREE,receipts),side:THREE.DoubleSide,alphaTest:.001,toneMapped:false});
  windowCorrection(g,entry.catalog_key,entry.curtain_spans,THREE);curtainMaterial(mat,entry.curtain_spans);
  g.computeBoundingBox();g.computeBoundingSphere();const mesh=new THREE.Mesh(g,mat);mesh.name=entry.label;
  mesh.userData.representation='actual-v9-B2-mesh-original-UV-atlas';root.add(mesh);
}

async function loadGLB(entry, root, THREE, GLTFLoader, receipts, shaderMaterials) {
  const palette=JSON.parse(decoder.decode(await pinned(entry.palette,receipts)));
  const loader=new GLTFLoader();
  const gltf=await loader.parseAsync(await pinned(entry.geometry,receipts),'');root.add(gltf.scene);
  if(entry.addon){const extra=await loader.parseAsync(await pinned(entry.addon,receipts),'');root.add(extra.scene);}
  const originalMaterials=new Set(),originalGeometry=new Set();root.traverse(o=>{if(o.isMesh){originalGeometry.add(o.geometry);for(const m of [o.material].flat())originalMaterials.add(m);}});
  const excluded=new Set(entry.exclude_elements??[]),found=new Set();
  const externalTrees=new Set(entry.embedded_landscape_ids??[]),removedTrees=new Set(),treeNodes=[];
  const direction=new THREE.Vector3(...entry.lighting.direction).transformDirection(root.matrix);
  const lighting={direction,thresholds:entry.lighting.thresholds,viewDirection:[1,-1,1]},cache=new Map();
  root.traverse(mesh=>{
    const id=mesh.userData.element_id??mesh.name;
    if(externalTrees.has(id)){
      if(!(mesh.userData.is_environment||mesh.userData.frozen_prefab))throw Error('外部景观ID不对应已登记图面: '+id);
      treeNodes.push(mesh);removedTrees.add(id);
    }
    if(excluded.has(id)){mesh.visible=false;found.add(id);mesh.userData.excluded_ground=true;}
    if(!mesh.isMesh)return;
    const list=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const converted=list.map((sourceMaterial,index)=>{
      if(sourceMaterial.userData.is_environment||mesh.userData.is_environment){
        sourceMaterial.toneMapped=false;mesh.userData.layer='landscape';mesh.userData.is_environment=true;return sourceMaterial;
      }
      const role=Shader.resolveRole(mesh,sourceMaterial,index),key=sourceMaterial.uuid+':'+role;
      if(!palette[role])throw Error(entry.id+'缺少实际材质角色'+role);
      if(!cache.has(key))cache.set(key,Shader.createMaterial({role,palette,lighting,mode:'lit'}));
      const mat=cache.get(key);shaderMaterials.add(mat);return mat;
    });
    mesh.material=Array.isArray(mesh.material)?converted:converted[0];
  });
  treeNodes.forEach(o=>o.removeFromParent());
  const retainedMaterials=new Set(),retainedTextures=new Set(),retainedGeometry=new Set();root.traverse(o=>{if(o.isMesh){retainedGeometry.add(o.geometry);for(const m of [o.material].flat()){retainedMaterials.add(m);for(const v of Object.values(m))if(v?.isTexture)retainedTextures.add(v);}}});
  for(const g of originalGeometry)if(!retainedGeometry.has(g))g.dispose();
  const discardedTextures=new Set();for(const m of originalMaterials)if(!retainedMaterials.has(m)){for(const v of Object.values(m))if(v?.isTexture&&!retainedTextures.has(v))discardedTextures.add(v);m.dispose();}
  for(const t of discardedTextures){t.dispose();t.image?.close?.();}
  for(const id of externalTrees)if(!removedTrees.has(id))throw Error('景观去重ID未命中: '+id);
  root.userData.external_landscape_ids=[...removedTrees];
  for(const id of excluded)if(!found.has(id))throw Error('地面构件未命中，拒绝重复铺地: '+id);
  return palette;
}

function shadowFor(entry,root,THREE,renderer,shaderMaterials){
  if(!shaderMaterials.size||!renderer)return null;
  root.updateMatrixWorld(true);
  const caster=root.clone(true),remove=[];
  caster.traverse(o=>{if(o.userData.is_environment||o.userData.excluded_ground)remove.push(o);});
  remove.forEach(o=>o.removeFromParent());caster.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(caster),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const direction=new THREE.Vector3(...entry.lighting.direction);
  if(entry.lighting.input_axis==='GLB_Y_UP')direction.transformDirection(root.matrix);
  const scale=new THREE.Vector3().setFromMatrixScale(root.matrix).x;
  const options={...entry.shadow,direction:direction.toArray(),target:center.toArray(),span:Math.max(size.x,size.y,size.z)*1.65,normalBias:(entry.shadow?.normalBias??.002)*scale};
  const pass=Shader.createShadowPass(renderer,caster,options);
  for(const material of shaderMaterials)Shader.updateMaterial(material,{shadow:pass.uniforms});
  pass.render();return pass;
}

export async function loadBuilding(entry,{THREE,GLTFLoader,renderer}={}){
  if(!THREE||!GLTFLoader)throw Error('需要统一 THREE 与 GLTFLoader 依赖');
  const receipts=[],shaderMaterials=new Set(),root=makeRoot(entry,THREE);let palette=null;
  if(entry.format==='glb')palette=await loadGLB(entry,root,THREE,GLTFLoader,receipts,shaderMaterials);
  else if(entry.format==='legacy-atlas')await loadLegacy(entry,root,THREE,receipts);
  else if(entry.format==='mesh-buffer')palette=await loadBuffers(entry,root,THREE,receipts,shaderMaterials);
  else throw Error('不支持的真实模型格式:'+entry.format);
  root.updateMatrixWorld(true);
  const pass=shadowFor(entry,root,THREE,renderer,shaderMaterials);
  const stats={id:entry.id,format:entry.format,meshes:0,vertices:0,triangles:0,source_checks:receipts,shader_materials:shaderMaterials.size,matrix_world_rows:entry.matrix_world_rows,palette,shadow:pass?.readback(),limitations:entry.limitations};
  root.traverse(o=>{if(o.isMesh&&!o.userData.excluded_ground){stats.meshes++;stats.vertices+=o.geometry.attributes.position.count;stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
  return {root,stats,shadowPass:pass,
    updateShadow(){pass?.render();stats.shadow=pass?.readback();},
    updateCamera(camera){const direction=new THREE.Vector3();camera.getWorldDirection(direction).negate();for(const m of shaderMaterials)Shader.updateMaterial(m,{lighting:{viewDirection:direction}});},
    setEmbeddedLandscapeVisible(visible){root.traverse(o=>{if(o.userData.is_environment)o.visible=visible;});},
    setMaterialMode(mode){for(const m of shaderMaterials)Shader.updateMaterial(m,{mode});},
    dispose(){pass?.dispose();const gs=new Set(),ms=new Set();root.traverse(o=>{if(!o.isMesh)return;gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>{m.map?.dispose();m.dispose();});}
  };
}
