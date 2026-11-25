// 설계({stack, radial, livery})로 실사풍 3D 로켓 모델을 만든다. 원점 = 맨 아래, +y = 기수 방향
import * as THREE from './vendor/three.module.min.js';
import { decalCanvas } from './flags.js';

const { PARTS } = window.Parts;
const RAD = 0.625, BR = 0.42;

function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// 패널 이음매(흰 바탕, 색은 재질 color로 곱해짐)
let _panel = null;
const panelTex = () => _panel || (_panel = canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(60,65,75,.35)'; c.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  c.strokeStyle = 'rgba(60,65,75,.2)'; c.lineWidth = 1;
  for (let y = 0; y <= h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`; c.fillRect(Math.random() * w, Math.random() * h, 30, 6); }
}));
const solarTex = () => canvasTex(128, 256, (c, w, h) => {
  c.fillStyle = '#0d1a3a'; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { c.fillStyle = `rgb(${18 + Math.random() * 8},${36 + Math.random() * 10},${86 + Math.random() * 20})`; c.fillRect(x + 1, y + 1, 14, 14); }
  c.strokeStyle = '#8890a0'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
});
const foilTex = () => canvasTex(128, 128, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#b8862e'); g.addColorStop(0.5, '#e8c46a'); g.addColorStop(1, '#a6741f');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { c.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,240,190' : '90,60,10'},${0.15 + Math.random() * 0.2})`; c.beginPath(); c.moveTo(Math.random() * w, Math.random() * h); c.lineTo(Math.random() * w, Math.random() * h); c.stroke(); }
});
const catFaceTex = () => canvasTex(256, 128, (c, w, h) => {
  c.fillStyle = '#f6f1ea'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#222'; c.beginPath(); c.ellipse(w * 0.4, h * 0.42, 9, 13, 0, 0, Math.PI * 2); c.ellipse(w * 0.6, h * 0.42, 9, 13, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ff8fab'; c.beginPath(); c.moveTo(w * 0.5 - 7, h * 0.58); c.lineTo(w * 0.5 + 7, h * 0.58); c.lineTo(w * 0.5, h * 0.66); c.fill();
  c.strokeStyle = '#555'; c.lineWidth = 2;
  for (const s of [-1, 1]) for (const dy of [-6, 2, 10]) { c.beginPath(); c.moveTo(w * 0.5 + s * 14, h * 0.62 + dy * 0.4); c.lineTo(w * 0.5 + s * 52, h * 0.58 + dy); c.stroke(); }
});

const S = (o) => new THREE.MeshStandardMaterial(o);
const shared = {};
function mat(key) {
  if (shared[key]) return shared[key];
  const m = {
    black: () => S({ color: 0x141518, roughness: 0.55, metalness: 0.2 }),
    steel: () => S({ color: 0x9aa0aa, roughness: 0.28, metalness: 0.9 }),
    darkMetal: () => S({ color: 0x3a3d44, roughness: 0.45, metalness: 0.85 }),
    copper: () => S({ color: 0xb86a3a, roughness: 0.25, metalness: 1.0, side: THREE.DoubleSide }),
    nozzleIn: () => S({ color: 0x1a1210, roughness: 0.9, metalness: 0.2, side: THREE.BackSide }),
    heat: () => S({ color: 0x3a2a20, roughness: 0.95, metalness: 0.05 }),
    glass: () => S({ color: 0x0b1626, roughness: 0.05, metalness: 0.6 }),
    chute: () => S({ color: 0xd8d2c6, roughness: 0.9 }),
    foil: () => S({ map: foilTex(), roughness: 0.32, metalness: 1.0 }),
    solar: () => S({ map: solarTex(), roughness: 0.22, metalness: 0.4, side: THREE.DoubleSide }),
    white: () => S({ color: 0xf1f2f4, roughness: 0.35, metalness: 0.05 }),
    sail: () => S({ color: 0xe8e2ff, roughness: 0.15, metalness: 1.0, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
    balloon: () => S({ color: 0xf4f2ee, roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.95 }),
    ionGlow: () => new THREE.MeshBasicMaterial({ color: 0x66aaff }),
    catFace: () => S({ map: catFaceTex(), roughness: 0.6 }),
    pink: () => S({ color: 0xffb7c5, roughness: 0.6 }),
  }[key]();
  return (shared[key] = m);
}
// 도색: 몸통색·포인트색 (색 조합마다 재질을 한 번만 만듦)
const paintCache = {};
function paint(livery) {
  const steel = livery.finish === 'steel';   // 스테인리스 맨 금속 (스타십)
  const key = (livery.body || '#f1f2f4') + (livery.accent || '#141518') + (steel ? 's' : '');
  if (paintCache[key]) return paintCache[key];
  const body = S({ map: panelTex(), color: new THREE.Color(livery.body || '#f1f2f4'), roughness: steel ? 0.3 : 0.38, metalness: steel ? 0.85 : 0.05 });
  const plain = S({ color: new THREE.Color(livery.body || '#f1f2f4'), roughness: steel ? 0.28 : 0.35, metalness: steel ? 0.85 : 0.05 });
  const accent = S({ color: new THREE.Color(livery.accent || '#141518'), roughness: 0.5, metalness: 0.2 });
  return (paintCache[key] = { body, plain, accent });
}

function cyl(rt, rb, h, seg, m, y, open) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open), typeof m === 'string' ? mat(m) : m);
  mesh.position.y = y + h / 2;
  return mesh;
}
function bell(rTop, rBot, h, seg, y) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(rTop + (rBot - rTop) * Math.pow(t, 0.6), h * (1 - t))); }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat('copper')));
  const inner = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat('nozzleIn')); inner.scale.set(0.97, 1, 0.97); g.add(inner);
  g.position.y = y;
  return g;
}
function ogive(r, h, seg, m, y) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(r * Math.sqrt(1 - t * t) * (1 - t * 0.15) + 0.0001, h * t)); }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), typeof m === 'string' ? mat(m) : m);
  mesh.position.y = y;
  return mesh;
}

export function buildSatellite(type, seg = 20, deployed = true) {
  const g = new THREE.Group();
  if (type === 'obs') {
    g.add(cyl(0.55, 0.55, 1.6, seg, 'foil', 0.2));
    g.add(cyl(0.38, 0.45, 0.4, seg, 'darkMetal', 1.8));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.32, seg), mat('glass')); lens.rotation.x = -Math.PI / 2; lens.position.y = 2.21; g.add(lens);
    g.add(cyl(0.6, 0.6, 0.2, seg, 'steel', 0));
  } else {
    const bus = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 1.0), mat('foil')); bus.position.y = 0.75; g.add(bus);
    g.add(cyl(0.55, 0.6, 0.12, seg, 'steel', 0));
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, seg, 8, 0, Math.PI * 2, 0, 0.9), mat('white'));
    dish.rotation.x = Math.PI; dish.position.y = 1.85; g.add(dish);
    g.add(cyl(0.03, 0.03, 0.35, 6, 'steel', 1.4));
  }
  for (const s of [-1, 1]) {
    if (deployed) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), mat('steel')); arm.position.set(s * 0.85, 0.9, 0); g.add(arm);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 1.0), mat('solar')); panel.position.set(s * 2.5, 0.9, 0); g.add(panel);
    } else { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.9), mat('solar')); p.position.set(s * 0.53, 0.75, 0); g.add(p); }
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function buildSail(open) {
  const g = new THREE.Group();
  if (!open) { g.add(cyl(RAD * 0.9, RAD * 0.9, 0.8, 20, 'darkMetal', 0)); g.add(cyl(RAD * 0.92, RAD * 0.92, 0.12, 20, 'sail', 0.6)); return g; }
  g.add(cyl(0.3, 0.3, 0.8, 12, 'darkMetal', 0));
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(24, 24, 1, 1), mat('sail')); sail.rotation.x = -Math.PI / 2; sail.rotation.z = Math.PI / 4; sail.position.y = 0.9; g.add(sail);
  for (const a of [0, Math.PI / 2]) { const boom = new THREE.Mesh(new THREE.BoxGeometry(34, 0.08, 0.08), mat('steel')); boom.position.y = 0.92; boom.rotation.y = a; g.add(boom); }
  return g;
}

// 엔진 클러스터 배치: 몸통 반지름을 1로 본 위치들과 엔진 하나의 축소 비율
const BELL_R = id => id === 'engH' ? 0.62 : id === 'engL' || id === 'engV' ? 0.6 : 0.46;
export const NOZZLE_SIZE = id => id === 'engH' ? 1.5 : id === 'engL' ? 1.25 : id === 'engV' ? 0.9 : PARTS[id].ion ? 0.6 : 1;
const ring = (k, r, off = 0) => Array.from({ length: k }, (_, i) => { const a = off + i / k * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
const LAYOUTS = {
  1: [[0, 0]], 2: ring(2, 0.5), 3: ring(3, 0.52, Math.PI / 2), 4: ring(4, 0.55, Math.PI / 4),
  5: [[0, 0], ...ring(4, 0.62, Math.PI / 4)], 7: [[0, 0], ...ring(6, 0.64)], 9: [[0, 0], ...ring(8, 0.68)],
  30: [...ring(6, 0.3), ...ring(24, 0.8)], 33: [...ring(3, 0.13), ...ring(10, 0.47), ...ring(20, 0.83)],
};
const layoutCache = {};
export function clusterLayout(id, w = 1) {
  const p = PARTS[id], n = p.cluster || 1, base = p.base || id;
  const key = base + n + '|' + w; if (layoutCache[key]) return layoutCache[key];
  const pos = LAYOUTS[n] || [[0, 0]];
  let room = 1.05;
  for (let i = 0; i < pos.length; i++) {
    room = Math.min(room, 1.08 - Math.hypot(...pos[i]));
    for (let j = i + 1; j < pos.length; j++) room = Math.min(room, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) / 2);
  }
  const s = Math.min(1, room * RAD * w / BELL_R(base));
  return (layoutCache[key] = { pos, s, base, w });
}

// 부품마다 아래·위 굵기(몸통 반지름의 배수). 탱크는 스스로 정하고, 엔진은 바로 위 부품을, 분리기는 위아래를 이어 줌
export function stackWidths(stack) {
  const n = stack.length, out = new Array(n);
  const own = id => { const p = PARTS[id]; return p.kind === 'tank' ? { b: p.w || 1, t: p.wt || p.w || 1 } : (p.kind === 'engine' || p.kind === 'dec') ? null : { b: 1, t: 1 }; };
  for (let i = 0; i < n; i++) {
    const p = PARTS[stack[i]], up = i > 0 ? out[i - 1].b : 1;
    let w = own(stack[i]);
    if (!w && p.kind === 'engine') w = { b: up, t: up };
    if (!w) { const nx = i + 1 < n ? own(stack[i + 1]) : null; w = { t: up, b: nx ? nx.t : up }; }
    out[i] = w;
  }
  // 노즈콘은 바로 아래 부품의 굵기에 맞춤 (탈출 타워는 그대로)
  for (let i = n - 2; i >= 0; i--) { const p = PARTS[stack[i]]; if (p.kind === 'nose' && p.look !== 'les') out[i] = { b: out[i + 1].t, t: out[i + 1].t }; }
  return out;
}
const gridTex = () => canvasTex(64, 64, (c, w, h) => {
  c.clearRect(0, 0, w, h); c.strokeStyle = '#d8dbe0'; c.lineWidth = 5; c.strokeRect(3, 3, w - 6, h - 6);
  c.lineWidth = 3;
  for (let k = 1; k < 6; k++) {
    c.beginPath(); c.moveTo(0, k * h / 6); c.lineTo(w, k * h / 6); c.stroke();
    c.beginPath(); c.moveTo(k * w / 6, 0); c.lineTo(k * w / 6, h); c.stroke();
  }
});
let _grid = null;
const gridMat = () => _grid || (_grid = new THREE.MeshStandardMaterial({ map: gridTex(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.4, color: 0x9aa0aa }));
function strut(m, A, B, r) {
  const st = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 5), mat(m));
  st.position.copy(A).add(B).multiplyScalar(0.5); st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return st;
}


// 우주왕복선 궤도선: 기수 +y, 배(검은 타일) -x, 꼬리 날개 +x
const ORB_SSME = [[0.3, 0], [-0.1, 0.24], [-0.1, -0.24]];   // 주 엔진 3개 (x, z)
const ORB_OMS = [[0.42, 0.36], [0.42, -0.36]];               // 궤도 조종 엔진 2개
function buildOrbiter(h, seg) {
  const g = new THREE.Group(), white = mat('white'), black = mat('black');
  g.add(cyl(0.6, 0.62, 0.7, seg, 'white', 0));                                   // 꼬리 부분
  g.add(cyl(0.55, 0.6, h - 2.1, seg, 'white', 0.7));                             // 동체
  g.add(ogive(0.55, 1.4, seg, 'white', h - 1.4));                                // 기수
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.6, h - 2.1, seg, 1, true, Math.PI, Math.PI), black); belly.position.y = 0.7 + (h - 2.1) / 2; g.add(belly);   // 배 쪽 타일
  const nosecap = ogive(0.556, 1.4, seg, 'black', h - 1.4); nosecap.scale.set(1.01, 1, 1.01); nosecap.position.x = -0.02; g.add(nosecap);
  // 삼각 날개 (양쪽)
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0.45 * s, 0.35); sh.lineTo(2.35 * s, 0.55); sh.lineTo(2.35 * s, 1.05); sh.lineTo(0.95 * s, 3.2); sh.lineTo(0.5 * s, 4.6); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false });
    const w = new THREE.Mesh(geo, white); w.rotation.y = -Math.PI / 2; w.position.x = -0.32; g.add(w);
    const wb = new THREE.Mesh(geo, black); wb.rotation.y = -Math.PI / 2; wb.position.x = -0.43; wb.scale.z = 0.3; g.add(wb);
  }
  // 꼬리 날개
  { const sh = new THREE.Shape(); sh.moveTo(0.5, 0.3); sh.lineTo(1.5, 0.05); sh.lineTo(1.95, 0.35); sh.lineTo(0.55, 2.1); sh.closePath();
    const t = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false }), white); t.position.z = -0.04; g.add(t); }
  // 화물칸 문 이음매, 조종실 창
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.55, 0.03), mat('darkMetal')); door.position.set(0.56, h * 0.48, 0); g.add(door);
  for (const z of [-0.18, 0, 0.18]) { const wnd = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.14), mat('glass')); wnd.position.set(0.43, h - 1.15, z); wnd.rotation.z = -0.5; g.add(wnd); }
  // 엔진: 주 엔진 3개 + 궤도 조종 엔진 포드 2개
  for (const [x, z] of ORB_SSME) { const b = bell(0.09, 0.24, 0.6, Math.max(10, seg >> 1), -0.55); b.position.x = x; b.position.z = z; g.add(b); }
  for (const [x, z] of ORB_OMS) { const pod = cyl(0.17, 0.2, 1.0, 12, 'white', 0.2); pod.position.x = x; pod.position.z = z; g.add(pod); const b = bell(0.05, 0.11, 0.28, 10, -0.05); b.position.x = x; b.position.z = z; g.add(b); }
  // 착륙 바퀴: 앞바퀴 1개(기수 아래) + 주바퀴 2개(날개 뿌리 아래). 배(-x) 쪽으로 내려옴
  const tire = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
  for (const [y, z, nose] of [[h - 1.75, 0, true], [1.55, 0.62, false], [1.55, -0.62, false]]) {
    const leg = new THREE.Group(); leg.position.set(-0.52, y, z); leg.userData.gear = 1; leg.visible = false; g.add(leg);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 8), mat('steel')); strut.rotation.z = Math.PI / 2; strut.position.x = -0.31; leg.add(strut);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, nose ? 0.5 : 0.7, 0.32), mat('black')); door.position.set(-0.08, 0, nose ? 0.2 : (z > 0 ? 0.24 : -0.24)); door.rotation.x = nose ? 0.9 : (z > 0 ? 0.9 : -0.9); leg.add(door);
    for (const dz of [-0.09, 0.09]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 14), tire); w.rotation.x = Math.PI / 2; w.position.set(-0.62, 0, dz); leg.add(w); }
  }
  return g;
}

function partMesh(id, seg, P, opt, wd) {
  const p = PARTS[id], h = p.h, g = new THREE.Group();
  const W = wd || { b: 1, t: 1 };
  if (p.look === 'hidden' || p.look === 'ssme' || p.look === 'oms') return g;   // 궤도선 안에 그려지는 부품
  if (p.look === 'orbiter') { g.add(buildOrbiter(h, seg)); return g; }
  switch (p.kind) {
    case 'chute':
      g.add(cyl(RAD * 0.42, RAD * 0.6, h * 0.75, seg, P.plain, 0));
      g.add(cyl(RAD * 0.3, RAD * 0.42, h * 0.25, seg, 'chute', h * 0.75));
      break;
    case 'pod': {
      g.add(cyl(RAD * 0.98, RAD, 0.12, seg, 'heat', 0));
      if (p.cat) {
        g.add(cyl(RAD * 0.5, RAD * 0.98, h - 0.12, seg, 'pink', 0.12));
        const face = new THREE.Mesh(new THREE.CylinderGeometry(RAD * 0.62 + 0.02, RAD * 0.86 + 0.02, h * 0.42, seg, 1, true, -0.7, 1.4), mat('catFace'));
        face.position.y = h * 0.45; g.add(face);
        for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 4), mat('pink')); ear.position.set(s * 0.2, h + 0.12, 0.05); ear.rotation.z = -s * 0.25; g.add(ear); }
      } else {
        g.add(cyl(RAD * 0.5, RAD * 0.98, h - 0.12, seg, 'steel', 0.12));
        for (const a of [0.35, -0.35]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.05), mat('glass')); w.position.set(Math.sin(a) * 0.5, h * 0.62, Math.cos(a) * 0.5); w.rotation.set(-0.28, a, 0); g.add(w); }
      }
      break;
    }
    case 'nose': {
      if (p.look === 'les') {
        // 비상 탈출 타워: 뼈대 + 고체 모터 + 뾰족한 끝
        g.add(cyl(RAD * 0.98, RAD, 0.05, seg, 'steel', 0));
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.add(strut('darkMetal', new THREE.Vector3(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42), new THREE.Vector3(Math.cos(a) * 0.12, 1.0, Math.sin(a) * 0.12), 0.025)); }
        g.add(cyl(0.18, 0.18, 1.3, seg, 'white', 1.0));
        g.add(cyl(0.2, 0.2, 0.12, seg, 'black', 1.0));
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, nz = cyl(0.03, 0.06, 0.16, 8, 'darkMetal', 1.02); nz.position.x = Math.cos(a) * 0.17; nz.position.z = Math.sin(a) * 0.17; g.add(nz); }
        g.add(ogive(0.18, 0.5, seg, 'white', 2.3));
        break;
      }
      const RN = RAD * W.b;
      g.add(ogive(RN, h, seg, P.plain, 0));
      if (p.look === 'starship') {
        // 한쪽 면은 검은 내열 타일, 앞날개 2개
        const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(RN * Math.sqrt(1 - t * t) * (1 - t * 0.15) * 1.012 + 0.0001, h * t)); }
        g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, seg, Math.PI / 2, Math.PI), mat('black')));
        for (const sx of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.05), mat('black')); f.position.set(sx * (RN * 0.62 + 0.28), h * 0.3, -0.05); f.rotation.z = -sx * 0.32; g.add(f); }
      }
      break;
    }
    case 'tank': {
      if (p.look === 'et') {
        // 주황색 단열재 외부 탱크: 위가 둥근 탄환 모양
        const r = RAD * W.b, foam = new THREE.MeshStandardMaterial({ map: panelTex(), color: 0xc8692c, roughness: 0.95 });
        g.add(cyl(r, r, h - 1.8, seg, foam, 0)); g.add(ogive(r, 1.8, seg, foam, h - 1.8));
        g.add(cyl(r + 0.01, r + 0.01, 0.12, seg, foam, h * 0.42));
        break;
      }
      const rb = RAD * W.b, rt = RAD * W.t, rAt = f => rb + (rt - rb) * f;
      g.add(cyl(rt, rb, h, seg, P.body, 0));
      g.add(cyl(rAt(0.02) + 0.008, rb + 0.008, 0.16, seg, P.accent, 0));
      g.add(cyl(rt + 0.008, rAt(0.98) + 0.008, 0.16, seg, P.accent, h - 0.16));
      if (h > 4) g.add(cyl(rAt(0.51) + 0.008, rAt(0.49) + 0.008, 0.1, seg, P.accent, h * 0.5));
      break;
    }
    case 'engine': {
      if (p.cluster > 1) {
        // 같은 엔진 여러 개를 줄여서 원형으로 배치 + 위쪽 추력 구조(엔진 받침판)
        const L = clusterLayout(id, W.b), R = RAD * W.b, one = partMesh(L.base, p.cluster >= 9 ? Math.max(10, seg >> 1) : seg, P, opt);
        const top = h * L.s * 0.55;   // 엔진 윗부분을 덮는 추력 구조(엔진 받침 치마)
        g.add(cyl(R * 0.97, R, h - top, seg, 'darkMetal', top));
        g.add(cyl(R * 0.99, R * 0.99, 0.08, seg, P.accent, top));
        for (const [x, z] of L.pos) { const e = one.clone(); e.scale.setScalar(L.s); e.position.set(x * R, 0, z * R); g.add(e); }
        break;
      }
      if (p.ion) {
        g.add(cyl(RAD * 0.8, RAD * 0.7, h * 0.5, seg, 'darkMetal', h * 0.5));
        g.add(cyl(0.34, 0.34, h * 0.5, seg, 'steel', 0, true));
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, seg), mat('ionGlow')); glow.rotation.x = Math.PI / 2; glow.position.y = 0.02; g.add(glow);
        break;
      }
      const big = id === 'engL' || id === 'engH', vac = id === 'engV', huge = id === 'engH';
      if (W.b > 1.05) g.add(cyl(RAD * W.b, RAD * 0.9, h * 0.32, seg, 'darkMetal', h * 0.68)); // 굵은 탱크 아래: 원뿔 치마
      g.add(cyl(RAD * 0.86, RAD * 0.7, h * 0.32, seg, 'darkMetal', h * 0.68));
      g.add(cyl(0.12, 0.12, h * 0.25, 8, 'steel', h * 0.45));
      const pipes = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 16), mat('steel')); pipes.rotation.x = Math.PI / 2; pipes.position.y = h * 0.55; g.add(pipes);
      g.add(bell(big ? 0.22 : 0.16, vac ? 0.6 : huge ? 0.62 : big ? 0.6 : 0.46, h * (vac ? 0.62 : 0.5), seg, 0));
      break;
    }
    case 'srb': {
      if (p.look === 'sts') {
        // 왕복선 고체 부스터: 흰 몸통, 뾰족한 머리, 아래로 퍼진 치마
        const r = p.r || BR;
        g.add(cyl(r * 1.0, r * 1.3, 0.8, seg, 'white', 0));
        g.add(cyl(r, r, h - 2.0, seg, P.plain, 0.8));
        g.add(ogive(r, 1.2, seg, 'white', h - 1.2));
        for (const f of [0.3, 0.6]) g.add(cyl(r + 0.01, r + 0.01, 0.12, seg, 'black', h * f));
        g.add(bell(r * 0.4, r * 0.78, 0.5, seg, -0.4));
        break;
      }
      if (p.look === 'cone') {
        // 소유즈형 원뿔 부스터: 위가 뾰족, 아래에 작은 엔진 4개
        const r = p.r || BR, pts = [];
        for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(Math.max(0.02, r * (1 - Math.pow(t, 1.25) * 0.86)), 0.5 + (h - 0.5) * t)); }
        g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, seg), P.plain));
        g.add(cyl(r * 0.95, r * 0.95, 0.5, seg, 'darkMetal', 0));
        g.add(cyl(r + 0.01, r * 0.99, 0.14, seg, P.accent, 0.55));
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, b = bell(0.05, r * 0.33, 0.42, Math.max(10, seg >> 1), -0.3); b.position.x = Math.cos(a) * r * 0.48; b.position.z = Math.sin(a) * r * 0.48; g.add(b); }
        break;
      }
      if (p.look === 'core') {
        // 팰컨 헤비형 측면 코어: 몸통과 같은 굵기, 노즈콘, 검은 연결부, 엔진 9개, 격자 날개·착륙 다리
        const r = p.r || RAD;
        g.add(cyl(r, r, h - 1.6, seg, P.body, 0.6));
        g.add(cyl(r + 0.01, r + 0.01, 0.7, seg, 'black', h - 1.7));
        g.add(ogive(r, 1.0, seg, P.plain, h - 1.0));
        g.add(cyl(r * 0.97, r, 0.6, seg, 'darkMetal', 0));
        const one = partMesh('engL', Math.max(10, seg >> 1), P, opt);
        for (const [x, z] of LAYOUTS[9]) { const e = one.clone(); e.scale.setScalar(0.3); e.position.set(x * r * 0.95, -0.35, z * r * 0.95); g.add(e); }
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;
          const kg = new THREE.Group(); kg.rotation.y = Math.PI / 2 - a; g.add(kg);   // 바깥쪽 = kg의 +z
          const gf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), gridMat()); gf.position.set(0, h - 2.0, r + 0.03); gf.userData.grid = r + 0.03; kg.add(gf);
          const pv = new THREE.Group(); pv.position.set(0, 2.6, r + 0.05); pv.userData.leg = 1; kg.add(pv);
          const lg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.1), mat('black')); lg.position.y = -1.0; pv.add(lg);
        }
        break;
      }
      const r = p.radial ? (p.r || BR) : RAD * W.b;
      g.add(cyl(r, r, h - 0.6, seg, P.plain, 0.6));
      for (let i = 0; i < 3; i++) g.add(cyl(r + 0.008, r + 0.008, 0.12, seg, P.accent, 0.9 + i * (h - 1.4) / 3));
      if (p.radial) g.add(ogive(r, 0.9, seg, P.plain, h - 0.02));
      g.add(cyl(r * 0.7, r * 0.75, 0.25, seg, 'darkMetal', 0.4));
      g.add(bell(r * 0.35, r * 0.72, 0.45, seg, 0));
      break;
    }
    case 'dec': {
      const rb = RAD * W.b + 0.03, rt = RAD * W.t + 0.03;
      if (p.look === 'truss') {
        g.add(cyl(rb, rb, 0.1, seg, 'darkMetal', 0)); g.add(cyl(rt, rt, 0.1, seg, 'darkMetal', h - 0.1));
        for (let k = 0; k < 12; k++) {
          const a0 = k / 12 * Math.PI * 2, a1 = a0 + Math.PI / 6 * (k % 2 ? 1 : -1);
          g.add(strut('darkMetal', new THREE.Vector3(Math.cos(a0) * rb * 0.97, 0.1, Math.sin(a0) * rb * 0.97), new THREE.Vector3(Math.cos(a1) * rt * 0.97, h - 0.1, Math.sin(a1) * rt * 0.97), 0.035));
        }
        break;
      }
      g.add(cyl(rt, rb, h, seg, 'darkMetal', 0));
      g.add(cyl((rt + rb) / 2 + 0.005, (rt + rb) / 2 + 0.005, h * 0.25, seg, 'steel', h * 0.38));
      break;
    }
    case 'sat': { const sat = buildSatellite(p.sat, seg, false); sat.scale.setScalar(Math.min(1, h / (p.sat === 'obs' ? 2.4 : 2.1))); g.add(sat); break; }
    case 'shield': g.add(cyl(RAD + 0.05, RAD + 0.08, h, seg, 'heat', 0)); break;
    case 'lab': {
      g.add(cyl(RAD, RAD, h, seg, P.plain, 0));
      g.add(cyl(RAD + 0.01, RAD + 0.01, 0.1, seg, P.accent, 0.1));
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, w = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), mat('glass')); w.position.set(Math.sin(a) * (RAD + 0.01), h * 0.55, Math.cos(a) * (RAD + 0.01)); w.rotation.y = a; g.add(w); }
      const ant = cyl(0.02, 0.02, 0.6, 6, 'steel', h); ant.position.x = 0.35; g.add(ant);
      break;
    }
    case 'sail': g.add(buildSail(!!(opt && opt.sailOpen))); break;
    case 'balloon': {
      g.add(cyl(RAD * 0.7, RAD * 0.9, h * 0.6, seg, 'darkMetal', 0));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(RAD * 0.7, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('balloon')); dome.position.y = h * 0.6; g.add(dome);
      if (opt && opt.balloonUp) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), mat('balloon')); ball.scale.y = 1.25; ball.position.y = h + 34; g.add(ball);
        const pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pts.push(0, h, 0, Math.cos(a) * 6, h + 23, Math.sin(a) * 6); }
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xdddddd })));
      }
      break;
    }
    case 'fairing': break; // 아래 buildRocket에서 덮개로 그림
  }
  return g;
}

// 착륙 다리 펴기·격자 날개 펼치기 (분리된 부스터가 돌아올 때)
export function setLanding(group, legs, grid) {
  group.traverse(o => {
    if (o.userData.leg) o.rotation.x = legs ? -0.6 : 0;
    if (o.userData.grid != null) { o.rotation.x = grid ? Math.PI / 2 : 0; o.position.z = o.userData.grid + (grid ? 0.25 : 0); }
  });
}

// 반환: { group, height, nozzles: [[x, y, z, 크기, 종류]], parts: [{ mesh, stack?, radial? }] }
export function buildRocket(design, quality, opt = {}) {
  const d = Array.isArray(design) ? { stack: design, radial: [] } : design;
  const seg = quality === 'low' ? 12 : quality === 'medium' ? 20 : 32;
  const P = paint(d.livery || {});
  const group = new THREE.Group(), parts = [], nozzles = [], ys = [];
  const WS = stackWidths(d.stack);
  let y = 0;
  for (let i = d.stack.length - 1; i >= 0; i--) {
    const id = d.stack[i], m = partMesh(id, seg, P, opt, WS[i]);
    m.position.y = y; m.userData = { stack: i };
    group.add(m); parts.push({ mesh: m, stack: i });
    ys[i] = y;
    if (i === d.stack.length - 1 && PARTS[id].cluster > 1) {
      const L = clusterLayout(id, WS[i].b), sz = NOZZLE_SIZE(L.base) * Math.max(0.3, L.s * 1.1), R = RAD * WS[i].b;
      for (const [x, z] of L.pos) nozzles.push([x * R, y, z * R, sz, 'core']);
    } else if (i === d.stack.length - 1 && (PARTS[id].kind === 'engine' || PARTS[id].kind === 'srb') && !['ssme', 'oms'].includes(PARTS[id].look)) nozzles.push([0, y, 0, NOZZLE_SIZE(id), PARTS[id].ion ? 'ion' : 'core']);
    y += PARTS[id].h;
  }
  // 우주왕복선: 궤도선을 외부 탱크 옆(+x)에 붙이고, 주 엔진·궤도 조종 엔진 불꽃을 궤도선 꼬리에
  let topY = y;
  const oi = d.stack.findIndex(id => PARTS[id].look === 'orbiter'), ei = d.stack.findIndex(id => PARTS[id].look === 'et');
  if (oi >= 0) {
    const om = parts.find(p => p.stack === oi).mesh;
    let ox = 0, oy = ys[oi];
    if (ei > oi) { ox = RAD * WS[ei].b + 0.66; oy = ys[ei] + 0.9; om.position.set(ox, oy, 0); topY = Math.max(ys[ei] + PARTS[d.stack[ei]].h, oy + PARTS.orbiter.h); }
    const last = PARTS[d.stack[d.stack.length - 1]].look;
    if (last === 'ssme') for (const [x, z] of ORB_SSME) nozzles.push([ox + x, oy - 0.55, z, 0.7, 'core']);
    if (last === 'oms') for (const [x, z] of ORB_OMS) nozzles.push([ox + x, oy - 0.05, z, 0.32, 'core']);
  }
  // 위 단의 이온 엔진도 불꽃 표시
  d.stack.forEach((id, i) => { if (i < d.stack.length - 1 && PARTS[id].ion) nozzles.push([0, ys[i], 0, 0.6, 'ion']); });
  // 페어링: 맨 위에서 첫 분리기까지 덮는 덮개
  if (d.stack[0] === 'fairing' && opt.fairing !== false) {
    let end = d.stack.findIndex((id, i) => i > 0 && PARTS[id].kind === 'dec'); if (end < 0) end = d.stack.length;
    const bottom = end > 1 ? ys[end - 1] : ys[0], shellH = Math.max(0.3, ys[0] - bottom), fr = RAD + 0.14;
    const g = new THREE.Group();
    g.add(cyl(fr, fr, shellH, seg, P.body, bottom));
    g.add(ogive(fr, PARTS.fairing.h + 0.6, seg, P.plain, ys[0]));
    g.add(cyl(fr + 0.01, fr + 0.01, 0.12, seg, P.accent, bottom));
    g.userData = { stack: 0 };
    const old = parts.find(p => p.stack === 0); if (old) { group.remove(old.mesh); parts.splice(parts.indexOf(old), 1); }
    group.add(g); parts.push({ mesh: g, stack: 0 });
  }
  (d.radial || []).forEach((r, ri) => {
    if (ys[r.at] == null) return;
    const p = PARTS[r.id], g = new THREE.Group(), wAt = WS[r.at] ? Math.max(WS[r.at].b, WS[r.at].t) : 1, RA = RAD * wAt, hostH = PARTS[d.stack[r.at]].h;
    for (let k = 0; k < r.n; k++) {
      const a = k / r.n * Math.PI * 2 + Math.PI / 4 + (r.rot || 0), b = new THREE.Group();
      if (p.kind === 'fin' && p.look === 'flap') {
        const hh = Math.min(p.h, hostH * 0.9), fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, hh, 0.95), mat('black'));
        fl.position.set(0, hh / 2 + 0.2, RA + 0.45); b.add(fl); b.position.y = ys[r.at]; b.rotation.y = a;
      } else if (p.kind === 'fin' && p.look === 'grid') {
        const gf = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), gridMat()); gf.position.set(0, hostH - 0.45, RA + 0.03); gf.userData.grid = RA + 0.03; b.add(gf);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), mat('darkMetal')); arm.position.set(0, hostH - 0.45, RA); b.add(arm);
        b.position.y = ys[r.at]; b.rotation.y = a;
      } else if (p.kind === 'fin' && p.look === 'legs') {
        // 다리는 위쪽 경첩에 매달려 있다가 착륙 직전 바깥으로 펴짐
        const lh = Math.min(p.h, hostH), pv = new THREE.Group(); pv.position.set(0, lh, RA + 0.05); pv.userData.leg = 1; b.add(pv);
        const lg = new THREE.Mesh(new THREE.BoxGeometry(0.16, lh, 0.1), mat('black')); lg.position.y = -lh / 2; pv.add(lg);
        const ft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.16), mat('darkMetal')); ft.position.set(0, -lh + 0.06, 0.03); pv.add(ft);
        b.position.y = ys[r.at]; b.rotation.y = a;
      } else if (p.kind === 'fin') {
        const hh = Math.min(p.h, PARTS[d.stack[r.at]].h * 1.1);
        const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.95, -0.25); shape.lineTo(0.95, hh * 0.35); shape.lineTo(0, hh); shape.closePath();
        const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }), P.accent);
        fin.position.set(-0.03, 0, RA - 0.02); fin.rotation.y = -Math.PI / 2; b.add(fin);
        b.position.y = ys[r.at]; b.rotation.y = a;
      } else {
        const br = p.r || BR;
        b.add(partMesh(r.id, seg, P, opt));
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat('darkMetal')); strut.position.set(0, p.h * 0.75, -(br + 0.05)); b.add(strut);
        const strut2 = strut.clone(); strut2.position.y = p.h * 0.25; b.add(strut2);
        const off = RA + br + 0.06;
        b.position.set(Math.sin(a) * off, ys[r.at], Math.cos(a) * off); b.rotation.y = a;
        if (p.look === 'core') {
          // 부스터 엔진 9개 각각 불꽃 (부스터 쪽 좌표 → 로켓 좌표로 회전)
          for (const [x, z] of LAYOUTS[9]) { const lx = x * br * 0.95, lz = z * br * 0.95; nozzles.push([Math.sin(a) * off + lx * Math.cos(a) + lz * Math.sin(a), ys[r.at] - 0.35, Math.cos(a) * off - lx * Math.sin(a) + lz * Math.cos(a), 0.45, 'booster']); }
        } else nozzles.push([Math.sin(a) * off, ys[r.at], Math.cos(a) * off, p.look === 'cone' ? 0.9 : 0.75, 'booster']);
      }
      g.add(b);
    }
    g.userData = { radial: ri };
    group.add(g); parts.push({ mesh: g, radial: ri });
  });
  // 깃발·이름 데칼: 가장 긴 탱크(또는 실험실)에 붙임
  const lv = d.livery || {};
  if ((lv.flag && lv.flag !== 'NONE') || opt.name || lv.mark) {
    let best = -1, bh = 0;
    d.stack.forEach((id, i) => { if (['tank', 'lab'].includes(PARTS[id].kind) && PARTS[id].h > bh) { bh = PARTS[id].h; best = i; } });
    if (best >= 0) {
      const tex = new THREE.CanvasTexture(decalCanvas(lv.flag, opt.name, lv.mark, lv.accent)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const rr = RAD * (WS[best].b + WS[best].t) / 2, hh = Math.min(bh * 0.86, 4.2), wAng = (hh / 4) / rr;
      const decal = new THREE.Mesh(new THREE.CylinderGeometry(RAD * WS[best].t + 0.012, RAD * WS[best].b + 0.012, hh, 24, 1, true, -wAng / 2, wAng),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1 }));
      decal.position.y = ys[best] + bh / 2;
      group.add(decal);
    }
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group, height: topY, nozzles, parts, coreR: RAD * (WS.length ? WS[WS.length - 1].b : 1) };
}

// 바퀴 내리기 (0 = 접힘, 1 = 다 내려옴)
export function setGear(group, t) {
  group.traverse(o => { if (o.userData.gear) { o.visible = t > 0.02; o.scale.set(Math.max(0.02, t), 1, 1); } });
}
// 우주왕복선 감속 낙하산: 꼬리 날개 아래에서 뒤로 끌려 나옴 (원점 = 묶인 곳, -y 쪽으로 펼쳐짐)
export function buildDragChute() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 64, (c, w, h) => { for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? '#f1ede4' : '#d9732f'; c.fillRect(i * w / 12, 0, w / 12, h); } });
  const R = 3.2, D = 14;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  dome.rotation.x = Math.PI; dome.position.y = -D - R * 0.55; g.add(dome);   // 볼록한 쪽이 뒤로, 입구가 궤도선 쪽
  const pts = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * R * 0.98, -D, Math.sin(a) * R * 0.98); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xe8e4da, transparent: true, opacity: 0.8 })));
  g.visible = false;
  return g;
}

export function buildCanopy() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#e9e4da' : '#c9502a'; c.fillRect(i * w / 8, 0, w / 8, h); } });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  dome.position.y = 7; g.add(dome);
  const pts = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * 6.76, 8.8, Math.sin(a) * 6.76); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 })));
  return g;
}

// 엔진 불꽃 셰이더: 종류별 색(uHot·uMid), 무지개, 희미함(수소)
function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uVac: { value: 0 }, uPower: { value: 1 }, uHot: { value: new THREE.Color(1, 0.92, 0.75) }, uMid: { value: new THREE.Color(1, 0.55, 0.18) }, uRainbow: { value: 0 }, uFaint: { value: 0 } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime; uniform float uVac; uniform float uPower; uniform vec3 uHot; uniform vec3 uMid; uniform float uRainbow; uniform float uFaint; varying vec2 vUv;
vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main(){
#include <logdepthbuf_fragment>
  float t = 1.0 - vUv.y;
  float flick = 0.85 + 0.15 * sin(uTime * 60.0 + t * 25.0) * sin(uTime * 37.0 + vUv.x * 30.0);
  float core = 1.0 - smoothstep(0.0, 1.0, t * (1.05 + uVac * 0.6));
  float diamonds = (1.0 - uVac) * (0.35 + uFaint * 0.6) * pow(abs(sin(t * 18.0)), 8.0) * (1.0 - smoothstep(0.1, 0.7, t));
  vec3 mid = mix(uMid, hue(fract(t * 1.3 - uTime * 0.6)), uRainbow);
  vec3 col = mix(mix(mid, uHot, core), vec3(0.55, 0.65, 1.0), uVac * 0.6 * t);
  float a = (core * 0.9 * (1.0 - uFaint * 0.75) + diamonds) * flick * (1.0 - t) * uPower * (1.0 - uVac * 0.45);
  gl_FragColor = vec4(col * a * 6.0, a);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
export const flameMat = flameMaterial();      // 일반 엔진 (설계의 불꽃 종류)
export const ionFlameMat = flameMaterial();   // 이온 엔진: 늘 파란 빛
ionFlameMat.uniforms.uHot.value.setRGB(0.7, 0.85, 1.0); ionFlameMat.uniforms.uMid.value.setRGB(0.25, 0.45, 1.0); ionFlameMat.uniforms.uFaint.value = 0.3;
export function setFlameType(f) {
  flameMat.uniforms.uHot.value.setRGB(...f.hot); flameMat.uniforms.uMid.value.setRGB(...f.mid);
  flameMat.uniforms.uRainbow.value = f.rainbow ? 1 : 0; flameMat.uniforms.uFaint.value = f.faint ? 1 : 0;
}
const flameGeo = new THREE.CylinderGeometry(0.45, 0.22, 1, 20, 1, true); flameGeo.translate(0, -0.5, 0);
export function makeFlame(kind) {
  const m = kind === 'ion' ? ionFlameMat : flameMat;
  const g = new THREE.Group();
  const outer = new THREE.Mesh(flameGeo, m), inner = new THREE.Mesh(flameGeo, m);
  inner.scale.set(0.55, 0.7, 0.55);
  g.add(outer, inner);
  return g;
}

// 국제우주정거장 모델: +x = 진행 방향(모듈이 줄지어 있음), +y = 하늘 쪽, z = 긴 트러스(태양전지판 날개)
export function buildISS(quality) {
  const seg = quality === 'low' ? 10 : 18, g = new THREE.Group();
  const white = mat('white'), foil = mat('foil'), dark = mat('darkMetal'), steel = mat('steel');
  const arrayMat = new THREE.MeshStandardMaterial({ map: solarTex(), color: 0xf0c078, emissive: 0x4a3214, emissiveIntensity: 1, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
  const mod = (len, r, x, m = white) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m); c.rotation.z = Math.PI / 2; c.position.x = x; g.add(c); return c; };
  // 가압 모듈 줄: 러시아 쪽(뒤) → 미국 쪽(앞), 앞 끝에 도킹 포트
  mod(9, 1.6, -22); mod(10, 1.7, -12.5); mod(6, 1.3, -5); mod(9, 2.1, 3); mod(7, 2.1, 11); mod(3, 1.0, 16, steel);
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 1.2, seg), dark); port.rotation.z = Math.PI / 2; port.position.x = 18.1; g.add(port);
  port.name = 'dockPort';
  // 옆으로 붙은 실험 모듈 (일본·유럽)
  for (const [z, len, r] of [[5.5, 8, 2.1], [-5, 6, 2.0]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), white); c.rotation.x = Math.PI / 2; c.position.set(9, 0, z + Math.sign(z) * len / 2 - Math.sign(z) * 1.5); g.add(c); }
  // 러시아 모듈의 작은 태양전지판
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 9), arrayMat); p.position.set(-22, 0, s * 6.3); g.add(p); }
  // 긴 트러스 (중심 모듈 위)
  const truss = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 74), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.5, metalness: 0.6, wireframe: false }));
  truss.position.set(3, 3.6, 0); g.add(truss);
  for (let k = -7; k <= 7; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.1, 0.12), dark); b.position.set(3, 3.6, k * 5); g.add(b); }
  // 큰 태양전지판 날개 8장 (양쪽 끝에 4장씩, 위아래로)
  for (const sz of [-1, 1]) for (const zOff of [30, 39]) for (const sy of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 16), arrayMat);
    wing.rotation.x = Math.PI / 2; wing.position.set(3, 3.6 + sy * 9.5, sz * zOff); g.add(wing);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 19, 6), steel); mast.position.set(3, 3.6, sz * zOff); g.add(mast);
  }
  // 하얀 방열판
  for (const sz of [-1, 1]) { const rad = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.05, 10), white); rad.position.set(3, 1.0, sz * 16); rad.rotation.x = 0.25 * sz; g.add(rad); }
  // 로봇 팔(캐나다암2)
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9, 8), white); arm1.position.set(5, 7.5, 6); arm1.rotation.x = 0.9; g.add(arm1);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  void foil;
  return g;
}
