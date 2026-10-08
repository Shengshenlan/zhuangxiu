import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createModel } from './model.js';
import { buildMeshes, triangulateFace, disposeGroup } from './geometry.js';
import { summarizeBudget } from './budget-tools.js';

const $ = id => document.getElementById(id);
const money = n => '¥' + Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const rooms = { all:'全屋', living:'客餐厅', master:'主卧', guest:'次卧', kitchen:'厨房', bath:'卫生间', balcony:'阳台' };
const stages = ['硬装施工', '入住必需', '入住后补'];
const model = createModel();
const storageKey = 'zhuangxiu-v7-20261008-budget';
const [baseBudget, sources] = await Promise.all(['budget.json', 'sources.json'].map(async url => { const r = await fetch(url); if (!r.ok) throw Error('无法读取 ' + url); return r.json(); }));
let budget = structuredClone(baseBudget);
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (Array.isArray(saved)) for (const r of budget) {
    const old = saved.find(o => o.id === r.id);
    if (old && Number.isFinite(old.planning) && old.planning >= 0 && old.planning <= 10000000) { r.planning = old.planning; r.included = !!old.included; }
  }
} catch { /* storage may be unavailable; current session remains editable */ }
const preferences = { room:'all', ceiling:'off', night:false, labels:false, routes:false };
let selected = null, data, building, ceilingGroup, routeGroup, selectionBox, renderer, controls, camera, scene, mainLight, ambient, environment, lightGroup;
let labelItems = [], movingTo = null;
const budgetRow = name => budget.find(b => b.name === name);
const originalRow = name => baseBudget.find(b => b.name === name);
const reference = name => sources.references.filter(s => s.budgetName === name);
function referenceHTML(name) {
  const found = reference(name);
  if (!found.length) return '<span class="muted">待询价 · 未核验同规格网价</span>';
  return found.map(r => `<a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">${escape(r.product)} · ${money(r.price)}</a><small>${escape(r.unit)}<br>${escape(r.status)} · ${sources.checkedOn}<br>${escape(r.note)}</small>`).join('');
}
function saveBudget() { try { localStorage.setItem(storageKey, JSON.stringify(budget.map(({id,planning,included}) => ({id,planning,included})))); } catch { $('view-status').textContent = '预算仅保留在本页；可导出 CSV 保存'; } }
function updateTotals() {
  const s = summarizeBudget(budget);
  $('totals').innerHTML = `<article><span>01 硬装资金</span><strong>${money(s.hardFund)}</strong><small>项目 ${money(s.phases[0])} + 应急金 ${money(s.contingency)}</small></article><article><span>02 入住必需</span><strong>${money(s.phases[1])}</strong><small>入住前累计 ${money(s.beforeMove)}</small></article><article><span>03 入住后补</span><strong>${money(s.phases[2])}</strong><small>后买设备，接口提前</small></article><article><span>全部纳入项目合计</span><strong>${money(s.total)}</strong><small>应急金仅计一次 · 电脑硬件另计</small></article>`;
  $('purchase-one').textContent = money(s.hardFund); $('purchase-two').textContent = money(s.phases[1]); $('purchase-three').textContent = money(s.phases[2]);
  $('upper').checked = budget.find(r => r.id === 'B42').included;
  $('upper').parentElement.lastChild.textContent = `八处扩充吊柜 · 加入预算 ${money(budget.find(r => r.id === 'B42').planning)}`;
  if (selected) showSelection(selected);
}
function renderBudget() {
  $('budget-rows').innerHTML = budget.map(r => `<tr data-row="${r.id}"><td><input type="checkbox" data-include="${r.id}" aria-label="纳入${escape(r.name)}" ${r.included?'checked':''}></td><td><strong>${escape(r.name)}</strong><small>${r.id} · 预留区间 ${money(r.low)}–${money(r.high)}</small><details><summary>范围与安装条件</summary><p>${escape(r.scope)}</p><p>${escape(r.note)}</p></details></td><td>${r.phase} ${stages[r.phase-1]}</td><td><input type="number" min="0" max="10000000" step="1" value="${r.planning}" data-price="${r.id}" aria-label="${escape(r.name)}规划金额"><small>方案预留，待报价</small></td><td>${referenceHTML(r.name)}</td></tr>`).join('');
  updateTotals();
}
function handleBudgetChange(event) {
  const input = event.target, id = input.dataset.include || input.dataset.price;
  if (!id) return; const row = budget.find(r => r.id === id);
  if (input.dataset.include) row.included = input.checked;
  else { if (input.value === '' || !input.validity.valid) { if(event.type==='change') input.value = row.planning; return; } row.planning = Number(input.value); }
  saveBudget(); updateTotals();
  if (id === 'B42') rebuild();
  renderObjects();
}
$('budget-rows').addEventListener('input', handleBudgetChange);
$('budget-rows').addEventListener('change', handleBudgetChange);
$('reset-budget').onclick = () => { budget = structuredClone(baseBudget); saveBudget(); renderBudget(); rebuild(); renderObjects(); };
$('export-budget').onclick = () => {
  const s = summarizeBudget(budget), cells = x => '"' + String(x).replace(/"/g,'""') + '"';
  const rows = [['编号','项目','阶段','纳入','规划金额','预留低值','预留高值','范围','备注','参考网价','来源','核验日期'], ...budget.map(r => [r.id,r.name,stages[r.phase-1],Number(r.included),r.planning,r.low,r.high,r.scope,r.note,reference(r.name).map(p => `${p.product} ${p.price}元/${p.unit}`).join('；') || '待询价',reference(r.name).map(p=>p.url).join('；'),sources.checkedOn]), ['', '一次应急金','硬装施工',1,s.contingency],['','入住前合计','','',s.beforeMove],['','全部合计','','',s.total]];
  download(new Blob(['\ufeff'+rows.map(r=>r.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'装修预算_V7_20261008.csv');
};
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

$('rooms').innerHTML = Object.entries(rooms).map(([id,name]) => `<button data-room="${id}" class="${id==='all'?'active':''}">${name}</button>`).join('');
$('rooms').onclick = e => { if (e.target.dataset.room) setRoom(e.target.dataset.room); };
function setRoom(room) {
  preferences.room = room;
  document.querySelectorAll('[data-room]').forEach(b => b.classList.toggle('active', b.dataset.room === room));
  updateRoomInfo();
  if (renderer) { rebuild(); moveCamera(room); }
  renderObjects();
}
function updateRoomInfo() {
  const room=preferences.room;
  let value=model.roomData[room].value, text=model.roomData[room].text;
  if(room==='master')value='脚边约 '+($('bed-length').value==='2.1'?'63':'73')+'cm';
  if(room==='bath'&&$('bath-layout').value==='inside')text='备选：洗漱台55×40cm放室内南墙，门改外侧移门；刷牙和淋浴仍共用湿区。门外两透气设备柜保留。门价、排水和站立空间另行核对。';
  $('room-title').textContent=room==='all'?'全屋 · 分阶段看新家':rooms[room]+' · '+value;
  $('room-copy').textContent=text;
}
function displayCost(c) {
  if (c.mode === 'existing') return '已有 · 不新增费用';
  if (c.mode === 'excluded') return '不计本次采购';
  if (c.mode === 'included') return '已含在整项预算';
  const b = budgetRow(c.budgetName), orig = originalRow(c.budgetName);
  let amount = c.price;
  if (b && orig) amount = c.mode === 'shared' ? b.planning : c.price * b.planning / orig.planning;
  return money(Math.round(amount)) + (c.mode === 'shared' ? ' / 整项共享' : ' / 分项预留');
}
function showSelection(id) {
  const c = model.objects[id]; if (!c) return;
  selected = id; const b = budgetRow(c.budgetName), inScene = !!data?.objectBounds[id];
  const length = Number($('bed-length').value), facing = $('bed-facing').value;
  let dimensions = c.dimensions, notes = c.notes;
  if (id === 'bed-main') { dimensions = `床架184×${Math.round((length+.08)*100)}cm；底最低梁16cm`; notes = `床头在图面${facing==='right'?'右':'左'}墙，脚边约${length===2.1?63:73}cm。完整床架尺寸、承重和受压净空按实物复核。`; }
  if (id === 'mattress-main') dimensions = `180×${length*100}cm`;
  if (['basin','bath-cab','bath-mirror'].includes(id)) dimensions = $('bath-layout').value === 'external' ? '洗漱柜占位70×45cm，门外干区' : '洗漱柜占位55×40cm，室内南墙；改外側移门';
  $('selection').hidden = false;
  $('selection').innerHTML = `<button class="close" aria-label="关闭物件详情">×</button><span class="eyebrow">${escape(c.id)} / ${rooms[c.room] || '全屋'}</span><h3>${escape(c.name)}</h3><span class="money">${displayCost(c)}</span><span class="badge">${stages[c.phase-1]}${!inScene?' · 当前场景未进场':''}${b && !b.included?' · 未纳入合计':''}</span><p><strong>尺寸</strong> ${escape(dimensions)}</p><p>${escape(notes)}</p><p class="muted">归属：${escape(c.budgetName)}${b?' · 整项 '+money(b.planning):''}。共享费用不重复相加。</p>${referenceHTML(c.budgetName)}<p class="muted">预算修改按原分配比例展示，待供应商逐项报价。</p>`;
  $('selection').querySelector('.close').onclick = () => { selected=null; $('selection').hidden=true; clearSelection(); };
  clearSelection();
  if (inScene && scene) {
    const {min,max}=data.objectBounds[id];
    selectionBox = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max)),0xb57935); scene.add(selectionBox);
  }
}
function clearSelection(){ if(selectionBox){scene.remove(selectionBox); selectionBox.geometry.dispose();selectionBox.material.dispose();selectionBox=null;} }
function renderObjects() {
  const term = $('object-search').value.toLowerCase();
  const items = model.catalog.filter(c => (preferences.room==='all'||c.room===preferences.room||c.relatedRoom===preferences.room||c.room==='all') && [c.name,c.id,c.budgetName,c.dimensions].join(' ').toLowerCase().includes(term));
  $('object-list').innerHTML = items.map(c => `<button data-object="${c.id}"><strong>${escape(c.name)}</strong><small>${displayCost(c)} · ${stages[c.phase-1]}${c.optional?' / 可选':''}</small></button>`).join('') || '<p>没有匹配的物件。</p>';
}
$('object-search').oninput = renderObjects;
$('object-list').onclick = e => {
  const button = e.target.closest('[data-object]'); if (!button) return;
  const c=model.objects[button.dataset.object];
  if (preferences.room !== 'all' && c.room !== preferences.room && c.relatedRoom !== preferences.room && c.room !== 'all') setRoom(c.room);
  showSelection(c.id);
  if (data?.objectBounds[c.id]) { const b=data.objectBounds[c.id], center=new THREE.Vector3().addVectors(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).multiplyScalar(.5); const offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(4); movingTo={position:center.clone().add(offset),target:center}; }
  $('viewer').scrollIntoView({behavior:'smooth',block:'start'});
};

function moveCamera(room, top=false) {
  if (!camera) return;
  const info=model.roomData[room], target=new THREE.Vector3(...info.target);
  const poly=room==='all'?model.footprint:model.floors[room];
  const spanX=Math.max(...poly.map(p=>p[0]))-Math.min(...poly.map(p=>p[0]));
  const spanZ=Math.max(...poly.map(p=>p[1]))-Math.min(...poly.map(p=>p[1]));
  const distance=room==='all'?15.5:Math.max(5.4, Math.max(spanX,spanZ)*1.6);
  const offset = top ? new THREE.Vector3(0,distance,.001) : new THREE.Vector3(.78,.98,1).normalize().multiplyScalar(distance);
  movingTo={target,position:target.clone().add(offset)};
}
function ceilingFaces(room, y) {
  const poly=model.floors[room], points=poly.map(([x,z])=>[x,y,z]);
  const faces=[{v:points,n:[0,-1,0],color:'#eeeade',room,objectId:['kitchen','bath'].includes(room)?'vent':'construction-wall'}];
  faces.push({v:points.map(p=>[p[0],p[1]+.065,p[2]]),n:[0,1,0],color:'#eeede8',room,objectId:faces[0].objectId});
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];faces.push({v:[a,b,[b[0],y+.065,b[2]],[a[0],y+.065,a[2]]],n:[b[2]-a[2],0,a[0]-b[0]],color:'#d3d6cb',room,objectId:faces[0].objectId});}
  return faces;
}
function rebuild() {
  if(!renderer)return;
  updateRoomInfo();
  clearSelection();
  for(const g of [building,ceilingGroup,routeGroup,lightGroup]) if(g){scene.remove(g);disposeGroup(g);}
  data=model.build({phase:Number($('phase').value),walls:$('walls').value,bedLength:Number($('bed-length').value),bedFacing:$('bed-facing').value,bathLayout:$('bath-layout').value,topCabs:$('upper').checked,electrical:$('electrical').checked,lighting:true});
  const lifted=preferences.ceiling==='lift';
  const ceilingLights=new Set(data.lightFixtures.filter(l=>l.type==='ceiling').map(l=>l.id));
  const faces=data.faces.map(f=>lifted&&ceilingLights.has(f.objectId)?{...f,v:f.v.map(p=>[p[0],p[1]+1.35,p[2]])}:f);
  building=buildMeshes(faces,{room:preferences.room,catalog:model.objects,night:preferences.night});scene.add(building);
  ceilingGroup=new THREE.Group();
  if(preferences.ceiling!=='off') {
    for(const room of Object.keys(model.floors)){
      if(preferences.room!=='all'&&room!==preferences.room)continue;
      const g=buildMeshes(ceilingFaces(room,2.7+(lifted?1.35:0)));
      g.traverse(m=>{if(m.material){m.material.transparent=preferences.ceiling!=='solid';m.material.opacity=preferences.ceiling==='ghost'?.10:lifted?.4:1;m.material.depthWrite=preferences.ceiling==='solid';m.castShadow=false;}});
      ceilingGroup.add(g);
      const linePts=model.floors[room].map(([x,z])=>new THREE.Vector3(x,2.77+(lifted?1.35:0),z));linePts.push(linePts[0]);
      ceilingGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts),new THREE.LineBasicMaterial({color:0xa0ae9d,transparent:true,opacity:.5})));
    }
  }scene.add(ceilingGroup);
  lightGroup=new THREE.Group();
  if(preferences.night)for(const l of data.lightFixtures){
    if(!model.objectVisible(model.objects[l.id]))continue;
    if(preferences.room!=='all'&&l.room!==preferences.room&&model.objects[l.id]?.relatedRoom!==preferences.room)continue;
    const light=new THREE.PointLight(0xffdfac,l.type==='ceiling'?10:2,l.type==='ceiling'?6:2,2);
    light.position.set(l.x,l.y-.06,l.z);lightGroup.add(light);
  }
  scene.add(lightGroup);
  scene.background.set(preferences.night?'#29352f':'#e9eee5');scene.environmentIntensity=preferences.night?.12:.35;
  mainLight.intensity=preferences.night?.12:1.8;ambient.intensity=preferences.night?.24:1.05;
  routeGroup=new THREE.Group();
  if(preferences.routes){
    for(const route of model.robotRoutes[`${model.state.bedFacing}-${model.state.bedLength}`]){
      if(preferences.room!=='all'&&route.room!==preferences.room)continue;
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.points.map(([x,z])=>new THREE.Vector3(x,.05,z))),new THREE.LineBasicMaterial({color:0x128b78,depthTest:false,transparent:true,opacity:.85}));line.renderOrder=10;routeGroup.add(line);
    }
  }scene.add(routeGroup);
  labelItems=[]; $('labels').replaceChildren();
  if(preferences.labels)for(const p of data.electricalPoints){
    if(preferences.room!=='all'&&p.room!==preferences.room)continue;
    const label=document.createElement('span');label.className='point-label';label.textContent=p.id; $('labels').append(label);labelItems.push({element:label,position:new THREE.Vector3(p.x,p.y+.1,p.z)});
  }
  const ids=new Set(building.children.map(o=>o.userData.objectId).filter(Boolean));
  $('visible-count').textContent=`${ids.size} 个场景物件 / 144 项全清单`;
  $('view-status').textContent=`${rooms[preferences.room]} · ${stages[model.state.phase-1]}${preferences.routes?' · 路线依原方案，非实机测试':''}${lifted?' · 顶面抬高1.35m展示':''}`;
  if(selected)showSelection(selected);
}
function init3D(){
  const host=$('canvas-host');
  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.prepend(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#e9eee5');
  camera=new THREE.PerspectiveCamera(43,1,.05,120);camera.position.set(12,11,15);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(4.65,.4,4.45);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.65;controls.maxDistance=28;controls.maxPolarAngle=Math.PI*.49;controls.addEventListener('start',()=>movingTo=null);
  const pmrem=new THREE.PMREMGenerator(renderer), envRoom=new RoomEnvironment(); environment=pmrem.fromScene(envRoom,.04);scene.environment=environment.texture;envRoom.dispose();pmrem.dispose();
  ambient=new THREE.HemisphereLight(0xfffaf0,0x718374,1.6);scene.add(ambient);
  mainLight=new THREE.DirectionalLight(0xfff3de,2.8);mainLight.position.set(-1,12,10);mainLight.target.position.set(4,0,4);mainLight.castShadow=true;mainLight.shadow.mapSize.set(2048,2048);Object.assign(mainLight.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:.5,far:30});mainLight.shadow.normalBias=.015;mainLight.shadow.bias=-.0001;scene.add(mainLight,mainLight.target);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.16}));ground.rotation.x=-Math.PI/2;ground.position.y=-.16;ground.receiveShadow=true;scene.add(ground);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let start;
  renderer.domElement.addEventListener('pointerdown',e=>start=[e.clientX,e.clientY]);
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>5||e.button!==0)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    const candidates=[...building.children,...(preferences.ceiling==='solid'?ceilingGroup.children:[])];
    const hit=raycaster.intersectObjects(candidates,true).find(h=>model.objects[h.object.userData.objectId]);
    if(hit)showSelection(hit.object.userData.objectId);
  });
  new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}).observe(host);
  renderer.setAnimationLoop(()=>{
    if(movingTo){camera.position.lerp(movingTo.position,.13);controls.target.lerp(movingTo.target,.13);if(camera.position.distanceTo(movingTo.position)<.005)movingTo=null;}
    controls.update();renderer.render(scene,camera);
    for(const {element,position}of labelItems){const p=position.clone().project(camera);element.style.display=p.z>1||p.z< -1?'none':'block';element.style.left=(p.x*.5+.5)*host.clientWidth+'px';element.style.top=(-p.y*.5+.5)*host.clientHeight+'px';}
  });
  rebuild();moveCamera('all');
}
$('phase').onchange=rebuild;$('walls').onchange=rebuild;$('electrical').onchange=rebuild;
for(const id of ['bed-length','bed-facing','bath-layout'])$(id).onchange=()=>{rebuild();if(selected)showSelection(selected);};
$('ceiling').onchange=()=>{preferences.ceiling=$('ceiling').value;rebuild();};
$('night').onchange=()=>{preferences.night=$('night').checked;rebuild();};
$('point-labels').onchange=()=>{preferences.labels=$('point-labels').checked;rebuild();};
$('routes').onchange=()=>{preferences.routes=$('routes').checked;rebuild();};
$('upper').onchange=()=>{budget.find(r=>r.id==='B42').included=$('upper').checked;saveBudget();renderBudget();rebuild();};
$('top-view').onclick=()=>moveCamera(preferences.room,true);$('reset-view').onclick=()=>moveCamera(preferences.room);
$('save-view').onclick=async()=>{
  if(!renderer)return;renderer.render(scene,camera);
  const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));
  download(blob,`装修V7-${preferences.room}-${preferences.night?'night':'day'}.png`);
  // Local preview server can retain the same export; static hosting needs no endpoint.
  try{await fetch('./__preview/'+preferences.room+'-'+(preferences.night?'night':'day')+'.png',{method:'POST',body:blob});}catch{}
  $('view-status').textContent='已导出当前视图图片';
};
renderBudget();setRoom('all');
try{init3D();}catch(error){console.error(error);$('load-error').hidden=false;$('load-error').textContent='三维画面未能加载，请使用支持 WebGL 的浏览器。下面的预算与清单仍可查看。';$('view-status').textContent='三维加载失败';}
