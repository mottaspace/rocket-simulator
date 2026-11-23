// 3D 로켓 체험: 조립(격납고) → 비행 → 궤도·위성 배치 → 관제 지도
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { PLANET, V, Rocket3D, Autopilot, horizon, satElements, satPosition, normalizeDesign, makeWeather, WEATHERS, launchCriteria, windSpeed, FLAMES } from './physics3d.js';
import { World, TIERS, TIER_ORDER, SUN_DIR, softTexture, loadEarth, LAUNCH_SITE } from './world.js';
import { buildRocket, buildCanopy, buildSatellite, makeFlame, flameMat, ionFlameMat, setFlameType } from './rocketModel.js';
import { Builder } from './builder.js';

const { PARTS } = window.Parts;
const $ = id => document.getElementById(id);
const fmtN = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtDist = m => !isFinite(m) ? '∞' : Math.abs(m) >= 10000 ? fmtN(m / 1000, 1) + ' km' : fmtN(Math.round(m)) + ' m';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
};

// ───────── 품질 ─────────
const isMobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
let qualityMode = store.get('rocket3d.quality', 'auto');
let tierKey = qualityMode === 'auto' ? (isMobile ? 'medium' : 'high') : qualityMode;
let tier = TIERS[tierKey];

// ───────── 렌더러 ─────────
const canvas = $('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: tierKey !== 'low', logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(tier.pixelRatio);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// ───────── 비행 장면 ─────────
const scene = new THREE.Scene();
scene.environment = env;
scene.fog = new THREE.Fog(0x8fb0d8, 4000, 90000);
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2e8);
const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a3320, 0.35);
const sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
scene.add(hemi, sun, sun.target);
// NASA 지구 사진을 먼저 불러옴 (실패하면 코드로 만든 행성으로 대신)
const earth = await loadEarth(tierKey).catch(e => { console.warn('지구 사진을 불러오지 못했어요', e); return null; });
let world = new World(scene, tier, renderer, earth);

const rocketGroup = new THREE.Group(); scene.add(rocketGroup);
let rocketModel = null, modelVersion = -1, flames = [];
const canopy = buildCanopy(); canopy.visible = false; rocketGroup.add(canopy);
const debrisModels = new Map();
const dotTex = softTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, depthTest: false, fog: false, color: 0xffe08a }));
marker.renderOrder = 10; scene.add(marker);
const ORB_N = 360;
function makeLine(color, opacity) {
  const l = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array((ORB_N + 1) * 3), 3)),
    new THREE.LineBasicMaterial({ color, fog: false, transparent: opacity < 1, opacity }));
  l.frustumCulled = false; return l;
}
const orbitLine = makeLine(0x5ab0ff, 1); scene.add(orbitLine);

// ───────── 후처리 (블룸) ─────────
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 2.2); // 아주 밝은 것(불꽃·태양)만 번지게
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());

// ───────── 우주(위성) 목록: 이 기기에 저장, 실제 시간에 맞춰 공전 ─────────
let clockExtra = 0;                                   // 시간 배속으로 앞당긴 시간(ms)
const uniNow = () => Date.now() + clockExtra;
function seedSats() {
  // 처음 실행 때 보여 줄 샘플 위성 2개 (누구의 것인지 '샘플'로 표시)
  const t = Date.now(), mk = (name, type, alt, incl, phase) => {
    const r = PLANET.R + alt, vC = Math.sqrt(PLANET.mu / r);
    const pos = [r * Math.cos(phase), r * Math.sin(phase), 0];
    const vel = [-vC * Math.sin(phase) * Math.cos(incl), vC * Math.cos(phase) * Math.cos(incl), vC * Math.sin(incl)];
    return { id: 'sample-' + name, name, type, owner: '샘플', epoch: t, r: pos, v: vel };
  };
  return [mk('샘플 통신위성', 'comm', 90000, 0.15, 1.2), mk('샘플 관측위성', 'obs', 140000, 0.9, 3.6)];
}
let sats = store.get('rocket3d.sats', null);
if (!sats) { sats = seedSats(); store.set('rocket3d.sats', sats); }
const satViews = new Map();
function satView(s) {
  if (satViews.has(s.id)) return satViews.get(s.id);
  const el = satElements(s.r, s.v, s.epoch);
  const model = buildSatellite(s.type, 20, true); model.visible = false; scene.add(model);
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, depthTest: true, fog: false, color: s.owner === '나' ? 0x7dff9b : 0xffffff }));
  dot.visible = false; scene.add(dot);
  const line = makeLine(s.owner === '나' ? 0x7dff9b : 0x8a96b8, 0.45); line.visible = false; scene.add(line);
  const v = { el, model, dot, line, s, spin: Math.random() * 6 };
  satViews.set(s.id, v);
  return v;
}

// ───────── 상태 ─────────
let mode = 'build';
let rk = null, design = null, designName = '', autopilot = null, ended = false, map = false, warpIdx = 0, lastEvent = 0, shipSatId = null;
const WARPS = [1, 2, 4, 10, 50, 200];

const builder = new Builder({ renderer, canvas, env, getTier: () => tierKey, onLaunch: (d, name) => briefing(d, name), sheet: (h, a) => sheet(h, a) });
let weatherKey = store.get('rocket3d.weather', 'clear'), weather = makeWeather(weatherKey);

function setMode(m) {
  mode = m; builder.active = m === 'build';
  document.body.classList.toggle('mode-build', m === 'build');
  document.body.classList.toggle('mode-flight', m === 'flight');
  closeSheet();
  resize();
}

function rebuildModel() {
  if (rocketModel) { rocketGroup.remove(rocketModel.group); rocketModel.group.traverse(o => o.geometry && o.geometry.dispose()); }
  flames.forEach(f => rocketGroup.remove(f)); flames = [];
  if (rk.isSatellite && rk.deployedSat && rk.deployedSat.ok) {
    const type = PARTS[rk.segs[0].ids.find(id => PARTS[id].kind === 'sat')].sat;
    rocketModel = { group: buildSatellite(type, 24, true), height: 2.2, nozzles: [] };
  } else rocketModel = buildRocket(rk.parts, tierKey, { name: designName, balloonUp: rk.balloon === 'rising', sailOpen: rk.sailOpen, fairing: rk.fairing !== 'off' });
  modelSail = rk.sailOpen; modelBalloon = rk.balloon;
  rocketGroup.add(rocketModel.group);
  canopy.position.y = rocketModel.height;
  for (const nz of rocketModel.nozzles) { const f = makeFlame(nz[4]); f.position.set(nz[0], nz[1], nz[2]); f.userData.size = nz[3]; f.userData.kind = nz[4]; rocketGroup.add(f); flames.push(f); }
  modelVersion = rk.version;
}

let modelSail = false, modelBalloon = 'none', lastStrike = -1;
function startFlight(d, name) {
  if (d) { design = normalizeDesign(d); designName = name || '나만의 로켓'; }
  weather = makeWeather(weatherKey);
  world.setWeather(weather);
  rk = new Rocket3D(design, weather);
  setFlameType(FLAMES[design.flame] || FLAMES.kerosene); lastStrike = -1;
  autopilot = null; ended = false; lastEvent = 0; warpIdx = 0; map = false; shipSatId = null;
  $('mapBtn').classList.remove('on');
  debrisModels.forEach(m => scene.remove(m.group)); debrisModels.clear();
  setSas('off'); setThrottle(1);
  rebuildModel();
  cam.dist = Math.max(30, rocketModel.height * 2.6); cam.el = 0.12; cam.az = 0.5;
  setMode('flight');
}

// ───────── 발사 전 브리핑 (날씨·발사 기준) ─────────
function briefing(d, name) {
  const opts = Object.values(WEATHERS).concat([{ key: 'random', name: '무작위', icon: '🎲' }]);
  const render = () => {
    const w = weatherKey === 'random' ? null : makeWeather(weatherKey);
    const crit = w ? launchCriteria(w) : null, go = crit ? crit.every(c => c.ok) : null;
    sheet('<h2>🚀 발사 브리핑</h2><p class="muted">' + esc(name) + ' · 발사장: ' + LAUNCH_SITE.name + ' (실제의 1/16 크기로 줄인 지구)</p><b>오늘의 날씨</b><div class="qrow" id="wrow">' +
      opts.map(o => `<button data-w="${o.key}" class="${weatherKey === o.key ? 'on' : ''}">${o.icon} ${o.name}</button>`).join('') + '</div>' +
      (w ? '<table class="rank"><thead><tr><th>발사 기준</th><th class="n">지금</th><th class="n">판정</th></tr></thead><tbody>' +
        crit.map(c => `<tr><td>${c.text}</td><td class="n">${c.now}</td><td class="n ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'GO' : 'NO-GO'}</td></tr>`).join('') + '</tbody></table>' +
        `<p class="${go ? 'pass' : 'fail'}">${go ? '✔ 발사 가능 (GO)' : '⚠ 기준을 넘었어요 (NO-GO). 실제라면 발사를 미뤄요. 그래도 도전할 수 있지만 위험해요!'}</p>` +
        '<p class="muted">' + ({ clear: '바람이 약하고 맑아요.', cloudy: '구름층을 뚫고 올라가요. 실험실이 있으면 구름 속 물방울을 채집할 수 있어요.', windy: '강한 옆바람과 제트기류! 발사탑에 부딪히거나, 날개가 없으면 자세가 흔들릴 수 있어요.', storm: '비와 번개! 번개를 맞으면 장치가 잠시 멈출 수 있어요(아폴로 12호처럼).' }[w.key]) + '</p>'
        : '<p class="muted">발사할 때 날씨가 무작위로 정해져요.</p>'),
      [{ label: '조립으로', fn: () => {} }, { label: '발사대로 ▶', primary: true, fn: () => startFlight(d, name) }]);
    document.querySelectorAll('#wrow button').forEach(b => b.onclick = () => { weatherKey = b.dataset.w; store.set('rocket3d.weather', weatherKey); render(); });
  };
  render();
}

// ───────── 카메라 조작 ─────────
const cam = { az: 0.5, el: 0.12, dist: 40 };
const mapCam = { az: Math.PI / 2 + 0.4, el: 0.38, dist: PLANET.R * 3.2 };
const pointers = new Map(); let pinchPrev = 0;
canvas.addEventListener('pointerdown', e => { if (mode !== 'flight') return; canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
canvas.addEventListener('pointermove', e => {
  if (mode !== 'flight' || !pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
  const c = map ? mapCam : cam;
  if (pointers.size === 1) { c.az -= (e.clientX - prev[0]) * 0.006; c.el = Math.max(-1.3, Math.min(1.45, c.el + (e.clientY - prev[1]) * 0.006)); }
  else if (pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinchPrev) zoom(pinchPrev / d); pinchPrev = d; }
});
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchPrev = 0; };
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => { if (mode !== 'flight') return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
function zoom(f) {
  if (map) mapCam.dist = Math.max(PLANET.R * 1.4, Math.min(PLANET.R * 40, mapCam.dist * f));
  else cam.dist = Math.max(8, Math.min(5000, cam.dist * f));
}

// ───────── 조종 입력 ─────────
const joy = [0, 0];
(function stick() {
  const el = $('stick'), knob = $('stickKnob'); let id = null;
  const set = e => {
    const r = el.getBoundingClientRect(), max = r.width / 2 - 24;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy); if (l > max) { dx *= max / l; dy *= max / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; joy[0] = dx / max; joy[1] = -dy / max;
    if (Math.hypot(joy[0], joy[1]) > 0.2 && autopilot) setSas('off');
  };
  el.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); set(e); });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
  const up = e => { if (e.pointerId !== id) return; id = null; joy[0] = joy[1] = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
})();
const keys = new Set();
window.addEventListener('keydown', e => {
  if (mode !== 'flight' || !$('sheetBg').hidden || e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) rk.stage(); }
  else if (e.code === 'KeyZ') setThrottle(1);
  else if (e.code === 'KeyX') setThrottle(0);
  else if (e.code.startsWith('Shift')) setThrottle(rk.throttle + 0.1);
  else if (e.code.startsWith('Control')) setThrottle(rk.throttle - 0.1);
  else if (e.code === 'KeyM') $('mapBtn').click();
  else if (e.code === 'KeyT') setSas(autopilot ? 'off' : 'auto');
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && autopilot) setSas('off');
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function setThrottle(v) {
  v = Math.max(0, Math.min(1, v)); if (rk) rk.throttle = v;
  $('thFill').style.height = (v * 100) + '%';
  $('thKnob').style.bottom = 'calc(' + (v * 100) + '% - ' + (v * 6) + 'px)';
  $('thVal').textContent = Math.round(v * 100) + '%';
}
(function throttleDrag() {
  const el = $('throttle');
  const set = e => { const r = el.getBoundingClientRect(); setThrottle(1 - (e.clientY - r.top) / r.height); if (autopilot) setSas('off'); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) set(e); });
})();
$('thMax').onclick = () => setThrottle(1);
$('thCut').onclick = () => setThrottle(0);
function setSas(m) {
  if (m === 'auto') autopilot = new Autopilot(rk); else { autopilot = null; if (rk) rk.sas = m; }
  document.querySelectorAll('.sas button').forEach(b => b.classList.toggle('on', b.dataset.sas === m));
}
document.querySelectorAll('.sas button').forEach(b => b.onclick = () => setSas(b.dataset.sas));
$('stageBtn').onclick = () => rk.stage();
$('mapBtn').onclick = () => { map = !map; $('mapBtn').classList.toggle('on', map); if (map) fitMap(); };
$('warpBtn').onclick = () => { warpIdx = (warpIdx + 1) % WARPS.length; };
function fitMap(extra) {
  let far = PLANET.R * 1.2;
  const ob = rk && rk.lifted ? rk.orbit() : null;
  if (ob && !ob.escape && isFinite(ob.ap)) far = Math.max(far, ob.ap + PLANET.R);
  if (extra) for (const s of sats) { const v = satView(s); if (v.el) far = Math.max(far, v.el.a * (1 + v.el.e)); }
  const halfV = camera.fov * Math.PI / 360, halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  mapCam.dist = Math.min(PLANET.R * 40, Math.max(PLANET.R * 2, far * 1.15 / Math.tan(Math.min(halfV, halfH))));
}

// ───────── 시트·메뉴 ─────────
function sheet(html, actions) {
  $('sheetBody').innerHTML = html;
  const box = $('sheetActions'); box.innerHTML = '';
  (actions || [{ label: '닫기' }]).forEach(a => {
    const b = document.createElement('button'); b.textContent = a.label; if (a.primary) b.className = 'primary';
    b.onclick = () => { if (!a.keep) closeSheet(); if (a.fn) a.fn(); }; box.appendChild(b);
  });
  $('sheetBg').hidden = false;
}
function closeSheet() { $('sheetBg').hidden = true; }
let toastTimer = 0;
function toast(text, bad, ms) {
  const t = $('toast'); t.textContent = text; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

function qualityHtml() {
  const opts = [['auto', '자동'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']];
  return '<b>그래픽 품질</b><div class="qrow" id="qrow">' + opts.map(([k, n]) => `<button data-q="${k}" class="${qualityMode === k ? 'on' : ''}">${n}</button>`).join('') + '</div><p class="muted">지금: ' + tier.name + ' · ' + esc(gpuName()) + '</p>';
}
function bindQuality() {
  document.querySelectorAll('#qrow button').forEach(b => b.onclick = () => {
    qualityMode = b.dataset.q; store.set('rocket3d.quality', qualityMode);
    applyTier(qualityMode === 'auto' ? (isMobile ? 'medium' : 'high') : qualityMode);
    document.querySelectorAll('#qrow button').forEach(x => x.classList.toggle('on', x === b));
  });
}
function showMenu() {
  if (mode === 'build') {
    sheet('<h2>메뉴</h2>' + qualityHtml() + '<p class="muted">부품 누르기: 쌓기 · 로켓의 부품 누르기: 선택(▲▼ 이동, 🗑 삭제) · 측면 부스터: 탱크를 선택하고 누르면 옆에 붙어요(대칭 2·3·4).</p>',
      [{ label: '성능 측정 (40초)', fn: startBench }, { label: '2D 버전', fn: () => { location.href = '../index.html'; } }, { label: '닫기', primary: true }]);
  } else {
    sheet('<h2>비행 메뉴</h2><p class="muted">로켓: ' + esc(designName) + '</p>' + qualityHtml() +
      '<p class="muted">조이스틱(WASD): 기울이기 · 화면 끌기: 시점 · 두 손가락/휠: 확대 · Space: 단 분리 · T: 자동 비행 · M: 지도</p>',
      [{ label: '조립으로', fn: () => setMode('build') }, { label: '처음부터', fn: () => startFlight() }, { label: '성능 측정', fn: startBench }, { label: '계속하기', primary: true }]);
  }
  bindQuality();
}
$('menuBtn').onclick = showMenu; $('perfPill').onclick = showMenu; $('bMenu').onclick = showMenu;
$('bUniverse').onclick = () => showUniverse();

function showUniverse() {
  const rows = sats.map(s => { const v = satView(s); return `<tr><td>${esc(s.name)}</td><td>${esc(s.owner)}</td><td class="n">${v.el ? fmtDist(v.el.pe) + ' ~ ' + fmtDist(v.el.ap) : '-'}</td><td class="n">${v.el ? fmtN(v.el.period / 60, 1) + '분' : '-'}</td></tr>`; }).join('');
  sheet('<h2>🛰 우리 우주의 인공위성</h2><p class="muted">궤도에 올린 위성은 이 기기에 저장되어 실제 시간에 맞춰 계속 공전해요. (반 친구들과 함께 보는 공유 우주는 다음 단계에서 Firestore로 연결합니다.)</p>' +
    '<table class="rank"><thead><tr><th>이름</th><th>주인</th><th class="n">고도</th><th class="n">한 바퀴</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4">아직 위성이 없어요.</td></tr>') + '</tbody></table>',
    [{ label: '내 위성 모두 지우기', fn: () => { sats = sats.filter(s => s.owner !== '나'); store.set('rocket3d.sats', sats); satViews.forEach(v => { scene.remove(v.model, v.dot, v.line); }); satViews.clear(); } },
     { label: '관제 지도에서 보기', primary: true, fn: () => { const d = design || builder.design; startFlight(d, designName || builder.name); map = true; $('mapBtn').classList.add('on'); fitMap(true); } }]);
}

function applyTier(key) {
  if (key === tierKey) return;
  tierKey = key; tier = TIERS[key];
  world.build(tier);
  renderer.setPixelRatio(tier.pixelRatio);
  resize();
  if (rk) rebuildModel();
  builder.rebuild();
  perf.lastChange = performance.now();
}
let gpu = null;
function gpuName() {
  if (gpu) return gpu;
  try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { gpu = '알 수 없음'; }
  return (gpu = String(gpu).replace(/ANGLE \((.*)\)/, '$1').slice(0, 60));
}

// ───────── 성능 측정 ─────────
const perf = { frames: [], fps: 0, lastChange: 0, windowStart: performance.now(), count: 0 };
let bench = null;
function startBench() {
  startFlight({ stack: ['chute', 'pod', 'tankM', 'engS', 'dec', 'tankL', 'engL'], radial: [] }, '성능 측정용 로켓');
  setSas('auto');
  bench = { t0: performance.now(), dts: [], tier: tierKey };
  toast('성능 측정 — 40초 동안 자동 비행합니다');
}
function finishBench() {
  const dts = bench.dts.slice().sort((a, b) => a - b);
  const avg = 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length), low = 1000 / dts[Math.floor(dts.length * 0.99)];
  const rec = { date: new Date().toISOString().slice(0, 16).replace('T', ' '), tier: TIERS[bench.tier].name, avg: Math.round(avg), low: Math.round(low), gpu: gpuName(), px: canvas.width + '×' + canvas.height };
  const hist = [rec].concat(store.get('rocket3d.bench', [])).slice(0, 8);
  store.set('rocket3d.bench', hist); bench = null;
  const pass = rec.avg >= 30;
  sheet('<h2>성능 측정 결과</h2><p class="' + (pass ? 'pass' : 'fail') + '">' + (pass ? '통과: 평균 30fps 이상' : '미달: 평균 30fps 미만 — 품질을 낮춰 다시 측정해 보세요') + '</p>' +
    '<div class="bench-grid"><div><span>평균</span><b>' + rec.avg + ' fps</b></div><div><span>가장 느린 1%</span><b>' + rec.low + ' fps</b></div><div><span>그래픽 품질</span><b>' + rec.tier + '</b></div><div><span>렌더 해상도</span><b>' + rec.px + '</b></div></div>' +
    '<p class="muted">GPU: ' + esc(rec.gpu) + '</p><b>이 기기의 측정 기록</b><table class="rank"><thead><tr><th>시각</th><th>품질</th><th class="n">평균</th><th class="n">1%</th></tr></thead><tbody>' +
    hist.map(h => '<tr><td>' + h.date.slice(5) + '</td><td>' + h.tier + '</td><td class="n">' + h.avg + '</td><td class="n">' + h.low + '</td></tr>').join('') + '</tbody></table>',
    [{ label: '다시 측정', fn: startBench }, { label: '조립으로', fn: () => setMode('build') }, { label: '닫기', primary: true }]);
}
function trackPerf(now, dtMs) {
  perf.count++;
  if (bench) { if (now - bench.t0 > 2000) bench.dts.push(dtMs); if (now - bench.t0 > 42000) finishBench(); }
  if (now - perf.windowStart < 1000) return;
  perf.fps = perf.count * 1000 / (now - perf.windowStart);
  perf.frames.push(perf.fps); if (perf.frames.length > 3) perf.frames.shift();
  perf.count = 0; perf.windowStart = now;
  $('perfPill').textContent = '그래픽 ' + tier.name + (qualityMode === 'auto' ? '(자동)' : '') + ' · ' + Math.round(perf.fps) + ' fps' + (bench ? ' · 측정 중' : '');
  const avg = perf.frames.reduce((a, b) => a + b, 0) / perf.frames.length;
  if (qualityMode === 'auto' && !bench && $('sheetBg').hidden && perf.frames.length === 3 && avg < 26 && avg > 4 /* 4fps 미만은 백그라운드 탭 절전으로 봄 */ && now - perf.lastChange > 6000 && !document.hidden) {
    const i = TIER_ORDER.indexOf(tierKey);
    if (i < TIER_ORDER.length - 1) { applyTier(TIER_ORDER[i + 1]); perf.frames = []; toast('화면이 느려서 그래픽을 ' + tier.name + '(으)로 낮췄어요'); }
  }
}

// ───────── 그리기 도우미 ─────────
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const v3 = (a, out = new THREE.Vector3()) => out.set(a[0], a[1], a[2]);
function orient(obj, fwd, pos) {
  const hz = horizon(pos), Y = v3(fwd);
  const X = new THREE.Vector3().crossVectors(Y, v3(hz.north)); if (X.lengthSq() < 1e-6) X.crossVectors(Y, v3(hz.east));
  X.normalize();
  tmpM.makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y));
  obj.quaternion.setFromRotationMatrix(tmpM);
}
function viewAxes(up) {
  const f = camera.getWorldDirection(new THREE.Vector3()), u = v3(up);
  let F = f.clone().addScaledVector(u, -f.dot(u)); if (F.lengthSq() < 1e-6) F = camera.up.clone().addScaledVector(u, -camera.up.dot(u));
  F.normalize();
  const R = new THREE.Vector3().crossVectors(F, u).normalize();
  return { F: [F.x, F.y, F.z], R: [R.x, R.y, R.z] };
}
function updateCamera(hz) {
  if (map) {
    const c = mapCam, center = v3(V.mul(rk.pos, -1));
    camera.position.copy(center).add(new THREE.Vector3(Math.cos(c.el) * Math.cos(c.az), Math.cos(c.el) * Math.sin(c.az), Math.sin(c.el)).multiplyScalar(c.dist));
    camera.up.set(0, 0, 1); camera.lookAt(center);
  } else {
    const target = v3(V.mul(rk.fwd, rocketModel.height * 0.5));
    const el = Math.max(rk.alt < cam.dist ? 0.03 : -1.3, cam.el), c = Math.cos(el);
    camera.position.copy(target).add(v3(V.add(V.add(V.mul(hz.north, c * Math.cos(cam.az)), V.mul(hz.east, c * Math.sin(cam.az))), V.mul(hz.up, Math.sin(el)))).multiplyScalar(cam.dist));
    camera.up.copy(v3(hz.up)); camera.lookAt(target);
  }
  camera.updateMatrixWorld();
}
function fillOrbit(line, el, center) {
  const arr = line.geometry.attributes.position.array;
  for (let i = 0; i <= ORB_N; i++) {
    const nu = -Math.PI + 2 * Math.PI * i / ORB_N;
    let p;
    if (el.isOrbit) { const r = el.p / (1 + el.e * Math.cos(nu)); p = V.add(center, V.add(V.mul(el.P, r * Math.cos(nu)), V.mul(el.Q, r * Math.sin(nu)))); }
    else { const E = nu, x = el.a * (Math.cos(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E); p = V.add(center, V.add(V.mul(el.P, x), V.mul(el.Q, y))); }
    arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
  }
  line.geometry.attributes.position.needsUpdate = true;
}
const labelsEl = $('labels');
function addLabel(p, cls, text) {
  tmpV.set(p[0], p[1], p[2]).project(camera);
  if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) return;
  const d = document.createElement('div'); d.className = 'olabel ' + cls; d.textContent = text;
  d.style.left = ((tmpV.x + 1) / 2 * canvas.clientWidth) + 'px'; d.style.top = ((1 - tmpV.y) / 2 * canvas.clientHeight) + 'px';
  labelsEl.appendChild(d);
}

function updateOrbitView() {
  labelsEl.innerHTML = '';
  const ob = rk.lifted ? rk.orbit() : null;
  orbitLine.visible = map && !!ob && !ob.flat && !ob.escape;
  marker.visible = map;
  const center = V.mul(rk.pos, -1);
  if (map) {
    const k = mapCam.dist * 0.012; marker.scale.set(k, k, 1);
    if (orbitLine.visible) {
      fillOrbit(orbitLine, { ...ob, isOrbit: true }, center);
      const at = nu => { const r = ob.p / (1 + ob.e * Math.cos(nu)); return V.add(center, V.add(V.mul(ob.P, r * Math.cos(nu)), V.mul(ob.Q, r * Math.sin(nu)))); };
      if (ob.e < 1) addLabel(at(Math.PI), 'ap', '원지점 ' + fmtDist(ob.ap));
      if (ob.pe > 0) addLabel(at(0), 'pe', '근지점 ' + fmtDist(ob.pe));
    }
  }
  // 위성들
  const now = uniNow();
  for (const s of sats) {
    const v = satView(s); if (!v.el) continue;
    const hide = s.id === shipSatId;
    const p = V.add(satPosition(v.el, now), center);
    const d = V.len(p);
    v.model.visible = !hide && !map && d < 30000;
    if (v.model.visible) { v.model.position.set(p[0], p[1], p[2]); v.spin += 0.002; orient(v.model, V.norm(V.add(p, rk.pos)), V.add(p, rk.pos)); }
    v.dot.visible = !hide && map;
    v.line.visible = !hide && map;
    if (map) {
      const k = mapCam.dist * 0.008; v.dot.scale.set(k, k, 1); v.dot.position.set(p[0], p[1], p[2]);
      if (!v.lineDone || v.lineCenter !== rk.pos) { fillOrbit(v.line, v.el, center); }
      addLabel(p, s.owner === '나' ? 'mine' : 'sat', s.name);
    }
  }
  return ob;
}

function drawDial(axes) {
  const ctx = $('dial').getContext('2d'), S = 160, c = 80, R = 70;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(170,180,214,.45)'; ctx.lineWidth = 2;
  [R * 0.5, R].forEach(r => { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); });
  ctx.fillStyle = 'rgba(170,180,214,.8)'; ctx.font = '15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('수평', c, c - R + 16);
  const hz = horizon(rk.pos);
  const dot = (vec, color, ring) => {
    const v = V.norm(vec), ang = Math.acos(Math.max(-1, Math.min(1, V.dot(v, hz.up))));
    const x = V.dot(v, axes.R), y = V.dot(v, axes.F), l = Math.hypot(x, y) || 1, rr = Math.min(1, ang / (Math.PI / 2)) * R;
    const px = c + x / l * rr, py = c - y / l * rr;
    ctx.beginPath(); ctx.arc(px, py, ring ? 11 : 9, 0, Math.PI * 2);
    if (ring) { ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke(); } else { ctx.fillStyle = color; ctx.fill(); }
    if (ang > Math.PI / 2) { ctx.fillStyle = color; ctx.font = 'bold 13px system-ui'; ctx.fillText('↓', px, py + 26); }
  };
  if (rk.speed > 3) dot(rk.vel, '#7dff9b', true);
  dot(rk.fwd, '#ffd166', false);
}

const ACT_LABEL = { launch: '점화!', balloon: '풍선 띄우기', release: '풍선 분리', boosters: '부스터 분리', stage: '단 분리', deploy: '위성 분리', chute: '낙하산' };
function updateHud(ob, warp) {
  $('hAlt').textContent = fmtDist(Math.max(0, rk.alt));
  $('hVel').textContent = fmtN(rk.speed) + ' m/s';
  $('hAp').textContent = ob ? (ob.escape ? '탈출' : fmtDist(ob.ap)) : '-';
  $('hPe').textContent = ob ? (ob.pe < -PLANET.R * 0.9 ? '-' : fmtDist(ob.pe)) : '-';
  $('fuelFill').style.width = (rk.stageFuelFrac * 100) + '%';
  const want = WARPS[warpIdx];
  $('warpBtn').textContent = warp < want ? warp + '×*' : want + '×';
  const act = rk.nextAction, btn = $('stageBtn');
  btn.disabled = act === 'none';
  btn.classList.toggle('chute', act === 'chute' || act === 'deploy');
  btn.textContent = ACT_LABEL[act] || (rk.chute === 'armed' ? '대기중' : '—');
  $('stageInfo').textContent = act === 'boosters' ? '측면 부스터 연료 ' + Math.round(rk.stageFuelFrac * 100) + '%'
    : act === 'deploy' ? (ob && ob.pe > PLANET.atm ? '궤도 진입! 위성을 분리하세요' : '근지점을 45 km 위로 올린 뒤 분리하세요')
    : act === 'stage' ? '남은 단 ' + rk.segs.length + ' · 추력 ' + fmtN(rk.thrustNow / 1000) + ' kN'
    : rk.chute === 'armed' ? '낙하산: 250 m/s 이하·고도 20 km 아래에서 펴져요'
    : rk.balloon === 'rising' ? '풍선 상승 중 · 18 km에서 자동 분리 (바람 ' + fmtN(rk.windSpeed) + ' m/s)'
    : rk.isSatellite ? '인공위성 공전 중' + (rk.sailOpen ? ' · 태양 돛 펼침' : '')
    : rk.ignited ? (rk.q > 3000 ? '동압 ' + fmtN(rk.q / 1000) + ' kPa' + (rk.q > 60000 ? ' ⚠' : '') + ' · ' : '') + (rk.alt < 30000 ? '바람 ' + fmtN(rk.windSpeed) + ' m/s · ' : '') + fmtN(rk.acc, 1) + ' G' + (rk.science.points ? ' · 🔬' + rk.science.points : '')
    : '날씨 ' + weather.icon + ' ' + weather.name + ' · 바람 ' + fmtN(weather.wind0) + ' m/s';
  const ap = $('apLabel'); ap.hidden = !autopilot; if (autopilot) ap.textContent = '자동 비행: ' + autopilot.label;
  if (Math.abs(rk.throttle * 100 - parseInt($('thVal').textContent, 10)) > 0.5) setThrottle(rk.throttle);
}

function flushEvents() {
  while (lastEvent < rk.events.length) {
    const e = rk.events[lastEvent++];
    if (e.kind !== 'info' || /분리|점화|낙하산|부스터|페어링|풍선|사출/.test(e.text)) toast(e.text + (e.fact && e.kind !== 'bad' ? '\n' + e.fact : ''), e.kind === 'bad', e.fact ? 5200 : 0);
    if (e.boom) for (let i = 0; i < 8; i++) world.emit(rk.pos, rk.vel, V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), horizon(rk.pos).up, 100, 6);
  }
  // 위성 배치 성공 → 우주 목록에 저장
  if (rk.deployedSat && rk.deployedSat.ok && !shipSatId) {
    const type = PARTS[rk.deployedSat.ids.find(id => PARTS[id].kind === 'sat')].sat;
    const s = { id: 'my-' + Date.now(), name: (designName || '내 위성').slice(0, 20), type, owner: '나', epoch: uniNow(), r: rk.pos.slice(), v: rk.vel.slice() };
    sats.push(s); store.set('rocket3d.sats', sats); shipSatId = s.id;
    const el = satElements(s.r, s.v, s.epoch);
    setTimeout(() => sheet('<h2>🛰 위성 배치 성공!</h2><p><b>' + esc(s.name) + '</b>이(가) 궤도에 올랐어요.</p><div class="bench-grid"><div><span>근지점</span><b>' + fmtDist(el.pe) + '</b></div><div><span>원지점</span><b>' + fmtDist(el.ap) + '</b></div><div><span>한 바퀴</span><b>' + fmtN(el.period / 60, 1) + ' 분</b></div><div><span>비행 시간</span><b>' + fmtN(rk.t) + ' 초</b></div></div><p class="muted">위성은 이 기기에 저장되어, 다음에 접속해도 실제 시간에 맞춰 계속 돌고 있어요.</p>',
      [{ label: '관제 지도', fn: () => { map = true; $('mapBtn').classList.add('on'); fitMap(true); } }, { label: '새 로켓 조립', primary: true, fn: () => setMode('build') }]), 1200);
  }
}

function showResult() {
  const dg = rk.diagnose();
  sheet('<h2>' + dg.title + '</h2>' + dg.lines.map(l => '<p>' + esc(l) + '</p>').join('') + (dg.fact ? '<p class="fact">💡 ' + esc(dg.fact) + '</p>' : '') +
    (rk.science.points ? '<p>🔬 과학 점수 <b>' + rk.science.points + '점</b> (' + [...rk.science.done].length + '개 실험)</p>' : '') + '<div class="bench-grid"><div><span>최고 고도</span><b>' + fmtDist(rk.max.alt) + '</b></div><div><span>최고 속도</span><b>' + fmtN(rk.max.vel) + ' m/s</b></div><div><span>비행 시간</span><b>' + fmtN(rk.t) + ' 초</b></div><div><span>최대 동압</span><b>' + fmtN(rk.max.q / 1000) + ' kPa</b></div></div><p class="muted">날씨: ' + weather.icon + ' ' + weather.name + '</p>',
    [{ label: '조립으로', fn: () => setMode('build') }, { label: '다시 비행', primary: true, fn: () => startFlight() }]);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(tier.pixelRatio); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  builder.resize(w, h);
}
window.addEventListener('resize', resize);

// ───────── 메인 루프 ─────────
let last = performance.now(), first = true;
function frame(now) {
  const dtMs = now - last, dtReal = Math.min(0.1, dtMs / 1000);
  last = now;
  trackPerf(now, dtMs);
  if (mode === 'build') {
    builder.update();
    render(builder.scene, builder.camera);
  } else flightFrame(dtReal);
  if (first) { first = false; $('loading').hidden = true; }
  requestAnimationFrame(frame);
}
function render(sc, cm) {
  if (tier.bloom) { renderPass.scene = sc; renderPass.camera = cm; composer.render(); }
  else renderer.render(sc, cm);
}

function flightFrame(dtReal) {
  const paused = !$('sheetBg').hidden && !ended;
  let warp = WARPS[warpIdx];
  if (rk.alt < PLANET.atm && warp > 4) warp = 4;
  if ((autopilot || rk.thrustNow > 0) && warp > 4) warp = 4;
  const hz = horizon(rk.pos), axes = viewAxes(hz.up);
  if (!paused) {
    const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), ky = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    rk.tiltDir = V.add(V.mul(axes.R, joy[0] || kx), V.mul(axes.F, joy[1] || ky));
    if (autopilot) autopilot.update();
    rk.update(dtReal * warp);
    clockExtra += dtReal * (warp - 1) * 1000;
  }
  if (rk.version !== modelVersion || rk.sailOpen !== modelSail || rk.balloon !== modelBalloon) rebuildModel();
  const alt = rk.alt;
  // 로켓이 번개를 맞음
  if (rk.strikeAt !== lastStrike && rk.strikeAt >= 0) { lastStrike = rk.strikeAt; world.bolt([0, 0, 0], horizon(rk.pos).up); }
  const smokeAmt = (FLAMES[design.flame] || FLAMES.kerosene).smokeAmt;
  if (!paused && rk.thrustNow > 0 && alt < PLANET.atm * 0.8 && Math.random() < smokeAmt) world.emit(rk.pos, rk.vel, rk.fwd, hz.up, alt, Math.max(1, Math.round((tierKey === 'high' ? 4 : tierKey === 'medium' ? 2 : 1) * Math.max(1, smokeAmt))));
  const info = world.update(rk.pos, paused ? 0 : dtReal * Math.min(warp, 4), alt, camera, renderer.domElement.height, map);

  // 로켓·불꽃·낙하산
  orient(rocketGroup, rk.fwd, rk.pos);
  const vac = Math.min(1, Math.max(0, alt / PLANET.atm));
  for (const m of [flameMat, ionFlameMat]) { m.uniforms.uTime.value += dtReal; m.uniforms.uVac.value = vac; }
  const boosterOn = rk.thrustNow - rk.coreThrust > 0, coreOn = rk.coreThrust > 0;
  const ionOn = coreOn && rk.active && rk.active.ids.some(id => PARTS[id].ion);
  for (const f of flames) {
    const k = f.userData.kind, on = k === 'booster' ? boosterOn : k === 'ion' ? ionOn : coreOn && !ionOn;
    f.visible = on;
    if (on) { const s = f.userData.size, L = (k === 'booster' ? 7 : k === 'ion' ? 5 : 6 + rk.coreThrust / 30000) * s * (1 + vac * 0.8), w = s * (1 + vac * 1.8); f.scale.set(w, L, w); }
  }
  canopy.visible = rk.chute === 'open';
  const alive = new Set(rk.debris);
  for (const [d, m] of debrisModels) if (!alive.has(d)) { scene.remove(m.group); debrisModels.delete(d); }
  for (const d of rk.debris) {
    if (!debrisModels.has(d)) { const m = buildRocket(d.design, tierKey); scene.add(m.group); debrisModels.set(d, m); }
    const m = debrisModels.get(d); m.group.position.copy(v3(V.sub(d.pos, rk.pos))); orient(m.group, d.fwd, d.pos);
  }

  // 빛·안개
  const sunUp = SUN_DIR.dot(v3(hz.up));
  sun.intensity = 3.0 * Math.max(0, Math.min(1, (sunUp + 0.1) / 0.3)) + (alt > PLANET.atm ? 0.6 : 0);
  hemi.intensity = 0.35 * Math.exp(-alt / 15000) * Math.max(0.1, sunUp + 0.2);
  scene.fog.color.copy(info.haze);
  scene.fog.near = map || alt > 30000 ? 1e10 : 3000 + alt; scene.fog.far = map || alt > 30000 ? 2e10 : 70000 + alt * 4;
  // 구름 속을 지날 때 하얗게
  const inCloud = map ? 0 : Math.min(1, info.inCloud * 1.6);
  if (inCloud > 0.02) { scene.fog.color.lerp(new THREE.Color(0.62, 0.64, 0.68).multiplyScalar(weather.key === 'storm' ? 0.5 : 1), inCloud); scene.fog.near = 10; scene.fog.far = 150 + (1 - inCloud) * 2500; }
  hemi.intensity += (world.flash || 0) * 2;
  sun.position.copy(SUN_DIR).multiplyScalar(80); sun.target.position.set(0, 0, 0);
  sun.castShadow = tier.shadows && alt < 300 && !map;

  updateCamera(hz);
  if (!map && rk.q > 2000) { const sh = Math.min(0.25, rk.q / 300000 + rk.windSpeed / 400) * (weather.gust || 0.2); camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
  rocketGroup.visible = !map;
  const ob = updateOrbitView();
  render(scene, camera);
  drawDial(axes);
  updateHud(ob, warp);
  flushEvents();
  if (!ended && (rk.state === 'landed' || rk.state === 'crashed')) { ended = true; bench = null; setTimeout(showResult, 1500); }
}

resize();
setMode('build');
window.__sim = { get rk() { return rk; }, get tier() { return tierKey; }, get world() { return world; }, get mode() { return mode; }, builder, scene, renderer, camera, perf, applyTier, startBench, setSas, startFlight, setMode, get sats() { return sats; } }; // 테스트용
requestAnimationFrame(frame);
