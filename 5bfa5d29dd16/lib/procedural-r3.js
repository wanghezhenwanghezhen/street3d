const hashString=value=>{let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const pick=(value,list)=>list[hashString(value)%list.length];

function mat(THREE,color,{roughness=.86,metalness=0,emissive=null,emissiveIntensity=0}={}){
  return new THREE.MeshStandardMaterial({color,roughness,metalness,emissive:emissive??color,emissiveIntensity,side:THREE.DoubleSide});
}
function box(THREE,parent,w,h,d,material,x=0,y=0,z=0){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function cylinder(THREE,parent,r1,r2,h,material,x=0,y=0,z=0,segments=10){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,segments,1),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function planeDecal(THREE,parent,w,d,material,x=0,y=.006,z=0,rotation=0){
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d),material);mesh.rotation.x=-Math.PI/2;mesh.rotation.z=rotation;mesh.position.set(x,y,z);mesh.receiveShadow=true;parent.add(mesh);return mesh;
}

export function buildShopModel(THREE,instance){
  const bounds=instance.bounds??[instance.position[0]-.8,-instance.position[2]-.8,instance.position[0]+.8,-instance.position[2]+.8];
  const width=Math.max(.9,bounds[2]-bounds[0]),depth=Math.max(.9,bounds[3]-bounds[1]);
  const h=1.35+(hashString(instance.instanceId)%3)*.22;
  const palette=[['#f0c28b','#d76b55','#355c66'],['#d8e4d8','#c47e62','#3c6571'],['#efd4a1','#7eaa9d','#4b5f72'],['#d4c1e7','#c37379','#3f5861'],['#d7e7ee','#e29b4a','#38546a']][hashString(instance.name)%5];
  const group=new THREE.Group();group.name='shop-model-r3:'+instance.instanceId;group.position.fromArray(instance.position);
  const wall=mat(THREE,palette[0]), trim=mat(THREE,palette[1]), dark=mat(THREE,palette[2]), roof=mat(THREE,pick(instance.name,['#d78364','#b96d5c','#7c9e9c','#d7a552']));
  box(THREE,group,width,.12,depth,trim,0,.06,0);
  box(THREE,group,width,h,depth,wall,0,h/2+.12,0);
  box(THREE,group,width*1.08,.14,depth*1.08,roof,0,h+.19,0);
  box(THREE,group,width*1.02,.07,depth*1.02,trim,0,h+.28,0);
  const front=depth/2+.012;
  box(THREE,group,Math.min(.46,width*.28),Math.min(.82,h*.66),.045,dark,-width*.23,.54,front+.025);
  for(const x of [-width*.28,width*.28])box(THREE,group,Math.min(.38,width*.22),Math.min(.42,h*.36),.04,trim,x,.78,front+.025);
  box(THREE,group,width*.86,.08,.22,trim,0,h*.62,front+.11);
  box(THREE,group,width*.7,.18,.28,mat(THREE,pick(instance.name,['#e7aa55','#d95b53','#6d9da3','#8e78ac'])),0,h*.56,front+.21);
  const signText=mat(THREE,pick(instance.name,['#fff0c7','#f7d7a4','#f2f3df']));box(THREE,group,width*.68,.10,.045,signText,0,h*.72,front+.13);
  // A small identity prop keeps the shop readable without using a texture plane.
  if(/甜品|快餐|早点|面馆|花店/.test(instance.name)){cylinder(THREE,group,.12,.16,.16,trim,0,h+.42,0,10);cylinder(THREE,group,.08,.08,.18,dark,0,h+.58,0,10);}
  else if(/医院|宠物/.test(instance.name)){box(THREE,group,.12,.34,.05,mat(THREE,'#fff8e8'),0,h+.43,front+.03);box(THREE,group,.34,.12,.05,mat(THREE,'#d95b53'),0,h+.43,front+.04);}
  else box(THREE,group,.32,.18,.06,mat(THREE,pick(instance.name,['#f0be62','#87ac9b','#cc6e65'])),0,h+.42,front+.03);
  return {group,width,depth,height:h+.6};
}

function orientationFor(source){return /_sw$/.test(source)?Math.PI*.75:/_se$/.test(source)?Math.PI*.25:/_nw$/.test(source)?Math.PI*1.25:0;}
export function buildStreetlightModel(THREE,instance){
  const group=new THREE.Group();group.name='streetlight-model-r3:'+instance.instanceId;group.position.fromArray(instance.position);group.rotation.y=orientationFor(instance.sourceAssetId??'');
  const pole=mat(THREE,'#9aa7a6'),dark=mat(THREE,'#4a6268'),lamp=mat(THREE,'#f3d579',{emissive:'#f3be55',emissiveIntensity:.34});
  cylinder(THREE,group,.045,.075,1.55,pole,0,.78,0,10);
  cylinder(THREE,group,.055,.035,.12,dark,0,1.57,0,10);
  box(THREE,group,.58,.045,.055,dark,.24,1.55,0);
  cylinder(THREE,group,.11,.08,.08,lamp,.53,1.51,0,12);
  cylinder(THREE,group,.06,.06,.018,mat(THREE,'#fff1b2',{emissive:'#ffe48a',emissiveIntensity:.65}),.53,1.46,0,12);
  return {group,width:.7,depth:.2,height:1.65};
}

export function buildSignModel(THREE,instance){
  const group=new THREE.Group();group.name='sign-model-r3:'+instance.instanceId;group.position.fromArray(instance.position);
  const source=instance.sourceAssetId??'';group.rotation.y=source.includes('guitar')?-.18:source.includes('ufo')?.16:0;
  const post=mat(THREE,'#6b7775'),boardColor=/warning|early|keep|right|praying|snail/i.test(source)?'#e6b84e':source.includes('heart')?'#df806d':'#5d9a9b';
  const board=mat(THREE,boardColor),edge=mat(THREE,'#f5e7bb');
  cylinder(THREE,group,.035,.045,1.12,post,0,.56,0,8);
  box(THREE,group,.48,.34,.055,board,0,1.15,.02);
  box(THREE,group,.38,.05,.06,edge,0,1.22,.055);
  box(THREE,group,.06,.18,.06,edge,0,1.06,.055);
  return {group,width:.55,depth:.16,height:1.35};
}

export function buildGraffitiModel(THREE,instance){
  const group=new THREE.Group();group.name='graffiti-model-r3:'+instance.instanceId;group.position.fromArray(instance.position);
  const wall=mat(THREE,'#c9b79a'),pink=mat(THREE,'#e87882'),blue=mat(THREE,'#4d93a7'),yellow=mat(THREE,'#e6bd4f');
  box(THREE,group,.9,.42,.12,wall,0,.22,0);
  box(THREE,group,.22,.05,.015,pink,-.2,.28,.072,-.04);
  box(THREE,group,.34,.05,.015,blue,.14,.2,.073,.25);
  box(THREE,group,.12,.05,.015,yellow,.26,.31,.074,-.3);
  return {group,width:.95,depth:.15,height:.5};
}

export function buildRoadEdge(THREE,roadCells){
  const group=new THREE.Group();group.name='road-paving-r3';
  const curb=mat(THREE,'#b9c1bd'),tileA=mat(THREE,'#d8dee0'),tileB=mat(THREE,'#c4d2d1');
  const dirs=[[1,0,'x'],[-1,0,'x'],[0,1,'z'],[0,-1,'z']];let shoulderSegments=0,tileCount=0;
  for(const key of roadCells){const [x,y]=key.split(',').map(Number);for(const [dx,dy,axis] of dirs){if(roadCells.has(`${x+dx},${y+dy}`))continue;shoulderSegments++;const cx=x+.5+dx*.54,cz=-(y+.5+dy*.54);const along=axis==='x';box(THREE,group,along?.92:.12,.10,along?.12:.92,curb,cx,.035,cz);for(let n=0;n<4;n++){const t=(n-1.5)*.23;const tx=cx+(along?t:dx*.22),tz=cz+(along?dy*.22:t);box(THREE,group,along?.19:.38,.045,along?.38:.19,n%2?tileB:tileA,tx,.008,tz);tileCount++;}}}
  return {group,shoulderSegments,tileCount};
}

export function buildRoadGraffiti(THREE,placements){
  const group=new THREE.Group();group.name='road-graffiti-r3';const yellow=mat(THREE,'#e4b755'),pink=mat(THREE,'#db7b89'),blue=mat(THREE,'#58a0ae');
  for(const p of placements){const g=new THREE.Group();g.position.fromArray(p.position);planeDecal(THREE,g,.34,.12,yellow,0,.011,0,.2);planeDecal(THREE,g,.12,.12,pink,.2,.012,.02,-.3);planeDecal(THREE,g,.1,.1,blue,-.18,.013,-.04,.5);group.add(g);}
  return {group,count:placements.length};
}
