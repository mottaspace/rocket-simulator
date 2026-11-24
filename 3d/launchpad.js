// 나로우주센터 제2발사대(누리호) 형식의 발사장
// 근거: 「한국형발사체 발사대 과업지시서」 표3 지상기계설비 (K101 발사패드, K102 이렉터, K131 지상고정장치,
//       K132 1단 엄빌리칼 접속장치, K133 상단부 엄빌리칼 접속장치, K134 엄빌리칼 타워),
//       그림18(엄빌리칼 타워), 그림28(버킷형 화염유도로), 낙뢰방지타워·조명·CCTV·추진제 저장설비.
// 게임 로켓(지름 1.25 m)에 맞춰 수평 치수는 줄이고, 타워 높이는 로켓 높이에 맞춥니다.
import * as THREE from './vendor/three.module.min.js';
import { PAD_TOWER } from './physics3d.js';

export const PAD_DEPTH = 4;          // 발사패드(K101) 높이 4 m: 주변 바닥은 패드 윗면보다 4 m 낮음
export const PAD_TERRAIN_R = 80;     // 이 반경 안의 지형은 발사장 전용 메시가 그림

// 발사장 지형 높이 (패드 윗면 = 0, 앞마당 = -4, 바깥 둔덕으로 올라가 0)
export function padTerrainY(x, z) {
  const r = Math.hypot(x, z), t = Math.min(1, Math.max(0, (r - 50) / 28)), s = t * t * (3 - 2 * t);
  return -PAD_DEPTH * (1 - s);
}
function isApron(x, z) { return (Math.abs(x) < 42 && Math.abs(z) < 36) || (Math.abs(z) < 5 && x < 0); }

const Y = new THREE.Vector3(0, 1, 0);
// 상자 하나로 많은 철골을 한 번에 그리기 (InstancedMesh)
class Beams {
  constructor() { this.m = []; this._q = new THREE.Quaternion(); }
  line(a, b, t, t2) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    this._q.setFromUnitVectors(Y, d.normalize());
    this.m.push(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), this._q, new THREE.Vector3(t, len, t2 || t)));
  }
  box(x0, y0, z0, x1, y1, z1) {
    this.m.push(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Quaternion(), new THREE.Vector3(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))));
  }
  mesh(mat, shadows) {
    const im = new THREE.InstancedMesh(UNIT, mat, Math.max(1, this.m.length));
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = this.m.length; im.castShadow = im.receiveShadow = !!shadows;
    return im;
  }
}
const UNIT = new THREE.BoxGeometry(1, 1, 1);

function boxMesh(mat, x0, y0, z0, x1, y1, z1, shadows) {
  const m = new THREE.Mesh(UNIT, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.scale.set(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  m.castShadow = m.receiveShadow = !!shadows; return m;
}
function cyl(mat, r0, r1, h, seg) { return new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), mat); }
// 두 점을 잇는 원통 (배관·유압 실린더)
function pipe(mat, a, b, r, seg) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const m = cyl(mat, r, r, d.length(), seg || 8);
  m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, d.normalize());
  return m;
}
function placePipe(m, a, b) {
  const d = b.clone().sub(a), len = d.length();
  m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, d.normalize()); m.scale.set(1, len, 1);
}

function sootTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  gr.addColorStop(0, 'rgba(12,12,12,0.95)'); gr.addColorStop(0.45, 'rgba(25,24,22,0.7)'); gr.addColorStop(1, 'rgba(40,38,35,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(10,10,10,${Math.random() * 0.15})`; const a = Math.random() * 6.28, r = 40 + Math.random() * 80; g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 3, 3); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function signTexture(text, sub) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = '#eef0f2'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#1d4f9c'; g.fillRect(0, 96, 512, 32);
  g.fillStyle = '#1b2330'; g.font = 'bold 54px "Noto Sans KR", sans-serif'; g.textAlign = 'center'; g.fillText(text, 256, 66);
  g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.fillText(sub, 256, 120);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class LaunchComplex {
  // T: 그래픽 등급, groundColor(x, z, color): 주변 지면과 같은 색, groundMap: 지면 잔무늬
  constructor(T, groundColor, groundMap) {
    this.T = T; this.group = new THREE.Group(); this.fitGroup = null;
    const S = T.shadows, lowQ = T.key === 'low';
    const M = this.mats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x9a9b9d, roughness: 0.95 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x8a8b8d, roughness: 0.92 }),
      soot: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.9 }),
      green: new THREE.MeshStandardMaterial({ color: 0x3e7a52, roughness: 0.6, metalness: 0.35 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x2b5ea8, roughness: 0.5, metalness: 0.35 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8e949a, roughness: 0.45, metalness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.4 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xe0782a, roughness: 0.55, metalness: 0.2 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe3b631, roughness: 0.55, metalness: 0.2 }),
      red: new THREE.MeshStandardMaterial({ color: 0xc8332a, roughness: 0.6 }),
      redLight: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2a1a, emissiveIntensity: 3 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xfff1cc, emissiveIntensity: 1.2 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223a52, roughness: 0.15, metalness: 0.6 }),
      tank: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4, metalness: 0.3 }),
    };

    // ── 지형: 발사장 앞마당(콘크리트)과 둘레 둔덕 ──
    const rings = lowQ ? 18 : 36, segs = lowQ ? 48 : 96, pos = [], col = [], uv = [], idx = [], c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
      const d = PAD_TERRAIN_R * Math.pow(i / rings, 1.35);
      for (let j = 0; j < segs; j++) {
        const a = j / segs * Math.PI * 2, x = Math.cos(a) * d, z = Math.sin(a) * d;
        pos.push(x, padTerrainY(x, z), z); uv.push(x / 30, z / 30);
        if (isApron(x, z)) { const k = 0.33 + 0.04 * Math.sin(x * 0.7) * Math.sin(z * 0.9); c.setRGB(k, k, k * 1.02); }
        else groundColor(x, z, c);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs, cc = (i + 1) * segs + j, dd = (i + 1) * segs + (j + 1) % segs;
      idx.push(a, b, cc, b, dd, cc);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx); tg.computeVertexNormals();
    this.terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundMap, roughness: 1 }));
    this.terrain.receiveShadow = S;
    this.group.add(this.terrain);

    // ── K101 발사패드 (높이 4 m, 가운데 화염 구멍, 아래로 버킷형 화염유도로) ──
    const g = this.group, D = -PAD_DEPTH;
    g.add(boxMesh(M.concrete, -11.5, D, -8, -1.8, 0, 8, S));      // 서쪽(타워 쪽) 블록
    g.add(boxMesh(M.concrete, 1.8, D, -8, 12, 0, 8, S));           // 동쪽(이렉터 쪽) 블록
    g.add(boxMesh(M.concrete, -1.8, D, -8, 1.8, 0, -1.6, S));     // 화염 구멍 뒤
    g.add(boxMesh(M.concrete, -1.8, -1.0, 1.6, 1.8, 0, 8, S));    // 화염 통로 천장
    g.add(boxMesh(M.soot, -1.8, D, -1.6, 1.8, D + 0.05, 8));      // 통로 바닥(그을음)
    // 버킷형 화염 전향판: 아래로 내려온 화염을 북쪽 통로로 꺾음
    const defl = new Beams(); defl.line([0, -0.9, -1.6], [0, D + 0.05, 2.6], 3.6, 0.35); g.add(defl.mesh(M.soot));
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ map: sootTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
    decal.rotation.x = -Math.PI / 2; decal.position.y = 0.01; g.add(decal);
    // 화염유도로(도랑): 패드 북쪽으로 26 m, 양쪽 벽 + 물 분사 배관
    g.add(boxMesh(M.soot, -2.4, D, 8, 2.4, D + 0.04, 34));
    g.add(boxMesh(M.wall, -3.0, D, 8, -2.4, D + 1.4, 34, S));
    g.add(boxMesh(M.wall, 2.4, D, 8, 3.0, D + 1.4, 34, S));
    for (const sx of [-1, 1]) {
      g.add(pipe(M.steel, [sx * 2.7, D + 1.6, 8.2], [sx * 2.7, D + 1.6, 33], 0.16));
      for (let z = 10; z < 33; z += 3) g.add(pipe(M.steel, [sx * 2.7, D + 1.6, z], [sx * 2.2, D + 1.3, z], 0.07, 6));
    }
    // 패드 가장자리 안전 난간과 계단
    const rail = new Beams();
    for (const [x0, z0, x1, z1] of [[-11.5, -8, 12, -8], [12, -8, 12, -3.2], [12, 3.2, 12, 8], [-11.5, 8, -1.8, 8], [1.8, 8, 12, 8], [-11.5, -8, -11.5, 8]]) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 1.8);
      rail.line([x0, 1.05, z0], [x1, 1.05, z1], 0.06); rail.line([x0, 0.55, z0], [x1, 0.55, z1], 0.05);
      for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; rail.line([x, 0, z], [x, 1.1, z], 0.06); }
    }
    g.add(rail.mesh(M.yellow));
    const stair = new Beams(); stair.line([4, D, -15], [4, 0, -8.05], 2.2, 0.3); g.add(stair.mesh(M.concrete, S));

    // ── 낙뢰방지타워 3기 (빨강·흰색 철탑, 서로 가공 피뢰선으로 연결) ──
    this.lightning = new THREE.Group(); g.add(this.lightning);
    this.mastSpots = [[-24, -26], [27, -21], [17, 31]];

    // ── 조명탑 4기, CCTV 2기 ──
    for (const [x, z] of [[-34, -30], [33, -29], [34, 27], [-33, 28]]) {
      const y0 = padTerrainY(x, z), h = 24, p = cyl(M.steel, 0.25, 0.4, h, 8); p.position.set(x, y0 + h / 2, z); g.add(p);
      const head = new THREE.Group(); head.position.set(x, y0 + h, z); head.lookAt(0, 10, 0);
      const fr = boxMesh(M.dark, -1.6, -0.9, -0.2, 1.6, 0.9, 0.2); head.add(fr);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) { const l = boxMesh(M.lamp, -1.4 + i * 1, -0.75 + k * 0.85, 0.15, -0.6 + i * 1, -0.05 + k * 0.85, 0.24); head.add(l); }
      g.add(head);
    }
    for (const [x, z] of [[-14, 14], [14, -14]]) {
      const y0 = padTerrainY(x, z), p = cyl(M.steel, 0.12, 0.15, 8, 6); p.position.set(x, y0 + 4, z); g.add(p);
      const cam = boxMesh(M.white, -0.3, -0.2, -0.2, 0.3, 0.2, 0.2); cam.position.set(x, y0 + 8.1, z); cam.lookAt(0, 6, 0); g.add(cam);
    }

    // ── 추진제 저장설비: 산화제(액체산소) 탱크, 연료(케로신) 탱크, 고압가스 구형 탱크, 배관 ──
    const lox = cyl(M.tank, 2.0, 2.0, 14, 20); lox.rotation.x = Math.PI / 2; lox.position.set(-33, D + 3.2, 14); g.add(lox);
    const fuel = cyl(M.tank, 1.5, 1.5, 9, 18); fuel.rotation.x = Math.PI / 2; fuel.position.set(-33, D + 2.6, 27); g.add(fuel);
    for (const [z, r] of [[14, 2.0], [27, 1.5]]) for (const dz of [-0.36, 0.36]) g.add(boxMesh(M.concrete, -35, D, z + dz * (r * 3) - 0.4, -31, D + 1.4, z + dz * (r * 3) + 0.4, S));
    const loxBand = cyl(M.blue, 2.03, 2.03, 0.6, 20); loxBand.rotation.x = Math.PI / 2; loxBand.position.copy(lox.position); g.add(loxBand);
    const fuelBand = cyl(M.orange, 1.53, 1.53, 0.5, 18); fuelBand.rotation.x = Math.PI / 2; fuelBand.position.copy(fuel.position); g.add(fuelBand);
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 10), M.tank); s.position.set(-21 + i * 3.6, D + 2.2, 26); g.add(s); g.add(boxMesh(M.steel, -21.6 + i * 3.6, D, 25.4, -20.4 + i * 3.6, D + 0.9, 26.6)); }
    const py = D + 1.3, pr = new Beams();
    for (const [a, b] of [[[-30.5, py, 14], [-13, py, 14]], [[-13, py, 14], [-13, py, 5]], [[-13, py, 5], [-11.7, py, 5]], [[-11.7, py, 5], [-11.7, 0.4, 5]], [[-11.7, 0.4, 5], [-9.5, 0.4, 5]],
      [[-31.4, py - 0.5, 27], [-13.6, py - 0.5, 27]], [[-13.6, py - 0.5, 27], [-13.6, py - 0.5, 4.4]], [[-13.6, py - 0.5, 4.4], [-11.7, py - 0.5, 4.4]], [[-11.7, py - 0.5, 4.4], [-11.7, 0.4, 4.4]]]) { g.add(pipe(M.steel, a, b, 0.22)); }
    for (let x = -28; x < -13; x += 4) pr.box(x - 0.1, D, 13.7, x + 0.1, py, 14.3);
    for (let z = 7; z < 27; z += 4) pr.box(-13.9, D, z - 0.1, -12.7, py - 0.2, z + 0.1);
    g.add(pr.mesh(M.dark));
    // 물 저장탱크 (화염유도로 냉각·소음 감소용 물 분사)
    const wt = cyl(M.tank, 4.5, 4.5, 9, 24); wt.position.set(31, D + 4.5, 12); g.add(wt);
    const wtRoof = cyl(M.steel, 0.5, 4.6, 1, 24); wtRoof.position.set(31, D + 9.5, 12); g.add(wtRoof);
    g.add(pipe(M.steel, [26.5, D + 1, 12], [3, D + 1, 12], 0.3)); g.add(pipe(M.steel, [3, D + 1, 12], [2.7, D + 1.6, 12], 0.3));

    // ── 중앙공용시설(CB) 건물 ──
    const cb = new THREE.Group(); cb.position.set(-30, D, -22);
    cb.add(boxMesh(M.white, -9, 0, -5, 9, 6, 5, S));
    cb.add(boxMesh(M.blue, -9.02, 4.6, -5.02, 9.02, 5.2, 5.02));
    for (let i = 0; i < 6; i++) cb.add(boxMesh(M.glass, -7.5 + i * 2.6, 2.2, 5.0, -6.1 + i * 2.6, 3.8, 5.06));
    cb.add(boxMesh(M.dark, 5, 0, 5.0, 7.5, 3.4, 5.08));
    cb.add(boxMesh(M.steel, -6, 6, -2, -2, 7.2, 1)); cb.add(boxMesh(M.steel, 1, 6, -3, 4, 7, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: signTexture('제2발사대', 'NARO SPACE CENTER · LB2') }));
    sign.position.set(0, 7.6, 5.0); cb.add(sign);
    cb.add(boxMesh(M.steel, -4.05, 6, 4.9, -3.95, 7.6, 5.0)); cb.add(boxMesh(M.steel, 3.95, 6, 4.9, 4.05, 7.6, 5.0));
    g.add(cb);
  }

  // 로켓 크기에 맞춰 엄빌리칼 타워·작업 암·이렉터·지상고정장치를 다시 만들기
  // h: 로켓 높이, rCore: 몸통 반지름, rMax: 부스터 포함 최대 반지름
  fit(h, rCore, rMax) {
    if (this.fitGroup) { this.group.remove(this.fitGroup); this.fitGroup.traverse(o => { if (o.geometry && o.geometry !== UNIT) o.geometry.dispose(); }); }
    const M = this.mats, S = this.T.shadows, f = this.fitGroup = new THREE.Group();
    this.group.add(f);
    rMax = Math.max(rMax, rCore, 0.6);
    const H = Math.min(64, Math.max(24, h + 5)), NS = 12, hs = H / NS;
    const tx = PAD_TOWER.x, th = PAD_TOWER.half, X0 = tx - th, X1 = tx + th;
    PAD_TOWER.h = H + 3;
    this.towerH = H;

    // ── K134 엄빌리칼 타워: 12단 격자 철골, 승강기, 비상계단, 기계실 ──
    const lat = new Beams();
    const C = [[X0, -th], [X1, -th], [X1, th], [X0, th]];
    for (const [x, z] of C) lat.line([x, 0, z], [x, H, z], 0.5);
    for (let i = 0; i <= NS; i++) {
      const y = i * hs;
      for (let k = 0; k < 4; k++) { const a = C[k], b = C[(k + 1) % 4]; lat.line([a[0], y, a[1]], [b[0], y, b[1]], 0.28); }
      if (i < NS) for (let k = 0; k < 4; k++) {
        const a = C[k], b = C[(k + 1) % 4];
        lat.line([a[0], y, a[1]], [b[0], y + hs, b[1]], 0.13); lat.line([b[0], y, b[1]], [a[0], y + hs, a[1]], 0.13);
      }
    }
    f.add(lat.mesh(M.green, S));
    const plat = new Beams();
    for (let i = 2; i <= NS; i += 2) plat.box(X0 + 0.2, i * hs - 0.12, -th + 0.2, X1 - 0.2, i * hs, th - 0.2);
    // 비상계단: 단마다 지그재그 경사판
    for (let i = 0; i < NS; i++) { const a = i % 2 ? X1 - 0.6 : X0 + 0.8, b = i % 2 ? X0 + 0.8 : X1 - 0.6; plat.line([a, i * hs, th - 0.7], [b, (i + 1) * hs, th - 0.7], 1.0, 0.14); }
    f.add(plat.mesh(M.dark, S));
    f.add(boxMesh(M.white, X0 + 0.3, 0, -th + 0.3, X0 + 2.1, H + 2.6, -th + 2.1, S));     // 승강기 통로
    this.elevator = boxMesh(M.yellow, X0 + 0.25, 0, -th + 0.6, X0 + 0.32, 2.4, -th + 1.8); f.add(this.elevator);
    f.add(boxMesh(M.white, X0 + 0.4, 0, -th + 2.4, X1 - 0.6, 3.4, th - 1.4, S));            // 유압실·공압실
    f.add(boxMesh(M.white, X0 - 0.2, H, -th - 0.2, X1 + 0.2, H + 2.6, th + 0.2, S));          // 기계실
    f.add(boxMesh(M.green, X0 - 0.3, H + 2.6, -th - 0.3, X1 + 0.3, H + 2.9, th + 0.3));
    const rod = cyl(M.steel, 0.06, 0.14, 7, 6); rod.position.set(tx, H + 6.4, 0); f.add(rod);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), M.redLight); tl.position.set(tx, H + 3.1, th + 0.35); f.add(tl);
    // 타워를 타고 오르는 배관(추진제·가스·전선)
    for (const z of [-1.2, -0.4, 1.0]) f.add(pipe(z > 0 ? M.dark : M.steel, [X1 - 0.3, 0.3, z], [X1 - 0.3, H, z], 0.14));

    // ── K133 상단부 엄빌리칼 + 작업통로 암 4기 (발사 때 옆으로 젖혀짐) ──
    this.arms = [];
    const armLen = Math.max(1.2, -X1 - rCore - 0.1);
    for (const fr of [0.32, 0.52, 0.72, 0.9]) {
      const y = Math.min(H - 1.5, Math.max(4, h * fr));
      const piv = new THREE.Group(); piv.position.set(X1, y, -0.9); f.add(piv);
      const ab = new Beams();
      ab.box(0, -0.15, 0, armLen, 0.05, 1.8);                                   // 바닥판
      for (const z of [0.05, 1.75]) { ab.line([0, 1.15, z], [armLen, 1.15, z], 0.1); ab.line([0, 0.6, z], [armLen, 0.6, z], 0.06); }
      for (let x = 0; x <= armLen + 0.01; x += Math.max(0.6, armLen / Math.ceil(armLen / 1.2))) for (const z of [0.05, 1.75]) ab.line([x, 0, z], [x, 1.15, z], 0.08);
      const am = ab.mesh(M.green, S); piv.add(am);
      const hose = pipe(M.dark, [0, -0.35, 0.9], [armLen - 0.2, -0.35, 0.9], 0.12); piv.add(hose);
      const plug = boxMesh(M.orange, -0.3, -1.0, 0.25, 0, 0.8, 1.55); plug.position.x += armLen; piv.add(plug);
      this.arms.push({ piv, plug, x0: plug.position.x });
    }

    // ── K131 지상고정장치 4세트 (0·90·180·270°) ──
    this.holds = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, grp = new THREE.Group(); grp.rotation.y = -a; f.add(grp);
      grp.add(boxMesh(M.steel, rCore - 0.15, -0.55, -0.35, Math.max(rMax, 2.0) + 0.6, 0, 0.35, S)); // 받침보
      grp.add(boxMesh(M.yellow, rCore + 0.05, 0, -0.3, rCore + 0.6, 0.7, 0.3, S));
      const jawP = new THREE.Group(); jawP.position.set(rCore + 0.6, 0.7, 0); grp.add(jawP);
      jawP.add(boxMesh(M.dark, -0.62, 0, -0.22, 0, 0.3, 0.22));
      this.holds.push(jawP);
    }

    // ── K132 1단 엄빌리칼 접속장치 2세트 (몸통 아래쪽 공급 연결) ──
    this.lowUmb = [];
    for (const s of [-1, 1]) {
      const a = Math.PI + s * Math.PI / 4, d = rMax + 2.0, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -a + Math.PI; f.add(grp);
      grp.add(boxMesh(M.white, -0.6, 0, -0.5, 0.6, 2.2, 0.5, S));
      grp.add(boxMesh(M.blue, -0.62, 1.8, -0.52, 0.62, 2.0, 0.52));
      const piv = new THREE.Group(); piv.position.set(0.5, 1.9, 0); grp.add(piv);
      const reach = d - rCore - 0.5;
      piv.add(pipe(M.dark, [0, 0, 0], [reach - 0.2, -0.8, 0], 0.1));
      piv.add(boxMesh(M.orange, reach - 0.35, -1.1, -0.25, reach, -0.5, 0.25));
      this.lowUmb.push(piv);
    }

    // ── K102 이렉터 (파란 세움 장치, 발사 전 뒤로 물러남) ──
    const ex = rMax + 1.7, eh = Math.max(10, h * 0.92);
    this.erector = new THREE.Group(); this.erector.position.set(ex, 0.6, 0); f.add(this.erector);
    f.add(boxMesh(M.concrete, ex - 0.9, 0, -1.6, ex + 0.9, 0.7, 1.6, S));
    const eb = new Beams(), ch = [[-0.5, -0.8], [0.5, -0.8], [0.5, 0.8], [-0.5, 0.8]], es = Math.max(6, Math.round(eh / 2.4));
    for (const [x, z] of ch) eb.line([x, 0, z], [x, eh, z], 0.24);
    for (let i = 0; i <= es; i++) {
      const y = i * eh / es;
      for (let k = 0; k < 4; k++) { const a = ch[k], b = ch[(k + 1) % 4]; eb.line([a[0], y, a[1]], [b[0], y, b[1]], 0.14); }
      if (i < es) { eb.line([-0.5, y, 0.8], [0.5, y + eh / es, 0.8], 0.09); eb.line([-0.5, y, -0.8], [0.5, y + eh / es, -0.8], 0.09); eb.line([0.5, y, -0.8], [0.5, y + eh / es, 0.8], 0.09); }
    }
    this.erector.add(eb.mesh(M.blue, S));
    // 고정 클램프: 먼저 오므라든 뒤 이렉터가 눕기 시작
    const cl = new Beams(), reachE = ex - rCore - 0.55 - 0.5;
    for (const fr of [0.3, 0.55, 0.8]) { const y = eh * fr; cl.box(-reachE, y - 0.15, -0.5, 0, y + 0.15, 0.5); cl.box(-reachE - 0.12, y - 0.4, -0.7, -reachE, y + 0.4, 0.7); }
    this.clamps = cl.mesh(M.yellow, S); this.clamps.position.x = -0.5; this.erector.add(this.clamps);
    this.erH = eh;
    // 이렉터가 누워 쉬는 받침길(발사체 이송 레일이 깔린 콘크리트 길)
    const xEnd = Math.max(22, ex + eh + 2.5);
    f.add(boxMesh(M.concrete, 12, -PAD_DEPTH, -3.2, xEnd, 0, 3.2, S));
    const rl = new Beams();
    for (const z of [-1.9, 1.9]) rl.box(ex + 1, 0, z - 0.09, xEnd - 0.3, 0.14, z + 0.09);
    for (const fr of [0.35, 0.65, 0.92]) { const x = ex + eh * fr; rl.box(x - 0.5, 0, -1.4, x + 0.5, 0.1, 1.4); }
    f.add(rl.mesh(M.dark, S));
    // 유압 실린더 2개: 바닥 속 받침점에서 이렉터 중간을 밀고 당김 (매 프레임 위치 갱신)
    this.rams = [-0.8, 0.8].map(z => { const m = cyl(M.steel, 0.2, 0.2, 1, 10); f.add(m); return { m, z }; });
    this.ramBase = ex + 0.22 * eh;
    f.add(boxMesh(M.dark, this.ramBase - 0.6, -0.02, -1.3, this.ramBase + 0.6, 0.04, 1.3));

    // ── 낙뢰방지타워 (타워 높이에 맞춤) ──
    const LG = this.lightning; LG.children.slice().forEach(o => { LG.remove(o); if (o.geometry && o.geometry !== UNIT) o.geometry.dispose(); });
    const mh = Math.max(55, H * 1.45), tops = [];
    for (const [x, z] of this.mastSpots) {
      const y0 = (padTerrainY(x, z)), nb = 10;
      for (let i = 0; i < nb; i++) {
        const r0 = 0.9 - 0.6 * i / nb, r1 = 0.9 - 0.6 * (i + 1) / nb, seg = cyl(i % 2 ? M.white : M.red, r1, r0, mh / nb, 10);
        seg.position.set(x, y0 + (i + 0.5) * mh / nb, z); seg.castShadow = S; LG.add(seg);
      }
      for (const fy of [0.5, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), M.redLight); l.position.set(x, y0 + mh * fy + 0.2, z); LG.add(l); }
      tops.push(new THREE.Vector3(x, y0 + mh - 0.5, z));
    }
    for (let k = 0; k < 3; k++) {
      const a = tops[k], b = tops[(k + 1) % 3], pts = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24, p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * a.distanceTo(b) * 0.06; pts.push(p); }
      LG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })));
    }
    this.reset();
  }

  // 발사 대기 상태로 되돌림
  reset() {
    this.st = { t: 0, erect: 0, ign: -1, umb: 0, arm: 0, hold: 0, announced: {} };
    this.apply();
  }

  // 발사 절차 진행. rk: Rocket3D. 알림 문구 목록을 돌려줌
  update(dt, rk) {
    const s = this.st, out = [];
    s.t += dt;
    const ign = rk.ignited;
    if (ign && s.ign < 0) s.ign = s.t;
    // 이렉터: 비행 화면에 들어오고 2초 뒤 클램프를 풀고 바닥까지 눕기 (약 8초, 점화되면 서둘러)
    if (s.t > 2 || ign) s.erect = Math.min(1, s.erect + dt / (ign ? 2 : 8));
    if (s.erect > 0 && !s.announced.erStart && !ign) { s.announced.erStart = 1; out.push('이렉터(로켓을 세우는 장치)가 클램프를 풀고 뒤로 눕고 있어요.'); }
    if (s.erect >= 1 && !s.announced.erect && !ign) { s.announced.erect = 1; out.push('이렉터가 바닥에 내려앉았어요. 발사 준비 완료!'); }
    if (ign) {
      const k = s.t - s.ign;
      s.umb = Math.min(1, k / 0.4);                         // 엄빌리칼 분리
      if (k > 0.3) s.arm = Math.min(1, s.arm + dt / 2.2);    // 작업 암 젖힘
      if (!s.announced.umb) { s.announced.umb = 1; out.push('엄빌리칼 분리! 연료·전기를 대 주던 줄이 떨어져요.\n화염유도로에 물을 뿌려 열과 소리를 줄여요.'); }
    }
    if (rk.lifted) s.hold = Math.min(1, s.hold + dt / 0.25);  // 지상고정장치 풀림
    this.apply();
    return out;
  }

  apply() {
    if (!this.erector) return;
    const s = this.st, cr = Math.min(1, s.erect / 0.2), r = Math.max(0, (s.erect - 0.2) / 0.8), e = r * r * (3 - 2 * r);
    this.clamps.scale.x = 1 - 0.8 * cr;
    this.erector.rotation.z = -Math.PI / 2 * e;
    for (const r of this.rams) {
      const top = new THREE.Vector3(0, this.erH * 0.42, r.z).applyEuler(this.erector.rotation).add(this.erector.position);
      placePipe(r.m, new THREE.Vector3(this.ramBase, -1.5, r.z), top);
    }
    const sw = s.arm * s.arm * (3 - 2 * s.arm);
    for (const a of this.arms) { a.plug.position.x = a.x0 - 0.6 * s.umb; a.piv.rotation.y = 1.65 * sw; }
    for (const j of this.holds) j.rotation.z = -1.1 * s.hold;
    for (const p of this.lowUmb) p.rotation.z = 0.9 * s.umb;
    if (this.elevator) this.elevator.position.y = 1.2 + (this.towerH - 3) * (0.5 - 0.5 * Math.cos(s.t * 0.25));
  }

  // 점화 직후 화염유도로에서 뿜어 나오는 수증기 (패드 좌표의 위치·속도 목록)
  steam(rk, n) {
    const s = this.st; if (s.ign < 0) return [];
    const k = s.t - s.ign; if (k > 22 || rk.alt > 300 || rk.thrustNow <= 0) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.65) out.push([[(Math.random() - 0.5) * 3.6, -PAD_DEPTH + 1, 14 + Math.random() * 20], [(Math.random() - 0.5) * 14, 5 + Math.random() * 9, 10 + Math.random() * 16], 4 + Math.random() * 4]);
      else if (rk.alt < 40) { const a = Math.random() * 6.28; out.push([[Math.cos(a) * 3, 0.5, Math.sin(a) * 3], [Math.cos(a) * 10, 3 + Math.random() * 5, Math.sin(a) * 10], 3 + Math.random() * 3]); }
    }
    return out;
  }
}
