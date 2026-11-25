// Phone orientation is a presentation state: no reload, renderer or asset rebuild.
(() => {
  const coarse=matchMedia('(pointer: coarse)'), shell=document.getElementById('game-shell');
  const notice=document.getElementById('orientation-notice'), button=document.getElementById('orientation-enter');
  const hint=document.getElementById('orientation-hint');
  let blocked=false,previousFocus=null,lockResult='not-requested';
  const phone=()=>coarse.matches&&Math.min(innerWidth,innerHeight)<=600;
  function update(){
    const next=phone()&&innerHeight>innerWidth,changed=next!==blocked;blocked=next;
    document.documentElement.classList.toggle('phone-portrait',blocked);
    shell.inert=blocked;notice.hidden=!blocked;
    if(changed){
      if(blocked){previousFocus=document.activeElement;button.focus({preventScroll:true});}
      else if(previousFocus?.isConnected){previousFocus.focus({preventScroll:true});previousFocus=null;}
      dispatchEvent(new CustomEvent('qianyu-orientation',{detail:{blocked}}));
    }
  }
  async function enter(){
    if(!phone())return;
    try{
      if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
      if(screen.orientation?.lock){await screen.orientation.lock('landscape');lockResult='locked';}
      else lockResult='unsupported';
    }catch(error){lockResult=error.name||'unavailable';}
    hint.textContent=lockResult==='locked'?'已切换横屏。':'请将手机横过来；若未旋转，请关闭手机的竖屏锁定。';
    update();
  }
  button.addEventListener('click',enter);
  // Start is an explicit gesture; unsupported fullscreen/locking never blocks play.
  document.getElementById('start').addEventListener('click',()=>{if(phone()&&!blocked)void enter();});
  addEventListener('resize',update);coarse.addEventListener('change',update);
  document.addEventListener('fullscreenchange',update);screen.orientation?.addEventListener('change',update);
  window.mobileLandscape=Object.freeze({get blocked(){return blocked;},snapshot:()=>({phone:phone(),blocked,lockResult,fullscreen:!!document.fullscreenElement,viewport:[innerWidth,innerHeight]})});
  update();
})();
