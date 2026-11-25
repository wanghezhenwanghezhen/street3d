export function createBuildingEditorUI({geometry,materials,outlines,entries,names,ensure,focus,onChange,prepare,arrayController,onPickStart=()=>{},onPicked=()=>{}}){
 const $=id=>document.getElementById(id);let selected=null,picking=false,timer=null,materialKey='*';
 const section=document.createElement('section');section.id='building-editor';section.setAttribute('aria-label','建筑与材质编辑');
 const range=(id,label,max,step,value,unit='%')=>`<label class="layer-control">${label} <output id="${id}-value">${value}${unit}</output><input id="${id}" type="range" min="0" max="${max}" step="${step}" value="${value}"></label>`;
 section.innerHTML=`<h3 class="layer-section">建筑编辑</h3>
  <label class="layer-select">编辑范围<select id="building-edit-target"><option value="">全部建筑与模型</option></select></label>
  <div class="editor-actions"><button id="building-pick" aria-pressed="false">点击建筑选择</button><button id="building-focus" disabled>定位选中</button><button id="building-clear">取消选择</button></div>
  <p id="building-selection-status" class="layer-hint" role="status">几何调整仅作用于地标建筑。选中单栋后独立编辑。</p>
  <fieldset id="geometry-controls"><legend>地标临时几何</legend>
  ${range('bevel-size','边倒角',.2,.005,.06)}${range('bevel-point','点倒角',.2,.005,0)}
  <p class="layer-hint">自动斜接外侧 · 均一长度采样。小部件会限制幅度，防止轮廓相交。</p>
  <label class="layer-check"><input id="bevel-harden" type="checkbox" checked> 硬化法向</label>
  ${range('building-smooth','物块平滑',1,.05,0)}${range('building-repeat','平滑重复',10,1,1,' 次')}
  </fieldset><p id="bevel-status" class="layer-hint" role="status"></p>
  <h3 class="layer-section">表面材质</h3><label class="layer-select">材质范围<select id="building-material"><option value="*">全部材质</option></select></label>
  ${range('material-scatter','表面散射',1,.05,0)}${range('material-refraction','折射 BSDF',1,.05,0)}
  <p class="layer-hint">折射使用实时屏幕空间采样，屏幕外物体不参与折射。</p>
  <h3 class="layer-section">外轮廓</h3>${range('outline-building','建筑勾边',6,1,0,' px')}${range('outline-asset','素材勾边',6,1,0,' px')}
  <h3 class="layer-section">沿街阵列</h3><p class="layer-hint">保留原落点，沿分布线增减显示数量。路口与入口功能牌保持原位。</p>
  ${range('array-lamps','沿街路灯数量',80,1,38,' 个')}${range('array-signs','沿街告示牌数量',100,1,50,' 个')}
  <button id="array-reset">恢复原沿街布置</button><p id="array-status" class="layer-hint" role="status"></p>`;
 const old=$('bevel-size').closest('label'),heading=old.previousElementSibling,status=$('bevel-status');heading.replaceWith(section);old.remove();status.remove();
 const target=$('building-edit-target');for(const e of entries){const option=document.createElement('option');option.value=e.instanceId;option.textContent=(e.kind==='landmark'?'地标 · ':'商店 · ')+(names.get(e.instanceId)?.name??e.instanceId);target.append(option);}
 function syncMaterials(){const select=$('building-material'),names=materials.materials(selected);select.replaceChildren(new Option('全部材质','*'),...names.map(n=>new Option(n,n)));if(!names.includes(materialKey))materialKey='*';select.value=materialKey;}
 function sync(){
  const e=entries.find(e=>e.instanceId===selected),p=geometry.getSettings(selected);target.value=selected??'';$('geometry-controls').disabled=!!e&&e.kind!=='landmark';$('building-focus').disabled=!selected;
  $('building-selection-status').textContent=selected?`已选中：${names.get(selected)?.name??selected}。${e?.kind==='landmark'?'以下参数只作用于这栋建筑。':'该建筑可编辑材质与勾边；临时倒角仅限地标。'}`:'编辑全部建筑与模型；临时几何仅作用于地标。';
  for(const [id,k]of [['bevel-size','edge'],['bevel-point','point'],['building-smooth','smooth'],['building-repeat','repeat']]){$(id).value=p[k];$(id+'-value').textContent=k==='repeat'?p[k]+' 次':Math.round(p[k]*100)+'%';}
  $('bevel-harden').checked=p.harden;syncMaterials();const m=materials.get(selected,materialKey);for(const k of ['scatter','refraction']){$('material-'+k).value=m[k]??0;$('material-'+k+'-value').textContent=Math.round((m[k]??0)*100)+'%';}
  $('outline-building').value=outlines.getBuilding(selected);$('outline-building-value').textContent=outlines.getBuilding(selected)+' px';$('outline-asset').value=outlines.snapshot().asset;$('outline-asset-value').textContent=outlines.snapshot().asset+' px';
  updateStatus();
 }
 async function select(id){if(id&&!entries.some(e=>e.instanceId===id))return false;selected=id||null;geometry.setActive(selected);outlines.set({selected});sync();if(id){await ensure([id]);sync();}void prepare();return true;}
 function updateStatus(){const s=geometry.snapshot(),rows=selected?s.rows.filter(r=>r.assetKey===selected):s.rows;let done=0,skipped=0,failed=0;for(const r of rows)for(const g of r.geometries){done+=g.applied?g.supported??0:0;skipped+=g.skipped??0;failed+=g.state==='failed'?1:0;}$('bevel-status').textContent=(s.preparing?'正在更新 · ':'')+`已调整 ${done} 个部件；保留原状 ${skipped} 个`+(failed?`；失败 ${failed} 项`:'');}
 function cancelPick(){picking=false;$('building-pick').setAttribute('aria-pressed','false');$('building-pick').textContent='点击建筑选择';}
 target.onchange=e=>void select(e.target.value);$('building-clear').onclick=()=>{cancelPick();void select(null);};
 $('building-pick').onclick=()=>{picking=!picking;$('building-pick').setAttribute('aria-pressed',String(picking));$('building-pick').textContent=picking?'正在选择建筑…':'点击建筑选择';if(picking)onPickStart();};
 $('building-focus').onclick=()=>selected&&focus(selected);
 for(const [id,k]of [['bevel-size','edge'],['bevel-point','point'],['building-smooth','smooth'],['building-repeat','repeat'],['bevel-harden','harden']])$(id).oninput=()=>{geometry.setSettings({[k]:k==='harden'?$(id).checked:Number($(id).value)},selected);sync();onChange();clearTimeout(timer);timer=setTimeout(prepare,160);};
 $('building-material').onchange=e=>{materialKey=e.target.value;sync();};
 for(const k of ['scatter','refraction'])$('material-'+k).oninput=e=>{materials.set({[k]:Number(e.target.value)},selected,materialKey);sync();onChange(true);};
 $('outline-building').oninput=e=>{outlines.set({building:Number(e.target.value)},selected);sync();};$('outline-asset').oninput=e=>{outlines.set({asset:Number(e.target.value)});sync();};
 const updateArray=()=>{const s=arrayController()?.snapshot();if(!s)return;for(const [id,k]of [['array-lamps','streetlight'],['array-signs','sign']]){$(id).max=s.capacity[k];$(id).value=s.requested[k];$(id+'-value').textContent=s.actual[k]+' 个';}$('array-status').textContent=`路灯 ${s.actual.streetlight} / ${s.requested.streetlight}；沿街牌 ${s.actual.sign} / ${s.requested.sign}；另保留 ${s.fixedSigns} 个固定功能牌。`;};
 for(const [id,k]of [['array-lamps','streetlight'],['array-signs','sign']])$(id).oninput=e=>{arrayController()?.setCount(k,Number(e.target.value));updateArray();onChange();};$('array-reset').onclick=()=>{arrayController()?.reset();updateArray();onChange();};
 sync();return {select,cancelPick,consumeHit:id=>{if(!picking)return false;if(!entries.some(e=>e.instanceId===id))return true;cancelPick();void select(id);onPicked();return true;},updateStatus,sync,updateArray,snapshot:()=>({selected,picking,materialKey})};
}
