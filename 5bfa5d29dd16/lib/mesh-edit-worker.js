import * as THREE from '../landmark-current-web3d-20261106/vendor/build/three.module.js';
import {editGeometry} from './mesh-edit-geometry.js';
self.onmessage=({data})=>{
 const {id,source,settings}=data,start=performance.now();
 try{
  const g=new THREE.BufferGeometry();for(const [name,a]of Object.entries(source.attributes))g.setAttribute(name,new THREE.Float32BufferAttribute(a.array,a.itemSize));
  if(source.index)g.setIndex(new THREE.BufferAttribute(source.index,1));g.groups=source.groups;
  const {geometry,report,remainderIndex,remainderGroups}=editGeometry(g,{THREE,...settings});let result=null,transfer=[];
  if(geometry){result={attributes:{},groups:geometry.groups,remainderIndex,remainderGroups};transfer.push(remainderIndex.buffer);for(const [name,a]of Object.entries(geometry.attributes)){result.attributes[name]={array:a.array,itemSize:a.itemSize};transfer.push(a.array.buffer);}}
  self.postMessage({id,result,report,elapsedMs:performance.now()-start},transfer);
 }catch(e){self.postMessage({id,error:String(e.stack??e)});}
};
