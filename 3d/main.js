// 3D 로켓 체험: 조립(격납고) → 비행 → 궤도·위성 배치 → 관제 지도
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { PLANET, V, Rocket3D, Autopilot, horizon, satElements, satPosition, normalizeDesign, makeWeather, WEATHERS, launchCriteria, windSpeed, FLAMES, EXAMPLES3D, REAL_ROCKETS, LZ_LIST, SEA_DECK, RUNWAY } from './physics3d.js';
import { World, TIERS, TIER_ORDER, SUN_DIR, softTexture, loadEarth, LAUNCH_SITE } from './world.js';
import { buildRocket, buildCanopy, buildSatellite, makeFlame, flameMat, ionFlameMat, setFlameType, setLanding, buildISS, setGear, buildDragChute } from './rocketModel.js';
import { ISS_INFO, ISS_EL, ISS_PERIOD, ISS_NORMAL, issState, launchWindow, issFromPad } from './iss.js';
import { Rendezvous, RDV_LABEL, issPort, noseOf, canDock, holdDocked, undock } from './rendezvous.js';
import { GlideHome, GLIDE_LABEL } from './glide.js';
import { Builder } from './builder.js';
import { RocketSound } from './sound.js';
import { MISSIONS, evaluate, loadProgress, saveStars, unlocked, totalStars } from './missions.js';

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

// ───────── 분리된 부품 낙하 지점 (빨간 ✕ + 낙하 예상 구역 원) ─────────
const impactTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.lineCap = 'round';
  for (const [w, c] of [[16, 'rgba(0,0,0,.55)'], [9, '#ff4b3e']]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(14, 14); g.lineTo(50, 50); g.moveTo(50, 14); g.lineTo(14, 50); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const impactGroup = new THREE.Group();
let impactViews = [];
const PAD_UP = [0, 1, 0];
const DIRS8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
function impactInfo(imp) {
  if (imp.orbit) return { text: '궤도에 남음 (우주 쓰레기)', where: '우주' };
  const n = V.norm(imp.pos), hz = horizon([0, PLANET.R, 0]), d = V.sub(imp.pos, [0, PLANET.R, 0]);
  const dist = PLANET.R * Math.acos(Math.max(-1, Math.min(1, V.dot(n, PAD_UP))));
  const ang = (Math.atan2(V.dot(d, hz.east), V.dot(d, hz.north)) * 180 / Math.PI + 360) % 360;
  const where = world.isWater(n) ? '바다' : '육지';
  return { dist, dir: DIRS8[Math.round(ang / 45) % 8], where, text: (dist < 1000 ? '발사장 근처' : '발사장 ' + DIRS8[Math.round(ang / 45) % 8] + '쪽 ' + fmtDist(dist)) + ' ' + where };
}
function addImpactView(imp) {
  if (imp.landing) {
    const L = imp.lander, info = impactInfo({ pos: imp.pos }), v = { imp, info: { ...info, where: L.mode === 'rtls' ? '착륙장' : '바다', text: L.mode === 'rtls' ? '발사장 옆 착륙장' : '해상 착륙선 (' + info.text + ')' } };
    if (L.mode === 'ship') addBarge(imp.pos);
    impactViews.push(v);
    setTimeout(() => toast('🛬 ' + imp.name + '이(가) 돌아가요 → ' + v.info.text + '\n🛬 버튼을 누르면 따라가 볼 수 있어요.', false, 4200), 1600);
    $('followBtn').hidden = false;
    return;
  }
  const info = impactInfo(imp), v = { imp, info };
  if (!imp.orbit) {
    const n = V.norm(imp.pos), lift = PLANET.R + 80;
    v.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: impactTex, sizeAttenuation: false, depthTest: false, fog: false }));
    v.sprite.scale.set(0.045, 0.045, 1); v.sprite.renderOrder = 11; v.sprite.position.set(n[0] * lift, n[1] * lift, n[2] * lift);
    // 낙하 예상 구역: 멀리서 떨어질수록 넓게 (실제 발사 때 미리 알리는 '낙하 예상 구역'처럼)
    const rr = Math.max(1500, info.dist * 0.07), a = V.norm(V.cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), b = V.cross(n, a), pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2, q = V.mul(V.norm(V.add(V.mul(n, PLANET.R), V.add(V.mul(a, Math.cos(t) * rr), V.mul(b, Math.sin(t) * rr)))), lift); pts.push(new THREE.Vector3(...q)); }
    v.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff4b3e, fog: false, transparent: true, opacity: 0.85 }));
    v.ring.frustumCulled = false;
    impactGroup.add(v.sprite, v.ring);
  }
  impactViews.push(v);
  const when = imp.orbit ? '' : ' · ' + (imp.t >= 60 ? Math.floor(imp.t / 60) + '분 ' : '') + Math.round(imp.t % 60) + '초 뒤';
  setTimeout(() => toast('📍 ' + imp.name + ' 낙하 예상: ' + info.text + when + (imp.orbit ? '\n분리된 단이 궤도 속도라 떨어지지 않고 계속 돌아요.' : '\n관제 지도에 빨간 ✕로 표시했어요.'), false, 4200), 1600);
}
// ───────── 부스터 착륙장(LZ)·해상 착륙선 ─────────
const landingGroup = new THREE.Group();
const xTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#5a5c60'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 22; g.lineCap = 'butt'; g.beginPath(); g.moveTo(70, 70); g.lineTo(186, 186); g.moveTo(186, 70); g.lineTo(70, 186); g.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function placeOnSurface(obj, pos, h) {
  const n = V.norm(pos), r = PLANET.R + h;
  obj.position.set(n[0] * r, n[1] * r, n[2] * r); obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(n));
}
for (const lz of LZ_LIST) (() => {   // 발사장 옆 착륙장: 콘크리트 원판 + X 표시
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 0.6, 40), new THREE.MeshStandardMaterial({ color: 0x8a8c90, roughness: 0.95 })); base.position.y = -0.3; g.add(base);
  const top = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshStandardMaterial({ map: xTex, roughness: 0.9 })); top.rotation.x = -Math.PI / 2; top.position.y = 0.02; g.add(top);
  placeOnSurface(g, lz, 0.05); landingGroup.add(g);
})();
(() => {   // 우주왕복선 활주로: 지면 곡률을 따라 휘어진 띠 + 흰 선
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512; const c = cv.getContext('2d');
  c.fillStyle = '#3d3f43'; c.fillRect(0, 0, 128, 512);
  c.fillStyle = '#e9e9e6'; c.fillRect(4, 0, 4, 512); c.fillRect(120, 0, 4, 512);
  for (let y = 0; y < 512; y += 64) c.fillRect(62, y, 4, 34);
  for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * 128, Math.random() * 512, 6, 2); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapT = THREE.RepeatWrapping;
  const N = 48, pos = [], uv = [], idx = [], L = RUNWAY.len, W = RUNWAY.width;
  for (let i = 0; i <= N; i++) for (const s of [-1, 1]) {
    const a = -L / 2 + L * i / N, p = V.mul(V.norm(V.add(RUNWAY.center, V.add(V.mul(RUNWAY.dir, a), V.mul(RUNWAY.side, s * W / 2)))), PLANET.R + 0.3);
    pos.push(p[0], p[1], p[2]); uv.push(s < 0 ? 0 : 1, a / 120);
  }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  landingGroup.add(m);
})();
let barges = [];
function addBarge(pos) {   // 해상 착륙선: 넓은 갑판 + X + 양쪽 방벽
  const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.8, metalness: 0.3 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 3, 26), dark); hull.position.y = -1.5; g.add(hull);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshStandardMaterial({ map: xTex, roughness: 0.9 })); deck.rotation.x = -Math.PI / 2; deck.position.y = 0.02; g.add(deck);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, 0.6), dark); w.position.set(0, 1.1, s * 12.5); g.add(w); }
  placeOnSurface(g, pos, SEA_DECK); landingGroup.add(g); barges.push(g);
}
function clearBarges() { barges.forEach(b => landingGroup.remove(b)); barges = []; }
let follow = null;   // 따라가 보는 부스터 (분리된 단) 또는 ISS

// ───────── 국제우주정거장 ─────────
const issObj = { name: '국제우주정거장', iss: true, pos: [0, 0, 0], vel: [0, 0, 0], fwd: [0, 1, 0] };
let issModel = null;
const issDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture('rgba(255,220,140,1)', 'rgba(255,220,140,0)'), depthTest: true, fog: false })); issDot.visible = false;
const issLine = (() => { const l = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(361 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffd27a, fog: false, transparent: true, opacity: 0.7 })); l.frustumCulled = false; l.visible = false; return l; })();
const fmtWait = s => Math.floor(s / 60) + '분 ' + String(Math.floor(s % 60)).padStart(2, '0') + '초';
function windowText(short) {
  const w = launchWindow(uniNow());
  if (w.open) return short ? 'ISS 발사 창 열림! (' + fmtWait(w.closesIn) + ' 남음)' : '🟢 지금 발사 창이 열렸어요! ' + fmtWait(w.closesIn) + ' 안에 북동쪽(방위 49°)으로 쏘면 ISS 가까이 갈 수 있어요.';
  return short ? 'ISS 발사 창 ' + fmtWait(w.wait) + ' 뒤' : '⏳ 다음 발사 창까지 ' + fmtWait(w.wait) + ' · ISS는 지금 ' + issFromPad(uniNow());
}
const PHASE_KO = { flip: '뒤집기', boost: '역추진 (발사장으로)', coast: '활공 (격자 날개)', entry: '재진입 연소', land: '착륙 연소' };

function clearImpacts() { impactViews.forEach(v => { if (v.sprite) { impactGroup.remove(v.sprite, v.ring); v.ring.geometry.dispose(); v.sprite.material.dispose(); } }); impactViews = []; }

// ───────── 후처리 (블룸) ─────────
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 2.2); // 아주 밝은 것(불꽃·태양)만 번지게
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());

// ───────── 우주(위성) 목록: 이 기기에 저장, 실제 시간에 맞춰 공전 ─────────
let clockExtra = 0;                                   // 시간 배속으로 앞당긴 시간(ms)
// 비행 중에는 로켓 물리 시간으로만 흐르는 우주 시계 (ISS·위성과 로켓이 정확히 같은 시간을 씀)
let simClock = null;
const uniNow = () => mode === 'flight' && simClock != null ? simClock : Date.now() + clockExtra;
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
let targetISS = store.get('rocket3d.target', 'free') === 'iss', rdv = null, docked = false, rcsDir = null, glide = null;
let rk = null, design = null, designName = '', autopilot = null, ended = false, map = false, warpIdx = 0, lastEvent = 0, shipSatId = null;
const WARPS = [1, 2, 4, 10, 50, 200];
let missionId = store.get('rocket3d.mission', MISSIONS[0].id);
let mstate = { auto: false, sat: null, maxAp: 0, doneShown: false, stars: 0 };

const builder = new Builder({ renderer, canvas, env, getTier: () => tierKey, onLaunch: (d, name) => briefing(d, name), sheet: (h, a) => sheet(h, a) });
let weatherKey = store.get('rocket3d.weather', 'clear'), weather = makeWeather(weatherKey);

function setMode(m) {
  mode = m; builder.active = m === 'build';
  document.body.classList.toggle('mode-build', m === 'build');
  document.body.classList.toggle('mode-flight', m === 'flight');
  if (m === 'build') { updateBuildChip(); if (simClock != null) { clockExtra = simClock - Date.now(); simClock = null; } }
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

// 로켓 크기를 재서 발사탑·이렉터·지상고정장치를 맞춤
function fitPadToRocket() {
  const g = rocketModel.group, par = g.parent; if (par) par.remove(g);
  g.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(g); if (par) par.add(g);
  const rMax = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  world.fitPad(rocketModel.height, rocketModel.coreR || 0.625, Math.min(rMax, 3.5));
}

let modelSail = false, modelBalloon = 'none', lastStrike = -1;
function startFlight(d, name) {
  if (simClock == null) simClock = Date.now() + clockExtra;
  if (d) { design = normalizeDesign(d); designName = name || '나만의 로켓'; }
  weather = makeWeather(weatherKey);
  world.setWeather(weather);
  rk = new Rocket3D(design, weather);
  setFlameType(FLAMES[design.flame] || FLAMES.kerosene); lastStrike = -1;
  autopilot = null; ended = false; lastEvent = 0; warpIdx = 0; map = false; shipSatId = null;
  $('mapBtn').classList.remove('on');
  debrisModels.forEach(m => scene.remove(m.group)); debrisModels.clear();
  clearImpacts(); if (impactGroup.parent !== world.root) world.root.add(impactGroup);
  clearBarges(); if (landingGroup.parent !== world.root) world.root.add(landingGroup);
  follow = null; $('followBtn').classList.remove('on'); $('followBtn').hidden = true;
  setSas('off'); setThrottle(1);
  rebuildModel();
  fitPadToRocket();
  countdown = null; ignT = -1; wasIgnited = false;
  mstate = { auto: false, sat: null, maxAp: 0, doneShown: false, stars: 0, docked: false, cargo: false };
  rdv = null; docked = false; rcsDir = null; glide = null;
  gearT = 0; chuteT = 0; chuteGone = 0; tdShown = false;
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
        : '<p class="muted">발사할 때 날씨가 무작위로 정해져요.</p>') +
      '<b>비행 목표</b><div class="qrow" id="trow"><button data-t="free" class="' + (targetISS ? '' : 'on') + '">🚀 자유 비행</button><button data-t="iss" class="' + (targetISS ? 'on' : '') + '">🛰 ISS 랑데부·도킹</button></div>' +
      '<b>🛰 국제우주정거장 발사 창</b><div class="iss-win ' + (launchWindow(uniNow()).open ? 'open' : '') + '">' + windowText(false) + '</div><p class="muted">ISS에 가려면 발사 창이 열렸을 때 쏴야 해요. 정거장이 너무 멀리 있으면 따라잡는 데 오래 걸려요.</p>',
      [{ label: '조립으로', fn: () => {} }].concat(launchWindow(uniNow()).open ? [] : [{ label: '⏩ 발사 창까지 기다리기', keep: true, fn: () => { clockExtra += launchWindow(uniNow()).wait * 1000 + 4000; render(); } }]).concat([{ label: '발사대로 ▶', primary: true, fn: () => startFlight(d, name) }]));
    document.querySelectorAll('#wrow button').forEach(b => b.onclick = () => { weatherKey = b.dataset.w; store.set('rocket3d.weather', weatherKey); render(); });
    document.querySelectorAll('#trow button').forEach(b => b.onclick = () => { targetISS = b.dataset.t === 'iss'; store.set('rocket3d.target', b.dataset.t); render(); });
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
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) doStage(); }
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
  if (m === 'auto' && mode === 'flight') mstate.auto = true;
  if (m === 'home') {
    if (!rk || !rk.gliding || docked) { toast('귀환 도우미는 우주왕복선 궤도선만 쓸 수 있어요 (도킹 중이면 먼저 분리)', true, 2600); return; }
    glide = new GlideHome(rk); rdv = null; autopilot = null; rcsDir = null; rk.sas = 'off';
    toast('🛬 귀환 시작! 활주로에 맞춰 역추진할 때를 계산해요.\n화면 위 표시줄을 누르면 시간을 빨리 감아요.', false, 3800);
    setSasUi('home'); return;
  }
  if (glide) { glide = null; rk.glideCtl = false; rk.brake = 0; }
  rdv = m === 'iss' && rk && rk.orbited && !docked ? new Rendezvous(rk) : (m === 'iss' ? rdv : null);
  if (m === 'iss' && !rdv) { toast('먼저 궤도에 올라야 ISS로 갈 수 있어요. [자동]으로 올라가면 이어서 접근해요.', true, 2600); m = 'auto'; targetISS = true; }
  if (m !== 'iss') rcsDir = null;
  if (m === 'auto') autopilot = targetISS ? new Autopilot(rk, 82000, { planeN: ISS_NORMAL, pe: 78000 }) : new Autopilot(rk);
  else { autopilot = null; if (rk) rk.sas = m === 'iss' ? 'off' : m; }
  document.querySelectorAll('.sas button').forEach(b => b.classList.toggle('on', b.dataset.sas === m));
}
document.querySelectorAll('.sas button').forEach(b => b.onclick = () => setSas(b.dataset.sas));
$('stageBtn').onclick = () => doStage();

// ───────── 발사 카운트다운·소리·비행 시간 ─────────
const sound = new RocketSound();
sound.on = store.get('rocket3d.sound', true);
$('soundBtn').classList.toggle('off', !sound.on); $('soundBtn').textContent = sound.on ? '🔊' : '🔇';
$('soundBtn').onclick = () => { sound.setOn(!sound.on); store.set('rocket3d.sound', sound.on); $('soundBtn').classList.toggle('off', !sound.on); $('soundBtn').textContent = sound.on ? '🔊' : '🔇'; };
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
let countdown = null, ignT = -1, wasIgnited = false;
const COUNT_FROM = 10, KO_NUM = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];
function doStage() {
  sound.unlock();
  if (rk.nextAction === 'launch') { if (!countdown) startCountdown(); return; }
  rk.stage();
}
function startCountdown() { countdown = { left: COUNT_FROM + 0.999, shown: COUNT_FROM + 1 }; }
function tickCountdown(dt) {
  if (!countdown) return;
  countdown.left -= dt;
  const n = Math.floor(countdown.left);
  if (n < countdown.shown) {
    countdown.shown = n;
    if (n > 0) {
      if (n === COUNT_FROM) toast('발사 ' + n + '초 전! 카운트다운 시작', false, 1500);
      else if (n <= 5) toast(String(n), false, 900);
      if (!sound.say(KO_NUM[n])) sound.beep(false);
    }
    else { if (!sound.say('발사!', { rate: 1.1, pitch: 1.05 })) sound.beep(true); countdown = null; if (rk.nextAction === 'launch') { if (autopilot) rk.throttle = 1; rk.stage(); } }
  }
}
function fmtClock(sec) {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60, p = v => String(v).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
}
$('followBtn').onclick = () => {
  const ls = rk.debris.filter(d => d.lander);
  const i = follow && !follow.iss ? ls.indexOf(follow) : ls.length, nx = ls[i + 1] || null;
  follow = nx; $('followBtn').classList.toggle('on', !!follow);
  if (follow) { map = false; $('mapBtn').classList.remove('on'); toast('🛬 ' + follow.name + ' 따라가기 (한 번 더 누르면 다음 부스터 / 로켓으로)', false, 1800); }
};
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
      [{ label: '조립으로', fn: () => setMode('build') }, { label: '처음부터', fn: () => startFlight() }, follow && follow.iss ? { label: '🚀 내 로켓으로', fn: () => { follow = null; $('followBtn').classList.remove('on'); } } : { label: '🛰 ISS 보러 가기', fn: () => { follow = issObj; map = false; $('mapBtn').classList.remove('on'); $('followBtn').classList.add('on'); cam.dist = Math.max(cam.dist, 140); toast('🛰 국제우주정거장을 보고 있어요\n🛬 버튼이나 메뉴로 내 로켓에 돌아와요', false, 2600); } }, { label: '성능 측정', fn: startBench }, { label: '계속하기', primary: true }]);
  }
  bindQuality();
}
$('menuBtn').onclick = showMenu; $('perfPill').onclick = showMenu; $('bMenu').onclick = showMenu;
$('bUniverse').onclick = () => showUniverse();

function showUniverse() {
  const rows = sats.map(s => { const v = satView(s); return `<tr><td>${esc(s.name)}</td><td>${esc(s.owner)}</td><td class="n">${v.el ? fmtDist(v.el.pe) + ' ~ ' + fmtDist(v.el.ap) : '-'}</td><td class="n">${v.el ? fmtN(v.el.period / 60, 1) + '분' : '-'}</td></tr>`; }).join('');
  sheet('<h2>🛰 국제우주정거장 (ISS)</h2><div class="bench-grid">' + ISS_INFO.facts.slice(0, 4).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('') + '</div><p class="fact">💡 ' + ISS_INFO.story + '</p><p class="muted">게임 속 ISS: 고도 ' + fmtDist(ISS_INFO.alt) + ' · 한 바퀴 ' + fmtN(ISS_PERIOD / 60, 1) + '분 · 궤도 경사 51.6°</p><div class="iss-win">' + windowText(false) + '</div><h2>🛰 우리 우주의 인공위성</h2><p class="muted">궤도에 올린 위성은 이 기기에 저장되어 실제 시간에 맞춰 계속 공전해요. (반 친구들과 함께 보는 공유 우주는 다음 단계에서 Firestore로 연결합니다.)</p>' +
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
function v3(a, out = new THREE.Vector3()) { return out.set(a[0], a[1], a[2]); }
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
  } else if (follow) {
    // 돌아오는 부스터 따라가기 (원점은 로켓 그대로, 카메라만 부스터로)
    const fh = horizon(follow.pos), target = v3(V.sub(follow.pos, rk.pos)).add(v3(V.mul(follow.fwd, follow.iss ? 2 : 5)));
    const el = Math.max(-1.3, cam.el), c = Math.cos(el);
    camera.position.copy(target).add(v3(V.add(V.add(V.mul(fh.north, c * Math.cos(cam.az)), V.mul(fh.east, c * Math.sin(cam.az))), V.mul(fh.up, Math.sin(el)))).multiplyScalar(Math.max(cam.dist, follow.iss ? 110 : 40)));
    camera.up.copy(v3(fh.up)); camera.lookAt(target);
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
  // 위성을 분리한 뒤에는 비행 화면에서도 위성의 이동 궤도(초록)를 보여 줌
  const satMode = rk.isSatellite && !!rk.deployedSat;
  orbitLine.visible = (map || satMode) && !!ob && !ob.flat && !ob.escape;
  orbitLine.material.color.setHex(satMode ? 0x7dff9b : 0x5ab0ff);
  marker.visible = map;
  const center = V.mul(rk.pos, -1);
  if (map) { const k = mapCam.dist * 0.012; marker.scale.set(k, k, 1); }
  // 낙하 지점 표시
  for (const v of impactViews) {
    if (v.sprite && (map || rk.alt < 200000)) addLabel(V.add(v.imp.pos, center), 'impact', v.imp.name + ' 낙하 · ' + (v.info.dist < 1000 ? '발사장 근처' : fmtDist(v.info.dist)));
    else if (v.imp.landing && (map || follow)) { const R = v.imp.lander.result; addLabel(V.add(v.imp.pos, center), 'mine', v.imp.name + (R ? (R.ok ? ' 착륙 성공 ✔' : ' 착륙 실패') : ' 착륙 목표')); }
  }
  if (map || satMode) {
    if (orbitLine.visible) {
      fillOrbit(orbitLine, { ...ob, isOrbit: true }, center);
      const at = nu => { const r = ob.p / (1 + ob.e * Math.cos(nu)); return V.add(center, V.add(V.mul(ob.P, r * Math.cos(nu)), V.mul(ob.Q, r * Math.sin(nu)))); };
      if (ob.e < 1) addLabel(at(Math.PI), 'ap', '원지점 ' + fmtDist(ob.ap));
      if (ob.pe > 0) addLabel(at(0), 'pe', '근지점 ' + fmtDist(ob.pe));
    }
  }
  // 국제우주정거장
  {
    const st = { pos: issObj.pos, vel: issObj.vel };
    if (!issModel) { issModel = buildISS(tierKey); scene.add(issModel, issDot, issLine); }
    const p = V.add(st.pos, center), focus = follow ? V.sub(follow.pos, rk.pos) : [0, 0, 0];
    issModel.visible = !map && V.len(V.sub(p, focus)) < 120000;
    if (issModel.visible) {
      issModel.position.set(p[0], p[1], p[2]);
      const X = v3(V.norm(st.vel)), Y = v3(V.norm(st.pos)), Z = new THREE.Vector3().crossVectors(X, Y);
      tmpM.makeBasis(X, Y, Z); issModel.quaternion.setFromRotationMatrix(tmpM);
    }
    issDot.visible = issLine.visible = map;
    if (map) {
      const k = mapCam.dist * 0.011; issDot.scale.set(k, k, 1); issDot.position.set(p[0], p[1], p[2]);
      fillOrbit(issLine, ISS_EL, center);
      addLabel(p, 'iss', '🛰 ISS');
    } else if (!follow || !follow.iss) {
      const dd = V.len(p); if (dd < 300000 && rk.lifted) addLabel(p, 'iss', '🛰 ISS ' + fmtDist(dd));
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
    : rk.isSatellite ? '인공위성 공전 중' + (ob && !ob.escape && ob.a > 0 ? ' · 한 바퀴 ' + fmtN(2 * Math.PI * Math.sqrt(ob.a ** 3 / PLANET.mu) / 60, 1) + '분 · 초록 선이 위성의 길' : '') + (rk.sailOpen ? ' · 태양 돛 펼침' : '')
    : rk.ignited ? (rk.q > 3000 ? '동압 ' + fmtN(rk.q / 1000) + ' kPa' + (rk.q > 60000 ? ' ⚠' : '') + ' · ' : '') + (rk.alt < 30000 ? '바람 ' + fmtN(rk.windSpeed) + ' m/s · ' : '') + fmtN(rk.acc, 1) + ' G' + (rk.science.points ? ' · 🔬' + rk.science.points : '')
    : '날씨 ' + weather.icon + ' ' + weather.name + ' · 바람 ' + fmtN(weather.wind0) + ' m/s · ' + windowText(true);
  if (follow && follow.iss) $('stageInfo').textContent = '🛰 국제우주정거장 · 고도 ' + fmtDist(ISS_INFO.alt) + ' · ' + fmtN(V.len(follow.vel)) + ' m/s · 한 바퀴 ' + fmtN(ISS_PERIOD / 60, 1) + '분 · 내 로켓까지 ' + fmtDist(V.len(V.sub(follow.pos, rk.pos)));
  else if (follow) { const L = follow.lander, fa = V.len(follow.pos) - PLANET.R - L.ground; $('stageInfo').textContent = '🛬 ' + follow.name + ' · ' + (L.result ? (L.result.ok ? '착륙 성공!' : '착륙 실패') : PHASE_KO[L.phase] || L.phase) + ' · 고도 ' + fmtDist(Math.max(0, fa)) + ' · ' + fmtN(V.len(follow.vel)) + ' m/s · 연료 ' + Math.round(L.fuel) + ' kg'; }
  updateTarget();
  const ap = $('apLabel'); ap.hidden = !autopilot; if (autopilot) ap.textContent = '자동 비행: ' + autopilot.label;
  if (Math.abs(rk.throttle * 100 - parseInt($('thVal').textContent, 10)) > 0.5) setThrottle(rk.throttle);
}

function flushEvents() {
  while (lastEvent < rk.events.length) {
    const e = rk.events[lastEvent++];
    if (e.kind !== 'info' || /분리|점화|낙하산|부스터|페어링|풍선|사출/.test(e.text)) toast(e.text + (e.fact && e.kind !== 'bad' ? '\n' + e.fact : ''), e.kind === 'bad', e.fact ? 5200 : 0);
    if (e.boomAt) { const up = horizon(e.boomAt).up; for (let i = 0; i < 10; i++) world.emit(e.boomAt, [0, 0, 0], V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), up, 100, 6); if (follow) sound.boom(1.4, 1); }
    if (e.boom) sound.boom(1.5, Math.exp(-Math.max(0, rk.alt) / 9000));
    else if (/분리|부스터|페어링/.test(e.text)) sound.boom(0.4, Math.exp(-Math.max(0, rk.alt) / 9000));
    if (e.boom) for (let i = 0; i < 8; i++) world.emit(rk.pos, rk.vel, V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), horizon(rk.pos).up, 100, 6);
  }
  while (impactViews.length < rk.impacts.length) addImpactView(rk.impacts[impactViews.length]);
  // 위성 배치 성공 → 우주 목록에 저장
  if (rk.deployedSat && rk.deployedSat.ok && !shipSatId) {
    const type = PARTS[rk.deployedSat.ids.find(id => PARTS[id].kind === 'sat')].sat;
    const s = { id: 'my-' + Date.now(), name: (designName || '내 위성').slice(0, 20), type, owner: '나', epoch: uniNow(), r: rk.pos.slice(), v: rk.vel.slice() };
    sats.push(s); store.set('rocket3d.sats', sats); shipSatId = s.id;
    const el = satElements(s.r, s.v, s.epoch);
    if (el) mstate.sat = { pe: el.pe, ap: el.ap };
    setTimeout(() => sheet('<h2>🛰 위성 배치 성공!</h2><p><b>' + esc(s.name) + '</b>이(가) 궤도에 올랐어요.</p><div class="bench-grid"><div><span>근지점</span><b>' + fmtDist(el.pe) + '</b></div><div><span>원지점</span><b>' + fmtDist(el.ap) + '</b></div><div><span>한 바퀴</span><b>' + fmtN(el.period / 60, 1) + ' 분</b></div><div><span>비행 시간</span><b>' + fmtN(rk.t) + ' 초</b></div></div><p class="muted">위성은 이 기기에 저장되어, 다음에 접속해도 실제 시간에 맞춰 계속 돌고 있어요.</p>',
      [{ label: '새 로켓 조립', fn: () => setMode('build') }, { label: '🛰 궤도 보기', primary: true, fn: () => { map = true; $('mapBtn').classList.add('on'); fitMap(); } }]), 1200);
  }
}

function showResult() {
  const dg = rk.diagnose(), mres = missionResultHtml();
  sheet(mres.html + '<h2>' + dg.title + '</h2>' + dg.lines.map(l => '<p>' + esc(l) + '</p>').join('') + (dg.fact ? '<p class="fact">💡 ' + esc(dg.fact) + '</p>' : '') +
    (impactViews.length ? '<b>분리된 부품이 떨어진 곳</b><table class="rank"><thead><tr><th>부품</th><th class="n">떨어진 곳</th></tr></thead><tbody>' + impactViews.map(v => '<tr><td>' + esc(v.imp.name) + '</td><td class="n">' + esc(v.imp.landing ? (v.imp.lander.result ? (v.imp.lander.result.ok ? '✔ 착륙 성공 · ' + v.info.text + ' · ' + v.imp.lander.result.speed.toFixed(1) + ' m/s' : '✘ 착륙 실패 · ' + v.imp.lander.result.reason) : '착륙 비행 중 · ' + v.info.text) : v.info.text) + '</td></tr>').join('') + '</tbody></table><p class="muted">실제 발사도 단이 떨어질 바다를 미리 정해 배와 비행기가 피하도록 알려요.</p>' : '') +
    (rk.science.points ? '<p>🔬 과학 점수 <b>' + rk.science.points + '점</b> (' + [...rk.science.done].length + '개 실험)</p>' : '') + '<div class="bench-grid"><div><span>최고 고도</span><b>' + fmtDist(rk.max.alt) + '</b></div><div><span>최고 속도</span><b>' + fmtN(rk.max.vel) + ' m/s</b></div><div><span>비행 시간</span><b>' + fmtN(rk.t) + ' 초</b></div><div><span>최대 동압</span><b>' + fmtN(rk.max.q / 1000) + ' kPa</b></div></div><p class="muted">날씨: ' + weather.icon + ' ' + weather.name + '</p>',
    mres.next ? [{ label: '다시 비행', fn: () => startFlight() }, { label: '조립으로', fn: () => setMode('build') }, { label: '다음 미션 ▶', primary: true, fn: () => { setMode('build'); openMission(mres.next); } }]
      : [{ label: '조립으로', fn: () => setMode('build') }, { label: '다시 비행', primary: true, fn: () => startFlight() }]);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(tier.pixelRatio); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  builder.resize(w, h);
}
window.addEventListener('resize', resize);

// ───────── 단계별 미션 ─────────
const curMission = () => MISSIONS.find(m => m.id === missionId) || null;
const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
function missionCtx() {
  const d = design || {};
  return {
    rk, auto: mstate.auto, weather: weather.key, real: d.real || null, sat: mstate.sat, maxAp: mstate.maxAp, impacts: impactViews,
    issMin: mstate.issMin ?? Infinity, issAt: mstate.issAt ?? Infinity, docked: !!mstate.docked, manualDock: !!mstate.manualDock, cargo: !!mstate.cargo, windowLaunch: !!mstate.windowLaunch,
    hasFins: (d.radial || []).some(r => PARTS[r.id].kind === 'fin'),
    maxCluster: Math.max(1, ...(d.stack || []).map(id => PARTS[id].cluster || 1), ...(d.radial || []).map(r => PARTS[r.id].look === 'core' ? 9 : 1)),
  };
}
function updateMission() {
  const m = curMission(), chip = $('fMission');
  chip.hidden = !m || m.soon;
  if (!m || m.soon) return;
  const ctx = missionCtx(), r = evaluate(m, ctx);
  chip.classList.toggle('done', r.done);
  const txt = '🎯 ' + m.title + ' · ' + (r.done ? '성공! ' + starText(r.stars) : m.progress(ctx));
  if (chip.textContent !== txt) chip.textContent = txt;
  if (r.done && r.stars > mstate.stars) { mstate.stars = r.stars; saveStars(m.id, r.stars); }
  if (r.done && !mstate.doneShown) {
    mstate.doneShown = true; sound.beep(true);
    setTimeout(() => toast('🎯 미션 성공: ' + m.title + '!\n' + m.learn, false, 5200), 400);
  }
}
function missionResultHtml() {
  const m = curMission();
  if (!m || m.soon) return { html: '' };
  const r = evaluate(m, missionCtx());
  if (r.done) saveStars(m.id, r.stars);
  const i = MISSIONS.indexOf(m), nx = MISSIONS[i + 1], next = r.done && nx && !nx.soon ? nx.id : null;
  const html = '<div class="mission-res"><p class="eyebrow">🎯 미션 ' + (i + 1) + ' · ' + esc(m.title) + '</p>' +
    (r.done ? '<div class="stars-big">' + starText(r.stars) + '</div>' : '<p class="fail">아직 목표를 이루지 못했어요: ' + esc(m.goal) + '</p>') +
    '<ul class="mcheck"><li>' + (r.done ? '✅' : '⬜') + ' ' + esc(m.goal) + '</li>' + m.bonus.map((b, k) => '<li>' + (r.bonus[k] && r.done ? '⭐' : '☆') + ' ' + esc(b.text) + '</li>').join('') + '</ul></div><hr>';
  return { html, next };
}
function recDesign(m) {
  if (!m.rec) return null;
  const [kind, key] = m.rec.split(':');
  if (kind === 'real') { const e = REAL_ROCKETS.find(x => x.key === key); return e && { design: { ...JSON.parse(JSON.stringify(e.design)), real: e.key }, name: e.name }; }
  const e = EXAMPLES3D.find(x => x.name === key); return e && { design: JSON.parse(JSON.stringify(e.design)), name: e.name };
}
function setMission(id) { missionId = id; store.set('rocket3d.mission', id); updateBuildChip(); }
function updateBuildChip() {
  const m = curMission(), chip = $('bMissionChip'), prog = loadProgress();
  chip.hidden = !m || m.soon;
  if (m && !m.soon) chip.textContent = '🎯 미션 ' + (MISSIONS.indexOf(m) + 1) + ': ' + m.goal + ' ' + starText(prog[m.id] || 0);
}
function openMissions() {
  const prog = loadProgress();
  sheet('<h2>🎯 미션</h2><p class="muted">미션을 해내면 별을 받아요. 보너스 목표까지 해내면 별 3개! 별을 1개 이상 받으면 다음 미션이 열려요. 모은 별: <b>' + totalStars(prog) + ' / ' + MISSIONS.filter(m => !m.soon).length * 3 + '</b></p><div class="mlist">' +
    MISSIONS.map((m, i) => {
      const open = unlocked(i, prog) && !m.soon;
      return `<button data-m="${m.id}" class="${open ? '' : 'lock'} ${m.id === missionId ? 'on' : ''}"><span class="mi">${open ? m.icon : '🔒'}</span><span><b>${i + 1}. ${esc(m.title)}</b><small>${m.soon ? '곧 열려요' : esc(m.goal)}</small></span><span class="ms">${m.soon ? '' : starText(prog[m.id] || 0)}</span></button>`;
    }).join('') + '</div>', [{ label: '닫기' }]);
  $('sheetBody').querySelectorAll('.mlist button').forEach(b => b.onclick = () => {
    const i = MISSIONS.findIndex(m => m.id === b.dataset.m), m = MISSIONS[i];
    if (m.soon) { toast('부스터 재착륙 미션은 곧 열려요!', false, 2000); return; }
    if (!unlocked(i, loadProgress())) { toast('앞 미션에서 별을 1개 이상 받으면 열려요', true, 2200); return; }
    openMission(m.id);
  });
}
function openMission(id) {
  const i = MISSIONS.findIndex(m => m.id === id), m = MISSIONS[i], prog = loadProgress(), rec = recDesign(m);
  sheet('<h2>' + m.icon + ' 미션 ' + (i + 1) + ': ' + esc(m.title) + '</h2><div class="stars-big">' + starText(prog[m.id] || 0) + '</div>' +
    '<ul class="mcheck"><li>🎯 <b>' + esc(m.goal) + '</b></li>' + m.bonus.map(b => '<li>⭐ 보너스: ' + esc(b.text) + '</li>').join('') + '</ul>' +
    '<p class="fact">💡 ' + esc(m.learn) + '</p>' + (rec ? '<p class="muted">추천 로켓: ' + esc(rec.name) + ' (내 로켓으로 도전해도 돼요)</p>' : ''),
    [{ label: '목록', fn: () => setTimeout(openMissions, 0) }].concat(rec ? [{ label: '추천 로켓으로 시작', fn: () => { setMission(m.id); builder.set(rec.design, rec.name); toast('🎯 미션 시작: ' + m.title, false, 2000); } }] : [])
      .concat([{ label: '이 미션 도전', primary: true, fn: () => { setMission(m.id); toast('🎯 미션 시작: ' + m.title + '\n지금 로켓으로 도전해요', false, 2200); } }]));
}
$('bMission').onclick = openMissions;
$('bMissionChip').onclick = () => openMission(missionId);
$('fMission').onclick = () => { const m = curMission(); if (m) toast('🎯 ' + m.goal + '\n보너스: ' + m.bonus.map(b => b.text).join(' · '), false, 3600); };
updateBuildChip();

// ───────── ISS 랑데부·도킹 화면 ─────────
function setSasUi(m) { document.querySelectorAll('.sas button').forEach(b => b.classList.toggle('on', b.dataset.sas === m)); }
// 미세 이동 방향 → 가속도 (ISS 기준: 앞 = ISS 쪽, 위 = 하늘 쪽)
function rcsVec(dir) {
  if (dir === 'stop') { const P = issPort(uniNow()), rv = V.sub(rk.vel, P.vel), l = V.len(rv); if (l < 0.01) { rcsDir = null; return null; } return V.mul(rv, -Math.min(0.5, l) / l); }
  const P = issPort(uniNow()), up = V.norm(rk.pos), fwd = V.mul(P.vdir, -1), side = V.norm(V.cross(fwd, up));
  const a = 0.35, m = { fwd: V.mul(fwd, a), back: V.mul(fwd, -a), up: V.mul(up, a), down: V.mul(up, -a), left: V.mul(side, -a), right: V.mul(side, a) };
  return m[dir] || null;
}
document.querySelectorAll('#rcsPad button').forEach(b => {
  const on = e => { e.preventDefault(); rcsDir = b.dataset.r; rdv = null; autopilot = null; setSasUi('off'); b.classList.add('on'); };
  const off = () => { if (rcsDir !== 'stop') rcsDir = null; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});
$('fTarget').onclick = () => { if (glide && (glide.phase === 'wait' || glide.phase === 'coast')) { warpIdx = WARPS.length - 1; toast('⏩ 시간을 빨리 감아요 (역추진·재진입 때는 저절로 느려져요)', false, 2200); return; } if (rdv && rdv.phase === 'wait') { warpIdx = WARPS.length - 1; toast('⏩ 시간을 빨리 감아요 (전이 연소가 가까워지면 저절로 느려져요)', false, 2200); } };
function updateTarget() {
  const chip = $('fTarget');
  $('homeBtn').hidden = !(rk.gliding && rk.lifted && rk.state === 'flying' && !docked && (rk.orbited || glide));
  if (rk.lifted) { const dI = V.len(V.sub(issPort(uniNow()).pos, rk.pos)); if (dI < (mstate.issMin ?? Infinity)) { mstate.issMin = dI; if (dI < 5000 && mstate.issAt == null) mstate.issAt = rk.t; } }
  if (glide && !map) {
    chip.hidden = false; chip.classList.toggle('close', glide.phase === 'final' || glide.phase === 'flare' || glide.phase === 'roll');
    chip.textContent = '🛬 귀환 · ' + (GLIDE_LABEL[glide.phase] || '') + (glide.hint ? ' · ' + glide.hint : '');
    $('rcsPad').hidden = true; $('issBtn').hidden = true; return;
  }
  const show = (targetISS || rdv || docked) && rk.lifted && !map;
  $('issBtn').hidden = !(targetISS || rdv) || docked || !rk.lifted;
  const P = issPort(uniNow()), dist = V.len(V.sub(P.pos, noseOf(rk))), relV = V.len(V.sub(rk.vel, P.vel));
  $('rcsPad').hidden = !show || docked || dist > 3000;
  chip.hidden = !show;
  if (!show) return;
  chip.classList.toggle('close', dist < 3000 || docked);
  chip.textContent = docked ? '🛰 ISS에 도킹 중 · 화물 ' + (mstate.cargo ? '전달 완료' : '전달 대기') :
    '🛰 ISS ' + fmtDist(dist) + ' · 상대 ' + (relV < 10 ? relV.toFixed(2) : fmtN(relV)) + ' m/s' + (rdv ? ' · ' + (RDV_LABEL[rdv.phase] || '') + (rdv.hint ? ' · ' + rdv.hint : '') : dist < 3000 ? ' · 미세 이동 버튼으로 포트에 천천히 닿으세요' : ' · [🛰 ISS] 버튼: 자동 접근');
}
const CARGO = [['💧', '마실 물 400 kg'], ['🍱', '우주 식량 6개월분'], ['🔬', '과학 실험 장비'], ['👕', '옷·생활용품'], ['🛠', '교체 부품']];
function onDocked() {
  mstate.manualDock = !rdv; docked = true; mstate.docked = true; rdv = null; rcsDir = null; autopilot = null; setSasUi('off');
  holdDocked(rk, uniNow()); sound.boom(0.25, 1);
  const n = store.get('rocket3d.issVisits', 0) + 1; store.set('rocket3d.issVisits', n);
  let k = 0;
  const show = () => sheet('<h2>🛰 도킹 성공!</h2><p>' + esc(designName) + '이(가) 국제우주정거장에 연결됐어요. 승무원이 문을 열었어요.</p><ul class="cargo-list">' +
    CARGO.map((c, i) => `<li class="${i < k ? 'done' : ''}">${i < k ? '✔' : c[0]} ${c[1]}</li>`).join('') + '</ul>' +
    (k >= CARGO.length ? '<p class="fact">💡 실제로는 우주왕복선·소유즈·드래곤 같은 우주선이 몇 달마다 물과 식량을 실어 날라요. 정거장 안의 물은 대부분 땀과 소변까지 걸러 다시 써요.</p>' : '<p class="muted">화물을 정거장으로 옮기는 중…</p>'),
    k >= CARGO.length ? [{ label: '도킹 유지', fn: () => {} }, { label: '분리하고 귀환 준비', primary: true, fn: doUndock }] : [{ label: '기다리기', keep: true }]);
  show();
  const step = () => { if (!docked) return; k++; if (k >= CARGO.length) { mstate.cargo = true; sound.beep(true); } show(); if (k < CARGO.length) setTimeout(step, 900); };
  setTimeout(step, 1200);
}
function doUndock() {
  if (!docked) return;
  docked = false; undock(rk, uniNow());
  toast('분리! 천천히 정거장에서 멀어져요.\n[역진행]으로 돌려 엔진을 켜면 고도가 낮아져 돌아올 수 있어요.', false, 4200);
}

// ───────── 우주왕복선 자세·착륙 바퀴·감속 낙하산 ─────────
const dragChute = buildDragChute(); rocketGroup.add(dragChute);
let gearT = 0, chuteT = 0, chuteGone = 0, tdShown = false;
// 궤도선은 배(검은 타일)가 공기를 받는 쪽으로 (받음각·뱅크 표현). 활주로에서는 배가 아래로
function orientRocket() {
  if (!(rk.gliding && rk.lifted)) { orient(rocketGroup, rk.fwd, rk.pos); return; }
  const Y = rk.fwd, up = V.norm(rk.pos), rel = V.sub(rk.vel, rk.wind || [0, 0, 0]), sp = V.len(rel);
  let X = null;
  if (sp > 30 && !rk.rolling) { const r = V.mul(rel, 1 / sp), b = V.sub(r, V.mul(Y, V.dot(r, Y))); if (V.len(b) > 0.05) X = V.mul(V.norm(b), -1); }
  if (!X) { const u = V.sub(up, V.mul(Y, V.dot(up, Y))); X = V.len(u) > 1e-4 ? V.norm(u) : V.norm(V.cross(Y, [1, 0, 0])); }
  const Xv = v3(X), Yv = v3(Y), Zv = new THREE.Vector3().crossVectors(Xv, Yv);
  tmpM.makeBasis(Xv, Yv, Zv); rocketGroup.quaternion.setFromRotationMatrix(tmpM);
}
function updateGearChute(dt) {
  if (!rocketModel) return;
  const isOrb = rk.segs.some(s => s.ids.some(id => PARTS[id].glider));
  // 바퀴: 최종 접근 중 고도 400 m 아래이거나 착지 뒤
  const want = isOrb && (rk.rolling || (rk.state === 'landed' && rk.touchdown) || (rk.gliding && rk.lifted && rk.alt < 400 && (!glide || ['final', 'flare', 'roll'].includes(glide.phase)))) ? 1 : 0;
  const prev = gearT; gearT += Math.sign(want - gearT) * Math.min(Math.abs(want - gearT), dt / 2.2);
  if (gearT !== prev || rocketModel._gear !== gearT) { setGear(rocketModel.group, gearT); rocketModel._gear = gearT; }
  if (want && prev === 0 && gearT > 0) toast('바퀴 내림! (착지 약 15초 전)', false, 1800);
  // 착지 순간 타이어 연기
  if (rk.touchdown && !tdShown) { tdShown = true; const up = horizon(rk.pos).up; for (let i = 0; i < 6; i++) world.emit(rk.pos, rk.vel, V.mul(rk.fwd, -1), up, 1.3, 2); sound.boom(0.3, 1); }
  if (!rk.touchdown) tdShown = false;
  // 감속 낙하산: 펴질 때 부풀고, 분리되면 뒤로 떨어져 사라짐
  if (rk.dragChute) { chuteT = Math.min(1, chuteT + dt / 1.2); chuteGone = 0; }
  else if (chuteT > 0) { chuteGone += dt; if (chuteGone > 2.5) chuteT = 0; }
  dragChute.visible = chuteT > 0;
  if (dragChute.visible) {
    const k = rk.dragChute ? chuteT : Math.max(0.05, 1 - chuteGone / 2.5);
    dragChute.scale.set(0.3 + 0.7 * k, 0.5 + 0.5 * k + (rk.dragChute ? 0 : chuteGone * 0.6), 0.3 + 0.7 * k);
    dragChute.position.set(0.75, 0.3 - (rk.dragChute ? 0 : chuteGone * 6), 0);   // 꼬리 날개 아래에 묶여 뒤(-y)로 펼쳐짐
  }
}

// ───────── 메인 루프 ─────────
let last = performance.now(), first = true;
function frame(now) {
  const dtMs = now - last, dtReal = Math.min(0.1, dtMs / 1000);
  last = now;
  trackPerf(now, dtMs);
  if (mode === 'build') {
    builder.update();
    render(builder.scene, builder.camera);
  } else flightFrame(dtReal, dtMs);
  if (first) { first = false; $('loading').hidden = true; }
  requestAnimationFrame(frame);
}
function render(sc, cm) {
  if (tier.bloom) { renderPass.scene = sc; renderPass.camera = cm; composer.render(); }
  else renderer.render(sc, cm);
}

function flightFrame(dtReal, dtMs = dtReal * 1000) {
  const paused = !$('sheetBg').hidden && !ended;
  let warp = WARPS[warpIdx];
  if (rk.alt < PLANET.atm && warp > 4) warp = 4;
  if ((autopilot || rk.thrustNow > 0) && warp > 4) warp = 4;
  const hz = horizon(rk.pos), axes = viewAxes(hz.up);
  if (!paused) {
    const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), ky = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    rk.tiltDir = V.add(V.mul(axes.R, joy[0] || kx), V.mul(axes.F, joy[1] || ky));
    tickCountdown(dtReal);
    if (autopilot && rk.nextAction === 'launch') { if (!countdown) startCountdown(); }
    else if (autopilot) {
      autopilot.update();
      // ISS 목표로 자동 비행하면 궤도에 오른 뒤 그대로 랑데부 도우미로 이어짐
      if (targetISS && autopilot.phase === 'done' && rk.orbited && rk.nextAction !== 'deploy') { autopilot = null; rdv = new Rendezvous(rk); setSasUi('iss'); toast('🛰 궤도 진입! 이제 ISS를 따라잡아요.\n오른쪽 위 1× 버튼으로 시간을 빨리 감으면 금방이에요.', false, 4200); }
    }
    if (glide) warp = Math.min(warp, glide.update(dtReal * warp));
    if (rdv && !docked) warp = Math.min(warp, rdv.update(uniNow()));
    if (rcsDir && !docked) rk.rcs = rcsVec(rcsDir); else if (!rdv && !glide) rk.rcs = null;
    if (rk.ignited && mstate.windowLaunch == null) mstate.windowLaunch = launchWindow(uniNow()).open;
    rk.update(dtReal * warp);
    if (docked) holdDocked(rk, uniNow() + dtReal * warp * 1000);
    else if (rk.lifted && (rdv || rcsDir || targetISS) && canDock(rk, uniNow() + dtReal * warp * 1000).ok) onDocked();
  }
  // 우주 시계(ISS·위성)를 로켓 물리 시간과 정확히 맞춤: 멈춤이면 시계도 멈추고, 배속이면 그만큼 앞당김
  if (!paused && simClock != null) simClock += dtReal * warp * 1000;
  void dtMs;
  if (rk.version !== modelVersion || rk.sailOpen !== modelSail || rk.balloon !== modelBalloon) rebuildModel();
  const alt = rk.alt;
  // 로켓이 번개를 맞음
  if (rk.strikeAt !== lastStrike && rk.strikeAt >= 0) { lastStrike = rk.strikeAt; world.bolt([0, 0, 0], horizon(rk.pos).up); }
  const smokeAmt = (FLAMES[design.flame] || FLAMES.kerosene).smokeAmt;
  if (!paused && rk.thrustNow > 0 && alt < PLANET.atm * 0.8 && Math.random() < smokeAmt) world.emit(rk.pos, rk.vel, rk.fwd, hz.up, alt, Math.max(1, Math.round((tierKey === 'high' ? 4 : tierKey === 'medium' ? 2 : 1) * Math.max(1, smokeAmt))));
  const followAlt = follow ? V.len(follow.pos) - PLANET.R : Infinity, viewAlt = Math.min(alt, followAlt);
  const info = world.update(rk.pos, paused ? 0 : dtReal * Math.min(warp, 4), viewAlt, camera, renderer.domElement.height, map);
  // 발사장 절차(이렉터 후퇴·엄빌리칼 분리·작업 암·지상고정장치)와 화염유도로 수증기
  if (!paused && alt < 3000) {
    for (const m of world.complex.update(dtReal * Math.min(warp, 4), rk)) toast(m, false, 4200);
    world.steam(world.complex.steam(rk, tierKey === 'high' ? 3 : tierKey === 'medium' ? 2 : 1));
  }
  // 점화 순간 '쿵', 비행 시간 표시, 엔진 소리
  if (rk.ignited && !wasIgnited) { ignT = rk.t; sound.boom(1.1, 1); }
  wasIgnited = rk.ignited;
  const tEl = $('hTime');
  tEl.parentElement.classList.toggle('count', !!countdown);
  tEl.textContent = countdown ? 'T−' + Math.max(1, Math.floor(countdown.left)) : rk.ignited ? 'T+ ' + fmtClock(rk.t - ignT) : '대기';
  const ionOnly = rk.coreThrust > 0 && rk.active && rk.active.ids.some(id => PARTS[id].ion);
  if (follow) sound.update({ thrust: follow.lander ? follow.lander.burn : 0, dens: Math.exp(-Math.max(0, followAlt) / 9000), dist: cam.dist, q: 0, ion: false, paused });
  else sound.update({ thrust: rk.thrustNow > 0 ? Math.min(1, 0.35 + 0.65 * rk.throttle + (rk.thrustNow - rk.coreThrust > 0 ? 0.3 : 0)) : 0, dens: Math.exp(-Math.max(0, alt) / 9000), dist: map ? 600 : cam.dist, q: rk.q, ion: ionOnly, paused });

  // 로켓·불꽃·낙하산
  orientRocket();
  updateGearChute(dtReal);
  const vac = Math.min(1, Math.max(0, alt / PLANET.atm));
  for (const m of [flameMat, ionFlameMat]) { m.uniforms.uTime.value += dtReal; m.uniforms.uVac.value = vac; }
  const boosterOn = rk.thrustNow - rk.coreThrust > 0, coreOn = rk.coreThrust > 0, nCore = Math.max(1, flames.filter(f => f.userData.kind === 'core').length);
  const ionOn = coreOn && rk.active && rk.active.ids.some(id => PARTS[id].ion);
  for (const f of flames) {
    const k = f.userData.kind, on = k === 'booster' ? boosterOn : k === 'ion' ? ionOn : coreOn && !ionOn;
    f.visible = on;
    if (on) { const s = f.userData.size, L = (k === 'booster' ? 7 : k === 'ion' ? 5 : 6 + rk.coreThrust / nCore / 30000) * s * (1 + vac * 0.8), w = s * (1 + vac * 1.8); f.scale.set(w, L, w); }
  }
  canopy.visible = rk.chute === 'open';
  const alive = new Set(rk.debris);
  for (const [d, m] of debrisModels) if (!alive.has(d)) { scene.remove(m.group); debrisModels.delete(d); }
  for (const d of rk.debris) {
    if (!debrisModels.has(d)) {
      const m = buildRocket(d.design, tierKey); scene.add(m.group); debrisModels.set(d, m);
      if (d.lander) m.flames = m.nozzles.slice(0, 12).map(nz => { const f = makeFlame('core'); f.position.set(nz[0], nz[1], nz[2]); f.userData.size = nz[3]; m.group.add(f); return f; });
    }
    const m = debrisModels.get(d); m.group.position.copy(v3(V.sub(d.pos, rk.pos))); orient(m.group, d.fwd, d.pos);
    if (d.lander) {
      const L = d.lander, key = (L.legs ? 1 : 0) + (L.grid ? 2 : 0);
      if (m.landKey !== key) { m.landKey = key; setLanding(m.group, L.legs, L.grid); }
      for (const f of m.flames) { f.visible = L.burn > 0; if (f.visible) { const s = f.userData.size, Lh = (4 + 6 * L.burn) * s; f.scale.set(s, Lh, s); } }
      const dAlt = V.len(d.pos) - PLANET.R - L.ground;
      if (!paused && L.burn > 0 && dAlt < 3000 && Math.random() < 0.6) world.emit(d.pos, d.vel, d.fwd, horizon(d.pos).up, dAlt, 2);
    }
  }
  if (follow && !follow.iss && !rk.debris.includes(follow)) { follow = null; $('followBtn').classList.remove('on'); }
  $('followBtn').hidden = !rk.debris.some(d => d.lander) && !(follow && follow.iss);

  // 빛·안개
  const sunUp = SUN_DIR.dot(v3(hz.up));
  sun.intensity = 3.0 * Math.max(0, Math.min(1, (sunUp + 0.1) / 0.3)) + (alt > PLANET.atm ? 0.6 : 0);
  hemi.intensity = 0.35 * Math.exp(-alt / 15000) * Math.max(0.1, sunUp + 0.2);
  scene.fog.color.copy(info.haze);
  scene.fog.near = map || viewAlt > 30000 ? 1e10 : 3000 + viewAlt; scene.fog.far = map || viewAlt > 30000 ? 2e10 : 70000 + viewAlt * 4;
  // 구름 속을 지날 때 하얗게
  const inCloud = map ? 0 : Math.min(1, info.inCloud * 1.6);
  if (inCloud > 0.02) { scene.fog.color.lerp(new THREE.Color(0.62, 0.64, 0.68).multiplyScalar(weather.key === 'storm' ? 0.5 : 1), inCloud); scene.fog.near = 10; scene.fog.far = 150 + (1 - inCloud) * 2500; }
  hemi.intensity += (world.flash || 0) * 2;
  sun.position.copy(SUN_DIR).multiplyScalar(80); sun.target.position.set(0, 0, 0);
  sun.castShadow = tier.shadows && alt < 300 && !map;

  { const st = issState(uniNow()); issObj.pos = st.pos; issObj.vel = st.vel; issObj.fwd = V.norm(st.pos); }   // ISS 위치를 카메라보다 먼저
  updateCamera(hz);
  if (!map && rk.q > 2000) { const sh = Math.min(0.25, rk.q / 300000 + rk.windSpeed / 400) * (weather.gust || 0.2); camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
  rocketGroup.visible = !map;
  const ob = updateOrbitView();
  if (ob && !ob.escape && rk.lifted) mstate.maxAp = Math.max(mstate.maxAp, ob.ap); else if (ob && ob.escape) mstate.maxAp = Infinity;
  updateMission();
  render(scene, camera);
  drawDial(axes);
  updateHud(ob, warp);
  flushEvents();
  if (!ended && (rk.state === 'landed' || rk.state === 'crashed')) { ended = true; bench = null; setTimeout(showResult, 1500); }
}

resize();
setMode('build');
window.__sim = { get rk() { return rk; }, uniNow, advance(dt) { for (let t = 0; t < dt && rk.state === 'flying'; t += 0.1) { if (glide) glide.update(0.1); if (rdv && !docked) rdv.update(uniNow()); rk.update(0.1); simClock += 100; if (docked) holdDocked(rk, uniNow()); else if (canDock(rk, uniNow()).ok) { onDocked(); break; } } }, get rdv() { return rdv; }, get glide() { return glide; }, get docked() { return docked; }, get tier() { return tierKey; }, get world() { return world; }, get mode() { return mode; }, builder, scene, renderer, camera, perf, applyTier, startBench, setSas, startFlight, setMode, get sats() { return sats; } }; // 테스트용
requestAnimationFrame(frame);
