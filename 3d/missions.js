// 단계별 미션: 목표 1개(성공) + 보너스 2개 → 별 1~3개. 앞 미션에서 별을 1개 이상 받으면 다음 미션이 열림
// 판정에 쓰는 값 ctx = { rk, auto(자동 비행을 썼는지), weather(날씨 키), real(실제 로켓 키), sat(배치한 위성 궤도 {pe, ap}), ended }
import { PLANET } from './physics3d.js';

const km = m => m / 1000;
const landed = c => c.rk.state === 'landed';
const noFail = c => !c.rk.fail;

export const MISSIONS = [
  {
    id: 'sky', icon: '☁️', title: '하늘 높이', goal: '고도 10 km까지 올라가기',
    learn: '비행기가 나는 높이(10 km)는 영하 50 °C쯤이에요. 높이 갈수록 공기가 옅어져요.',
    rec: 'ex:과학 관측 로켓',
    done: c => c.rk.max.alt >= 10000,
    bonus: [
      { text: '낙하산으로 무사히 착륙하기', ok: c => landed(c) },
      { text: '과학 실험 2개 이상 성공하기', ok: c => c.rk.science.done.size >= 2 },
    ],
    progress: c => '최고 고도 ' + km(c.rk.max.alt).toFixed(1) + ' / 10 km',
  },
  {
    id: 'space', icon: '🌌', title: '우주에 닿기', goal: '고도 45 km(이 행성의 우주 경계) 넘기',
    learn: '실제 지구는 100 km(카르만 선)부터 우주예요. 이 게임 행성은 1/16 크기라 45 km로 줄였어요.',
    rec: 'ex:연습용 1단 로켓',
    done: c => c.rk.max.alt >= PLANET.atm,
    bonus: [
      { text: '무사히 돌아와 착륙하기', ok: c => landed(c) },
      { text: '최대 동압 40 kPa 넘지 않기', ok: c => c.rk.max.q <= 40000 },
    ],
    progress: c => '최고 고도 ' + km(c.rk.max.alt).toFixed(1) + ' / 45 km',
  },
  {
    id: 'orbit', icon: '🪐', title: '첫 궤도', goal: '궤도에 오르기 (근지점 45 km 위)',
    learn: '궤도는 아주 빠르게 옆으로 날며 계속 떨어지는 상태예요. 떨어지는 만큼 지면이 둥글게 멀어져서 땅에 닿지 않아요(뉴턴의 대포).',
    rec: 'ex:궤도 도전 2단 로켓',
    done: c => c.rk.orbited,
    bonus: [
      { text: '자동 비행 없이 직접 조종하기', ok: c => !c.auto },
      { text: '궤도를 돈 뒤 무사히 귀환하기', ok: c => c.rk.orbited && landed(c) },
    ],
    progress: c => c.rk.orbited ? '궤도 진입!' : '수평 속도 ' + Math.round(c.rk.max.hvel) + ' m/s (궤도 약 ' + Math.round(Math.sqrt(PLANET.mu / (PLANET.R + PLANET.atm))) + ' m/s)',
  },
  {
    id: 'satellite', icon: '🛰', title: '통신위성 배치', goal: '통신위성을 궤도에 분리하기',
    learn: '정지궤도 통신위성은 지구 자전과 같은 속도로 돌아서 하늘의 한 자리에 멈춰 있는 것처럼 보여요.',
    rec: 'ex:통신위성 발사체',
    done: c => !!c.sat,
    bonus: [
      { text: '둥근 궤도: 근지점과 원지점 차이 30 km 이내', ok: c => c.sat && c.sat.ap - c.sat.pe <= 30000 },
      { text: '뇌우·강풍이 아닌 날(GO)에 발사하기', ok: c => c.weather === 'clear' || c.weather === 'cloudy' },
    ],
    progress: c => c.sat ? '위성 분리 성공!' : '궤도에 올라 [위성 분리]를 누르세요',
  },
  {
    id: 'nuri', icon: '🇰🇷', title: '누리호처럼', goal: '누리호로 관측위성을 근지점 80 km 위에 올리기',
    learn: '누리호는 2022년 2차 발사에서 성능검증위성을 고도 700 km 궤도에 올려 우리나라를 자력 발사 7번째 나라로 만들었어요.',
    rec: 'real:nuri',
    done: c => c.real === 'nuri' && c.sat && c.sat.pe >= 80000,
    bonus: [
      { text: '자동 비행 없이 직접 조종하기', ok: c => !c.auto },
      { text: '떨어진 단이 모두 바다에 떨어지기', ok: c => c.impacts.length > 0 && c.impacts.every(v => v.info.where !== '육지') },
    ],
    progress: c => c.real !== 'nuri' ? '예제에서 누리호를 불러오세요' : c.sat ? '위성 근지점 ' + km(c.sat.pe).toFixed(0) + ' / 80 km' : '궤도를 80 km 위로 올린 뒤 위성 분리',
  },
  {
    id: 'return', icon: '🪂', title: '무사 귀환', goal: '유인 캡슐로 궤도를 돈 뒤 착륙하기',
    learn: '돌아올 때는 뒤로 엔진을 켜서(역추진) 속도를 줄이고, 열 방패를 앞세워 대기권에 들어와요.',
    rec: 'ex:유인 궤도선',
    done: c => c.rk.orbited && landed(c) && c.rk.hasPart('pod'),
    bonus: [
      { text: '착륙 속도 초속 7 m 이하', ok: c => landed(c) && c.rk.impact <= 7 },
      { text: '소유즈 또는 새턴 5로 해내기', ok: c => c.real === 'soyuz' || c.real === 'saturn' },
    ],
    progress: c => c.rk.orbited ? '궤도 성공! 이제 역추진 → 재진입 → 낙하산' : '먼저 궤도에 오르세요',
  },
  {
    id: 'high', icon: '🚀', title: '더 높이, 더 멀리', goal: '원지점 300 km 이상 궤도 만들기',
    learn: '높은 궤도일수록 한 바퀴 도는 시간이 길어져요. 국제우주정거장은 약 90분, 정지궤도는 24시간이에요.',
    rec: 'real:saturn',
    done: c => c.maxAp >= 300000,
    bonus: [
      { text: '새턴 5 또는 N1로 해내기', ok: c => c.real === 'saturn' || c.real === 'n1' },
      { text: '실패 없이 비행 마치기', ok: noFail },
    ],
    progress: c => '최고 원지점 ' + km(c.maxAp || 0).toFixed(0) + ' / 300 km',
  },
  {
    id: 'storm', icon: '⛈️', title: '날씨와의 싸움', goal: '강풍 또는 뇌우 날씨에 궤도 오르기',
    learn: '실제 발사는 바람·번개 기준을 넘으면 미뤄요. 1969년 아폴로 12호는 발사 직후 번개를 두 번 맞았어요.',
    rec: 'real:soyuz',
    done: c => (c.weather === 'windy' || c.weather === 'storm') && c.rk.orbited,
    bonus: [
      { text: '날개(또는 격자 날개) 달고 날기', ok: c => c.hasFins },
      { text: '실패 없이 비행 마치기', ok: noFail },
    ],
    progress: c => (c.weather === 'windy' || c.weather === 'storm') ? (c.rk.orbited ? '궤도 진입!' : '거친 날씨 속 상승 중') : '발사 브리핑에서 강풍·뇌우를 고르세요',
  },
  {
    id: 'heavy', icon: '🔥', title: '엔진을 묶어라', goal: '엔진 9개 이상 묶은 로켓으로 위성 배치',
    learn: '팰컨 9은 멀린 엔진 9개, 슈퍼 헤비는 랩터 33개를 묶어요. 엔진 하나가 멈춰도 나머지로 버틸 수 있어요.',
    rec: 'real:fh',
    done: c => c.maxCluster >= 9 && !!c.sat,
    bonus: [
      { text: '둥근 궤도: 근지점과 원지점 차이 40 km 이내', ok: c => c.sat && c.sat.ap - c.sat.pe <= 40000 },
      { text: '자동 비행 없이 직접 조종하기', ok: c => !c.auto },
    ],
    progress: c => c.maxCluster < 9 ? '엔진을 9개 이상 묶으세요 (엔진 선택 → 엔진 ×9)' : c.sat ? '위성 분리 성공!' : '궤도에서 위성 분리',
  },
  {
    id: 'landing', icon: '🛬', title: '부스터 재착륙', goal: '1단 부스터를 다시 착륙시키기',
    learn: '팰컨 9은 2015년 처음으로 1단을 착륙시켰어요. 로켓을 다시 쓰면 발사 비용이 크게 줄어요.',
    soon: true,
  },
];

const KEY = 'rocket3d.missions';
export function loadProgress() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
export function saveStars(id, stars) {
  const p = loadProgress();
  if ((p[id] || 0) < stars) { p[id] = stars; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* 저장 불가 */ } }
  return p;
}
export function unlocked(i, prog = loadProgress()) { return i === 0 || (prog[MISSIONS[i - 1].id] || 0) >= 1; }
export function totalStars(prog = loadProgress()) { return Object.values(prog).reduce((a, b) => a + b, 0); }

// 별 계산: 목표 성공 = 1개, 보너스마다 +1
export function evaluate(m, ctx) {
  if (!m || m.soon) return { done: false, stars: 0, bonus: [] };
  const done = !!m.done(ctx), bonus = m.bonus.map(b => !!b.ok(ctx));
  return { done, bonus, stars: done ? 1 + bonus.filter(Boolean).length : 0 };
}
