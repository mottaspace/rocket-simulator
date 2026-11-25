// 우주왕복선 자동 귀환: 역추진 → 재진입(받음각 40°, 기울여 비행하며 거리 조절) → 활공 → 최종 접근 → 플레어 → 착지
import { PLANET, V, horizon, density, glideAero, orbit, RUNWAY, runwayLocal } from './physics3d.js';

const DEG = Math.PI / 180;
const AIM_IN = 700;   // 활공 경로가 겨누는 점: 활주로 시작에서 700 m (플레어하며 그 앞에 내려앉음)
const AIM = V.add(RUNWAY.center, V.mul(RUNWAY.dir, -RUNWAY.len / 2 + AIM_IN));
const HAP = V.mul(V.norm(V.sub(AIM, V.mul(RUNWAY.dir, 12000))), PLANET.R);   // 활주로 연장선 위 정렬점
export const GLIDE_LABEL = { wait: '역추진 지점까지 비행', deorbit: '역추진 (궤도에서 내려오기)', coast: '대기권 가장자리까지', entry: '재진입 (배를 앞으로, 받음각 40°)', taem: '활공 (활주로 쪽으로)', final: '최종 접근', flare: '플레어 (기수 들기)', roll: '활주로 감속' };

// 지표면을 따라 잰 거리와, 활주로 방향으로 남은 거리
const groundDist = (a, b) => PLANET.R * Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(a), V.norm(b)))));
function toGo(pos) {
  const d = groundDist(pos, AIM), rw = runwayLocal(pos), aimAlong = -RUNWAY.len / 2 + AIM_IN;
  return { d, along: rw.along - aimAlong, cross: rw.cross };   // along < 0 : 아직 활주로 앞
}
// 받음각·기울기(뱅크)로 기수 방향 만들기
function attitude(pos, rel, aoa, bank) {
  const r = V.norm(rel), up = V.norm(pos);
  let u = V.sub(up, V.mul(r, V.dot(up, r))); if (V.len(u) < 1e-6) u = V.norm(V.cross(r, [1, 0, 0])); u = V.norm(u);
  const side = V.norm(V.cross(r, u)), L = V.add(V.mul(u, Math.cos(bank)), V.mul(side, Math.sin(bank)));
  return V.norm(V.add(V.mul(r, Math.cos(aoa)), V.mul(L, Math.sin(aoa))));
}
// 예측용 공기력: 실제로는 뱅크를 좌우로 번갈아 하므로 옆 힘은 상쇄 (위쪽 양력만 cos(뱅크)로 줄어듦)
function symAero(rho, v, p, aoa, bank) {
  const f1 = glideAero(rho, v, attitude(p, v, aoa, bank), 0).F, f2 = glideAero(rho, v, attitude(p, v, aoa, -bank), 0).F;
  return V.mul(V.add(f1, f2), 0.5);
}
const entryAoa = sp => sp > 1200 ? 40 * DEG : sp > 450 ? (12 + 28 * (sp - 450) / 750) * DEG : 12 * DEG;
// 앞으로 비행을 빨리 흉내 내서 고도 9 km에 닿을 때 활주로까지 남은 거리 예측 (뱅크 고정)
export function predictEntry(pos, vel, m, bank) {
  let p = pos.slice(), v = vel.slice();
  for (let t = 0; t < 2400; t += 1) {
    const r = V.len(p), alt = r - PLANET.R, sp = V.len(v);
    if (alt < 9000 || sp < 300) break;
    const rho = density(Math.max(0, alt));
    const a = V.add(V.mul(symAero(rho, v, p, entryAoa(sp), bank), 1 / m), V.mul(p, -PLANET.mu / (r * r * r)));
    v = V.add(v, a); p = V.add(p, v);
  }
  return toGo(p).along;
}

// 궤도면을 따라 잰 '활주로 조준점까지' 거리 (앞이면 음수, 지나치면 양수)
function trackDist(p, h) {
  const a = V.norm(AIM), b = V.norm(p);
  return PLANET.R * Math.atan2(V.dot(V.cross(a, b), h), V.dot(a, b));
}
// 지금 역추진하면(근지점 15 km) 고도 9.5 km에 닿는 곳이 조준점보다 얼마나 앞/뒤인지 예측
export function predictLanding(pos, vel, m, bank) {
  const vd = V.norm(vel); let lo = 0, hi = V.len(vel) * 0.4;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (orbit(pos, V.sub(vel, V.mul(vd, mid))).pe > 15000) lo = mid; else hi = mid; }
  let p = pos.slice(), v = V.sub(vel, V.mul(vd, hi));
  const h = V.norm(V.cross(pos, vel));
  for (let t = 0; t < 6000;) {
    const r = V.len(p), alt = r - PLANET.R, sp = V.len(v);
    if (alt < 9500 || sp < 320) break;
    const dt = alt > 47000 ? 5 : 1;
    let a = V.mul(p, -PLANET.mu / (r * r * r));
    if (alt < 47000) a = V.add(a, V.mul(symAero(density(alt), v, p, entryAoa(sp), bank), 1 / m));
    v = V.add(v, V.mul(a, dt)); p = V.add(p, V.mul(v, dt)); t += dt;
  }
  return trackDist(p, h);
}
const TAEM_AT = -30000;   // 고도 9.5 km에서 조준점 30 km 앞에 있도록 역추진   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 앞에 이만큼 떨어져 있도록   // 고도 9.5 km에서 조준점 30 km 앞에 있도록

// 활공 경로 보정 가속도 (최대 6 m/s²): 활주로 축 위, 각도 gamma의 경로, 속도 vRef
function pathAssist(rk, up, rel, tg, alt, gamma, vRef) {
  const dAlong = -tg.along;                                 // 조준점까지 활주로 축 거리 (앞이면 +)
  const hRef = Math.max(0, dAlong) * Math.tan(gamma);
  const pathDir = V.norm(V.sub(V.mul(RUNWAY.dir, Math.cos(gamma)), V.mul(up, Math.sin(gamma))));
  const vDes = V.mul(pathDir, vRef), w = Math.min(1, Math.max(0, (17000 - tg.d) / 4000));   // 멀리서는 약하게
  const vg = rk.vel, side = RUNWAY.side;
  let acc = V.add(V.mul(up, (hRef - alt) * 0.012), V.mul(V.sub(vDes, rel), 0.35));
  acc = V.sub(acc, V.mul(side, V.dot(acc, side)));                                    // 옆 방향은 땅 기준으로 따로
  acc = V.add(acc, V.mul(side, -tg.cross * 0.012 - V.dot(vg, side) * 0.4));
  acc = V.mul(acc, w);
  const l = V.len(acc); if (l > 6) acc = V.mul(acc, 6 / l);
  return acc;
}

export class GlideHome {
  constructor(rk) { this.rk = rk; this.phase = 'wait'; this.bank = 50 * DEG; this.predT = 0; this.hint = ''; rk.glideCtl = true; }
  // 매 프레임 호출. 반환값 = 허용할 최대 시간 배속
  update(dt) {
    const rk = this.rk, up = V.norm(rk.pos), alt = rk.alt - 1.35, rel = V.sub(rk.vel, rk.wind || [0, 0, 0]), sp = V.len(rel);
    const tg = toGo(rk.pos), ob = rk.orbit();
    rk.sas = 'off'; rk.tiltDir = [0, 0, 0]; rk.brake = 0; rk.rcs = null;
    if (rk.rolling) { this.phase = 'roll'; this.hint = fmt(V.len(rk.vel)) + ' m/s'; return 1; }
    switch (this.phase) {
      case 'wait': {
        // '지금 역추진하면 어디에 내릴까'를 계속 계산하다가, 조준점 앞 30 km가 되는 순간 역추진
        rk.throttle = 0; rk.fwd = V.toward(rk.fwd, V.mul(V.norm(rk.vel), -1), 0.05);
        const pred = predictLanding(rk.pos, rk.vel, rk.mass, 60 * DEG), err = pred - TAEM_AT;
        const prev = this.lastErr; this.lastErr = err;
        const rate = V.len(rk.vel) * 1.0, wait = err < 0 ? -err / rate : (2 * Math.PI * PLANET.R - err) / rate;
        this.hint = '역추진까지 ' + fmtT(wait);
        if (prev != null && prev < 0 && err >= 0 && err < 200000) this.phase = 'deorbit';
        return wait > 600 ? 200 : wait > 60 ? 20 : wait > 10 ? 4 : 1;
      }
      case 'deorbit':
        rk.fwd = V.toward(rk.fwd, V.mul(V.norm(rk.vel), -1), 0.4);
        rk.throttle = V.dot(rk.fwd, V.mul(V.norm(rk.vel), -1)) > 0.98 ? 1 : 0;
        this.hint = '근지점 ' + Math.round(ob.pe / 1000) + ' → 15 km';
        if (ob.pe < 15000 || rk.stageFuelFrac === 0) { rk.throttle = 0; this.phase = 'coast'; }
        return 2;
      case 'coast':
        rk.throttle = 0; rk.fwd = attitude(rk.pos, rel, 40 * DEG, 0);
        this.hint = '대기권까지 ' + Math.max(0, Math.round((alt - 45000) / 1000)) + ' km';
        if (alt < 46000) this.phase = 'entry';
        return alt > 60000 ? 50 : 4;
      case 'entry': {
        rk.throttle = 0;
        if ((this.predT -= dt) <= 0) {
          // 남은 거리 예측으로 뱅크 조절: 너무 멀리 가면 더 기울여 양력을 옆으로 돌림
          this.predT = 2;
          const err = predictEntry(rk.pos, rel, rk.mass, this.bank) - (TAEM_AT + 10000);
          this.bank = Math.max(0, Math.min(80 * DEG, this.bank + Math.max(-12 * DEG, Math.min(12 * DEG, err / 25000))));
        }
        const sgn = tg.cross > 0 ? -1 : 1;     // 활주로 쪽으로 기울이기 (오른쪽에 있으면 왼쪽으로)
        rk.fwd = attitude(rk.pos, rel, entryAoa(sp), this.bank * sgn);
        this.hint = '활주로까지 ' + fmtD(tg.d) + ' · 뱅크 ' + Math.round(this.bank / DEG) + '°';
        if (alt < 9500 || sp < 320) this.phase = 'taem';
        return 4;
      }
      case 'taem':
      case 'final': {
        // 활공: 활주로 시작점을 향해 비행경로각을 맞추고(고도/거리), 옆으로 벗어난 만큼 기울여 돌기
        rk.throttle = 0;
        const hdg = V.norm(V.sub(rel, V.mul(up, V.dot(rel, up))));
        // 활주로 축에서 많이 벗어났으면 먼저 활주로 연장선 위 12 km 지점(정렬점)으로
        const tgt = this.phase === 'taem' && Math.abs(tg.cross) > 1500 && tg.d > 13000 ? HAP : AIM;
        const toAim = V.sub(tgt, rk.pos), toAimH = V.norm(V.sub(toAim, V.mul(up, V.dot(toAim, up))));
        let lineup = this.phase === 'final' ? V.norm(V.add(RUNWAY.dir, V.mul(RUNWAY.side, -Math.max(-0.4, Math.min(0.4, tg.cross / 400))))) : toAimH;
        // 너무 높으면(에너지가 남으면) S자로 돌아 길을 늘려 고도를 버림
        const excess = alt - (Math.max(0, tg.d - 2500) * Math.tan(16 * DEG) + 300);
        if (this.phase === 'taem' && excess > 300 && tg.d > 6000) { this.sT = (this.sT || 0) + dt; const s2 = Math.floor(this.sT / 12) % 2 ? 1 : -1; const sideH = V.norm(V.cross(toAimH, up)); lineup = V.norm(V.add(V.mul(toAimH, 1.0), V.mul(sideH, s2 * Math.min(1, excess / 1500)))); }
        const turn = Math.atan2(V.dot(V.cross(hdg, lineup), up), V.dot(hdg, lineup));
        const bank = Math.max(-50 * DEG, Math.min(50 * DEG, turn * 2.2));
        // 가파른 활공(최대 20°) → 고도 500 m 아래에서는 완만하게(3°) 바꿔 착지 준비 (프리플레어)
        // 글라이더처럼: 받음각으로 속도(초속 150 m)를 지키고, 높이가 남으면 에어브레이크로 버림
        const hRef = Math.max(0, tg.d) * Math.tan(18 * DEG), high = alt - hRef;
        const vRef = 150, aoa = Math.max(3 * DEG, Math.min(18 * DEG, 8 * DEG + (sp - vRef) * 0.12 * DEG + Math.max(-4 * DEG, Math.min(4 * DEG, -high / 400 * DEG))));
        rk.brake = Math.max(0, Math.min(1, high / 300, 1)) * (sp > 120 ? 1 : 0) + (sp > 200 ? 0.5 : 0);
        // 자동 착륙 장치: 활주로 축 위 18° 활공 경로와 초속 150 m를 따라가도록 조종면·브레이크를 미세 보정
        if (this.phase === 'final') rk.rcs = pathAssist(rk, up, rel, tg, alt, 18 * DEG, vRef);
        rk.fwd = attitude(rk.pos, rel, aoa, -bank);
        if (this.phase === 'taem' && tg.d < 16000 && Math.abs(tg.cross) < 2500) this.phase = 'final';
        if (alt < Math.max(30, -V.dot(rel, up) * 1.8)) this.phase = 'flare';   // 내려오는 속도가 빠를수록 일찍 기수를 듦
        this.hint = '활주로까지 ' + fmtD(tg.d) + ' · 고도 ' + fmtD(alt) + ' · ' + fmt(sp) + ' m/s';
        return 2;
      }
      case 'flare': {
        // 플레어: 기수를 들어 내려오는 속도를 초속 1~2 m로
        rk.throttle = 0;
        // 조준점을 지나도 떠 있으면 조금 더 단단히 내려앉음 (활주로 끝을 넘지 않게)
        const vz = V.dot(rel, up), late = tg.along > -150, want = late ? -Math.max(2.6, alt * 0.3) : -Math.max(1.0, alt * 0.12);
        const hdg = V.norm(V.sub(rel, V.mul(up, vz)));
        const lineup = V.norm(V.add(RUNWAY.dir, V.mul(RUNWAY.side, -Math.max(-0.3, Math.min(0.3, tg.cross / 200)))));
        const turn = Math.atan2(V.dot(V.cross(hdg, lineup), up), V.dot(hdg, lineup));
        const aoa = Math.max(6 * DEG, Math.min(34 * DEG, 15 * DEG + (want - vz) * 3 * DEG));
        rk.fwd = attitude(rk.pos, rel, aoa, -Math.max(-15 * DEG, Math.min(15 * DEG, turn * 2)));
        { // 플레어 보정: 내려오는 속도를 목표에 맞추고 활주로 가운데로
          const vh = V.sub(rel, V.mul(up, vz)), vc = V.dot(V.sub(rk.vel, V.mul(up, V.dot(rk.vel, up))), RUNWAY.side);   // 옆 방향은 땅 기준 속도(옆바람 보정)
          let acc = V.add(V.mul(up, (want - vz) * 1.6), V.mul(RUNWAY.side, -tg.cross * 0.05 - vc * 0.6));
          acc = V.add(acc, V.mul(RUNWAY.dir, -Math.max(0, V.dot(vh, RUNWAY.dir) - 105) * 0.25));   // 너무 오래 떠 있지 않게 속도를 줄임
          const l = V.len(acc); if (l > 9) acc = V.mul(acc, 9 / l);
          rk.rcs = acc;
        }
        this.hint = '고도 ' + Math.round(alt) + ' m · 내려오는 속도 ' + (-vz).toFixed(1) + ' m/s';
        return 1;
      }
    }
    return 1;
  }
}
// 역추진 시점: 활주로가 궤도 위에서 이만큼 앞에 있을 때 (rad)
export const DEORBIT_LEAD = alt => 3.5;
const fmt = v => Math.round(v).toLocaleString('ko-KR');
const fmtD = m => m >= 10000 ? (m / 1000).toFixed(0) + ' km' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
const fmtT = s => s >= 60 ? Math.floor(s / 60) + '분 ' + Math.round(s % 60) + '초' : Math.round(s) + '초';
void horizon;
