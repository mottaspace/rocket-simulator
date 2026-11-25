// ISS 랑데부·도킹 도우미
// 1) 따라잡기: 낮은 궤도는 더 빨리 돌아요. ISS와의 각도 차이가 맞을 때까지 기다림 (시간 가속 가능)
// 2) 전이 연소: 진행 방향으로 가속해 원지점을 ISS 높이로 (호만 전이)
// 3) 원지점 도착 → 다시 가속해 ISS와 같은 원궤도
// 4) 근접 접근: 자세 제어 추진기(RCS)로 ISS 앞 60 m 지점까지
// 5) 최종 접근: 초속 0.2 m 정도로 도킹 포트에 닿기
import { PLANET, V, horizon } from './physics3d.js';
import { ISS_INFO, ISS_N, ISS_NORMAL, issState } from './iss.js';

const R_ISS = PLANET.R + ISS_INFO.alt;
export const PORT_OFFSET = 18.7;      // ISS 중심에서 앞쪽 도킹 포트까지 (m)
const APPROACH = 60;                  // 최종 접근을 시작하는 지점 (포트 앞 m)

// ISS 도킹 포트 위치·속도, 진행 방향
export function issPort(tMs) {
  const st = issState(tMs), vdir = V.norm(st.vel);
  return { pos: V.add(st.pos, V.mul(vdir, PORT_OFFSET)), vel: st.vel, vdir, center: st.pos };
}
// 로켓 앞끝(기수) 위치
export const noseOf = rk => V.add(rk.pos, V.mul(rk.fwd, rk.height));

// ISS가 나보다 궤도 위에서 얼마나 앞서 있는지 (rad, -π..π)
export function phaseAhead(rk, tMs) {
  const a = V.norm(rk.pos), b = V.norm(issState(tMs).pos);
  return Math.atan2(V.dot(V.cross(a, b), ISS_NORMAL), V.dot(a, b));
}

export const RDV_LABEL = { wait: '따라잡는 중', burn1: '전이 연소 (원지점을 ISS 높이로)', coast: 'ISS 높이까지 올라가는 중', burn2: '궤도 맞추기 연소', approach: '근접 접근 (RCS)', final: '최종 접근 · 도킹 포트로', docked: '도킹 완료' };

export class Rendezvous {
  constructor(rk) { this.rk = rk; this.phase = 'wait'; this.hint = ''; }
  // 매 프레임: 로켓의 방향·추력·RCS를 정함. 반환값 = 이번 프레임에 허용할 최대 시간 배속
  update(tMs) {
    const rk = this.rk, P = issPort(tMs), mu = PLANET.mu;
    rk.sas = 'off'; rk.tiltDir = [0, 0, 0]; rk.rcs = null;
    // 다 쓴 단·외부 탱크는 먼저 버림
    if (rk.nextAction === 'stage' && (rk.stageFuelFrac === 0 || (rk.active && rk.active.ids.some(id => window.Parts.PARTS[id].look === 'et')))) rk.stage();
    const rel = V.sub(P.pos, noseOf(rk)), dist = V.len(rel), relV = V.sub(rk.vel, P.vel);
    const pro = V.norm(rk.vel), ob = rk.orbit();
    if (this.phase !== 'approach' && this.phase !== 'final' && this.phase !== 'docked' && dist < 25000 && Math.abs(V.len(rk.pos) - R_ISS) < 4000) this.phase = 'approach';
    // 엔진 연료가 없으면 갈 수 없음
    if (['wait', 'burn1', 'burn2'].includes(this.phase) && rk.stageFuelFrac === 0 && rk.nextAction !== 'stage') { rk.throttle = 0; this.hint = '⚠ 연료가 없어 ISS까지 갈 수 없어요 (위에 연료가 남은 우주선이 필요해요)'; return 10; }
    switch (this.phase) {
      case 'wait': {
        // 궤도가 ISS보다 높으면 따라잡을 수 없으니 먼저 원지점을 낮춤
        if (ob.ap > ISS_INFO.alt - 2000 && ob.pe > PLANET.atm + 8000) {
          rk.fwd = V.toward(rk.fwd, V.mul(pro, -1), 0.3); rk.throttle = V.dot(rk.fwd, V.mul(pro, -1)) > 0.98 ? 0.6 : 0;
          this.hint = '원지점 낮추기 ' + Math.round(ob.ap / 1000) + ' km → ' + Math.round(ISS_INFO.alt / 1000 - 5) + ' km';
          if (ob.ap < ISS_INFO.alt - 5000) rk.throttle = 0;
          return 2;
        }
        rk.throttle = 0; rk.fwd = V.toward(rk.fwd, pro, 0.05);
        const r1 = ob.a > 0 ? ob.a : V.len(rk.pos), tau = Math.PI * Math.sqrt(Math.pow(r1 + R_ISS, 3) / (8 * mu));
        const need = Math.PI - ISS_N * tau, now = phaseAhead(rk, tMs), nMe = Math.sqrt(mu / (r1 * r1 * r1));
        let diff = now - need; const rate = nMe - ISS_N;
        if (rate > 0) diff = ((diff % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); else diff = -((((-diff) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
        const wait = rate !== 0 ? diff / rate : Infinity;
        this.hint = '위상 차 ' + Math.round(now * 57.3) + '° · 전이까지 약 ' + (wait < 120 ? Math.round(wait) + '초' : Math.round(wait / 60) + '분') + (wait > 60 ? ' (시간 가속 ⏩ 추천)' : '');
        if (Math.abs(diff) < 0.012 || (wait >= 0 && wait < 1.5)) this.phase = 'burn1';
        return wait > 120 ? 200 : wait > 20 ? 10 : 1;
      }
      case 'burn1':
        rk.fwd = V.toward(rk.fwd, pro, 0.3); rk.throttle = V.dot(rk.fwd, pro) > 0.98 ? 1 : 0;
        this.hint = '원지점 ' + Math.round(ob.ap / 100) / 10 + ' / ' + ISS_INFO.alt / 1000 + ' km';
        if (ob.ap >= ISS_INFO.alt - 150) { rk.throttle = 0; this.phase = 'coast'; }
        return 2;
      case 'coast':
        rk.throttle = 0; rk.fwd = V.toward(rk.fwd, pro, 0.05);
        this.hint = 'ISS 높이까지 ' + Math.round((ISS_INFO.alt - rk.alt) / 100) / 10 + ' km';
        if (rk.vertSpeed < 3 && rk.alt > ISS_INFO.alt - 3000) this.phase = 'burn2';
        return rk.alt < ISS_INFO.alt - 8000 ? 50 : 4;
      case 'burn2':
        rk.fwd = V.toward(rk.fwd, pro, 0.3); rk.throttle = V.dot(rk.fwd, pro) > 0.98 ? 0.5 : 0;
        this.hint = '근지점 ' + Math.round(ob.pe / 100) / 10 + ' km';
        if (ob.pe >= ISS_INFO.alt - 1500) { rk.throttle = 0; this.phase = 'approach'; }
        return 2;
      case 'approach': {
        // ISS 앞 60 m 지점을 향해, 거리에 따라 속도를 줄이며 다가감
        rk.throttle = 0;
        const A = V.add(P.pos, V.mul(P.vdir, APPROACH)), toA = V.sub(A, noseOf(rk)), dA = V.len(toA);
        const vDes = V.mul(V.norm(toA), Math.min(60, 0.04 * dA + 0.6));
        const dv = V.sub(vDes, relV), acc = Math.min(3, V.len(dv) * 0.6);
        rk.rcs = V.len(dv) > 0.02 ? V.mul(V.norm(dv), acc) : null;
        rk.fwd = V.toward(rk.fwd, V.mul(P.vdir, -1), 0.04);       // 기수를 ISS 쪽(뒤)으로
        this.hint = '접근 지점까지 ' + (dA > 1000 ? (dA / 1000).toFixed(1) + ' km' : Math.round(dA) + ' m');
        if (dA < 12 && V.len(relV) < 1.2) this.phase = 'final';
        return dA > 5000 ? 10 : 4;
      }
      case 'final': {
        rk.throttle = 0;
        rk.fwd = V.toward(rk.fwd, V.mul(P.vdir, -1), 0.08);
        const vDes = V.mul(V.norm(rel), Math.max(0.12, Math.min(0.6, 0.02 * dist + 0.12)));
        const dv = V.sub(vDes, relV);
        rk.rcs = V.len(dv) > 0.005 ? V.mul(V.norm(dv), Math.min(0.5, V.len(dv) * 0.8)) : null;
        this.hint = '포트까지 ' + dist.toFixed(1) + ' m · 상대 ' + V.len(relV).toFixed(2) + ' m/s';
        return 1;
      }
    }
    return 1;
  }
}

// 도킹 판정: 기수가 포트 2 m 안, 상대 속도 초속 0.5 m 아래
export function canDock(rk, tMs) {
  const P = issPort(tMs), d = V.len(V.sub(P.pos, noseOf(rk))), v = V.len(V.sub(rk.vel, P.vel));
  return { ok: d < 2 && v < 0.5, dist: d, relV: v };
}
// 도킹 중: 로켓을 포트에 붙여 함께 돌게 함
export function holdDocked(rk, tMs) {
  const P = issPort(tMs);
  rk.fwd = V.mul(P.vdir, -1);
  rk.pos = V.sub(P.pos, V.mul(rk.fwd, rk.height));
  rk.vel = P.vel.slice();
  rk.rcs = null; rk.throttle = 0;
}
export function undock(rk, tMs) {
  const P = issPort(tMs);
  rk.vel = V.add(P.vel, V.mul(P.vdir, 0.6));     // 앞쪽으로 천천히 떨어져 나감
}
void horizon;
