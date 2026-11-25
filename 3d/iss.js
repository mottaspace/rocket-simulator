// 국제우주정거장(ISS): 1/16 지구에 맞춘 원궤도. 위치는 실제 시계로 계산해서 어느 기기에서나 같은 시각에 같은 곳에 있어요.
// 궤도면은 발사장(나로우주센터) 위를 지나고, 실제 ISS처럼 적도에 51.6° 기울어져 있어요.
// → 발사장에서 북동쪽(방위각 약 49°)으로 쏘면 같은 궤도면에 올라갈 수 있어요.
import { PLANET, V, horizon } from './physics3d.js';

const DEG = Math.PI / 180;
export const ISS_INFO = {
  name: '국제우주정거장 (ISS)',
  alt: 100000,              // 게임 고도 100 km (실제 약 400 km)
  incl: 51.6,               // 궤도 경사각 (실제와 같음)
  siteLat: 34.43,           // 나로우주센터 위도
  facts: [
    ['첫 모듈 발사', '1998년 (자랴 모듈)'],
    ['크기', '약 109 m (축구장만 함)'],
    ['무게', '약 420 t'],
    ['실제 고도', '약 400 km'],
    ['한 바퀴', '약 92분 · 하루 16번 해돋이'],
    ['참여', '15개 나라 · 5개 우주기관'],
  ],
  story: '2000년 11월부터 지금까지 우주비행사가 쉬지 않고 머물며 실험하는 하늘 위 연구소예요. 우주왕복선과 여러 로켓이 40번 넘게 부품을 실어 날라 우주에서 조립했어요.',
};

const PAD_UP = [0, 1, 0];
const R = PLANET.R + ISS_INFO.alt;
// 발사장에서 궤도면이 지나가는 방향 (북쪽에서 동쪽으로 잰 방위각)
export const LAUNCH_AZ = Math.asin(Math.min(1, Math.cos(ISS_INFO.incl * DEG) / Math.cos(ISS_INFO.siteLat * DEG)));
const hz = horizon([0, PLANET.R, 0]);
const P = PAD_UP;                                                        // 궤도면 위의 기준점: 발사장 바로 위
const Q = V.norm(V.add(V.mul(hz.north, Math.cos(LAUNCH_AZ)), V.mul(hz.east, Math.sin(LAUNCH_AZ))));   // 발사장 위에서 날아가는 방향
export const ISS_NORMAL = V.norm(V.cross(P, Q));
export const ISS_N = Math.sqrt(PLANET.mu / (R * R * R));               // 각속도 (rad/s)
export const ISS_PERIOD = 2 * Math.PI / ISS_N;
const EPOCH = Date.UTC(2026, 0, 1);

// 발사장 기준 궤도 위 각도 (0 = 발사장 바로 위)
export function issPhase(tMs) { const u = ISS_N * (tMs - EPOCH) / 1000; return ((u % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
export function issState(tMs) {
  const u = issPhase(tMs), c = Math.cos(u), s = Math.sin(u), w = R * ISS_N;
  return {
    pos: V.add(V.mul(P, R * c), V.mul(Q, R * s)),
    vel: V.add(V.mul(P, -w * s), V.mul(Q, w * c)),
    phase: u,
  };
}
// 궤도 요소 (관제 지도에 궤도선 그리기용, satElements와 같은 모양)
export const ISS_EL = { a: R, e: 0, P, Q, ap: ISS_INFO.alt, pe: ISS_INFO.alt, period: ISS_PERIOD };

// 발사 창: ISS가 발사장보다 이만큼 앞서 있을 때 쏘면, 궤도에 오를 즈음 ISS 근처에 닿아요
export const WINDOW_LEAD = 0.45;      // rad (약 26°)
export const WINDOW_HALF = 0.22;      // 창의 너비 ±(약 13°)
export function launchWindow(tMs) {
  const u = issPhase(tMs);
  let d = u - WINDOW_LEAD; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;   // -π..π
  const open = Math.abs(d) <= WINDOW_HALF;
  // 다음 창이 열릴 때까지 (각도 차이 / 각속도)
  const wait = open ? 0 : (((WINDOW_LEAD - WINDOW_HALF - u) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / ISS_N;
  const closesIn = open ? (WINDOW_HALF - d) / ISS_N : 0;
  return { open, wait, closesIn, phaseDeg: u / DEG };
}
// 발사장에서 본 ISS 방향 설명 (예: "발사장 앞쪽 120°")
export function issFromPad(tMs) {
  const u = issPhase(tMs) / DEG;
  return u < 180 ? '발사 방향으로 ' + Math.round(u) + '° 앞' : '발사장 뒤쪽 ' + Math.round(360 - u) + '°';
}
