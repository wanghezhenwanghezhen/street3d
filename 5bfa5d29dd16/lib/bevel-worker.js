// Module workers do not inherit the page's import map. Keep this version-relative.
import * as THREE from '../landmark-current-web3d-20261106/vendor/build/three.module.js';
import {prepareBevelGeometry} from './bevel-runtime.js';

self.onmessage=event=>{
 const {id,source,options}=event.data,start=performance.now();
 try{
  const geometry=new THREE.BufferGeometry();
  for(const [name,a]of Object.entries(source.attributes)){
   let attribute;
   if(a.stride!==undefined)attribute=new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(a.array,a.stride),a.itemSize,a.offset,a.normalized);
   else attribute=new THREE.BufferAttribute(a.array,a.itemSize,a.normalized);
   if(a.instanced)attribute.isInstancedBufferAttribute=true;
   geometry.setAttribute(name,attribute);
  }
  if(source.index)geometry.setIndex(new THREE.BufferAttribute(source.index.array,1));geometry.groups=source.groups;
  if(source.hasMorph)geometry.morphAttributes={unsupported:[]};
  const candidate=prepareBevelGeometry(geometry,{THREE,...options}),result={report:candidate.report,geometry:null};
  const transfer=[];
  if(candidate.geometry){
   const g=candidate.geometry,attributes={};
   for(const [name,a]of Object.entries(g.attributes)){attributes[name]={array:a.array,itemSize:a.itemSize};transfer.push(a.array.buffer);}
   result.geometry={attributes,groups:g.groups,boundingBox:{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()},boundingSphere:{center:g.boundingSphere.center.toArray(),radius:g.boundingSphere.radius}};
   result.buffers=candidate.buffers;result.remainderIndex=candidate.remainderIndex;result.remainderGroups=candidate.remainderGroups;transfer.push(candidate.remainderIndex.buffer);
   for(const arrays of Object.values(candidate.buffers))for(const array of Object.values(arrays))transfer.push(array.buffer);
  }
  self.postMessage({id,result,elapsedMs:performance.now()-start},transfer);
 }catch(error){self.postMessage({id,error:String(error?.stack??error),elapsedMs:performance.now()-start});}
};
