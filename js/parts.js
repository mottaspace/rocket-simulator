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
  };
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

  global.Parts = { PARTS, PALETTE_ORDER, EXAMPLES, WIDTH, splitStages, segInfo, analyze, totalHeight, drawPart, drawStack };
})(window);
