/* 로켓 부품 정의, 단(stage) 분석, 부품 그리기 */
(function (global) {
  'use strict';

  const G0 = 9.81;
  const WIDTH = 1.25; // 모든 부품의 지름 (m)

  // mass: 빈 무게(kg), fuel: 연료(kg), thrust: 추력(N), isp: 비추력(s, 해면/진공)
  const PARTS = {
    chute: { name: '낙하산', short: '낙하산', mass: 100, h: 0.5, kind: 'chute', desc: '착륙 직전 속도를 줄여 줘요.' },
    pod:   { name: '유인 캡슐', short: '캡슐', mass: 800, h: 1.5, kind: 'pod', desc: '우주비행사가 타는 곳. 꼭 1개 필요!' },
    tankS: { name: '연료탱크 S', short: '탱크 S', mass: 60, fuel: 400, h: 1.1, kind: 'tank', desc: '작은 탱크' },
    tankM: { name: '연료탱크 M', short: '탱크 M', mass: 180, fuel: 1600, h: 2.6, kind: 'tank', desc: '중간 탱크' },
    tankL: { name: '연료탱크 L', short: '탱크 L', mass: 450, fuel: 4000, h: 5.2, kind: 'tank', desc: '큰 탱크' },
    engS:  { name: '엔진 · 제비', short: '제비 엔진', mass: 400, thrust: 60000, ispSL: 270, ispV: 345, h: 1.1, kind: 'engine', desc: '힘은 약하지만 연료를 아껴 써요(우주용).' },
    engL:  { name: '엔진 · 코뿔소', short: '코뿔소 엔진', mass: 1300, thrust: 230000, ispSL: 265, ispV: 300, h: 1.7, kind: 'engine', desc: '힘이 아주 세요(이륙용).' },
    srb:   { name: '고체 로켓', short: '고체 로켓', mass: 350, fuel: 2000, thrust: 200000, ispSL: 210, ispV: 230, h: 5.0, kind: 'srb', desc: '연료 내장. 한 번 켜면 끌 수 없어요!' },
    dec:   { name: '단 분리기', short: '분리기', mass: 50, h: 0.35, kind: 'dec', desc: '다 쓴 아래 단을 떼어 내요.' },
    // ── 3D 시제품에서 추가된 부품 (2D 조립 화면 목록에는 나오지 않음) ──
    nose:  { name: '노즈콘', short: '노즈콘', mass: 80, h: 1.4, kind: 'nose', desc: '뾰족한 머리. 공기저항을 줄여요.' },
    satCom:{ name: '통신위성', short: '통신위성', mass: 600, h: 1.8, kind: 'sat', sat: 'comm', desc: '궤도에서 분리하면 계속 공전하며 통신을 이어 줘요.' },
    satObs:{ name: '관측위성', short: '관측위성', mass: 900, h: 2.2, kind: 'sat', sat: 'obs', desc: '망원 카메라로 행성을 내려다봐요.' },
    engV:  { name: '엔진 · 올빼미', short: '올빼미 엔진', mass: 250, thrust: 30000, ispSL: 120, ispV: 370, h: 1.6, kind: 'engine', desc: '우주 전용 엔진. 공기 중에서는 약해요.' },
    srbS:  { name: '소형 고체 부스터', short: '측면 부스터', mass: 150, fuel: 900, thrust: 90000, ispSL: 210, ispV: 230, h: 3.6, kind: 'srb', radial: true, desc: '탱크 옆에 붙이는 보조 로켓. 다 타면 떨어져요.' },
    catPod:{ name: '냥이 캡슐', short: '냥이 캡슐', mass: 820, h: 1.5, kind: 'pod', cat: true, desc: '고양이 우주비행사가 타요. 무중력에서 꼬리가 둥둥! 냥.' },
    fairing:{ name: '페어링', short: '페어링', mass: 220, h: 1.6, kind: 'fairing', desc: '위성을 감싸 공기와 열로부터 보호해요. 고도 50 km에서 자동으로 벗겨져요.' },
    shield:{ name: '열 방패', short: '열 방패', mass: 150, h: 0.35, kind: 'shield', desc: '궤도에서 돌아올 때 공기와의 마찰열(최대 1,600 °C 이상)을 막아요. 캡슐 바로 아래에 두세요.' },
    lab:   { name: '과학 실험실', short: '실험실', mass: 300, h: 1.2, kind: 'lab', desc: '고도마다 실험을 해서 과학 점수와 과학 상식을 모아요.' },
    sail:  { name: '태양 돛', short: '태양 돛', mass: 60, h: 0.8, kind: 'sail', desc: '우주에서 펼쳐져 햇빛이 미는 힘(복사압)으로 연료 없이 조금씩 가속해요. 게임에서는 힘을 크게 키웠어요.' },
    balloon:{ name: '고고도 풍선', short: '풍선', mass: 120, h: 0.6, kind: 'balloon', desc: '헬륨 풍선이 로켓을 18 km까지 들어 올린 뒤 점화해요(로쿤). 공기가 옅어 저항이 작아요. 맨 위에 두세요.' },
    ion:   { name: '이온 엔진', short: '이온 엔진', mass: 120, thrust: 3000, ispSL: 200, ispV: 3000, h: 0.9, kind: 'engine', ion: true, desc: '전기로 이온을 쏘는 엔진. 연료를 10배 아끼지만 힘이 아주 약하고, 공기 중에서는 거의 작동하지 않아요.' },
    engH:  { name: '엔진 · 고래', short: '고래 엔진', mass: 3200, thrust: 620000, ispSL: 272, ispV: 312, h: 2.4, kind: 'engine', desc: '아주 강력한 대형 엔진. 큰 탱크와 함께 써요.' },
    tankXL:{ name: '연료탱크 XL', short: '탱크 XL', mass: 900, fuel: 8000, h: 9.0, kind: 'tank', desc: '아주 큰 탱크' },
    fin:   { name: '안정 날개', short: '날개', mass: 40, h: 1.6, kind: 'fin', radial: true, desc: '화살 깃처럼 로켓이 바람에 흔들리지 않게 잡아 줘요. 맨 아래 부품 옆에 붙이세요.' },
    // ── 실제 로켓을 닮은 부품 ──
    ssNose:  { name: '스타십 기수', short: '스타십 기수', mass: 700, h: 3.4, kind: 'nose', look: 'starship', control: true, desc: '스테인리스 기수와 앞날개(플랩). 조종석과 화물칸이 들어 있어요. 돌아올 때 배를 아래로 눕혀 공기로 속도를 줄여요.' },
    les:     { name: '비상 탈출 타워', short: '탈출 타워', mass: 300, h: 2.8, kind: 'nose', look: 'les', desc: '발사 중 문제가 생기면 작은 로켓으로 캡슐을 끌고 도망쳐요(아폴로·소유즈). 보통은 중간에 버려요.' },
    flap:    { name: '뒷날개(플랩)', short: '플랩', mass: 80, h: 2.4, kind: 'fin', radial: true, look: 'flap', desc: '스타십의 움직이는 날개. 하늘다이빙하듯 내려올 때 자세를 잡아요.' },
    gridFin: { name: '격자 날개', short: '격자 날개', mass: 30, h: 0.6, kind: 'fin', radial: true, look: 'grid', desc: '와플처럼 생긴 날개. 1단이 돌아올 때 방향을 잡아요(팰컨 9·슈퍼 헤비). 탱크 맨 위에 붙여요.' },
    legs:    { name: '착륙 다리', short: '착륙 다리', mass: 150, h: 2.6, kind: 'fin', radial: true, look: 'legs', desc: '접혀 있다가 착륙 직전에 펴져요. 다시 쓰는 로켓의 발이에요.' },
    boosterCone: { name: '원뿔 액체 부스터', short: '원뿔 부스터', mass: 300, fuel: 1500, thrust: 120000, ispSL: 255, ispV: 300, h: 5.2, kind: 'srb', radial: true, look: 'cone', r: 0.5, desc: '소유즈의 원뿔형 부스터. 다 쓰고 떨어질 때 십자가처럼 퍼져요(코롤료프 십자가).' },
    boosterCore: { name: '측면 코어', short: '측면 코어', mass: 1300, fuel: 11000, thrust: 560000, ispSL: 270, ispV: 305, h: 12.5, kind: 'srb', radial: true, look: 'core', r: 0.625, desc: '몸통과 같은 굵기의 액체 로켓(엔진 9개). 팰컨 헤비처럼 양옆에 붙여요.' },
    orbiter: { name: '우주왕복선 궤도선', short: '궤도선', mass: 5200, h: 7.5, kind: 'pod', look: 'orbiter', glider: true, desc: '날개 달린 우주선. 외부 탱크 옆에 붙어 올라가고, 돌아올 때는 비행기처럼 활공해 활주로에 내려요. 화물칸에 정거장 부품과 보급품을 실어요.' },
    omsTank: { name: '궤도 조종 연료', short: 'OMS 연료', mass: 120, fuel: 1900, h: 0.05, kind: 'tank', look: 'hidden', hidden: true, desc: '궤도선 안에 있는 궤도 조종용 연료.' },
    oms:     { name: '궤도 조종 엔진(OMS)', short: 'OMS', mass: 250, thrust: 52000, ispSL: 200, ispV: 316, h: 0.05, kind: 'engine', look: 'oms', hidden: true, desc: '궤도선 꼬리의 작은 엔진 2개. 외부 탱크를 버린 뒤 궤도를 다듬어요.' },
    decET:   { name: '외부 탱크 분리 장치', short: '탱크 분리', mass: 40, h: 0.05, kind: 'dec', look: 'hidden', hidden: true, desc: '궤도선과 외부 탱크를 이어 줘요.' },
    etTank:  { name: '외부 연료탱크', short: '외부 탱크', mass: 1500, fuel: 15500, h: 10.5, kind: 'tank', look: 'et', w: 1.35, wt: 1.35, desc: '주황색 단열재로 덮인 커다란 액체수소·액체산소 탱크. 궤도선의 주 엔진 3개가 이 연료를 써요. 다 쓰면 버려요.' },
    ssme:    { name: '왕복선 주 엔진 ×3', short: '주 엔진', mass: 900, thrust: 300000, ispSL: 300, ispV: 360, h: 0.05, kind: 'engine', look: 'ssme', hidden: true, desc: '궤도선 꼬리의 주 엔진 3개(외부 탱크 연료 사용).' },
    srbShuttle: { name: '왕복선 고체 부스터', short: '왕복선 부스터', mass: 800, fuel: 6200, thrust: 330000, ispSL: 235, ispV: 262, h: 10.2, kind: 'srb', radial: true, look: 'sts', r: 0.42, desc: '역사상 가장 힘센 고체 로켓 중 하나. 다 타면 낙하산을 펴고 바다에 떨어져 건져서 다시 썼어요.' },
    decTruss:{ name: '격자 연결부', short: '격자 연결부', mass: 70, h: 0.8, kind: 'dec', look: 'truss', desc: '뼈대만 있는 단 분리기. N1·소유즈처럼 윗단 엔진 불꽃이 빠져나갈 수 있어요.' },
  };
  // 엔진 클러스터(여러 개를 한 단에 묶기): 'engLx9'처럼 개수를 붙인 숨은 부품을 자동으로 만듦
  // 실제 예: 팰컨 9 1단 9개, 새턴 5 1단 5개, 소유즈 4개, N1 1단 30개, 슈퍼 헤비 33개
  const CLUSTER_N = [1, 2, 3, 4, 5, 7, 9, 30, 33];
  for (const id of Object.keys(PARTS)) {
    const p = PARTS[id];
    if (p.kind !== 'engine' || p.ion) continue;
    for (const n of CLUSTER_N.slice(1)) {
      PARTS[id + 'x' + n] = Object.assign({}, p, {
        name: p.name + ' ×' + n, short: p.short + ' ×' + n, mass: p.mass * n, thrust: p.thrust * n, base: id, cluster: n, hidden: true,
        desc: p.short + ' ' + n + '개를 한 단에 묶었어요(클러스터). 힘도 무게도 ' + n + '배예요. 엔진 하나가 고장 나도 나머지로 버틸 수 있어요.',
      });
    }
  }
  // 탱크 굵기: 'tankL@16'(굵기 1.6배), 'tankL@16-13'(아래 1.6배 → 위 1.3배 원뿔). 연료는 부피만큼 늘어요.
  const WIDTH_OPTS = ['08', '10', '13', '16', '20', '13-10', '16-13', '20-16', '10-08'];
  for (const id of Object.keys(PARTS)) {
    const p = PARTS[id];
    if (p.kind !== 'tank') continue;
    for (const code of WIDTH_OPTS) {
      if (code === '10') continue;
      const [b, t] = code.split('-').map(v => +v / 10), wt = t || b, vol = (b * b + b * wt + wt * wt) / 3;
      PARTS[id + '@' + code] = Object.assign({}, p, {
        name: p.name + (t ? ' (원뿔 ' + b + '→' + wt + ')' : ' (굵기 ×' + b + ')'), short: p.short + (t ? ' 원뿔' : ' ×' + b),
        mass: Math.round(p.mass * vol), fuel: Math.round(p.fuel * vol), w: b, wt, base: id, widthCode: code, hidden: true,
        desc: (t ? '아래가 넓고 위가 좁은 원뿔 탱크' : '굵기 ' + b + '배 탱크') + '. 연료가 ' + vol.toFixed(1) + '배 들어가지만 그만큼 무거워요.',
      });
    }
  }
  const PALETTE_ORDER = ['pod', 'chute', 'tankS', 'tankM', 'tankL', 'engS', 'engL', 'srb', 'dec'];

  const EXAMPLES = [
    { name: '연습용 1단 로켓', parts: ['chute', 'pod', 'tankM', 'engS'] },
    { name: '고체 부스터 로켓', parts: ['chute', 'pod', 'dec', 'srb'] },
    { name: '궤도 도전 2단 로켓', parts: ['chute', 'pod', 'tankM', 'engS', 'dec', 'tankL', 'engL'] },
    { name: '튼튼한 3단 로켓', parts: ['chute', 'pod', 'tankS', 'engS', 'dec', 'tankM', 'tankS', 'engS', 'dec', 'tankL', 'engL'] },
  ];

  // 부품 목록(위→아래)을 단으로 나눈다. 반환: 아래 단(먼저 점화)부터 순서대로.
  // 분리기는 그 아래 단과 함께 떨어져 나간다.
  function splitStages(ids) {
    const segs = [];
    let cur = [];
    for (const id of ids) {
      if (PARTS[id].kind === 'dec' && cur.length) { segs.push(cur); cur = []; }
      cur.push(id);
    }
    if (cur.length) segs.push(cur);
    return segs.reverse();
  }

  function segInfo(seg) {
    let dry = 0, fuel = 0, thrust = 0, flowSL = 0, flowV = 0;
    for (const id of seg) {
      const p = PARTS[id];
      dry += p.mass;
      if (p.fuel) fuel += p.fuel;
      if (p.thrust) { thrust += p.thrust; flowSL += p.thrust / p.ispSL; flowV += p.thrust / p.ispV; }
    }
    const engines = seg.filter(id => PARTS[id].thrust).length;
    const tanksOnly = seg.some(id => PARTS[id].kind === 'tank');
    const liquidEngines = seg.some(id => PARTS[id].kind === 'engine');
    return {
      dry, fuel, thrust, engines,
      ispSL: thrust ? thrust / flowSL : 0,
      ispV: thrust ? thrust / flowV : 0,
      noFuelForEngine: liquidEngines && !tanksOnly,
    };
  }

  // 단별 성능 분석: Δv(진공), 이륙 추력중량비 등
  function analyze(ids) {
    const segs = splitStages(ids);
    const infos = segs.map(segInfo);
    const stages = [];
    let total = 0;
    for (let i = 0; i < segs.length; i++) {
      let m0 = 0;
      for (let j = i; j < segs.length; j++) m0 += infos[j].dry + infos[j].fuel;
      const s = infos[i];
      const m1 = m0 - s.fuel;
      const isFirst = i === 0;
      const isp = isFirst ? (s.ispSL + s.ispV) / 2 : s.ispV;
      const dv = s.thrust && s.fuel ? isp * G0 * Math.log(m0 / m1) : 0;
      const burn = s.thrust ? s.fuel / (s.thrust / (isp * G0)) : 0;
      stages.push({ index: i + 1, mass: m0, dv, twr: s.thrust / (m0 * G0), burn, info: s });
      total += dv;
    }
    const mass = infos.reduce((a, s) => a + s.dry + s.fuel, 0);
    const pods = ids.filter(id => id === 'pod').length;
    const warnings = [];
    if (!ids.length) warnings.push('부품이 없어요.');
    else {
      if (!pods) warnings.push('유인 캡슐이 필요해요.');
      if (stages.length && !stages[0].info.thrust) warnings.push('맨 아래 단에 엔진이 없어요.');
      else if (stages.length && stages[0].twr < 1) warnings.push('추력이 무게보다 약해서 이륙할 수 없어요 (추력중량비 < 1).');
      if (infos.some(s => s.noFuelForEngine)) warnings.push('엔진과 같은 단에 연료탱크가 없어요.');
      if (ids[ids.length - 1] === 'dec') warnings.push('맨 아래에 분리기가 있어요.');
      if (!ids.includes('chute')) warnings.push('낙하산이 없으면 안전하게 착륙할 수 없어요.');
    }
    const fatal = warnings.filter(w => !w.startsWith('낙하산'));
    return { stages, totalDv: total, mass, warnings, ok: fatal.length === 0 };
  }

  function totalHeight(ids) { return ids.reduce((a, id) => a + PARTS[id].h, 0); }

  // ── 그리기 (단위: 미터, 원점 = 부품 아래 가운데, 위쪽이 -y) ──
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawPart(ctx, id, opt) {
    const p = PARTS[id];
    const w = WIDTH, h = p.h, x = -w / 2, y = -h;
    ctx.save();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = '#1b2033';
    switch (p.kind) {
      case 'chute': {
        ctx.fillStyle = opt && opt.chuteUsed ? '#555' : '#e8483f';
        ctx.beginPath();
        ctx.moveTo(x + 0.15, 0); ctx.lineTo(x + w - 0.15, 0);
        ctx.quadraticCurveTo(x + w - 0.2, y, 0, y);
        ctx.quadraticCurveTo(x + 0.2, y, x + 0.15, 0);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillRect(-0.08, y + 0.12, 0.16, 0.3);
        break;
      }
      case 'pod': {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#8d97ad'); g.addColorStop(0.5, '#e9edf5'); g.addColorStop(1, '#7f889c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w - 0.33, y); ctx.lineTo(x + 0.33, y); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1f3a66';
        ctx.beginPath(); ctx.arc(0, y + h * 0.5, 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(160,210,255,.8)';
        ctx.beginPath(); ctx.arc(-0.06, y + h * 0.46, 0.08, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'tank': {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#b9c0cc'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(1, '#a8afbc');
        ctx.fillStyle = g; rr(ctx, x, y, w, h, 0.12); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff8a3d';
        const band = Math.min(0.22, h * 0.15);
        ctx.fillRect(x, y + 0.12, w, band); ctx.fillRect(x, -0.12 - band, w, band);
        const f = opt && opt.fuelFrac != null ? opt.fuelFrac : null;
        if (f != null) { // 연료 게이지
          ctx.fillStyle = '#20263a'; ctx.fillRect(x + w - 0.2, y + 0.4, 0.08, h - 0.8);
          ctx.fillStyle = '#ffd166'; const gh = (h - 0.8) * f; ctx.fillRect(x + w - 0.2, -0.4 - gh, 0.08, gh);
        }
        break;
      }
      case 'engine': {
        const big = id === 'engL';
        ctx.fillStyle = '#4b5366';
        rr(ctx, x + 0.1, y, w - 0.2, h * 0.45, 0.06); ctx.fill(); ctx.stroke();
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#5a4636'); g.addColorStop(0.5, big ? '#c9894f' : '#b9a07a'); g.addColorStop(1, '#4e3b2c');
        ctx.fillStyle = g;
        const top = y + h * 0.45, nw = big ? 0.5 : 0.35, bw = big ? 0.62 : 0.5;
        ctx.beginPath(); ctx.moveTo(-nw / 2, top); ctx.lineTo(nw / 2, top); ctx.lineTo(bw, 0); ctx.lineTo(-bw, 0); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'srb': {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#c9c9c9'); g.addColorStop(0.45, '#f6f6f6'); g.addColorStop(1, '#b2b2b2');
        ctx.fillStyle = g; rr(ctx, x, y, w, h - 0.5, 0.1); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b2f3c';
        for (let i = 0; i < 4; i++) ctx.fillRect(x, y + 0.5 + i * (h - 1.2) / 4, w, 0.14);
        ctx.fillStyle = '#3c3f48';
        ctx.beginPath(); ctx.moveTo(-0.3, -0.5); ctx.lineTo(0.3, -0.5); ctx.lineTo(0.48, 0); ctx.lineTo(-0.48, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'dec': {
        ctx.fillStyle = '#d6a21c'; ctx.fillRect(x - 0.03, y, w + 0.06, h); ctx.strokeRect(x - 0.03, y, w + 0.06, h);
        ctx.fillStyle = '#2b2f3c';
        for (let i = 0; i < 5; i++) ctx.fillRect(x + 0.08 + i * 0.24, y + 0.08, 0.12, h - 0.16);
        break;
      }
    }
    ctx.restore();
  }

  // 부품 목록을 아래쪽 원점 기준으로 위로 쌓아 그린다. 각 부품의 [top, bottom] y 범위 반환
  function drawStack(ctx, ids, opt) {
    const ranges = [];
    let yb = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      const h = PARTS[ids[i]].h;
      ctx.save(); ctx.translate(0, yb);
      drawPart(ctx, ids[i], opt && opt.partOpt ? opt.partOpt(i) : null);
      if (opt && opt.selected === i) {
        ctx.strokeStyle = '#5ab0ff'; ctx.lineWidth = 0.09; ctx.setLineDash([0.18, 0.12]);
        ctx.strokeRect(-WIDTH / 2 - 0.15, -h - 0.06, WIDTH + 0.3, h + 0.12);
      }
      ctx.restore();
      ranges[i] = [yb - h, yb];
      yb -= h;
    }
    return ranges;
  }

  global.Parts = { PARTS, CLUSTER_N, WIDTH_OPTS, PALETTE_ORDER, EXAMPLES, WIDTH, splitStages, segInfo, analyze, totalHeight, drawPart, drawStack };
})(window);
