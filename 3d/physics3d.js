// 3차원 로켓 비행 물리 (행성 중심 = 원점, 단위 m, 배열 [x, y, z])
// 설계 = { stack: [부품 id, 위→아래], radial: [{ at, id, n }], livery, flame, launch }
const { PARTS } = window.Parts;

export const PLANET = { R: 400000, g0: 9.81, atm: 45000, rho0: 1.2, H: 5500 };
PLANET.mu = PLANET.g0 * PLANET.R * PLANET.R;
export const SUN = (() => { const l = Math.hypot(0.55, 0.62, 0.56); return [0.55 / l, 0.62 / l, 0.56 / l]; })();

const G0 = 9.81, DT = 0.02;
const AREA = Math.PI * 0.625 * 0.625;
const CHUTE_AREA = 400, CHUTE_CD = 1.3, CHUTE_SAFE_SPEED = 250, CHUTE_SAFE_ALT = 20000;
const ROT_RATE = 0.9, SAFE_LANDING = 12, RADIAL_DEC_MASS = 50;
// 실패 기준 (모의 비행으로 맞춘 값 — 자동 비행의 최대값보다 넉넉하게)
// 엄빌리칼 타워(K134) 위치: 발사장 기준 x(서쪽), 한 변의 절반, 높이(로켓에 맞춰 launchpad.js가 바꿈)
export const PAD_TOWER = { x: -7.4, z: 0, half: 3, h: 34 };
export const LIMITS = { maxQ: 110000, sideLoad: 14000, heatNoShield: 450, heatShield: 3200, unstableAoa: 0.22, unstableQ: 7000 };
const BALLOON_TOP = 18000, BALLOON_CLIMB = 30, RAIL_SPEED = 110, SAIL_FORCE = 150;

// ── 벡터 도우미 ──
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  rot: (v, k, t) => {
    const c = Math.cos(t), s = Math.sin(t), kv = V.cross(k, v), d = V.dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
  },
  // a를 b 쪽으로 최대 각 maxAng만큼 돌린 단위벡터
  toward: (a, b, maxAng) => {
    const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(a, b))));
    if (ang < 1e-6) return a;
    let axis = V.cross(a, b); if (V.len(axis) < 1e-9) return a;
    return V.norm(V.rot(a, V.norm(axis), Math.min(ang, maxAng)));
  },
  angle: (a, b) => Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(a), V.norm(b))))),
};

export function density(alt) { return alt >= PLANET.atm ? 0 : PLANET.rho0 * Math.exp(-Math.max(0, alt) / PLANET.H); }
function soundSpeed(alt) { return alt < 11000 ? 340 - alt * 0.004 : 296; }
function machFactor(M) { return 1 + 0.9 * Math.exp(-Math.pow((M - 1.05) / 0.3, 2)) + (M > 1.05 ? 0.3 : 0); }

export function horizon(pos) {
  const up = V.norm(pos);
  let north = V.sub([0, 0, 1], V.mul(up, up[2]));
  if (V.len(north) < 1e-6) north = V.sub([1, 0, 0], V.mul(up, up[0]));
  north = V.norm(north);
  return { up, north, east: V.cross(north, up) }; // 오른손 좌표계에서 실제 지리상 동쪽
}

export function orbit(r, v) {
  const mu = PLANET.mu, rl = V.len(r), v2 = V.dot(v, v);
  const h = V.cross(r, v), hl = V.len(h);
  const eps = v2 / 2 - mu / rl;
  const ev = V.sub(V.mul(V.cross(v, h), 1 / mu), V.mul(r, 1 / rl));
  const e = V.len(ev), p = hl * hl / mu;
  let ra = Infinity, rp = p / (1 + e), a = Infinity;
  if (eps < 0) { a = -mu / (2 * eps); ra = a * (1 + e); rp = a * (1 - e); }
  const P = e > 1e-6 ? V.mul(ev, 1 / e) : V.norm(r);
  const hn = hl > 1e-9 ? V.mul(h, 1 / hl) : horizon(r).north;
  const Q = V.cross(hn, P);
  return { e, p, a, eps, P, Q, ap: ra - PLANET.R, pe: rp - PLANET.R, escape: eps >= 0, flat: hl < 1 };
}

// 분리된 부품이 어디에 떨어질지 미리 계산 (중력 + 공기저항, 바람은 무시)
// 돌려줌: { pos: 지표 낙하점, t: 걸리는 시간(초) } 또는 { orbit: true } (궤도에 남음 = 우주 쓰레기)
export function predictImpact(pos, vel, kind) {
  const o = orbit(pos, vel);
  if (o.escape || o.pe > PLANET.atm) return { orbit: true, ap: o.ap, pe: o.pe };
  let p = pos.slice(), v = vel.slice(), t = 0;
  const kk = 0.9 * AREA / 1000 * (kind === 'balloon' ? 40 : 1);
  while (t < 30000) {
    const r = V.len(p), alt = r - PLANET.R;
    if (alt <= 0) return { pos: V.mul(p, PLANET.R / r), t };
    const h = alt > PLANET.atm ? 2 : alt > 12000 ? 0.4 : 0.15;
    const g = PLANET.mu / (r * r), sp = V.len(v), k = 0.5 * density(Math.max(0, alt)) * sp * kk;
    v = V.add(v, V.mul(V.add(V.mul(p, -g / r), V.mul(v, -k)), h));
    p = V.add(p, V.mul(v, h)); t += h;
  }
  return { orbit: true, ap: o.ap, pe: o.pe };
}

export function satElements(r, v, epoch) {
  const o = orbit(r, v);
  if (o.escape) return null;
  const cosNu = V.dot(V.norm(r), o.P), sinNu = V.dot(V.norm(r), o.Q), nu = Math.atan2(sinNu, cosNu);
  const E = 2 * Math.atan2(Math.sqrt(1 - o.e) * Math.sin(nu / 2), Math.sqrt(1 + o.e) * Math.cos(nu / 2));
  return { a: o.a, e: o.e, P: o.P, Q: o.Q, M0: E - o.e * Math.sin(E), n: Math.sqrt(PLANET.mu / (o.a ** 3)), epoch, ap: o.ap, pe: o.pe, period: 2 * Math.PI * Math.sqrt(o.a ** 3 / PLANET.mu) };
}
export function satPosition(el, tMs) {
  const M = el.M0 + el.n * (tMs - el.epoch) / 1000;
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  return V.add(V.mul(el.P, el.a * (Math.cos(E) - el.e)), V.mul(el.Q, el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E)));
}

// ── 날씨 ──
export const WEATHERS = {
  clear:  { key: 'clear',  name: '맑음',     icon: '☀️', wind0: 3,  jet: 25, gust: 0.15, clouds: 0.25, rain: 0, lightning: 0 },
  cloudy: { key: 'cloudy', name: '구름 많음', icon: '⛅', wind0: 6,  jet: 35, gust: 0.25, clouds: 0.8,  rain: 0, lightning: 0 },
  windy:  { key: 'windy',  name: '강풍',     icon: '💨', wind0: 17, jet: 75, gust: 0.45, clouds: 0.45, rain: 0, lightning: 0 },
  storm:  { key: 'storm',  name: '뇌우',     icon: '⛈️', wind0: 13, jet: 45, gust: 0.6,  clouds: 1.0,  rain: 1, lightning: 0.07 },
};
export function makeWeather(key) {
  if (!WEATHERS[key]) { const ks = Object.keys(WEATHERS); key = ks[Math.floor(Math.random() * ks.length)]; }
  return { ...WEATHERS[key], dir: Math.random() * Math.PI * 2, phase: Math.random() * 100 };
}
// 고도별 바람 세기: 지상풍 → 고도 11 km 제트기류 → 25 km 위에서 잦아듦
export function windSpeed(w, alt) {
  if (!w || alt > 32000) return 0;
  const jet = (w.jet - w.wind0) * Math.exp(-Math.pow((alt - 11000) / 5000, 2));
  const fade = alt < 20000 ? 1 : Math.max(0, 1 - (alt - 20000) / 12000);
  return Math.max(0, (w.wind0 * (1 + Math.min(alt, 3000) / 3000 * 0.5) + jet) * fade);
}
// 날씨에 따른 발사 허용 기준 (실제 발사 기준을 단순화)
export function launchCriteria(w) {
  return [
    { ok: w.wind0 <= 15, text: '지상 바람 15 m/s 이하', now: Math.round(w.wind0) + ' m/s' },
    { ok: !w.lightning, text: '주변에 낙뢰 위험 없음', now: w.lightning ? '뇌우 경보' : '없음' },
    { ok: w.jet <= 60, text: '상층 제트기류 60 m/s 이하', now: Math.round(w.jet) + ' m/s' },
  ];
}

// ── 과학 실험 (실험실 부품) ──
export const EXPERIMENTS = [
  { id: 'ground', name: '지상 기압 측정', pts: 5, test: r => r.ignited, fact: '지상의 공기는 약 1기압(101 kPa)으로 손톱만 한 넓이에 1 kg쯤 되는 무게로 누르고 있어요.' },
  { id: 'cloud', name: '구름 속 물방울 채집', pts: 10, test: r => r.alt > 1500 && r.alt < 5000 && r.weather && r.weather.clouds > 0.5, fact: '구름은 수증기가 아니라 아주 작은 물방울과 얼음 알갱이가 모인 거예요.' },
  { id: 'tropo', name: '대류권 끝 기온 측정', pts: 10, test: r => r.alt > 10000, fact: '높이 올라갈수록 추워져서, 비행기가 나는 10 km 높이는 영하 50 °C 정도예요.' },
  { id: 'ozone', name: '오존층 관측', pts: 15, test: r => r.alt > 20000 && r.alt < 30000, fact: '성층권의 오존층이 해로운 자외선을 막아 생명을 지켜 줘요.' },
  { id: 'space', name: '우주 방사선 측정', pts: 20, test: r => r.alt > PLANET.atm, fact: '실제 지구는 고도 100 km(카르만 선)부터 우주예요. 이 게임 행성은 45 km로 줄였어요.' },
  { id: 'zeroG', name: '미세중력 실험', pts: 25, test: r => r.orbited, fact: '궤도에서 몸이 뜨는 건 중력이 없어서가 아니라, 옆으로 아주 빠르게 날며 계속 떨어지고 있기 때문이에요.' },
  { id: 'plasma', name: '재진입 플라스마 관측', pts: 25, test: r => r.heat > 600 && r.vertSpeed < 0, fact: '재진입 때 앞쪽 공기가 압축되며 수천 도로 달아올라 빛나는 플라스마가 생겨요.' },
];

// ── 설계 → 단(stage) ──
export function normalizeDesign(d) {
  if (Array.isArray(d)) d = { stack: d, radial: [] };
  const stack = (d.stack || []).filter(id => PARTS[id]);
  return {
    stack,
    radial: (d.radial || []).filter(r => PARTS[r.id] && r.at < stack.length),
    livery: { body: '#f1f2f4', accent: '#141518', flag: 'KR', ...(d.livery || {}) },
    flame: d.flame || 'kerosene',
    launch: d.launch || 'pad',
    real: d.real || null,   // 실제 로켓 예제에서 시작했는지 (미션 판정용)
  };
}
function topSegIndex(stack) {
  const out = []; let s = 0;
  stack.forEach((id, i) => { if (PARTS[id].kind === 'dec' && i > 0) s++; out.push(s); });
  return out;
}
export function buildSegments(design) {
  const { stack, radial } = normalizeDesign(design);
  const tops = topSegIndex(stack), nTop = stack.length ? tops[tops.length - 1] + 1 : 0;
  const segs = [];
  for (let k = nTop - 1; k >= 0; k--) {
    const idx = stack.map((_, i) => i).filter(i => tops[i] === k), ids = idx.map(i => stack[i]);
    const seg = { ids, idx, dry: 0, liquid: 0, liquidMax: 0, solids: [], boosters: [], fins: [] };
    for (const id of ids) {
      const p = PARTS[id]; seg.dry += p.mass;
      if (p.kind === 'tank') { seg.liquid += p.fuel; seg.liquidMax += p.fuel; }
      if (p.kind === 'srb') seg.solids.push({ id, fuel: p.fuel, max: p.fuel });
    }
    for (const r of radial) if (idx.includes(r.at)) {
      if (PARTS[r.id].kind === 'fin') { seg.fins.push({ id: r.id, n: r.n, at: r.at }); seg.dry += PARTS[r.id].mass * r.n; }
      else seg.boosters.push({ id: r.id, n: r.n, at: r.at, fuel: PARTS[r.id].fuel, max: PARTS[r.id].fuel, attached: true });
    }
    segs.push(seg);
  }
  return segs;
}
function segMass(s) {
  let m = s.dry + s.liquid;
  for (const x of s.solids) m += x.fuel;
  for (const b of s.boosters) if (b.attached) m += b.n * (PARTS[b.id].mass + RADIAL_DEC_MASS + b.fuel);
  return m;
}
const has = (s, kind) => s.ids.some(id => PARTS[id].kind === kind);
const isSatSeg = s => has(s, 'sat') && !has(s, 'pod') && !s.ids.some(id => PARTS[id].thrust && !PARTS[id].ion);

export function analyze3d(design) {
  const d = normalizeDesign(design), segs = buildSegments(d);
  const stages = []; let total = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    let m = 0; for (let j = i; j < segs.length; j++) m += segMass(segs[j]);
    const m0 = m, first = i === 0, isp = p => first && !d.stack.includes('balloon') ? (p.ispSL + p.ispV) / 2 : p.ispV;
    let Fc = 0, qc = 0; for (const id of s.ids) { const p = PARTS[id]; if (p.kind === 'engine') { const F = first && p.ion && !d.stack.includes('balloon') ? p.thrust * 0.02 : p.thrust; Fc += F; qc += p.thrust / (isp(p) * G0); } }
    let Fs = 0, qs = 0, fuelS = 0; for (const x of s.solids) { const p = PARTS[x.id]; Fs += p.thrust; qs += p.thrust / (isp(p) * G0); fuelS += x.fuel; }
    let Fb = 0, qb = 0, fuelB = 0, dryB = 0; for (const b of s.boosters) { const p = PARTS[b.id]; Fb += b.n * p.thrust; qb += b.n * p.thrust / (isp(p) * G0); fuelB += b.n * p.fuel; dryB += b.n * (p.mass + RADIAL_DEC_MASS); }
    const liquid = qc > 0 ? s.liquid : 0, F0 = (liquid > 0 ? Fc : 0) + Fs + Fb;
    let dv = 0, t = 0, coreLeft = liquid, solLeft = fuelS, bLeft = fuelB;
    for (let guard = 0; guard < 6; guard++) {
      const F = (coreLeft > 0 ? Fc : 0) + (solLeft > 0 ? Fs : 0) + (bLeft > 0 ? Fb : 0);
      const q = (coreLeft > 0 ? qc : 0) + (solLeft > 0 ? qs : 0) + (bLeft > 0 ? qb : 0);
      if (q <= 0) break;
      const dt = Math.min(coreLeft > 0 ? coreLeft / qc : Infinity, solLeft > 0 ? solLeft / qs : Infinity, bLeft > 0 ? bLeft / qb : Infinity);
      const burned = q * dt, Fv = (coreLeft > 0 ? s.ids.reduce((a, id) => a + (PARTS[id].kind === 'engine' ? PARTS[id].thrust : 0), 0) : 0) + (solLeft > 0 ? Fs : 0) + (bLeft > 0 ? Fb : 0);
      dv += (Fv / q) * Math.log(m / (m - burned));
      m -= burned; t += dt;
      if (coreLeft > 0) coreLeft = Math.max(0, coreLeft - qc * dt);
      if (solLeft > 0) solLeft = Math.max(0, solLeft - qs * dt);
      if (bLeft > 0) { bLeft -= qb * dt; if (bLeft <= 1e-6) { m -= dryB; bLeft = 0; } }
    }
    stages.push({ index: i + 1, mass: m0, dv, twr: F0 / (m0 * G0), burn: t, thrust: F0, boosters: s.boosters.reduce((a, b) => a + b.n, 0), sat: isSatSeg(s) });
    total += dv;
  }
  const mass = segs.reduce((a, s) => a + segMass(s), 0);
  const w = [], st = d.stack, kinds = st.map(id => PARTS[id].kind), hasK = k => kinds.includes(k);
  if (!st.length) w.push({ t: '부품이 없어요.', fatal: true });
  else {
    if (!hasK('pod') && !hasK('sat') && !hasK('lab') && !d.stack.some(id => PARTS[id].control)) w.push({ t: '조종할 부품(캡슐·위성·실험실)이 필요해요.', fatal: true });
    if (!stages[0] || !stages[0].thrust) w.push({ t: '맨 아래 단에 엔진이나 부스터가 없어요.', fatal: true });
    else if (stages[0].twr < 1 && !hasK('balloon')) w.push({ t: '추력이 무게보다 약해서 이륙할 수 없어요 (추력/무게 < 1).', fatal: true });
    else if (stages[0].twr < 1.25) w.push({ t: '추력/무게가 1.25보다 작아요. 중력에 연료를 많이 빼앗겨 궤도에 못 갈 수 있어요.', fatal: false });
    segs.forEach((s, i) => { if (s.ids.some(id => PARTS[id].kind === 'engine') && !s.liquid) w.push({ t: (i + 1) + '단 엔진에 연료탱크가 없어요.', fatal: true }); });
    if (kinds[kinds.length - 1] === 'dec') w.push({ t: '맨 아래에 분리기가 있어요.', fatal: true });
    if (hasK('balloon') && kinds[0] !== 'balloon') w.push({ t: '풍선은 맨 위에 달아야 해요.', fatal: true });
    if (hasK('sat') && segs.length && !isSatSeg(segs[segs.length - 1])) w.push({ t: '위성은 맨 위 단에 두고, 바로 아래에 분리기를 넣어야 궤도에서 떼어 낼 수 있어요.', fatal: false });
    if (hasK('pod') && !hasK('chute')) w.push({ t: '낙하산이 없으면 캡슐이 안전하게 착륙할 수 없어요.', fatal: false });
    if (hasK('pod') && !hasK('shield') && total > 2500) w.push({ t: '열 방패가 없으면 궤도에서 돌아올 때 타 버릴 수 있어요.', fatal: false });
    if (!d.radial.some(r => PARTS[r.id].kind === 'fin')) w.push({ t: '날개가 없으면 기울일 때 자세가 흔들려요. 맨 아래 부품에 날개를 붙여 보세요.', fatal: false });
  }
  return { stages, totalDv: total, mass, warnings: w, ok: !w.some(x => x.fatal) };
}

export class Rocket3D {
  constructor(design, weather) {
    this.design = normalizeDesign(design);
    this.weather = weather || makeWeather('clear');
    this.segs = buildSegments(this.design);
    this.pos = [0, PLANET.R, 0];
    this.vel = [0, 0, 0];
    this.fwd = [0, 1, 0];
    this.throttle = 1;
    this.tiltDir = [0, 0, 0];
    this.sas = 'off';
    this.t = 0;
    this.ignited = false; this.lifted = false;
    this.state = 'pad';
    this.chute = 'none';
    this.balloon = this.design.stack[0] === 'balloon' ? 'ready' : 'none';
    this.fairing = this.design.stack.includes('fairing') ? 'on' : 'none';
    this.debris = []; this.events = [];
    this.max = { alt: 0, vel: 0, q: 0, heat: 0, hvel: 0, aoa: 0 };
    this.reachedSpace = false; this.orbited = false;
    this.thrustNow = 0; this.coreThrust = 0; this.acc = 0;
    this.q = 0; this.aoa = 0; this.heat = 0; this.wind = [0, 0, 0]; this.windSpeed = 0;
    this.version = 0;
    this.deployedSat = null;
    this.impacts = []; this.stageNo = 0;   // 분리된 부품 낙하 예측
    this.fail = null;
    this.science = { points: 0, done: new Set() };
    this.unstableWarned = false; this.fuelOut = false;
    this.lockSasUntil = 0; this.lockThrottleUntil = 0; this.strikeAt = -1;
    this.sailOpen = false;
  }

  get parts() {
    const stack = [], radial = [];
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const s = this.segs[i];
      for (const b of s.boosters) if (b.attached) radial.push({ at: stack.length + s.idx.indexOf(b.at), id: b.id, n: b.n });
      for (const f of s.fins) radial.push({ at: stack.length + s.idx.indexOf(f.at), id: f.id, n: f.n });
      stack.push(...s.ids);
    }
    return { ...this.design, stack, radial };
  }
  get r() { return V.len(this.pos); }
  get alt() { return this.r - PLANET.R; }
  get speed() { return V.len(this.vel); }
  get vertSpeed() { return V.dot(this.vel, V.norm(this.pos)); }
  get horizSpeed() { const up = V.norm(this.pos); return V.len(V.sub(this.vel, V.mul(up, V.dot(this.vel, up)))); }
  get mass() { return this.segs.reduce((a, s) => a + segMass(s), 0); }
  get active() { return this.segs[0]; }
  get height() { return this.segs.reduce((a, s) => a + s.ids.reduce((b, id) => b + PARTS[id].h, 0), 0); }
  hasPart(kind) { return this.segs.some(s => has(s, kind)); }
  get hasChute() { return this.segs.some(s => s.ids.includes('chute')); }
  get hasFins() { return this.segs.some(s => s.fins.length); }
  get isSatellite() { return this.segs.length === 1 && isSatSeg(this.segs[0]); }
  get stageFuelFrac() {
    const s = this.active; if (!s) return 0;
    let max = s.liquidMax, cur = s.liquid;
    for (const x of s.solids) { max += x.max; cur += x.fuel; }
    for (const b of s.boosters) if (b.attached) { max += b.max * b.n; cur += b.fuel * b.n; }
    return max ? cur / max : 0;
  }
  get anyFuel() {
    return this.segs.some(s => (s.liquid > 0 && s.ids.some(id => PARTS[id].kind === 'engine')) || s.solids.some(x => x.fuel > 0) || s.boosters.some(b => b.attached && b.fuel > 0));
  }
  get nextAction() {
    if (this.state !== 'pad' && this.state !== 'flying') return 'none';
    if (this.balloon === 'ready') return 'balloon';
    if (this.balloon === 'rising') return 'release';
    if (!this.ignited) return 'launch';
    const s = this.active;
    if (s && s.boosters.some(b => b.attached)) return 'boosters';
    if (this.segs.length > 1) return this.segs.length === 2 && isSatSeg(this.segs[1]) ? 'deploy' : 'stage';
    if (this.hasChute && this.chute === 'none') return 'chute';
    return 'none';
  }
  orbit() { return orbit(this.pos, this.vel); }
  // 가장 굵은 부품 기준 정면 면적 배수 (굵은 로켓은 공기저항도 큼)
  get areaK() {
    if (this._akV !== this.version) { this._akV = this.version; let w = 1; for (const s of this.segs) for (const id of s.ids) w = Math.max(w, PARTS[id].w || 1); this._ak = w * w; }
    return this._ak;
  }
  addImpact(d, name) {
    const pr = predictImpact(d.pos, d.vel, d.kind);
    this.impacts.push({ name, ...pr, at: this.t, alt: this.alt, speed: this.speed });
  }
  log(text, kind, extra) { this.events.push({ t: this.t, text, kind: kind || 'info', ...(extra || {}) }); }

  sideDirs(n) {
    const hz = horizon(this.pos);
    let a = V.cross(this.fwd, hz.north); if (V.len(a) < 1e-6) a = V.cross(this.fwd, hz.east);
    a = V.norm(a); const b = V.cross(a, this.fwd);
    return Array.from({ length: n }, (_, k) => { const t = k / n * Math.PI * 2; return V.add(V.mul(a, Math.cos(t)), V.mul(b, Math.sin(t))); });
  }

  removePart(kind) { // 페어링·풍선 떼어 내기
    for (const s of this.segs) {
      const i = s.ids.findIndex(id => PARTS[id].kind === kind);
      if (i >= 0) {
        const id = s.ids[i]; s.ids.splice(i, 1); s.idx.splice(i, 1); s.dry -= PARTS[id].mass;
        this.debris.push({ design: { stack: [id], radial: [] }, pos: V.add(this.pos, V.mul(this.fwd, this.height)), vel: V.add(this.vel, V.mul(this.sideDirs(1)[0], 6)), fwd: this.fwd.slice(), spin: 0.8, life: 40, kind });
        if (kind === 'fairing') this.addImpact(this.debris[this.debris.length - 1], '페어링');
        this.version++;
        return true;
      }
    }
    return false;
  }

  ignite() {
    this.ignited = true; this.state = 'flying';
    if (this.design.launch === 'rail' && !this.lifted && this.balloon === 'none') {
      this.vel = V.mul(horizon(this.pos).up, RAIL_SPEED); this.lifted = true;
      this.log('전자기 사출! 출발 속도 ' + RAIL_SPEED + ' m/s', 'good', { fact: '전자석의 힘으로 처음 속도를 얻으면 가장 무거울 때 쓰는 연료를 아낄 수 있어요(매스 드라이버 구상).' });
    } else this.log('점화!');
  }

  stage() {
    const a = this.nextAction;
    if (a === 'balloon') { this.balloon = 'rising'; this.state = 'flying'; this.lifted = true; this.log('풍선 출발! 18 km까지 천천히 올라가요.', 'good', { fact: '헬륨은 공기보다 가벼워서 떠올라요. 높이 올라갈수록 기압이 낮아져 풍선이 점점 부풀어요.' }); return a; }
    if (a === 'release') { this.releaseBalloon(); return a; }
    if (a === 'launch') { this.ignite(); return a; }
    if (a === 'boosters') {
      const s = this.active;
      for (const b of s.boosters) {
        if (!b.attached) continue;
        b.attached = false;
        this.sideDirs(b.n).forEach(dir => this.debris.push({ design: { stack: [b.id], radial: [] }, pos: V.add(this.pos, V.mul(dir, 1.3)), vel: V.add(this.vel, V.mul(dir, 4)), fwd: this.fwd.slice(), spin: (Math.random() - 0.5) * 0.8, life: 50 }));
        this.addImpact(this.debris[this.debris.length - 1], '측면 부스터 ' + b.n + '개');
      }
      this.version++; this.log('측면 부스터 분리!');
      return a;
    }
    if (a === 'stage' || a === 'deploy') {
      if (a === 'deploy' && this.fairing === 'on') { this.removePart('fairing'); this.fairing = 'off'; this.log('페어링 분리'); }
      const seg = this.segs.shift();
      const h = seg.ids.reduce((x, id) => x + PARTS[id].h, 0);
      const fins = seg.fins.map(f => ({ at: seg.idx.indexOf(f.at), id: f.id, n: f.n }));
      this.debris.push({ design: { stack: seg.ids, radial: fins }, pos: this.pos.slice(), vel: V.sub(this.vel, V.mul(this.fwd, 2)), fwd: this.fwd.slice(), spin: (Math.random() - 0.5) * 0.5, life: 60 });
      this.stageNo++;
      this.addImpact(this.debris[this.debris.length - 1], a === 'deploy' ? '위성을 올린 마지막 단' : this.stageNo + '단');
      this.pos = V.add(this.pos, V.mul(this.fwd, h));
      this.version++;
      if (a === 'deploy') {
        const ob = this.orbit(), ok = !ob.escape && ob.pe > PLANET.atm;
        this.deployedSat = { ok, ids: this.segs[0].ids.slice() };
        this.log(ok ? '위성 분리 성공! 궤도를 돌기 시작했어요.' : '위성을 분리했지만 궤도가 낮아 다시 떨어져요…', ok ? 'good' : 'bad');
      } else this.log('단 분리!');
      return a;
    }
    if (a === 'chute') { this.chute = 'armed'; this.log('낙하산 준비 — 안전한 속도가 되면 자동으로 펴져요.'); }
    return a;
  }

  releaseBalloon() {
    this.balloon = 'released';
    this.removePart('balloon');
    this.log('풍선 분리 — 이제 점화하세요!', 'good');
  }

  destroy(code, text, fact) {
    if (this.fail) return;
    this.fail = { code, text, fact };
    this.state = 'crashed';
    for (const s of this.segs) {
      this.debris.push({ design: { stack: s.ids, radial: [] }, pos: this.pos.slice(), vel: V.add(this.vel, V.mul(V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), 15)), fwd: V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), spin: (Math.random() - 0.5) * 3, life: 30 });
    }
    this.segs = []; this.version++;
    this.log(text, 'bad', { fact, boom: true });
  }

  update(dt) {
    const n = Math.max(1, Math.round(dt / DT));
    for (let i = 0; i < n; i++) this.step(DT);
    for (const d of this.debris) this.stepDebris(d, dt);
    this.debris = this.debris.filter(d => d.life > 0);
  }

  windAt(pos, alt) {
    const w = this.weather, hz = horizon(pos);
    const t = this.t + w.phase;
    const gust = 1 + w.gust * (0.6 * Math.sin(t * 0.7) + 0.4 * Math.sin(t * 2.3 + 1.7));
    const s = windSpeed(w, alt) * Math.max(0, gust);
    const dir = w.dir + 0.3 * Math.sin(alt / 4000);
    return V.add(V.mul(hz.east, Math.cos(dir) * s), V.mul(hz.north, Math.sin(dir) * s));
  }

  steer(dt, rel, q) {
    const hz = horizon(this.pos);
    if (this.chute === 'open') { this.fwd = V.toward(this.fwd, hz.up, dt * 1.5); return; }
    if (!this.lifted || this.balloon === 'rising') { this.fwd = hz.up; return; }
    const sasOk = this.t >= this.lockSasUntil;
    if (sasOk && this.sas !== 'off' && this.speed > 3) {
      let target = V.norm(this.vel);
      if (this.sas === 'retro') target = V.mul(target, -1);
      this.fwd = V.toward(this.fwd, target, ROT_RATE * dt);
    }
    const mag = V.len(this.tiltDir);
    if (mag > 0.01) this.fwd = V.norm(V.rot(this.fwd, V.norm(V.cross(hz.up, this.tiltDir)), Math.min(1, mag) * ROT_RATE * dt));
    // 공기역학 회전력: 날개가 있으면 바람 방향으로 정렬(화살), 없으면 받음각이 크면 점점 더 틀어짐
    const va = V.len(rel);
    if (va > 20 && q > 500) {
      const relDir = V.mul(rel, 1 / va);
      // 뒤로 날 때(열 방패가 앞): 배드민턴 셔틀콕처럼 뒤쪽 방향으로 안정
      if (this.aoa > Math.PI / 2) this.fwd = V.toward(this.fwd, V.mul(relDir, -1), Math.min(1, q / 15000) * 0.8 * dt);
      else if (this.hasFins) this.fwd = V.toward(this.fwd, relDir, Math.min(1, q / 15000) * 0.8 * dt);
      else if (this.aoa > LIMITS.unstableAoa && q > LIMITS.unstableQ) {
        const away = V.norm(V.sub(this.fwd, V.mul(relDir, V.dot(this.fwd, relDir))));
        this.fwd = V.norm(V.add(this.fwd, V.mul(away, this.aoa * q / 14000 * dt)));
        if (!this.unstableWarned) { this.unstableWarned = true; this.log('자세가 불안정해요! [진행]을 눌러 날아가는 방향에 맞추세요.', 'bad', { fact: '화살 깃처럼 뒤쪽에 날개가 있으면 공기가 로켓을 바로 세워 줘요(무게중심보다 압력중심이 뒤에 있어야 안정).' }); }
      }
    }
  }

  step(dt) {
    if (this.state === 'landed' || this.state === 'crashed') return;
    const r = this.r, alt = r - PLANET.R, up = V.mul(this.pos, 1 / r);
    const rho = density(alt), press = rho / PLANET.rho0;
    this.wind = this.windAt(this.pos, alt); this.windSpeed = V.len(this.wind);

    // 고고도 풍선: 바람을 타고 천천히 상승
    if (this.balloon === 'rising') {
      this.vel = V.add(V.mul(up, BALLOON_CLIMB), V.mul(this.wind, 0.9));
      this.pos = V.add(this.pos, V.mul(this.vel, dt)); this.t += dt;
      this.fwd = up;
      if (this.alt > this.max.alt) this.max.alt = this.alt;
      this.science_();
      if (this.alt >= BALLOON_TOP) this.releaseBalloon();
      return;
    }

    const rel = V.sub(this.vel, this.wind), va = V.len(rel);
    this.q = 0.5 * rho * va * va;
    this.aoa = va > 5 ? V.angle(this.fwd, rel) : 0;
    this.steer(dt, rel, this.q);
    // 번개
    const w = this.weather;
    if (w.lightning && alt > 400 && alt < 9000 && Math.random() < w.lightning * dt) this.lightning();

    const m = this.mass;
    let F = [0, 0, 0];
    this.thrustNow = 0; this.coreThrust = 0;
    const s = this.active;
    const throttle = this.t < this.lockThrottleUntil ? 0 : this.throttle;
    if (s && this.ignited) {
      const isp = p => p.ispV + (p.ispSL - p.ispV) * press;
      let flow = 0;
      for (const id of s.ids) {
        const p = PARTS[id];
        if (p.kind === 'engine' && s.liquid > 0 && throttle > 0) {
          const f = p.thrust * throttle * (p.ion ? Math.pow(Math.max(0, 1 - press), 6) : 1);
          this.thrustNow += f; flow += p.thrust * throttle / (isp(p) * G0) * (p.ion ? 0.5 : 1);
        }
      }
      s.liquid = Math.max(0, s.liquid - flow * dt);
      for (const x of s.solids) if (x.fuel > 0) { const p = PARTS[x.id]; this.thrustNow += p.thrust; x.fuel = Math.max(0, x.fuel - p.thrust / (isp(p) * G0) * dt); if (!x.fuel) this.log('고체 로켓 연소 종료'); }
      this.coreThrust = this.thrustNow;
      for (const b of s.boosters) if (b.attached && b.fuel > 0) { const p = PARTS[b.id]; this.thrustNow += p.thrust * b.n; b.fuel = Math.max(0, b.fuel - p.thrust / (isp(p) * G0) * dt); if (!b.fuel) this.log('측면 부스터 연소 끝 — 분리하세요!'); }
      F = V.mul(this.fwd, this.thrustNow);
    }
    // 태양 돛: 우주에서 햇빛이 미는 힘 (행성 그림자 안에서는 없음)
    this.sailOpen = this.hasPart('sail') && alt > PLANET.atm;
    if (this.sailOpen) {
      const along = V.dot(this.pos, SUN), perp = V.len(V.sub(this.pos, V.mul(SUN, along)));
      if (along > 0 || perp > PLANET.R) F = V.add(F, V.mul(SUN, SAIL_FORCE));
    }
    if (this.chute === 'armed' && alt < CHUTE_SAFE_ALT && this.speed < CHUTE_SAFE_SPEED && rho > 0) { this.chute = 'open'; this.log('낙하산이 펴졌어요!', 'good'); }

    // 공기 저항: 앞면(진행 방향)과 옆면(옆바람)으로 나눠 계산
    if (rho > 0 && va > 0.01) {
      const top = this.segs.length ? PARTS[this.segs[this.segs.length - 1].ids[0]] : null;
      const pointy = top && (top.kind === 'nose' || top.kind === 'fairing');
      const backward = this.aoa > Math.PI / 2; // 열 방패가 앞: 뭉툭한 면이 공기를 받아 저항이 큼
      let cdA = (backward ? 1.25 : pointy ? 0.32 : 0.45) * machFactor(va / soundSpeed(alt)) * AREA * this.areaK;
      if (this.active && this.active.boosters.some(b => b.attached)) cdA *= 1.6;
      // 낙하산: 모든 방향의 상대 바람에 저항
      if (this.chute === 'open') F = V.sub(F, V.mul(rel, 0.5 * rho * va * CHUTE_CD * CHUTE_AREA));
      const ax = V.mul(this.fwd, V.dot(rel, this.fwd)), side = V.sub(rel, ax);
      F = V.sub(F, V.mul(ax, 0.5 * rho * V.len(ax) * cdA));
      const sideA = this.chute === 'open' ? 0 : 0.2 * this.height * 1.25; // 옆면 저항(작은 받음각에서는 작게)
      F = V.sub(F, V.mul(side, 0.5 * rho * V.len(side) * sideA));
    }
    const g = PLANET.mu / (r * r);
    const a = V.sub(V.mul(F, 1 / m), V.mul(up, g));
    if (!this.lifted && V.dot(a, up) <= 0) { this.vel = [0, 0, 0]; this.acc = 0; if (this.ignited) this.t += dt; return; }
    this.vel = V.add(this.vel, V.mul(a, dt));
    this.pos = V.add(this.pos, V.mul(this.vel, dt));
    this.t += dt;
    this.acc = V.len(V.mul(F, 1 / m)) / G0;

    // 열: 공기 밀도의 제곱근 × 속도³에 비례 (시간 상수 4초로 달아오르고 식음)
    const heatEq = 1.1e-6 * Math.sqrt(rho) * va * va * va;
    this.heat += (heatEq - this.heat) * Math.min(1, dt / 4);

    const nalt = this.alt;
    if (!this.lifted && nalt > 0.5) { this.lifted = true; this.log('이륙!', 'good'); }
    const mx = this.max;
    if (nalt > mx.alt) mx.alt = nalt;
    if (this.speed > mx.vel) mx.vel = this.speed;
    if (this.q > mx.q) mx.q = this.q;
    if (this.heat > mx.heat) mx.heat = this.heat;
    const hs = this.horizSpeed; if (hs > mx.hvel) mx.hvel = hs;
    if (this.q > 2000 && this.aoa > mx.aoa) mx.aoa = this.aoa;

    // 실패 판정
    if (this.q > LIMITS.maxQ * (this.aoa > Math.PI / 2 ? 1.6 : 1)) return this.destroy('maxq', '공기 압력이 너무 커서 기체가 부서졌어요! (최대 동압 ' + Math.round(this.q / 1000) + ' kPa)', '빠르게 날수록 공기가 세게 부딪혀요. 실제 로켓은 공기가 짙은 낮은 고도에서 일부러 추력을 줄여 "최대 동압(Max-Q)"을 넘기지 않아요.');
    if (this.q * Math.sin(this.aoa) > LIMITS.sideLoad && this.chute !== 'open') return this.destroy('aoa', '옆으로 받는 바람에 기체가 꺾였어요! (받음각 ' + Math.round(this.aoa * 57.3) + '°)', '빠를 때 로켓을 급하게 기울이면 옆면에 엄청난 공기 힘이 걸려요. 공기가 짙을 땐 날아가는 방향과 거의 같게 유지해야 해요.');
    const shield = this.hasPart('shield');
    if (this.heat > (shield ? LIMITS.heatShield : LIMITS.heatNoShield) && this.vertSpeed < 0) return this.destroy('heat', '재진입 열에 기체가 타 버렸어요! (' + Math.round(this.heat) + ' °C)', '우주에서 돌아올 때는 공기가 압축되며 엄청 뜨거워져요. 캡슐 아래에 열 방패를 달고, 너무 가파르게 들어오지 않아야 해요.');
    // 발사탑 충돌 (강풍에 밀려서)
    if (nalt < PAD_TOWER.h && this.lifted) {
      // 발사장 근처에서는 월드 x·z가 곧 동서·남북 (발사장은 [0, R, 0])
      const dx = this.pos[0] - PAD_TOWER.x, dz = this.pos[2] - PAD_TOWER.z;
      if (Math.abs(dx) < PAD_TOWER.half + 0.6 && Math.abs(dz) < PAD_TOWER.half + 0.6) return this.destroy('tower', '바람에 밀려 발사탑에 부딪혔어요!', '그래서 실제 발사는 지상 바람이 약할 때만 해요. 강풍 속에서는 로켓이 옆으로 밀려 위험해요.');
    }
    if (nalt > PLANET.atm && !this.reachedSpace) { this.reachedSpace = true; this.log('우주에 도착했어요!', 'good'); }
    if (nalt > PLANET.atm && !this.orbited) { const ob = this.orbit(); if (!ob.escape && ob.pe > PLANET.atm) { this.orbited = true; this.log(this.hasPart('pod') && this.segs.some(s2 => s2.ids.includes('catPod')) ? '궤도 진입 성공! 냥~ 무중력이다냥!' : '궤도 진입 성공!', 'good'); } }
    if (this.fairing === 'on' && nalt > 50000) { this.removePart('fairing'); this.fairing = 'off'; this.log('페어링 분리 — 공기가 거의 없어 이제 벗겨도 돼요.'); }
    // 연료가 바닥났는데 궤도에 못 오름
    if (!this.fuelOut && this.ignited && !this.orbited && nalt > 2000 && !this.anyFuel && !this.isSatellite) {
      this.fuelOut = true;
      const need = Math.sqrt(PLANET.mu / Math.max(this.r, PLANET.R + PLANET.atm));
      this.log('연료가 바닥났어요 — 궤도 진입 실패 (수평 속도 ' + Math.max(0, Math.round(need - this.horizSpeed)) + ' m/s 부족)', 'bad');
    }
    this.science_();
    if (this.lifted && nalt <= 0) {
      this.pos = V.mul(V.norm(this.pos), PLANET.R);
      this.impact = this.speed; this.vel = [0, 0, 0];
      if (this.impact <= SAFE_LANDING) { this.state = 'landed'; this.log('무사히 착륙했어요! (' + this.impact.toFixed(1) + ' m/s)', 'good'); }
      else { this.state = 'crashed'; this.fail = this.fail || { code: 'ground', text: '지면에 ' + Math.round(this.impact) + ' m/s로 부딪혔어요.' }; this.log('지면에 부딪혔어요… (' + this.impact.toFixed(0) + ' m/s)', 'bad'); }
    }
  }

  science_() {
    if (!this.hasPart('lab')) return;
    for (const e of EXPERIMENTS) {
      if (this.science.done.has(e.id) || !e.test(this)) continue;
      this.science.done.add(e.id); this.science.points += e.pts;
      this.log('🔬 ' + e.name + ' +' + e.pts + '점', 'science', { fact: e.fact });
    }
  }

  lightning() {
    this.strikeAt = this.t;
    const jolt = V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.fwd = V.norm(V.add(this.fwd, V.mul(jolt, 0.18)));
    this.lockSasUntil = this.t + 5;
    const cut = Math.random() < 0.25;
    if (cut) this.lockThrottleUntil = this.t + 4;
    this.log('⚡ 번개에 맞았어요! ' + (cut ? '엔진이 잠시 꺼졌어요.' : '자동 자세 장치가 잠시 멈췄어요.'), 'bad', { fact: '1969년 아폴로 12호도 발사 직후 번개를 두 번 맞았어요. 그래서 뇌우 근처에서는 발사하지 않아요.', flash: true });
  }

  stepDebris(d, dt) {
    const steps = Math.max(1, Math.round(dt / 0.05)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const r = V.len(d.pos), alt = r - PLANET.R;
      if (alt <= 0) { d.life = 0; return; }
      const g = PLANET.mu / (r * r), v = V.len(d.vel), k = v > 0 ? 0.5 * density(alt) * v * 0.9 * AREA / 1000 * (d.kind === 'balloon' ? 40 : 1) : 0;
      d.vel = V.add(d.vel, V.mul(V.add(V.mul(d.pos, -g / r), V.mul(d.vel, -k)), h));
      d.pos = V.add(d.pos, V.mul(d.vel, h));
    }
    d.fwd = V.norm(V.rot(d.fwd, horizon(d.pos).north, d.spin * dt));
    d.life -= dt;
  }

  // 비행이 끝났을 때 결과 설명
  diagnose() {
    const lines = [];
    if (this.fail && this.fail.code !== 'ground') return { title: '비행 실패', lines: [this.fail.text], fact: this.fail.fact };
    if (this.deployedSat && this.deployedSat.ok) return { title: '임무 성공: 위성 배치!', lines: ['위성이 궤도를 돌고 있어요.'] };
    if (this.orbited) {
      if (this.state === 'landed') return { title: '임무 성공: 궤도 비행 후 귀환!', lines: ['우주를 돌고 무사히 돌아왔어요.'] };
      lines.push('궤도에는 올랐어요.');
    }
    if (this.state === 'landed') return { title: '무사 착륙', lines: lines.concat(this.orbited ? [] : ['궤도까지는 가지 못했지만 안전하게 돌아왔어요.']) };
    const need = Math.sqrt(PLANET.mu / (PLANET.R + Math.max(this.max.alt, PLANET.atm)));
    if (!this.orbited) {
      lines.push('궤도에 오르려면 수평 속도가 약 ' + Math.round(need) + ' m/s 필요한데, 최고 ' + Math.round(this.max.hvel) + ' m/s였어요.');
      if (this.max.alt > 120000 && this.max.hvel < need * 0.6) lines.push('너무 똑바로 위로만 올라갔어요. 더 일찍 동쪽(옆)으로 기울여 속도를 옆으로 써야 해요.');
      else if (this.max.alt < 40000 && this.max.q > 30000) lines.push('너무 일찍 눕혀서 짙은 공기 속에서 속도를 많이 잃었어요. 10 km까지는 좀 더 세워서 올라가요.');
      if (this.fuelOut) lines.push('연료(Δv)가 부족했어요. 탱크를 늘리거나 단을 하나 더 쌓아 보세요.');
      else if (this.anyFuel) lines.push('아직 연료가 남아 있었어요. 단 분리와 엔진을 끝까지 써 보세요.');
    }
    return { title: this.fail ? '추락' : '궤도 진입 실패', lines: this.fail ? [this.fail.text].concat(lines) : lines };
  }
}

// 자동 비행: 중력 선회로 궤도까지. 공기가 짙을 땐 받음각을 작게 유지
export class Autopilot {
  constructor(rk, targetAp = 65000) { this.rk = rk; this.phase = 'asc'; this.targetAp = targetAp; }
  get label() { return { balloon: '풍선 상승 중', asc: '상승·중력 선회', coast: '원지점까지 관성 비행', circ: '궤도 원형화 가속', done: '궤도 진입 완료' }[this.phase] || ''; }
  update() {
    const rk = this.rk;
    if (rk.nextAction === 'balloon') { rk.stage(); this.phase = 'balloon'; return; }
    if (rk.balloon === 'rising') { this.phase = 'balloon'; return; }
    if (this.phase === 'balloon') this.phase = 'asc';
    if (rk.nextAction === 'launch') { rk.throttle = 1; rk.stage(); return; }
    if (rk.state !== 'flying') return;
    const hz = horizon(rk.pos), alt = rk.alt, ob = rk.lifted ? rk.orbit() : null;
    rk.sas = 'off'; rk.tiltDir = [0, 0, 0];
    const aim = p => V.norm(V.add(V.mul(hz.up, Math.cos(p)), V.mul(hz.east, Math.sin(p))));
    const rel = V.sub(rk.vel, rk.wind), va = V.len(rel);
    const limitAoa = d => { if (va < 30 || rk.q < 1500) return d; const allow = 0.35 - 0.25 * Math.min(1, rk.q / 25000); return V.toward(V.mul(rel, 1 / va), d, allow); };
    // 최대 동압 근처에서는 실제 로켓처럼 추력을 줄임 (액체 엔진만)
    const maxQThrottle = rk.q > 35000 ? Math.max(0.35, 1 - (rk.q - 35000) / 15000) : 1;
    if (this.phase === 'asc') {
      const base = rk.balloon === 'released' ? BALLOON_TOP + 300 : 800;
      rk.fwd = limitAoa(aim(alt < base ? 0 : Math.min(1.45, Math.sqrt((alt - base) / 27000) * 1.45))); rk.throttle = maxQThrottle;
      if (ob && ob.ap > this.targetAp) { rk.throttle = 0; this.phase = 'coast'; }
    } else if (this.phase === 'coast') {
      rk.fwd = limitAoa(aim(Math.PI / 2)); rk.throttle = 0;
      if (rk.vertSpeed < (alt > PLANET.atm ? 150 : 10)) this.phase = 'circ';
    } else if (this.phase === 'circ') {
      // 내려가기 시작하면 살짝 위로 들어 고도를 지키며 가속
      rk.fwd = limitAoa(aim(Math.PI / 2 - Math.max(-0.15, Math.min(0.5, -rk.vertSpeed / 300)))); rk.throttle = maxQThrottle;
      if (ob && ob.pe > 50000) { rk.throttle = 0; this.phase = 'done'; }
    }
    const act = rk.nextAction;
    if (act === 'boosters' && rk.active.boosters.every(b => !b.attached || b.fuel <= 0)) rk.stage();
    else if (act === 'stage' && (rk.stageFuelFrac === 0 || this.phase === 'done')) rk.stage();
    else if (act === 'deploy' && this.phase === 'done') rk.stage();
  }
}

// 예제 설계 (3D)
// 실제 로켓을 닮은 예제 (1/16 크기 지구에 맞춰 크기·힘은 줄이고, 단 구성·엔진 수·모양은 실제처럼)
export const REAL_ROCKETS = [
  { key: "nuri", name: "누리호", design: {"stack": ["fairing", "satObs", "dec", "tankM", "engV", "dec", "tankL@13", "engL", "dec", "tankXL@13", "tankL@13", "engLx4"], "radial": [{"at": 11, "id": "fin", "n": 4}], "livery": {"body": "#f3f4f6", "accent": "#1b1d22", "flag": "KR"}, "flame": "kerosene"}, facts: {"country": "대한민국", "first": "2021년 (2022년 첫 성공)", "height": "47.2 m", "stages": "3단", "engines": "1단 75톤 엔진 4개 묶음 · 2단 1개 · 3단 7톤 1개"}, story: "우리 기술로 만든 첫 우주발사체예요. 1단은 75톤급 엔진 4개를 한 몸처럼 움직이게 묶었어요(클러스터링). 나로우주센터 제2발사대에서 발사해요." },
  { key: "soyuz", name: "소유즈", design: {"stack": ["les", "chute", "pod", "shield", "tankS", "engV", "decTruss", "tankM", "engL", "decTruss", "tankXL", "tankL", "engSx4"], "radial": [{"at": 10, "id": "boosterCone", "n": 4}, {"at": 12, "id": "fin", "n": 4}], "livery": {"body": "#c3c8bb", "accent": "#e06a2c", "flag": "NONE"}, "flame": "kerosene"}, facts: {"country": "소련·러시아", "first": "1966년", "height": "약 46 m", "stages": "부스터 4개 + 2단 + 3단", "engines": "부스터·중심 단 모두 4개 노즐"}, story: "역사상 가장 많이 발사된 로켓 계열(R-7)이에요. 지금도 우주비행사를 실어 날라요. 부스터 4개가 떨어지며 십자가처럼 퍼지는 모습을 '코롤료프 십자가'라고 불러요." },
  { key: "saturn", name: "새턴 5", design: {"stack": ["les", "chute", "pod", "shield", "tankS", "engV", "dec", "tankL@13", "engV", "dec", "tankL@20", "engLx5", "dec", "tankXL@20", "engLx5"], "radial": [{"at": 14, "id": "fin", "n": 4}], "livery": {"body": "#f4f4f2", "accent": "#151515", "flag": "US"}, "flame": "kerosene"}, facts: {"country": "미국 (NASA)", "first": "1967년", "height": "110.6 m", "stages": "3단", "engines": "1단 F-1 엔진 5개 · 2단 J-2 5개 · 3단 J-2 1개"}, story: "아폴로 11호(1969)를 달로 보낸 로켓이에요. 13번 발사되는 동안 우주비행사를 한 번도 잃지 않았어요. 맨 위의 뾰족한 탑은 비상 탈출 타워예요." },
  { key: "n1", name: "N1", design: {"stack": ["les", "chute", "pod", "shield", "tankS", "engS", "decTruss", "tankM@13-10", "engVx4", "decTruss", "tankL@16-13", "engVx7", "decTruss", "tankXL@20-16", "engSx30"], "radial": [{"at": 14, "id": "gridFin", "n": 4}], "livery": {"body": "#e6e3da", "accent": "#2b2b2b", "flag": "NONE"}, "flame": "kerosene"}, facts: {"country": "소련", "first": "1969년 (시험 4번)", "height": "105 m", "stages": "4단 + 달 착륙선", "engines": "1단 NK-15 엔진 30개"}, story: "소련이 달에 가려고 만든 거대한 로켓이에요. 1단 엔진 30개를 함께 맞추기가 너무 어려워 4번 모두 실패했어요. 엔진을 많이 묶을수록 제어가 어렵다는 교훈을 남겼어요." },
  { key: "f9", name: "팰컨 9", design: {"stack": ["fairing", "satCom", "dec", "tankL", "engS", "dec", "tankXL", "tankL", "engSx9"], "radial": [{"at": 6, "id": "gridFin", "n": 4}, {"at": 7, "id": "legs", "n": 4}], "livery": {"body": "#f5f6f7", "accent": "#141518", "flag": "US"}, "flame": "kerosene"}, facts: {"country": "미국 (스페이스X)", "first": "2010년", "height": "약 70 m", "stages": "2단", "engines": "1단 멀린 엔진 9개 · 2단 1개"}, story: "1단이 다시 돌아와 착륙해서 수십 번이나 다시 써요(2015년 첫 착륙). 격자 날개로 방향을 잡고 착륙 다리를 펴고 내려와요." },
  { key: "fh", name: "팰컨 헤비", design: {"stack": ["fairing", "satCom", "dec", "tankL", "engS", "dec", "tankXL", "tankL", "engSx9"], "radial": [{"at": 6, "id": "boosterCore", "n": 2, "rot": 0.785}, {"at": 6, "id": "gridFin", "n": 4}, {"at": 7, "id": "legs", "n": 4}], "livery": {"body": "#f5f6f7", "accent": "#141518", "flag": "US"}, "flame": "kerosene"}, facts: {"country": "미국 (스페이스X)", "first": "2018년", "height": "약 70 m", "stages": "1단 코어 3개 + 2단", "engines": "코어마다 멀린 9개, 모두 27개"}, story: "팰컨 9 1단 세 개를 나란히 묶은 로켓이에요. 양옆 부스터 2개가 동시에 돌아와 나란히 착륙하는 장면으로 유명해요." },
  { key: "starship", name: "스타십", design: {"stack": ["ssNose", "tankL@16", "engVx3", "decTruss", "tankXL@16", "tankL@16", "engSx33"], "radial": [{"at": 1, "id": "flap", "n": 2}, {"at": 4, "id": "gridFin", "n": 4}], "livery": {"body": "#b8bdc4", "accent": "#18191b", "flag": "NONE", "finish": "steel"}, "flame": "methane"}, facts: {"country": "미국 (스페이스X)", "first": "2023년 (시험 비행)", "height": "약 120 m", "stages": "2단 (슈퍼 헤비 + 스타십)", "engines": "슈퍼 헤비 랩터 33개 · 스타십 6개"}, story: "지금까지 만든 로켓 중 가장 크고 힘이 세요. 스테인리스강으로 만들고 두 단 모두 다시 쓰는 것이 목표예요. 2024년에는 돌아오는 슈퍼 헤비를 발사탑의 '젓가락' 팔로 붙잡았어요." },
];
const L = (body, accent, flag) => ({ body, accent, flag });
export const EXAMPLES3D = [
  { name: '통신위성 발사체', design: { stack: ['fairing', 'satCom', 'dec', 'tankM', 'engV', 'dec', 'tankL', 'tankM', 'engL'], radial: [{ at: 6, id: 'srbS', n: 2 }, { at: 8, id: 'fin', n: 4 }], livery: L('#f1f2f4', '#141518', 'KR'), flame: 'kerosene' } },
  { name: '유인 궤도선', design: { stack: ['chute', 'pod', 'shield', 'tankL', 'engS', 'dec', 'tankL', 'tankM', 'engL'], radial: [{ at: 6, id: 'srbS', n: 2 }, { at: 8, id: 'fin', n: 4 }], livery: L('#e9eef5', '#1f4fa8', 'KR'), flame: 'hydrogen' } },
  { name: '대형 관측위성 발사체', design: { stack: ['fairing', 'satObs', 'dec', 'tankM', 'engV', 'dec', 'tankXL', 'engH'], radial: [{ at: 6, id: 'srbS', n: 4 }, { at: 7, id: 'fin', n: 4 }], livery: L('#d9d4c7', '#8a2b1d', 'UN'), flame: 'methane' } },
  { name: '로쿤: 풍선 로켓', design: { stack: ['balloon', 'lab', 'chute', 'pod', 'shield', 'tankM', 'engS'], radial: [{ at: 6, id: 'fin', n: 3 }], livery: L('#ffd166', '#3d2b8f', 'KR'), flame: 'copper' } },
  { name: '냥이 우주 탐험대', design: { stack: ['chute', 'catPod', 'shield', 'tankL', 'engS', 'dec', 'tankL', 'engL'], radial: [{ at: 6, id: 'srbS', n: 3 }, { at: 7, id: 'fin', n: 3 }], livery: L('#ffb7c5', '#7a3e9d', 'CAT'), flame: 'rainbow' } },
  { name: '태양 돛 탐사선', design: { stack: ['fairing', 'sail', 'satCom', 'dec', 'tankM', 'engS', 'dec', 'tankL', 'tankM', 'engL'], radial: [{ at: 7, id: 'srbS', n: 2 }, { at: 9, id: 'fin', n: 4 }], livery: L('#1c2333', '#d4a645', 'EARTH'), flame: 'methane' } },
  { name: '이온 엔진 위성', design: { stack: ['fairing', 'satObs', 'tankS', 'ion', 'dec', 'tankM', 'engS', 'dec', 'tankL', 'tankM', 'engL'], radial: [{ at: 8, id: 'srbS', n: 4 }, { at: 10, id: 'fin', n: 4 }], livery: L('#f1f2f4', '#2a7fd6', 'KR'), flame: 'potassium' } },
  { name: '과학 관측 로켓', design: { stack: ['nose', 'lab', 'chute', 'tankM', 'srb'], radial: [{ at: 4, id: 'fin', n: 4 }], livery: L('#f4f4f4', '#d23b2e', 'KR'), flame: 'solid' } },
  { name: '실패 연습: 추력 부족', design: { stack: ['chute', 'pod', 'tankL', 'engS'], radial: [], livery: L('#9aa0aa', '#3a3d44', 'NONE'), flame: 'kerosene' } },
  { name: '연습용 1단 로켓', design: { stack: ['chute', 'pod', 'tankM', 'engS'], radial: [{ at: 3, id: 'fin', n: 3 }], livery: L('#f1f2f4', '#ff7a2e', 'KR'), flame: 'kerosene' } },
];

// 불꽃 종류 (연료·불꽃 반응)
export const FLAMES = {
  kerosene:  { name: '등유 (주황)',     hot: [1.0, 0.85, 0.55], mid: [1.0, 0.45, 0.12], smoke: [0.55, 0.52, 0.5], smokeAmt: 1.0, fact: '등유(케로신)는 탄소가 많아 그을음 때문에 주황빛으로 타고 연기가 나요.' },
  methane:   { name: '메탄 (파랑)',     hot: [0.75, 0.85, 1.0], mid: [0.25, 0.4, 1.0], smoke: [0.8, 0.82, 0.86], smokeAmt: 0.5, fact: '메탄은 그을음이 거의 없이 깨끗하게 타서 파란 불꽃이 보여요.' },
  hydrogen:  { name: '수소 (거의 투명)', hot: [0.85, 0.8, 1.0], mid: [0.55, 0.45, 0.9], smoke: [0.95, 0.95, 0.97], smokeAmt: 0.35, faint: true, fact: '수소가 타면 물(수증기)만 생겨요. 불꽃이 잘 안 보이고 하얀 수증기 구름이 생겨요.' },
  solid:     { name: '고체 연료 (눈부신 흰색)', hot: [1.0, 0.97, 0.88], mid: [1.0, 0.7, 0.35], smoke: [0.92, 0.92, 0.92], smokeAmt: 1.8, fact: '고체 연료 속 알루미늄 가루가 타면서 아주 밝게 빛나고 짙은 흰 연기가 나요.' },
  strontium: { name: '불꽃 반응: 스트론튬 (빨강)', hot: [1.0, 0.6, 0.6], mid: [1.0, 0.08, 0.12], smoke: [0.8, 0.6, 0.6], smokeAmt: 0.8, fact: '스트론튬은 불꽃 반응에서 빨간색을 내요. 불꽃놀이의 빨간 불꽃이 바로 이것!' },
  copper:    { name: '불꽃 반응: 구리 (청록)', hot: [0.7, 1.0, 0.85], mid: [0.05, 0.85, 0.45], smoke: [0.6, 0.8, 0.7], smokeAmt: 0.8, fact: '구리는 불꽃 반응에서 청록색을 내요. 원소마다 내는 빛의 색이 달라 원소를 알아낼 수 있어요.' },
  potassium: { name: '불꽃 반응: 칼륨 (보라)', hot: [0.9, 0.75, 1.0], mid: [0.55, 0.2, 0.95], smoke: [0.75, 0.65, 0.85], smokeAmt: 0.8, fact: '칼륨은 연한 보라색 불꽃을 내요.' },
  sodium:    { name: '불꽃 반응: 나트륨 (노랑)', hot: [1.0, 0.95, 0.6], mid: [1.0, 0.78, 0.05], smoke: [0.85, 0.8, 0.6], smokeAmt: 0.8, fact: '나트륨(소금 성분)은 진한 노란색 불꽃을 내요. 가로등의 노란빛도 나트륨이에요.' },
  rainbow:   { name: '무지개 (재미)', hot: [1, 1, 1], mid: [1, 0.3, 0.3], smoke: [1, 1, 1], smokeAmt: 1.2, rainbow: true, fact: '여러 금속 가루를 차례로 섞으면 불꽃 색이 바뀌어요. 진짜 로켓은 이러지 않지만 재미로!' },
};
