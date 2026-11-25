// Preserve the existing tactile mesh as the sole path owner. Paver relief is
// masked only at pixels actually covered by a depth-visible tactile triangle.
// No duplicate route, geometry, texture, or elevation offset is introduced.
const TACTILE_ID='mat-tactile-actual-warm-yellow';
const BIT=1;

export function createTactilePavingGuard(THREE,{stencilEnabled=false}={}){
 if(!stencilEnabled)throw Error('Tactile paving guard requires a stencil-enabled WebGL context');
 const stats={schema:'qianyu-tactile-paving-guard-r10',method:'original-depth-visible-tactile-stencil',sourceMaterialId:TACTILE_ID,configuredTactileMeshes:0,configuredPavingMeshes:0,createdGeometry:0,createdTextures:0,sourcePositionsUnchanged:true,sourceTopologyUnchanged:true,elevationOffsetU:0,stencilBit:BIT};
 const ownedMaterials=new Set();
 const isTactile=material=>material?.userData?.sourceDefinition?.id===TACTILE_ID;
 function enableStencil(material,func,pass){
  material.stencilWrite=true;
  material.stencilRef=BIT;
  material.stencilFunc=func;
  material.stencilFuncMask=BIT;
  material.stencilWriteMask=BIT;
  material.stencilFail=THREE.KeepStencilOp;
  material.stencilZFail=THREE.KeepStencilOp;
  material.stencilZPass=pass;
  // In particular, an occluded tactile triangle must not cut a hole through a
  // visible object. Both the original depth buffer and its stencil are tested.
  material.depthTest=true;
  material.depthWrite=true;
  material.needsUpdate=true;
 }
 function makePavingMaterials(materials){
  const result=new Map();
  for(const [id,source]of materials){
   // Shared base materials must remain unmasked. Material.clone does not copy
   // custom shader hooks; explicitly preserve the existing surface recipe.
   const material=source.clone();
   material.onBeforeCompile=source.onBeforeCompile;
   material.customProgramCacheKey=source.customProgramCacheKey;
   material.userData={...source.userData,tactilePavingGuard:true};
   enableStencil(material,THREE.NotEqualStencilFunc,THREE.KeepStencilOp);
   ownedMaterials.add(material);material.addEventListener('dispose',()=>ownedMaterials.delete(material));result.set(id,material);
  }
  return result;
 }
 function prepareMesh(mesh,kind){
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(kind==='paving'){
   if(!materials.every(m=>m.userData?.tactilePavingGuard))throw Error('Paving requires its dedicated guarded material');
   mesh.renderOrder=2;
   // Existing streamed pavers do not cast shadows. Keep that contract so the
   // cut-out relief cannot leave a separate floating shadow across the path.
   mesh.castShadow=false;
   mesh.userData.tactilePavingGuard='paving-cutout';stats.configuredPavingMeshes++;
  }else if(materials.some(isTactile)){
   if(!materials.every(isTactile))throw Error('Mixed tactile/base material mesh requires explicit source grouping');
   for(const material of materials)enableStencil(material,THREE.AlwaysStencilFunc,THREE.ReplaceStencilOp);
   mesh.renderOrder=1;
   mesh.castShadow=false;
   mesh.userData.tactilePavingGuard='original-tactile-owner';stats.configuredTactileMeshes++;
  }
  return mesh;
 }
 function dispose(){for(const material of ownedMaterials)material.dispose();ownedMaterials.clear();}
 return {makePavingMaterials,prepareMesh,stats,dispose};
}
