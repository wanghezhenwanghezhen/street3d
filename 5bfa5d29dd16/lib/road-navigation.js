export function createRoadGraph(roads) {
  const nodes=new Map(roads.map(r=>[r.id,{...r,position:[r.center[0],.035,-r.center[1]],neighbors:[]}]));
  const cells=new Map(roads.map(r=>[r.cell_uv.join(','),r.id]));
  for(const node of nodes.values()){
    const [x,y]=node.cell_uv;
    node.neighbors=[[x+1,y],[x,y+1],[x-1,y],[x,y-1]].map(c=>cells.get(c.join(','))).filter(Boolean);
  }
  function nearest(point,allowed=null){
    return [...nodes.values()].filter(n=>!allowed||allowed.has(n.id)).sort((a,b)=>
      Math.hypot(a.position[0]-point[0],a.position[2]-point[2])-Math.hypot(b.position[0]-point[0],b.position[2]-point[2]))[0];
  }
  function path(from,to){
    const queue=[from],previous=new Map([[from,null]]);
    for(let k=0;k<queue.length&&!previous.has(to);k++){
      for(const next of nodes.get(queue[k]).neighbors)if(!previous.has(next)){previous.set(next,queue[k]);queue.push(next);}
    }
    if(!previous.has(to))return null;
    const route=[];for(let id=to;id;id=previous.get(id))route.unshift(id);
    return route;
  }
  function component(from){
    const visited=new Set([from]),queue=[from];
    for(let k=0;k<queue.length;k++)for(const next of nodes.get(queue[k]).neighbors)if(!visited.has(next)){visited.add(next);queue.push(next);}
    return visited;
  }
  return {nodes,nearest,path,component};
}
