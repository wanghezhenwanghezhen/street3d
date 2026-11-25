import {createDice3D} from './dice-3d.js';
const svgNS='http://www.w3.org/2000/svg',asset=name=>new URL('../assets/ui-r20/'+name,import.meta.url).href;
export function createHud(){
 const $=id=>document.getElementById(id),shell=$('game-shell'),hud=document.createElement('div');hud.id='hud';hud.setAttribute('aria-label','游戏操作');shell.append(hud);
 const surface=(name,cls='hud-surface')=>{const img=document.createElement('img');img.src=asset(name);img.className=cls;img.alt='';img.draggable=false;return img;};
 const scrim=document.createElement('div');scrim.id='hud-scrim';scrim.style.backgroundImage=`url("${asset('scrim.svg')}")`;shell.append(scrim);
 const card=document.createElement('div');card.id='hud-card';card.append(surface('card.svg'));card.insertAdjacentHTML('beforeend','<output class="card-time">08:00</output><span class="card-caption">街区编辑 · 一天循环</span>');hud.append(card);
 const tray=document.createElement('div');tray.id='hud-tray';tray.append(surface('toolbar.svg'));hud.append(tray);
 function decorate(button,icon,label,circle=false){button.replaceChildren(surface('button-'+(circle?'circle':'square')+'.svg'));button.setAttribute('aria-label',label);button.title=label;const svg=document.createElementNS(svgNS,'svg');svg.classList.add('hud-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(svgNS,'use');use.setAttribute('href',asset('icons.svg')+'#'+icon);svg.append(use);button.append(svg);const text=document.createElement('span');text.className='hud-label';text.textContent=label;button.append(text);const tip=document.createElement('span');tip.className='hud-tip';tip.textContent=label;button.append(tip);}
 for(const [id,icon,label] of [['play-mode','edit','切换编辑模式'],['journal','book','街区手册'],['landscape-toggle','settings','场景设置']]){const b=$(id);hud.append(b);decorate(b,icon,label,true);}
 const progress=document.createElement('span');progress.id='progress';progress.hidden=true;$('journal').append(progress);
 const home=$('home');hud.append(home);decorate(home,'home','返回落点');
 const tools=document.createElement('div');tools.id='hud-tools';hud.append(tools);
 const specs=[['mode','camera','观察视角'],['day-toggle','clock','人物日程'],['hud-building','building','建筑编辑'],['hud-weather','weather','天气环境'],['hud-people','people','人物与关系'],['help','help','操作说明']];
 specs.forEach(([id,icon,label],i)=>{const b=$(id)??document.createElement('button');b.id=id;decorate(b,icon,label);b.style.setProperty('--order',i);tools.append(b);});
 $('hud-building').onclick=()=>{$('landscape-toggle').click();setTimeout(()=>$('bevel-size')?.scrollIntoView({block:'center'}),0);};$('hud-weather').onclick=()=>{$('landscape-toggle').click();setTimeout(()=>$('cloud-style')?.scrollIntoView({block:'center'}),0);};$('hud-people').onclick=()=>$('day-toggle').click();
 // An explicit map control preserves the existing minimap without adding a fourth top-level control.
 const mapLabel=document.createElement('label');mapLabel.className='layer-check';mapLabel.innerHTML='<input id="hud-map-toggle" type="checkbox"> 显示右上角小地图';$('landscape-panel').append(mapLabel);$('hud-map-toggle').onchange=e=>document.body.classList.toggle('hud-map-visible',e.target.checked);
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','可拖动旋转的三维骰子');$('dice-face').replaceChildren(canvas);const dice=createDice3D(canvas);const portrait=surface('interaction-portrait.svg','');portrait.id='hud-portrait';$('dice-panel').append(portrait);
 let current='play',clock=-1;document.body.dataset.hudState=current;
 function state(next){if(next===current)return;current=next;document.body.dataset.hudState=next;const expanded=next!=='play';tools.inert=!expanded;tools.setAttribute('aria-hidden',String(!expanded));card.querySelector('.card-caption').textContent=next==='interaction'?'街角相遇 · 正在交谈':'街区编辑 · 一天循环';if(!matchMedia('(prefers-reduced-motion: reduce)').matches){const target=next==='play'?$('dice-panel'):card;target.animate([{transform:'translateY(9px) rotate(-1.5deg)',opacity:.5},{transform:'translateY(-2px) rotate(.5deg)',opacity:1,offset:.7},{transform:'translateY(0) rotate(0)'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});}}
 tools.inert=true;tools.setAttribute('aria-hidden','true');
 return {state,roll:dice.roll,update(dt,minute){dice.update(dt);if(Math.floor(minute)!==clock){clock=Math.floor(minute);card.querySelector('.card-time').textContent=String(Math.floor(minute/60)%24).padStart(2,'0')+':'+String(Math.floor(minute%60)).padStart(2,'0');}},refreshButton(id,icon,label){decorate($(id),icon,label,id==='play-mode');},snapshot:()=>({state:current,referenceSize:[1688,780],svgLayers:true,dice:dice.snapshot()})};
}
