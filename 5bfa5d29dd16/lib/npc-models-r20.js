import * as THREE from 'three';
// Shared primitive buffers and per-instance colors: all 39 characters use four draws, no textures.
export function createNpcModels({scene,profiles,interactables}){
 const types={sphere:new THREE.SphereGeometry(1,12,8),box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,10),cone:new THREE.ConeGeometry(1,1,10)},parts=[],roots=new Map(),heights=new Map();
 for(const p of profiles){const root=new THREE.Group();root.name=p.name;root.userData={instanceId:p.id,basePosition:new THREE.Vector3()};roots.set(p.id,root);scene.add(root);const a=p.appearance,stick=!a,h=stick?.48:(a.silhouette?.build?.includes('小孩')?.40:.49),scale=h/.49;heights.set(p.id,h);
  const add=(type,color,position,size,limb='',rx=0,rz=0)=>{let at=[...position],dim=[...size];if(!stick&&position[1]>.32){const headScale=Math.min(.89,Math.max(.66,3.2/(a.silhouette?.headBodyRatioApprox??4.4)));at=[at[0]*headScale,.365+(at[1]-.32)*headScale,at[2]*headScale];dim=dim.map(v=>v*headScale);}parts.push({id:p.id,type,color:new THREE.Color(color),position:at.map(n=>n*scale),size:dim.map(n=>n*scale),limb,rx,rz});};
  const sphere=(c,pos,size,limb)=>add('sphere',c,pos,size,limb),box=(c,pos,size,limb)=>add('box',c,pos,size,limb);
  if(stick){sphere('#e7d1b5',[0,.413,0],[.063,.071,.062]);add('cylinder','#3f475a',[0,.255,0],[.014,.19,.014]);for(const side of [-1,1]){add('cylinder','#3f475a',[side*.055,.274,0],[.012,.16,.012],'arm'+side,0,side*.42);add('cylinder','#3f475a',[side*.033,.105,0],[.014,.19,.014],'leg'+side,0,-side*.18);sphere('#3f475a',[side*.046,.019,.024],[.03,.017,.047],'leg'+side);}continue;}
  const skin=a.skin,hair=a.hairColor,top=a.topColor,bottom=a.bottomColor,shoe=a.shoeColor,fat=/胖|壮|圆腹/.test(a.silhouette?.build??''),body=fat?.092:.068;
  sphere(top,[0,.25,0],[body,.103,.054]);sphere(bottom,[0,.17,0],[body*.86,.046,.05]);sphere(skin,[0,.383,0],[.082,.093,.077]);sphere(skin,[0,.297,.003],[.028,.035,.027]);
  for(const side of [-1,1]){sphere(top,[side*(body+.017),.25,0],[.028,.077,.029],'arm'+side);sphere(skin,[side*(body+.025),.188,.009],[.023,.029,.023],'arm'+side);add('cylinder',bottom,[side*.037,.102,0],[.025,.137,.027],'leg'+side);sphere(shoe,[side*.039,.022,.018],[.035,.022,.057],'leg'+side);box('#e5dfd5',[side*.039,.01,.02],[.064,.013,.097],'leg'+side);sphere(skin,[side*.081,.379,0],[.016,.023,.02]);sphere('#303044',[side*.031,.389,.071],[.009,.015,.008]);}
  sphere(skin,[0,.369,.078],[.013,.014,.013]);
  if(!/秃顶/.test(a.hairStyle)){sphere(hair,[0,.432,-.008],[.084,.055,.076]);for(let i=0;i<7;i++){const t=i/6*Math.PI; sphere(hair,[Math.cos(t)*.069,.421+Math.sin(t)*.02,.044],[.026,.036,.032]);}}
  else for(const side of [-1,1])sphere(hair,[side*.072,.414,-.013],[.018,.035,.052]);
  if(/卷|圆团/.test(a.hairStyle))for(let i=0;i<13;i++){const t=i/13*Math.PI*2;sphere(hair,[Math.sin(t)*.079,.438+Math.cos(t)*.025,-.004+Math.cos(t)*.035],[.029,.032,.03]);}
  if(/长|过肩|双辫/.test(a.hairStyle)){sphere(hair,[0,.36,-.05],[.082,.102,.034]);for(const side of [-1,1])sphere(hair,[side*.07,.347,.002],[.028,.085,.03]);}
  if(/马尾|发髻/.test(a.hairStyle)){sphere(hair,[a.hairStyle.includes('一侧')?.07:0,.425,-.081],[.036,.044,.043]);sphere(hair,[a.hairStyle.includes('一侧')?.08:0,.383,-.087],[.025,.053,.027]);}
  if(a.hat){const c=a.hat.color;add('cylinder',c,[0,.459,0],[.085,.046,.076]);sphere(c,[0,.469,-.004],[.084,.03,.075]);sphere(c,[0,.443,.029],[.10,.009,.093]);if(/保安|医生|布帽/.test(a.hat.type))box('#f0e8c9',[0,.46,.076],[.018,.018,.005]);}
  const accessories=(a.accessory??[]).join(' ');
  if(/黑帽檐/.test(accessories)){sphere('#252832',[0,.44,.059],[.088,.009,.065]);box('#dbdce1',[0,.449,.078],[.12,.006,.008]);}
  if(/短.*尖束|放射|层叠/.test(a.hairStyle))for(let i=0;i<5;i++)add('cone',hair,[(i-2)*.027,.419,.062],[.021,.052,.02],'',Math.PI,(i-2)*.16);
  if(/眼镜|墨镜/.test(accessories)){const c=/粉色/.test(accessories)?'#eaa9c3':'#414147';for(const side of [-1,1]){box(c,[side*.034,.397,.08],[.052,.032,.009]);box(skin,[side*.034,.397,.086],[.040,.021,.008]);}box(c,[0,.397,.083],[.02,.006,.008]);}
  if(/背包/.test(accessories)){box(/红背包/.test(accessories)?'#c95a4e':'#c79c5f',[0,.249,-.068],[.105,.12,.046]);for(const side of [-1,1])box('#705b4b',[side*.048,.26,.048],[.012,.13,.008]);}
  if(/斜挎|邮差包|腰包|挎包/.test(accessories)){box('#39444e',[.087,.184,.009],[.05,.06,.04]);add('box','#ded3b4',[.01,.26,.054],[.012,.16,.008],'',0,-.55);}
  if(/领带|领结/.test(accessories)){add('cone','#e2b54c',[0,.272,.054],[.011,.052,.008],'',Math.PI);}
  if(/白衬衫|白内衫|白色.*T恤|V领/.test(accessories))box('#ece8db',[0,.262,.053],[.052,.086,.006]);
  if(/黑领带/.test(accessories))add('cone','#252a38',[0,.263,.06],[.012,.071,.008],'',Math.PI);
  if(/胸袋|制服|棉背心/.test(accessories))for(const side of [-1,1])box(top,[side*.041,.263,.053],[.033,.036,.009]);
  if(/黑色肩带|肩带/.test(accessories))for(const side of [-1,1])box('#33343d',[side*.046,.271,.056],[.011,.12,.008]);
  if(/条纹/.test(accessories))for(const side of [-1,1])for(let i=-1;i<=1;i++)box('#d7dde1',[side*.037+i*.01,.105,.027],[.004,.12,.004],'leg'+side);
  if(/格纹|格衬衫|菱格/.test(accessories))for(let i=-1;i<=1;i++){box('#b7a5c2',[i*.026,.256,.056],[.004,.10,.004]);box('#b7a5c2',[0,.256+i*.027,.056],[.088,.004,.004]);}
  if(/围巾/.test(accessories)){add('cylinder','#dd8d56',[0,.307,0],[.039,.022,.034]);box('#edc8a4',[.02,.269,.06],[.019,.065,.012]);}
  if(/长.*袍|长.*衣|围裙|连衣裙|短裙/.test(accessories)){add('cone',/围裙/.test(accessories)?'#d3c6ae':top,[0,.188,.003],[body*1.15,.15,.07]);}
  if(/手持|持.*|拿|拐杖|雨伞/.test(accessories)){const color=/橙色设备/.test(accessories)?'#f49030':/红/.test(accessories)?'#cb5d62':/金|黄/.test(accessories)?'#d8b449':'#829da5';box(color,[-(body+.03),.195,.039],[.030,.071,.024],'arm-1');box('#303841',[-(body+.03),.21,.054],[.022,.024,.004],'arm-1');}
  if(/胡须|胡子/.test(accessories))sphere(hair,[0,.337,.048],[.047,.025,.031]);
 }
 const material=new THREE.MeshStandardMaterial({roughness:.85}),batches=[];for(const [type,geometry] of Object.entries(types)){const list=parts.filter(p=>p.type===type);const mesh=new THREE.InstancedMesh(geometry,material,list.length);mesh.userData.instanceIds=list.map(p=>p.id);mesh.userData.npcCodeModels=true;mesh.name='NPC code '+type;mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=false;list.forEach((p,i)=>mesh.setColorAt(i,p.color));scene.add(mesh);interactables.push(mesh);batches.push({mesh,list});}
 const transform=new THREE.Object3D(),rootMatrix=new THREE.Matrix4(),local=new THREE.Matrix4(),up=new THREE.Vector3(0,1,0),quat=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1);let lastTime=0;
 function update(runtime,minute){lastTime=minute;for(const p of profiles){const sample=runtime.get(p.id),root=roots.get(p.id);if(sample){root.position.fromArray(sample.position);root.rotation.y=sample.heading??0;root.userData.basePosition.copy(root.position);}}
  for(const {mesh,list}of batches){list.forEach((part,i)=>{const sample=runtime.get(part.id),root=roots.get(part.id);if(!sample)return;const moving=sample.speedUPerGameMinute>.01,phase=minute*18+(Number(part.id.slice(-3))||i),side=part.limb.endsWith('-1')?-1:1;transform.position.fromArray(part.position);transform.rotation.set(part.rx,0,part.rz);transform.scale.fromArray(part.size);if(moving&&part.limb){const swing=Math.sin(phase)*.035*side;transform.position.z+=swing;transform.position.y+=Math.max(0,Math.sin(phase)*side)*.009;}transform.updateMatrix();quat.setFromAxisAngle(up,root.rotation.y);rootMatrix.compose(root.position,quat,one);local.multiplyMatrices(rootMatrix,transform.matrix);mesh.setMatrixAt(i,local);});mesh.instanceMatrix.needsUpdate=true;}
 }
 return {roots,heights,batches:batches.map(b=>b.mesh),update,snapshot:()=>({count:profiles.length,referenceModels:profiles.filter(p=>p.appearance).length,stickFigures:profiles.filter(p=>!p.appearance).length,textureCount:0,drawCalls:batches.length,visibleDrawCalls:batches.filter(b=>b.mesh.visible).length,visible:batches.some(b=>b.mesh.visible),parts:parts.length,minute:lastTime,profiles:profiles.map(p=>({id:p.id,name:p.name,height:heights.get(p.id),kind:p.appearance?'reference-based-code-model':'stick-figure',sourceCell:p.sourceCell,referenceSha256:p.referenceSha256,position:roots.get(p.id).position.toArray()}))})};
}
