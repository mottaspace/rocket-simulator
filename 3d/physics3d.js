// 3차원 로켓 비행 물리 (행성 중심 = 원점, 단위 m, 배열 [x, y, z])
// 설계 = { stack: [부품 id, 위→아래], radial: [{ at: stack 인덱스, id: 'srbS', n: 2|3|4 }] }
const { PARTS } = window.Parts;

export const PLANET = { R: 400000, g0: 9.81, atm: 45000, rho0: 1.2, H: 5500 };
PLANET.mu = PLANET.g0 * PLANET.R * PLANET.R;

const G0 = 9.81, DT = 0.02;
const AREA = Math.PI * 0.625 * 0.625;
const CHUTE_AREA = 400, CHUTE_CD = 1.3, CHUTE_SAFE_SPEED = 250, CHUTE_SAFE_ALT = 20000;
const ROT_RATE = 0.9, SAFE_LANDING = 12, RADIAL_DEC_MASS = 50;

// ── 벡터 도우미 ──
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  rot: (v, k, t) => { // 축 k 둘레로 각 t 회전 (로드리게스)
    const c = Math.cos(t), s = Math.sin(t), kv = V.cross(k, v), d = V.dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
  },
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

// 위성 궤도 전파: 배치 순간의 위치·속도(epoch)로부터 시각 t(ms)의 위치
export function satElements(r, v, epoch) {
  const o = orbit(r, v);
  if (o.escape) return null;
  const rl = V.len(r), cosNu = V.dot(V.norm(r), o.P), sinNu = V.dot(V.norm(r), o.Q);
  const nu = Math.atan2(sinNu, cosNu);
  const E = 2 * Math.atan2(Math.sqrt(1 - o.e) * Math.sin(nu / 2), Math.sqrt(1 + o.e) * Math.cos(nu / 2));
  return { a: o.a, e: o.e, P: o.P, Q: o.Q, M0: E - o.e * Math.sin(E), n: Math.sqrt(PLANET.mu / (o.a * o.a * o.a)), epoch, ap: o.ap, pe: o.pe, period: 2 * Math.PI * Math.sqrt(o.a ** 3 / PLANET.mu), _r: rl };
}
export function satPosition(el, tMs) {
  const M = el.M0 + el.n * (tMs - el.epoch) / 1000;
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const x = el.a * (Math.cos(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return V.add(V.mul(el.P, x), V.mul(el.Q, y));
}

// ── 설계 → 단(stage) 구조 ──
export function normalizeDesign(d) {
  if (Array.isArray(d)) return { stack: d.slice(), radial: [] };
  return { stack: (d.stack || []).filter(id => PARTS[id]), radial: (d.radial || []).filter(r => PARTS[r.id] && r.at < (d.stack || []).length) };
}
// 위→아래 인덱스마다 단 번호(맨 위 = 0)를 매긴다. 분리기는 아래 단에 속한다.
function topSegIndex(stack) {
  const out = []; let s = 0;
  stack.forEach((id, i) => { if (PARTS[id].kind === 'dec' && i > 0) s++; out.push(s); });
  return out;
}
export function buildSegments(design) {
  const { stack, radial } = normalizeDesign(design);
  const tops = topSegIndex(stack), nTop = stack.length ? tops[tops.length - 1] + 1 : 0;
  const segs = [];
  for (let k = nTop - 1; k >= 0; k--) { // 아래 단부터
    const idx = stack.map((_, i) => i).filter(i => tops[i] === k);
    const ids = idx.map(i => stack[i]);
    const seg = { ids, idx, dry: 0, liquid: 0, liquidMax: 0, solids: [], boosters: [] };
    for (const id of ids) {
      const p = PARTS[id]; seg.dry += p.mass;
      if (p.kind === 'tank') { seg.liquid += p.fuel; seg.liquidMax += p.fuel; }
      if (p.kind === 'srb') seg.solids.push({ id, fuel: p.fuel, max: p.fuel });
    }
    for (const r of radial) if (idx.includes(r.at)) seg.boosters.push({ id: r.id, n: r.n, at: r.at, fuel: PARTS[r.id].fuel, max: PARTS[r.id].fuel, attached: true });
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
const isSatSeg = s => s.ids.some(id => PARTS[id].kind === 'sat') && !s.ids.some(id => PARTS[id].kind === 'pod' || PARTS[id].thrust);

// 조립 화면용 성능 분석: 단별 Δv, 추력중량비, 경고
export function analyze3d(design) {
  const d = normalizeDesign(design), segs = buildSegments(d);
  const stages = []; let total = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    let m = 0; for (let j = i; j < segs.length; j++) m += segMass(segs[j]);
    const m0 = m;
    const first = i === 0, isp = p => first ? (p.ispSL + p.ispV) / 2 : p.ispV;
    let Fc = 0, qc = 0; for (const id of s.ids) { const p = PARTS[id]; if (p.kind === 'engine') { Fc += p.thrust; qc += p.thrust / (isp(p) * G0); } }
    let Fs = 0, qs = 0, fuelS = 0; for (const x of s.solids) { const p = PARTS[x.id]; Fs += p.thrust; qs += p.thrust / (isp(p) * G0); fuelS += x.fuel; }
    let Fb = 0, qb = 0, fuelB = 0, dryB = 0; for (const b of s.boosters) { const p = PARTS[b.id]; Fb += b.n * p.thrust; qb += b.n * p.thrust / (isp(p) * G0); fuelB += b.n * p.fuel; dryB += b.n * (p.mass + RADIAL_DEC_MASS); }
    const liquid = qc > 0 ? s.liquid : 0;
    const F0 = Fc * (liquid > 0 ? 1 : 0) + Fs + Fb;
    let dv = 0, t = 0, coreLeft = liquid, solLeft = fuelS, bLeft = fuelB;
    // 단순 구간 적분: 부스터 → 고체 → 액체 순으로 연료가 떨어지는 구간별 로켓 방정식
    for (let guard = 0; guard < 6; guard++) {
      const F = (coreLeft > 0 ? Fc : 0) + (solLeft > 0 ? Fs : 0) + (bLeft > 0 ? Fb : 0);
      const q = (coreLeft > 0 ? qc : 0) + (solLeft > 0 ? qs : 0) + (bLeft > 0 ? qb : 0);
      if (q <= 0) break;
      const dt = Math.min(coreLeft > 0 ? coreLeft / qc : Infinity, solLeft > 0 ? solLeft / qs : Infinity, bLeft > 0 ? bLeft / qb : Infinity);
      const burned = q * dt;
      dv += (F / (q * G0)) * G0 * Math.log(m / (m - burned));
      m -= burned; t += dt;
      if (coreLeft > 0) coreLeft -= qc * dt; if (solLeft > 0) solLeft -= qs * dt;
      if (bLeft > 0) { bLeft -= qb * dt; if (bLeft <= 1e-6) { m -= dryB; bLeft = 0; } }
      coreLeft = Math.max(0, coreLeft); solLeft = Math.max(0, solLeft);
    }
    stages.push({ index: i + 1, mass: m0, dv, twr: F0 / (m0 * G0), burn: t, thrust: F0, boosters: s.boosters.reduce((a, b) => a + b.n, 0), sat: isSatSeg(s) });
    total += dv;
  }
  const mass = segs.reduce((a, s) => a + segMass(s), 0);
  const w = [];
  const st = d.stack;
  const has = k => st.some(id => PARTS[id].kind === k);
  if (!st.length) w.push({ t: '부품이 없어요.', fatal: true });
  else {
    if (!has('pod') && !has('sat')) w.push({ t: '조종할 부품(캡슐이나 위성)이 필요해요.', fatal: true });
    if (!stages[0] || !stages[0].thrust) w.push({ t: '맨 아래 단에 엔진이나 부스터가 없어요.', fatal: true });
    else if (stages[0].twr < 1) w.push({ t: '추력이 무게보다 약해서 이륙할 수 없어요.', fatal: true });
    segs.forEach((s, i) => { if (s.ids.some(id => PARTS[id].kind === 'engine') && !s.liquid) w.push({ t: (i + 1) + '단 엔진에 연료탱크가 없어요.', fatal: true }); });
    if (PARTS[st[st.length - 1]].kind === 'dec') w.push({ t: '맨 아래에 분리기가 있어요.', fatal: true });
    const satIdx = st.findIndex(id => PARTS[id].kind === 'sat');
    if (satIdx >= 0 && segs.length && !isSatSeg(segs[segs.length - 1])) w.push({ t: '위성은 맨 위 단에 두고, 바로 아래에 분리기를 넣어야 궤도에서 떼어 낼 수 있어요.', fatal: false });
    if (has('pod') && !has('chute')) w.push({ t: '낙하산이 없으면 캡슐이 안전하게 착륙할 수 없어요.', fatal: false });
  }
  return { stages, totalDv: total, mass, warnings: w, ok: !w.some(x => x.fatal) };
}

export class Rocket3D {
  constructor(design) {
    this.design = normalizeDesign(design);
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
    this.debris = [];
    this.events = [];
    this.max = { alt: 0, vel: 0 };
    this.reachedSpace = false; this.orbited = false;
    this.thrustNow = 0; this.acc = 0;
    this.version = 0;
    this.deployedSat = null;   // 분리된 위성 (id)
  }

  // 현재 남은 부품 (모델용): 위→아래 stack + 아직 붙어 있는 측면 부스터
  get parts() {
    const stack = [], radial = [];
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const s = this.segs[i];
      for (const b of s.boosters) if (b.attached) radial.push({ at: stack.length + s.idx.indexOf(b.at), id: b.id, n: b.n });
      stack.push(...s.ids);
    }
    return { stack, radial };
  }
  get r() { return V.len(this.pos); }
  get alt() { return this.r - PLANET.R; }
  get speed() { return V.len(this.vel); }
  get vertSpeed() { return V.dot(this.vel, V.norm(this.pos)); }
  get mass() { return this.segs.reduce((a, s) => a + segMass(s), 0); }
  get active() { return this.segs[0]; }
  get height() { return this.segs.reduce((a, s) => a + s.ids.reduce((b, id) => b + PARTS[id].h, 0), 0); }
  get hasChute() { return this.segs.some(s => s.ids.includes('chute')); }
  get isSatellite() { return this.segs.length === 1 && isSatSeg(this.segs[0]); }
  get stageFuelFrac() {
    const s = this.active; if (!s) return 0;
    let max = s.liquidMax, cur = s.liquid;
    for (const x of s.solids) { max += x.max; cur += x.fuel; }
    for (const b of s.boosters) if (b.attached) { max += b.max * b.n; cur += b.fuel * b.n; }
    return max ? cur / max : 0;
  }
  get nextAction() {
    if (this.state !== 'pad' && this.state !== 'flying') return 'none';
    if (!this.ignited) return 'launch';
    const s = this.active;
    if (s && s.boosters.some(b => b.attached)) return 'boosters';
    if (this.segs.length > 1) return this.segs.length === 2 && isSatSeg(this.segs[1]) ? 'deploy' : 'stage';
    if (this.hasChute && this.chute === 'none') return 'chute';
    return 'none';
  }
  orbit() { return orbit(this.pos, this.vel); }
  log(text, kind) { this.events.push({ t: this.t, text, kind: kind || 'info' }); }

  // 측면 방향 (부스터 위치·분리 방향용)
  sideDirs(n) {
    const hz = horizon(this.pos);
    let a = V.cross(this.fwd, hz.north); if (V.len(a) < 1e-6) a = V.cross(this.fwd, hz.east);
    a = V.norm(a); const b = V.cross(a, this.fwd);
    return Array.from({ length: n }, (_, k) => { const t = k / n * Math.PI * 2; return V.add(V.mul(a, Math.cos(t)), V.mul(b, Math.sin(t))); });
  }

  stage() {
    const a = this.nextAction;
    if (a === 'launch') { this.ignited = true; this.state = 'flying'; this.log('점화!'); return a; }
    if (a === 'boosters') {
      const s = this.active;
      for (const b of s.boosters) {
        if (!b.attached) continue;
        b.attached = false;
        const off = PARTS.srbS ? 1.25 : 1.25;
        this.sideDirs(b.n).forEach(dir => this.debris.push({ design: { stack: [b.id], radial: [] }, pos: V.add(this.pos, V.mul(dir, off)), vel: V.add(this.vel, V.mul(dir, 4)), fwd: this.fwd.slice(), spin: (Math.random() - 0.5) * 0.8, life: 50 }));
      }
      this.version++; this.log('측면 부스터 분리!');
      return a;
    }
    if (a === 'stage' || a === 'deploy') {
      const seg = this.segs.shift();
      const h = seg.ids.reduce((x, id) => x + PARTS[id].h, 0);
      this.debris.push({ design: { stack: seg.ids, radial: [] }, pos: this.pos.slice(), vel: V.sub(this.vel, V.mul(this.fwd, 2)), fwd: this.fwd.slice(), spin: (Math.random() - 0.5) * 0.5, life: 60 });
      this.pos = V.add(this.pos, V.mul(this.fwd, h));
      this.version++;
      if (a === 'deploy') {
        const ob = this.orbit();
        const ok = !ob.escape && ob.pe > PLANET.atm;
        this.deployedSat = { ok, ids: this.segs[0].ids.slice() };
        this.log(ok ? '위성 분리 성공! 궤도를 돌기 시작했어요.' : '위성을 분리했지만 궤도가 낮아 다시 떨어져요…', ok ? 'good' : 'bad');
      } else this.log('단 분리!');
      return a;
    }
    if (a === 'chute') { this.chute = 'armed'; this.log('낙하산 준비 — 안전한 속도가 되면 자동으로 펴져요.'); }
    return a;
  }

  update(dt) {
    const n = Math.max(1, Math.round(dt / DT));
    for (let i = 0; i < n; i++) this.step(DT);
    for (const d of this.debris) this.stepDebris(d, dt);
    this.debris = this.debris.filter(d => d.life > 0);
  }

  steer(dt) {
    const hz = horizon(this.pos);
    if (this.chute === 'open') { this.fwd = V.norm(V.add(this.fwd, V.mul(V.sub(hz.up, this.fwd), Math.min(1, dt * 2)))); return; }
    if (!this.lifted) { this.fwd = hz.up; return; }
    if (this.sas !== 'off' && this.speed > 3) {
      let target = V.norm(this.vel);
      if (this.sas === 'retro') target = V.mul(target, -1);
      const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(this.fwd, target))));
      if (ang > 1e-5) {
        let axis = V.cross(this.fwd, target);
        axis = V.len(axis) < 1e-9 ? hz.north : V.norm(axis);
        this.fwd = V.norm(V.rot(this.fwd, axis, Math.min(ang, ROT_RATE * dt)));
      }
    }
    const mag = V.len(this.tiltDir);
    if (mag > 0.01) this.fwd = V.norm(V.rot(this.fwd, V.norm(V.cross(hz.up, this.tiltDir)), Math.min(1, mag) * ROT_RATE * dt));
  }

  step(dt) {
    if (this.state === 'landed' || this.state === 'crashed') return;
    const r = this.r, alt = r - PLANET.R, up = V.mul(this.pos, 1 / r);
    const rho = density(alt), press = rho / PLANET.rho0;
    this.steer(dt);
    const m = this.mass;
    let F = [0, 0, 0];
    this.thrustNow = 0; this.coreThrust = 0;
    const s = this.active;
    if (s && this.ignited) {
      const isp = p => p.ispV + (p.ispSL - p.ispV) * press;
      let flow = 0;
      for (const id of s.ids) {
        const p = PARTS[id];
        if (p.kind === 'engine' && s.liquid > 0 && this.throttle > 0) { const f = p.thrust * this.throttle; this.thrustNow += f; flow += f / (isp(p) * G0); }
      }
      s.liquid = Math.max(0, s.liquid - flow * dt);
      for (const x of s.solids) if (x.fuel > 0) { const p = PARTS[x.id]; this.thrustNow += p.thrust; x.fuel = Math.max(0, x.fuel - p.thrust / (isp(p) * G0) * dt); if (!x.fuel) this.log('고체 로켓 연소 종료'); }
      this.coreThrust = this.thrustNow;
      for (const b of s.boosters) if (b.attached && b.fuel > 0) { const p = PARTS[b.id]; this.thrustNow += p.thrust * b.n; b.fuel = Math.max(0, b.fuel - p.thrust / (isp(p) * G0) * dt); if (!b.fuel) this.log('측면 부스터 연소 끝 — 분리하세요!'); }
      F = V.mul(this.fwd, this.thrustNow);
    }
    if (this.chute === 'armed' && alt < CHUTE_SAFE_ALT && this.speed < CHUTE_SAFE_SPEED && rho > 0) { this.chute = 'open'; this.log('낙하산이 펴졌어요!', 'good'); }
    const v = this.speed;
    if (rho > 0 && v > 0.01) {
      const nose = this.segs.length && PARTS[this.segs[this.segs.length - 1].ids[0]].kind === 'nose';
      let cdA = (nose ? 0.32 : 0.45) * machFactor(v / soundSpeed(alt)) * AREA;
      if (this.active && this.active.boosters.some(b => b.attached)) cdA *= 1.6;
      if (this.chute === 'open') cdA += CHUTE_CD * CHUTE_AREA;
      F = V.sub(F, V.mul(this.vel, 0.5 * rho * v * cdA));
    }
    const g = PLANET.mu / (r * r);
    const a = V.sub(V.mul(F, 1 / m), V.mul(up, g));
    if (!this.lifted && V.dot(a, up) <= 0) { this.vel = [0, 0, 0]; this.acc = 0; if (this.ignited) this.t += dt; return; }
    this.vel = V.add(this.vel, V.mul(a, dt));
    this.pos = V.add(this.pos, V.mul(this.vel, dt));
    this.t += dt;
    this.acc = V.len(V.mul(F, 1 / m)) / G0;
    const nalt = this.alt;
    if (!this.lifted && nalt > 0.5) { this.lifted = true; this.log('이륙!', 'good'); }
    if (nalt > this.max.alt) this.max.alt = nalt;
    if (this.speed > this.max.vel) this.max.vel = this.speed;
    if (nalt > PLANET.atm && !this.reachedSpace) { this.reachedSpace = true; this.log('우주에 도착했어요!', 'good'); }
    if (nalt > PLANET.atm && !this.orbited) { const ob = this.orbit(); if (!ob.escape && ob.pe > PLANET.atm) { this.orbited = true; this.log('궤도 진입 성공!', 'good'); } }
    if (this.lifted && nalt <= 0) {
      this.pos = V.mul(V.norm(this.pos), PLANET.R);
      this.impact = this.speed; this.vel = [0, 0, 0];
      if (this.impact <= SAFE_LANDING) { this.state = 'landed'; this.log('무사히 착륙했어요! (' + this.impact.toFixed(1) + ' m/s)', 'good'); }
      else { this.state = 'crashed'; this.log('지면에 부딪혔어요… (' + this.impact.toFixed(0) + ' m/s)', 'bad'); }
    }
  }

  stepDebris(d, dt) {
    const steps = Math.max(1, Math.round(dt / 0.05)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const r = V.len(d.pos), alt = r - PLANET.R;
      if (alt <= 0) { d.life = 0; return; }
      const g = PLANET.mu / (r * r), v = V.len(d.vel), k = v > 0 ? 0.5 * density(alt) * v * 0.9 * AREA / 1000 : 0;
      d.vel = V.add(d.vel, V.mul(V.add(V.mul(d.pos, -g / r), V.mul(d.vel, -k)), h));
      d.pos = V.add(d.pos, V.mul(d.vel, h));
    }
    d.fwd = V.norm(V.rot(d.fwd, horizon(d.pos).north, d.spin * dt));
    d.life -= dt;
  }
}

// 자동 비행: 중력 선회로 궤도까지 (성능 측정·도우미용)
export class Autopilot {
  constructor(rk, targetAp = 65000) { this.rk = rk; this.phase = 'asc'; this.targetAp = targetAp; }
  get label() { return { asc: '상승·중력 선회', coast: '원지점까지 관성 비행', circ: '궤도 원형화 가속', done: '궤도 진입 완료' }[this.phase]; }
  update() {
    const rk = this.rk;
    if (rk.state === 'pad') { rk.throttle = 1; rk.stage(); return; }
    if (rk.state !== 'flying') return;
    const hz = horizon(rk.pos), alt = rk.alt, ob = rk.lifted ? rk.orbit() : null;
    rk.sas = 'off'; rk.tiltDir = [0, 0, 0];
    const aim = p => V.norm(V.add(V.mul(hz.up, Math.cos(p)), V.mul(hz.east, Math.sin(p))));
    if (this.phase === 'asc') {
      rk.fwd = aim(alt < 800 ? 0 : Math.min(1.45, Math.sqrt((alt - 800) / 30000) * 1.45)); rk.throttle = 1;
      if (ob && ob.ap > this.targetAp) { rk.throttle = 0; this.phase = 'coast'; }
    } else if (this.phase === 'coast') {
      rk.fwd = aim(Math.PI / 2); rk.throttle = 0;
      if (rk.vertSpeed < 10) this.phase = 'circ';
    } else if (this.phase === 'circ') {
      rk.fwd = aim(Math.PI / 2); rk.throttle = 1;
      if (ob && ob.pe > 50000) { rk.throttle = 0; this.phase = 'done'; }
    }
    const act = rk.nextAction;
    if (act === 'boosters' && rk.active.boosters.every(b => !b.attached || b.fuel <= 0)) rk.stage();
    else if (act === 'stage' && (rk.stageFuelFrac === 0 || this.phase === 'done')) rk.stage();
    else if (act === 'deploy' && this.phase === 'done') rk.stage();
  }
}

// 예제 설계 (3D)
export const EXAMPLES3D = [
  { name: '통신위성 발사체', design: { stack: ['nose', 'satCom', 'dec', 'tankM', 'engV', 'dec', 'tankL', 'tankM', 'engL'], radial: [{ at: 6, id: 'srbS', n: 2 }] } },
  { name: '유인 궤도선', design: { stack: ['chute', 'pod', 'tankM', 'engS', 'dec', 'tankL', 'engL'], radial: [] } },
  { name: '관측위성 + 부스터 4개', design: { stack: ['nose', 'satObs', 'dec', 'tankM', 'engV', 'dec', 'tankL', 'tankL', 'engL'], radial: [{ at: 6, id: 'srbS', n: 4 }] } },
  { name: '연습용 1단 로켓', design: { stack: ['chute', 'pod', 'tankM', 'engS'], radial: [] } },
];
