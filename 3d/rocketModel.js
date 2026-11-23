// 설계({stack, radial})로 실사풍 3D 로켓 모델을 만든다. 원점 = 맨 아래, +y = 기수 방향
import * as THREE from './vendor/three.module.min.js';

const { PARTS } = window.Parts;
const RAD = 0.625, BR = 0.42; // 본체·측면 부스터 반지름

function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// 탱크 표면: 이음매와 작은 패널 선
const panelTex = () => canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#eceef1'; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(80,85,95,.35)'; c.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  c.strokeStyle = 'rgba(80,85,95,.22)'; c.lineWidth = 1;
  for (let y = 0; y <= h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`; c.fillRect(Math.random() * w, Math.random() * h, 30, 6); }
});
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

const mats = {};
function mat(key) {
  if (mats[key]) return mats[key];
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const m = {
    paint: () => S({ map: panelTex(), roughness: 0.38, metalness: 0.05 }),
    white: () => S({ color: 0xf1f2f4, roughness: 0.35, metalness: 0.05 }),
    black: () => S({ color: 0x141518, roughness: 0.55, metalness: 0.2 }),
    steel: () => S({ color: 0x9aa0aa, roughness: 0.28, metalness: 0.9 }),
    darkMetal: () => S({ color: 0x3a3d44, roughness: 0.45, metalness: 0.85 }),
    copper: () => S({ color: 0xb86a3a, roughness: 0.25, metalness: 1.0, side: THREE.DoubleSide }),
    nozzleIn: () => S({ color: 0x1a1210, roughness: 0.9, metalness: 0.2, side: THREE.BackSide }),
    heat: () => S({ color: 0x2b2420, roughness: 0.9, metalness: 0.1 }),
    glass: () => S({ color: 0x0b1626, roughness: 0.05, metalness: 0.6 }),
    chute: () => S({ color: 0xd8d2c6, roughness: 0.9 }),
    foil: () => S({ map: foilTex(), roughness: 0.32, metalness: 1.0 }),
    solar: () => S({ map: solarTex(), roughness: 0.22, metalness: 0.4, side: THREE.DoubleSide }),
    orange: () => S({ color: 0xc4581e, roughness: 0.6 }),
  }[key]();
  return (mats[key] = m);
}

function cyl(rt, rb, h, seg, m, y, open) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open), mat(m));
  mesh.position.y = y + h / 2;
  return mesh;
}
function bell(rTop, rBot, h, seg, y) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(rTop + (rBot - rTop) * Math.pow(t, 0.6), h * (1 - t))); }
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat('copper'));
  const inner = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat('nozzleIn')); inner.scale.set(0.97, 1, 0.97);
  g.add(outer, inner); g.position.y = y;
  return g;
}
function ogive(r, h, seg, m, y) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(r * Math.sqrt(1 - t * t) * (1 - t * 0.15) + 0.0001, h * t)); }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat(m));
  mesh.position.y = y;
  return mesh;
}

// 인공위성 본체 (deployed = 태양전지판 펼침)
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
  if (deployed) {
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), mat('steel')); arm.position.set(s * 0.85, 0.9, 0); g.add(arm);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 1.0), mat('solar')); panel.position.set(s * 2.5, 0.9, 0); g.add(panel);
    }
  } else {
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.9), mat('solar')); p.position.set(s * 0.53, 0.75, 0); g.add(p); }
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function partMesh(id, seg) {
  const p = PARTS[id], h = p.h, g = new THREE.Group();
  switch (p.kind) {
    case 'chute':
      g.add(cyl(RAD * 0.42, RAD * 0.6, h * 0.75, seg, 'white', 0));
      g.add(cyl(RAD * 0.3, RAD * 0.42, h * 0.25, seg, 'chute', h * 0.75));
      break;
    case 'pod': {
      g.add(cyl(RAD * 0.98, RAD, 0.12, seg, 'heat', 0));
      g.add(cyl(RAD * 0.5, RAD * 0.98, h - 0.12, seg, 'steel', 0.12));
      for (const a of [0.35, -0.35]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.05), mat('glass')); w.position.set(Math.sin(a) * 0.5, h * 0.62, Math.cos(a) * 0.5); w.rotation.set(-0.28, a, 0); g.add(w); }
      break;
    }
    case 'nose':
      g.add(ogive(RAD, h, seg, 'white', 0));
      break;
    case 'tank': {
      const body = cyl(RAD, RAD, h, seg, 'paint', 0);
      body.material = mat('paint').clone(); body.material.map = mat('paint').map.clone(); body.material.map.needsUpdate = true;
      body.material.map.wrapS = body.material.map.wrapT = THREE.RepeatWrapping; body.material.map.repeat.set(2, Math.max(1, h / 1.3));
      g.add(body);
      g.add(cyl(RAD + 0.008, RAD + 0.008, 0.16, seg, 'black', 0));
      g.add(cyl(RAD + 0.008, RAD + 0.008, 0.16, seg, 'black', h - 0.16));
      break;
    }
    case 'engine': {
      const big = id === 'engL', vac = id === 'engV';
      g.add(cyl(RAD * 0.86, RAD * 0.7, h * 0.32, seg, 'darkMetal', h * 0.68));
      g.add(cyl(0.12, 0.12, h * 0.25, 8, 'steel', h * 0.45));
      const pipes = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 16), mat('steel')); pipes.rotation.x = Math.PI / 2; pipes.position.y = h * 0.55; g.add(pipes);
      g.add(bell(big ? 0.22 : 0.16, vac ? 0.6 : big ? 0.6 : 0.46, h * (vac ? 0.62 : 0.5), seg, 0));
      break;
    }
    case 'srb': {
      const r = p.radial ? BR : RAD;
      g.add(cyl(r, r, h - 0.6, seg, 'white', 0.6));
      for (let i = 0; i < 3; i++) g.add(cyl(r + 0.008, r + 0.008, 0.12, seg, 'black', 0.9 + i * (h - 1.4) / 3));
      if (p.radial) g.add(ogive(r, 0.9, seg, 'white', h - 0.02));
      g.add(cyl(r * 0.7, r * 0.75, 0.25, seg, 'darkMetal', 0.4));
      g.add(bell(r * 0.35, r * 0.72, 0.45, seg, 0));
      break;
    }
    case 'dec':
      g.add(cyl(RAD + 0.03, RAD + 0.03, h, seg, 'darkMetal', 0));
      g.add(cyl(RAD + 0.035, RAD + 0.035, h * 0.25, seg, 'steel', h * 0.38));
      break;
    case 'sat': {
      const sat = buildSatellite(p.sat, seg, false);
      sat.scale.setScalar(Math.min(1, h / (p.sat === 'obs' ? 2.4 : 2.1)));
      g.add(sat);
      break;
    }
  }
  return g;
}

// 반환: { group, height, nozzles: [[x, y, z, 크기]], parts: [{ mesh, stack?, radial? }] }
export function buildRocket(design, quality, opt = {}) {
  const d = Array.isArray(design) ? { stack: design, radial: [] } : design;
  const seg = quality === 'low' ? 12 : quality === 'medium' ? 20 : 32;
  const group = new THREE.Group(), parts = [], nozzles = [];
  const ys = [];
  let y = 0;
  for (let i = d.stack.length - 1; i >= 0; i--) {
    const id = d.stack[i], m = partMesh(id, seg);
    m.position.y = y; m.userData = { stack: i };
    group.add(m); parts.push({ mesh: m, stack: i });
    ys[i] = y;
    if (i === d.stack.length - 1 && (PARTS[id].kind === 'engine' || PARTS[id].kind === 'srb')) nozzles.push([0, y, 0, id === 'engL' ? 1.25 : id === 'engV' ? 0.9 : 1]);
    y += PARTS[id].h;
  }
  (d.radial || []).forEach((r, ri) => {
    if (ys[r.at] == null) return;
    const p = PARTS[r.id], g = new THREE.Group();
    for (let k = 0; k < r.n; k++) {
      const a = k / r.n * Math.PI * 2 + Math.PI / 4, b = new THREE.Group();
      const body = partMesh(r.id, seg); b.add(body);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat('darkMetal'));
      strut.position.set(0, p.h * 0.75, -(BR + 0.05)); b.add(strut);
      const strut2 = strut.clone(); strut2.position.y = p.h * 0.25; b.add(strut2);
      const off = RAD + BR + 0.06;
      b.position.set(Math.sin(a) * off, ys[r.at], Math.cos(a) * off);
      b.rotation.y = a;
      g.add(b);
      nozzles.push([Math.sin(a) * off, ys[r.at], Math.cos(a) * off, 0.75, 'b']);
    }
    g.userData = { radial: ri };
    group.add(g); parts.push({ mesh: g, radial: ri });
  });
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group, height: y, nozzles, parts };
}

export function buildCanopy() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#e9e4da' : '#c9502a'; c.fillRect(i * w / 8, 0, w / 8, h); } });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  dome.position.y = 7;
  g.add(dome);
  const pts = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * 6.76, 8.8, Math.sin(a) * 6.76); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 })));
  return g;
}

// 엔진 불꽃: 노즐에서 길게 뻗는 가산 혼합 셰이더 (밝은 부분은 블룸으로 번짐)
const flameMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uVac: { value: 0 }, uPower: { value: 1 } },
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime; uniform float uVac; uniform float uPower; varying vec2 vUv;
void main(){
#include <logdepthbuf_fragment>
  float t = 1.0 - vUv.y;                    // 0 = 노즐, 1 = 끝
  float flick = 0.85 + 0.15 * sin(uTime * 60.0 + t * 25.0) * sin(uTime * 37.0 + vUv.x * 30.0);
  float core = (1.0 - smoothstep(0.0, 1.0, t * (1.05 + uVac * 0.6)));
  float diamonds = (1.0 - uVac) * 0.35 * pow(abs(sin(t * 18.0)), 8.0) * (1.0 - smoothstep(0.1, 0.7, t));
  vec3 hot = vec3(1.0, 0.92, 0.75), mid = vec3(1.0, 0.55, 0.18), vac = vec3(0.55, 0.65, 1.0);
  vec3 col = mix(mix(mid, hot, core), vac, uVac * 0.6 * t);
  float a = (core * 0.9 + diamonds) * flick * (1.0 - t) * uPower * (1.0 - uVac * 0.45);
  gl_FragColor = vec4(col * a * 6.0, a);
}`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const flameGeo = new THREE.CylinderGeometry(0.45, 0.22, 1, 20, 1, true); flameGeo.translate(0, -0.5, 0);
export function makeFlame() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(flameGeo, flameMat); const inner = new THREE.Mesh(flameGeo, flameMat);
  inner.scale.set(0.55, 0.7, 0.55);
  g.add(outer, inner);
  g.userData.inner = inner;
  return g;
}
export { flameMat };
