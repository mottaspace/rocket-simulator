/* 행성 주위를 도는 2차원 로켓 비행 물리 */
(function (global) {
  'use strict';
  const { PARTS, splitStages, segInfo, totalHeight } = global.Parts;

  // 학생용 작은 행성 (지구보다 작아서 궤도에 오르기 쉬움)
  const PLANET = {
    R: 400000,          // 반지름 400 km
    g0: 9.81,           // 표면 중력
    atm: 45000,         // 대기권 높이 45 km
    rho0: 1.2,          // 표면 공기 밀도
    H: 5500,            // 대기 척도고도
  };
  PLANET.mu = PLANET.g0 * PLANET.R * PLANET.R;

  const DT = 0.02;
  const AREA = Math.PI * 0.625 * 0.625;
  const CD = 0.45;
  const CHUTE_AREA = 400, CHUTE_CD = 1.3;
  const CHUTE_SAFE_SPEED = 250, CHUTE_SAFE_ALT = 20000;
  const ROT_RATE = 0.9;          // 회전 속도 (rad/s)
  const SAFE_LANDING = 12;       // 안전 착륙 속도 (m/s)

  function density(alt) { return alt >= PLANET.atm ? 0 : PLANET.rho0 * Math.exp(-Math.max(0, alt) / PLANET.H); }
  function soundSpeed(alt) { return alt < 11000 ? 340 - alt * 0.004 : 296; }
  function machFactor(M) { return 1 + 0.9 * Math.exp(-Math.pow((M - 1.05) / 0.3, 2)) + (M > 1.05 ? 0.3 : 0); }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // 위치·속도로 궤도 요소 계산 (원지점/근지점 고도 등)
  function orbit(x, y, vx, vy) {
    const mu = PLANET.mu, r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
    const h = x * vy - y * vx;
    const eps = v2 / 2 - mu / r;
    const ex = (vy * h) / mu - x / r;
    const ey = (-vx * h) / mu - y / r;
    const e = Math.hypot(ex, ey);
    const p = h * h / mu;
    // 수직 비행(e≈1)에서도 안정적이도록 장반경 a로 계산
    let ra = Infinity, rp = p / (1 + e);
    if (eps < 0) { const a = -mu / (2 * eps); ra = a * (1 + e); rp = a * (1 - e); }
    return { e, p, h, eps, omega: Math.atan2(ey, ex), pe: rp - PLANET.R, ap: ra - PLANET.R, escape: eps >= 0 };
  }

  class Rocket {
    constructor(ids) {
      this.ids = ids.slice();            // 남은 부품(위→아래)
      this.x = 0; this.y = PLANET.R;     // 발사장: 행성 꼭대기
      this.vx = 0; this.vy = 0;
      this.att = Math.PI / 2;            // 기수 방향(월드 각도)
      this.throttle = 1;
      this.rotInput = 0;                 // -1 왼쪽, +1 오른쪽
      this.sas = 'off';
      this.t = 0;
      this.ignited = false;
      this.lifted = false;
      this.state = 'pad';                // pad, flying, landed, crashed
      this.chute = 'none';               // none, armed, open, torn
      this.debris = [];
      this.events = [];
      this.max = { alt: 0, vel: 0, ap: -Infinity, pe: -Infinity };
      this.reachedSpace = false;
      this.orbited = false;
      this.thrustNow = 0;
      this.buildSegments();
    }

    buildSegments() {
      // 아래 단부터. 액체 연료는 단 안에서 공유, 고체 로켓은 각자 연료.
      this.segs = splitStages(this.ids).map(seg => ({
        ids: seg,
        info: segInfo(seg),
        liquid: seg.reduce((a, id) => a + (PARTS[id].kind === 'tank' ? PARTS[id].fuel : 0), 0),
        liquidMax: seg.reduce((a, id) => a + (PARTS[id].kind === 'tank' ? PARTS[id].fuel : 0), 0),
        solids: seg.filter(id => PARTS[id].kind === 'srb').map(() => PARTS.srb.fuel),
      }));
    }

    get alt() { return Math.hypot(this.x, this.y) - PLANET.R; }
    get speed() { return Math.hypot(this.vx, this.vy); }
    get up() { return Math.atan2(this.y, this.x); }
    get vertSpeed() { const r = Math.hypot(this.x, this.y); return (this.x * this.vx + this.y * this.vy) / r; }
    get mass() {
      let m = 0;
      for (const s of this.segs) m += s.info.dry + s.liquid + s.solids.reduce((a, b) => a + b, 0);
      return m;
    }
    get active() { return this.segs[0]; }
    get height() { return totalHeight(this.ids); }
    get hasChute() { return this.ids.includes('chute'); }
    get stageFuelFrac() {
      const s = this.active; if (!s) return 0;
      const max = s.liquidMax + s.solids.length * PARTS.srb.fuel;
      const cur = s.liquid + s.solids.reduce((a, b) => a + b, 0);
      return max ? cur / max : 0;
    }
    get nextAction() {
      if (this.state !== 'pad' && this.state !== 'flying') return 'none';
      if (!this.ignited) return 'launch';
      if (this.segs.length > 1) return 'stage';
      if (this.hasChute && this.chute === 'none') return 'chute';
      return 'none';
    }

    log(text, kind) { this.events.push({ t: this.t, text, kind: kind || 'info' }); }

    // 발사 / 단 분리 / 낙하산
    stage() {
      const a = this.nextAction;
      if (a === 'launch') {
        this.ignited = true; this.state = 'flying';
        this.log('점화!');
      } else if (a === 'stage') {
        const seg = this.segs.shift();
        this.ids = this.ids.slice(0, this.ids.length - seg.ids.length);
        const ux = Math.cos(this.att), uy = Math.sin(this.att);
        const h = totalHeight(seg.ids);
        this.debris.push({ ids: seg.ids, x: this.x - ux * h * 0, y: this.y - uy * 0, vx: this.vx - ux * 3, vy: this.vy - uy * 3, att: this.att, spin: (Math.random() - 0.5) * 0.6, life: 40, off: 0 });
        // 남은 로켓은 분리된 단 높이만큼 위에 있었음
        this.x += ux * h; this.y += uy * h;
        this.log('단 분리!');
      } else if (a === 'chute') {
        this.chute = 'armed';
        this.log('낙하산 준비 — 안전한 속도가 되면 자동으로 펴져요.');
      }
    }

    thrustAvailable() {
      const s = this.active; if (!s || !this.ignited) return 0;
      let F = 0;
      for (const id of s.ids) {
        const p = PARTS[id];
        if (p.kind === 'engine' && s.liquid > 0) F += p.thrust * this.throttle;
      }
      s.solids.forEach(f => { if (f > 0) F += PARTS.srb.thrust; });
      return F;
    }

    update(dt) {
      let n = Math.max(1, Math.round(dt / DT));
      for (let i = 0; i < n; i++) this.step(DT);
      for (const d of this.debris) this.stepDebris(d, dt);
      this.debris = this.debris.filter(d => d.life > 0);
    }

    step(dt) {
      if (this.state === 'landed' || this.state === 'crashed') return;
      const r = Math.hypot(this.x, this.y);
      const alt = r - PLANET.R;
      const ux = this.x / r, uy = this.y / r;
      const up = Math.atan2(uy, ux);
      const rho = density(alt);
      const press = rho / PLANET.rho0;

      // 자세 제어
      if (this.chute === 'open') {
        this.att += wrap(up - this.att) * Math.min(1, dt * 2);
      } else if (this.sas !== 'off' && this.speed > 3) {
        let target = Math.atan2(this.vy, this.vx);
        if (this.sas === 'retro') target += Math.PI;
        this.att += Math.max(-ROT_RATE * dt, Math.min(ROT_RATE * dt, wrap(target - this.att)));
        if (this.rotInput) this.att -= this.rotInput * ROT_RATE * dt;
      } else {
        this.att -= this.rotInput * ROT_RATE * dt;
      }
      if (!this.lifted) this.att = up + Math.max(-0.5, Math.min(0.5, wrap(this.att - up)));

      // 추력과 연료 소모
      const m = this.mass;
      let fx = 0, fy = 0;
      this.thrustNow = 0;
      const s = this.active;
      if (s && this.ignited) {
        let liquidFlow = 0;
        for (const id of s.ids) {
          const p = PARTS[id];
          if (p.kind === 'engine' && s.liquid > 0 && this.throttle > 0) {
            const F = p.thrust * this.throttle;
            const isp = p.ispV + (p.ispSL - p.ispV) * press;
            this.thrustNow += F; liquidFlow += F / (isp * PLANET.g0);
          }
        }
        s.liquid = Math.max(0, s.liquid - liquidFlow * dt);
        for (let k = 0; k < s.solids.length; k++) {
          if (s.solids[k] > 0) {
            const p = PARTS.srb, isp = p.ispV + (p.ispSL - p.ispV) * press;
            this.thrustNow += p.thrust;
            s.solids[k] = Math.max(0, s.solids[k] - p.thrust / (isp * PLANET.g0) * dt);
            if (s.solids[k] === 0) this.log('고체 로켓 연소 종료');
          }
        }
        fx += this.thrustNow * Math.cos(this.att);
        fy += this.thrustNow * Math.sin(this.att);
      }

      // 낙하산 전개
      if (this.chute === 'armed' && alt < CHUTE_SAFE_ALT && this.speed < CHUTE_SAFE_SPEED && rho > 0) {
        this.chute = 'open'; this.log('낙하산이 펴졌어요!', 'good');
      }

      // 공기 저항
      const v = this.speed;
      if (rho > 0 && v > 0.01) {
        const M = v / soundSpeed(alt);
        let cdA = CD * machFactor(M) * AREA;
        if (this.chute === 'open') cdA += CHUTE_CD * CHUTE_AREA;
        const D = 0.5 * rho * v * v * cdA;
        fx -= D * this.vx / v; fy -= D * this.vy / v;
        this.drag = D;
      } else this.drag = 0;

      // 중력
      const g = PLANET.mu / (r * r);
      let ax = fx / m - g * ux, ay = fy / m - g * uy;

      // 발사대 위 (추력 < 무게면 정지)
      if (!this.lifted) {
        const radial = ax * ux + ay * uy;
        if (radial <= 0) { this.vx = 0; this.vy = 0; this.t += this.ignited ? dt : 0; this.acc = 0; return; }
      }

      this.vx += ax * dt; this.vy += ay * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.t += dt;
      this.acc = Math.hypot(fx / m, fy / m) / PLANET.g0;

      const nalt = Math.hypot(this.x, this.y) - PLANET.R;
      if (!this.lifted && nalt > 0.5) { this.lifted = true; this.log('이륙!', 'good'); }

      // 기록
      if (nalt > this.max.alt) this.max.alt = nalt;
      if (this.speed > this.max.vel) this.max.vel = this.speed;
      if (nalt > PLANET.atm && !this.reachedSpace) { this.reachedSpace = true; this.log('우주에 도착했어요!', 'good'); }
      if (nalt > PLANET.atm && !this.orbited) {
        const ob = orbit(this.x, this.y, this.vx, this.vy);
        if (!ob.escape && ob.pe > PLANET.atm) { this.orbited = true; this.log('🎉 궤도 진입 성공!', 'good'); }
      }

      // 지면 충돌
      if (this.lifted && nalt <= 0) {
        const k = PLANET.R / Math.hypot(this.x, this.y);
        this.x *= k; this.y *= k;
        const impact = this.speed;
        this.impact = impact;
        this.vx = this.vy = 0;
        if (impact <= SAFE_LANDING) { this.state = 'landed'; this.log('무사히 착륙했어요! (' + impact.toFixed(1) + ' m/s)', 'good'); }
        else { this.state = 'crashed'; this.log('지면에 부딪혔어요… (' + impact.toFixed(0) + ' m/s)', 'bad'); }
      }
    }

    stepDebris(d, dt) {
      const steps = Math.max(1, Math.round(dt / 0.05)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const r = Math.hypot(d.x, d.y), alt = r - PLANET.R;
        if (alt <= 0) { d.life = 0; return; }
        const g = PLANET.mu / (r * r), v = Math.hypot(d.vx, d.vy), rho = density(alt);
        const D = v > 0 ? 0.5 * rho * v * CD * 2 * AREA / 1500 : 0;
        d.vx += (-g * d.x / r - D * d.vx) * h; d.vy += (-g * d.y / r - D * d.vy) * h;
        d.x += d.vx * h; d.y += d.vy * h;
      }
      d.att += d.spin * dt; d.life -= dt;
    }

    orbit() { return orbit(this.x, this.y, this.vx, this.vy); }
  }

  global.Physics = { PLANET, Rocket, orbit, density, wrap, DT };
})(window);
