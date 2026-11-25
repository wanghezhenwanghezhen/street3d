export async function verifiedBytes(url,expected){
  const response=await fetch(url);if(!response.ok)throw Error(url+' HTTP '+response.status);
  const bytes=await response.arrayBuffer();
  if(expected){const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==expected)throw Error('Frozen streaming input changed: '+url);}
  return bytes;
}
export async function verifiedJSON(url,expected){return JSON.parse(new TextDecoder().decode(await verifiedBytes(url,expected)));}
export function validateContract(contract,data,payload){
  if(contract.schema!=='qianyu-building-stream-contract/1')throw Error('Unsupported building stream contract');
  const buildings=data.instances.filter(i=>['true3d','source-model-r2'].includes(i.representation));
  const sameIds=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
  if(!sameIds(buildings.map(i=>i.instanceId),contract.buildings.map(r=>r.instanceId))||buildings.length!==65)throw Error('Building stream ID contract mismatch');
  if(!sameIds(payload.rows.map(r=>r.id),contract.furniture.map(r=>r.id))||payload.rows.length!==237)throw Error('Frozen furniture ID contract mismatch');
  const rows=new Map(contract.furniture.map(r=>[r.id,r]));
  for(const spec of payload.rows){const row=rows.get(spec.id);if(row.model!==spec.model||row.yaw!==spec.yaw||JSON.stringify(row.sourcePosition)!==JSON.stringify(spec.position)||JSON.stringify(row.storyIds)!==JSON.stringify(spec.storyIds))throw Error('Frozen furniture binding changed: '+spec.id);}
  if(contract.buildingWalkColliders.length!==21||contract.expectedWalkColliders!==262)throw Error('Walk collider contract mismatch');
  return true;
}
