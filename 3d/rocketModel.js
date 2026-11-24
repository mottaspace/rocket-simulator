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
  const key = (livery.body || '#f1f2f4') + (livery.accent || '#141518');
  if (paintCache[key]) return paintCache[key];
  const body = S({ map: panelTex(), color: new THREE.Color(livery.body || '#f1f2f4'), roughness: 0.38, metalness: 0.05 });
  const plain = S({ color: new THREE.Color(livery.body || '#f1f2f4'), roughness: 0.35, metalness: 0.05 });
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
export function clusterLayout(id) {
  const p = PARTS[id], n = p.cluster || 1, base = p.base || id;
  const key = base + n; if (layoutCache[key]) return layoutCache[key];
  const pos = LAYOUTS[n] || [[0, 0]];
  let room = 1.05;
  for (let i = 0; i < pos.length; i++) {
    room = Math.min(room, 1.08 - Math.hypot(...pos[i]));
    for (let j = i + 1; j < pos.length; j++) room = Math.min(room, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) / 2);
  }
  const s = Math.min(1, room * RAD / BELL_R(base));
  return (layoutCache[key] = { pos, s, base });
}

function partMesh(id, seg, P, opt) {
  const p = PARTS[id], h = p.h, g = new THREE.Group();
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
    case 'nose': g.add(ogive(RAD, h, seg, P.plain, 0)); break;
    case 'tank': {
      g.add(cyl(RAD, RAD, h, seg, P.body, 0));
      g.add(cyl(RAD + 0.008, RAD + 0.008, 0.16, seg, P.accent, 0));
      g.add(cyl(RAD + 0.008, RAD + 0.008, 0.16, seg, P.accent, h - 0.16));
      if (h > 4) g.add(cyl(RAD + 0.008, RAD + 0.008, 0.1, seg, P.accent, h * 0.5));
      break;
    }
    case 'engine': {
      if (p.cluster > 1) {
        // 같은 엔진 여러 개를 줄여서 원형으로 배치 + 위쪽 추력 구조(엔진 받침판)
        const L = clusterLayout(id), one = partMesh(L.base, p.cluster >= 9 ? Math.max(10, seg >> 1) : seg, P, opt);
        const top = h * L.s * 0.55;   // 엔진 윗부분을 덮는 추력 구조(엔진 받침 치마)
        g.add(cyl(RAD * 0.97, RAD, h - top, seg, 'darkMetal', top));
        g.add(cyl(RAD * 0.99, RAD * 0.99, 0.08, seg, P.accent, top));
        for (const [x, z] of L.pos) { const e = one.clone(); e.scale.setScalar(L.s); e.position.set(x * RAD, 0, z * RAD); g.add(e); }
        break;
      }
      if (p.ion) {
        g.add(cyl(RAD * 0.8, RAD * 0.7, h * 0.5, seg, 'darkMetal', h * 0.5));
        g.add(cyl(0.34, 0.34, h * 0.5, seg, 'steel', 0, true));
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, seg), mat('ionGlow')); glow.rotation.x = Math.PI / 2; glow.position.y = 0.02; g.add(glow);
        break;
      }
      const big = id === 'engL' || id === 'engH', vac = id === 'engV', huge = id === 'engH';
      g.add(cyl(RAD * 0.86, RAD * 0.7, h * 0.32, seg, 'darkMetal', h * 0.68));
      g.add(cyl(0.12, 0.12, h * 0.25, 8, 'steel', h * 0.45));
      const pipes = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 16), mat('steel')); pipes.rotation.x = Math.PI / 2; pipes.position.y = h * 0.55; g.add(pipes);
      g.add(bell(big ? 0.22 : 0.16, vac ? 0.6 : huge ? 0.62 : big ? 0.6 : 0.46, h * (vac ? 0.62 : 0.5), seg, 0));
      break;
    }
    case 'srb': {
      const r = p.radial ? BR : RAD;
      g.add(cyl(r, r, h - 0.6, seg, P.plain, 0.6));
      for (let i = 0; i < 3; i++) g.add(cyl(r + 0.008, r + 0.008, 0.12, seg, P.accent, 0.9 + i * (h - 1.4) / 3));
      if (p.radial) g.add(ogive(r, 0.9, seg, P.plain, h - 0.02));
      g.add(cyl(r * 0.7, r * 0.75, 0.25, seg, 'darkMetal', 0.4));
      g.add(bell(r * 0.35, r * 0.72, 0.45, seg, 0));
      break;
    }
    case 'dec':
      g.add(cyl(RAD + 0.03, RAD + 0.03, h, seg, 'darkMetal', 0));
      g.add(cyl(RAD + 0.035, RAD + 0.035, h * 0.25, seg, 'steel', h * 0.38));
      break;
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

// 반환: { group, height, nozzles: [[x, y, z, 크기, 종류]], parts: [{ mesh, stack?, radial? }] }
export function buildRocket(design, quality, opt = {}) {
  const d = Array.isArray(design) ? { stack: design, radial: [] } : design;
  const seg = quality === 'low' ? 12 : quality === 'medium' ? 20 : 32;
  const P = paint(d.livery || {});
  const group = new THREE.Group(), parts = [], nozzles = [], ys = [];
  let y = 0;
  for (let i = d.stack.length - 1; i >= 0; i--) {
    const id = d.stack[i], m = partMesh(id, seg, P, opt);
    m.position.y = y; m.userData = { stack: i };
    group.add(m); parts.push({ mesh: m, stack: i });
    ys[i] = y;
    if (i === d.stack.length - 1 && PARTS[id].cluster > 1) {
      const L = clusterLayout(id), sz = NOZZLE_SIZE(L.base) * Math.max(0.3, L.s * 1.1);
      for (const [x, z] of L.pos) nozzles.push([x * RAD, y, z * RAD, sz, 'core']);
    } else if (i === d.stack.length - 1 && (PARTS[id].kind === 'engine' || PARTS[id].kind === 'srb')) nozzles.push([0, y, 0, NOZZLE_SIZE(id), PARTS[id].ion ? 'ion' : 'core']);
    y += PARTS[id].h;
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
    const p = PARTS[r.id], g = new THREE.Group();
    for (let k = 0; k < r.n; k++) {
      const a = k / r.n * Math.PI * 2 + Math.PI / 4, b = new THREE.Group();
      if (p.kind === 'fin') {
        const hh = Math.min(p.h, PARTS[d.stack[r.at]].h * 1.1);
        const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.95, -0.25); shape.lineTo(0.95, hh * 0.35); shape.lineTo(0, hh); shape.closePath();
        const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }), P.accent);
        fin.position.set(-0.03, 0, RAD - 0.02); fin.rotation.y = -Math.PI / 2; b.add(fin);
        b.position.y = ys[r.at]; b.rotation.y = a;
      } else {
        b.add(partMesh(r.id, seg, P, opt));
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat('darkMetal')); strut.position.set(0, p.h * 0.75, -(BR + 0.05)); b.add(strut);
        const strut2 = strut.clone(); strut2.position.y = p.h * 0.25; b.add(strut2);
        const off = RAD + BR + 0.06;
        b.position.set(Math.sin(a) * off, ys[r.at], Math.cos(a) * off); b.rotation.y = a;
        nozzles.push([Math.sin(a) * off, ys[r.at], Math.cos(a) * off, 0.75, 'booster']);
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
      const hh = Math.min(bh * 0.86, 4.2), wAng = (hh / 4) / RAD;
      const decal = new THREE.Mesh(new THREE.CylinderGeometry(RAD + 0.012, RAD + 0.012, hh, 24, 1, true, -wAng / 2, wAng),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1 }));
      decal.position.y = ys[best] + bh / 2;
      group.add(decal);
    }
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group, height: y, nozzles, parts };
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
