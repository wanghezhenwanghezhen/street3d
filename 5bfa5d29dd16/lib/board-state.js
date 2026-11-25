// A hop always follows one authoritative road edge. No invented linear ordering.
export function createBoardState(graph,start,saved={}) {
  const state={cell:graph.nodes.has(saved.cell)?saved.cell:start,previous:null,remaining:0,value:0,turn:0,landings:[],heading:[1,0]};
  if(graph.nodes.has(saved.previous))state.previous=saved.previous;
  if(Number.isInteger(saved.remaining)&&saved.remaining>=0&&saved.remaining<=6)state.remaining=saved.remaining;
  if(Number.isInteger(saved.value)&&saved.value>=1&&saved.value<=6)state.value=saved.value;
  if(Number.isInteger(saved.turn)&&saved.turn>=0)state.turn=saved.turn;
  function direction(from,to){const a=graph.nodes.get(from).position,b=graph.nodes.get(to).position,dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz);return n?[dx/n,dz/n]:[1,0];}
  if(state.previous&&graph.nodes.get(state.cell).neighbors.includes(state.previous))state.heading=direction(state.previous,state.cell);
  else if(Array.isArray(saved.heading)&&saved.heading.length===2&&saved.heading.every(Number.isFinite)&&Math.hypot(...saved.heading)>.99)state.heading=directionHeading(saved.heading);
  function directionHeading(h){const n=Math.hypot(...h);return h.map(v=>v/n);}
  function choices(){const neighbors=graph.nodes.get(state.cell).neighbors,forward=neighbors.filter(id=>id!==state.previous);return forward.length?forward:neighbors;}
  // Continue straight; at a fork take the smallest turn, preferring right on a tie.
  function forward(){const [hx,hz]=state.heading;return choices().map(id=>{const [dx,dz]=direction(state.cell,id);return {id,dot:hx*dx+hz*dz,right:hx*dz-hz*dx};}).sort((a,b)=>b.dot-a.dot||b.right-a.right||a.id.localeCompare(b.id))[0]?.id??null;}
  function roll(value){if(state.remaining||!Number.isInteger(value)||value<1||value>6)return false;state.value=value;state.remaining=value;state.turn++;return true;}
  function land(id){if(!state.remaining||!choices().includes(id))return false;const from=state.cell;state.heading=direction(from,id);state.previous=from;state.cell=id;state.remaining--;state.landings.push({turn:state.turn,from,to:id,remaining:state.remaining});if(state.landings.length>120)state.landings.shift();return true;}
  return {state,choices,forward,roll,land};
}
