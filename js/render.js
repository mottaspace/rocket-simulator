/* 비행 화면 / 지도 화면 / 자세 표시기 그리기 */
(function (global) {
  'use strict';
  const { PARTS, drawStack, WIDTH } = global.Parts;
  const { PLANET, wrap } = global.Physics;

  const stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.7 + 0.3 }));
  // 구름: 행성 둘레의 각도와 고도
  const clouds = Array.from({ length: 90 }, () => ({ ang: Math.PI / 2 + (Math.random() - 0.5) * 0.25, alt: 1200 + Math.random() * 3500, w: 120 + Math.random() * 260 }));
  const particles = [];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    t = Math.max(0, Math.min(1, t));
    return 'rgb(' + c1.map((v, i) => Math.round(lerp(v, c2[i], t))).join(',') + ')';
  }
  function skyColors(alt) {
    const a = Math.max(0, alt);
    if (a < 12000) { const t = a / 12000; return [mix([120, 190, 245], [50, 105, 190], t), mix([190, 225, 250], [90, 150, 220], t)]; }
    if (a < 30000) { const t = (a - 12000) / 18000; return [mix([50, 105, 190], [10, 18, 50], t), mix([90, 150, 220], [30, 50, 110], t)]; }
    const t = Math.min(1, (a - 30000) / 15000);
    return [mix([10, 18, 50], [2, 3, 10], t), mix([30, 50, 110], [6, 8, 22], t)];
  }

  function fmtDist(m) {
    if (!isFinite(m)) return '∞';
    if (Math.abs(m) >= 10000) return (m / 1000).toFixed(1) + ' km';
    return Math.round(m).toLocaleString('ko-KR') + ' m';
  }

  // ── 비행 화면 ──
  function drawFlight(ctx, W, H, rk, dtReal) {
    const alt = rk.alt, up = rk.up;
    const scale = Math.max(5, Math.min(14, H / 34)); // px/m
    const cx = W / 2, cy = H * 0.52;

    const [top, bottom] = skyColors(alt);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 별
    const sa = Math.max(0, Math.min(1, (alt - 18000) / 22000));
    if (sa > 0) {
      ctx.fillStyle = '#fff';
      const shift = (up * 600) % 1;
      for (const s of stars) {
        ctx.globalAlpha = s.a * sa;
        const x = ((s.x + shift + 1) % 1) * W;
        ctx.fillRect(x, s.y * H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    // 월드 → 화면 (로켓 기준, 위쪽 = 행성 반지름 방향)
    const cosU = Math.cos(up), sinU = Math.sin(up);
    function toScreen(wx, wy) {
      const dx = wx - rk.x, dy = wy - rk.y;
      const east = dx * sinU - dy * cosU;      // 접선(동쪽)
      const north = dx * cosU + dy * sinU;     // 반지름(위)
      return [cx + east * scale, cy - north * scale];
    }

    // 구름
    if (alt < 9000) {
      for (const c of clouds) {
        const cr = PLANET.R + c.alt;
        const [sx, sy] = toScreen(Math.cos(c.ang) * cr, Math.sin(c.ang) * cr);
        if (sx < -c.w * scale || sx > W + c.w * scale || sy < -200 || sy > H + 200) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        const w = c.w * scale * 0.1;
        ctx.beginPath();
        ctx.ellipse(sx, sy, w, w * 0.3, 0, 0, Math.PI * 2);
        ctx.ellipse(sx + w * 0.4, sy - w * 0.15, w * 0.5, w * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 지면 (곡률이 작아 평평하게 근사)
    const groundY = cy + alt * scale;
    if (groundY < H + 10) {
      const gg = ctx.createLinearGradient(0, groundY, 0, groundY + 120);
      gg.addColorStop(0, '#4f9a4a'); gg.addColorStop(0.15, '#3d7a3a'); gg.addColorStop(1, '#2a4a26');
      ctx.fillStyle = gg; ctx.fillRect(0, groundY, W, H - groundY + 10);
      // 발사대
      const padAng = wrap(up - Math.PI / 2);
      const padX = cx + padAng * PLANET.R * scale; // 동쪽으로 날아가면 발사대는 왼쪽(서쪽)
      if (padX > -200 && padX < W + 200) {
        ctx.fillStyle = '#6b6f7a'; ctx.fillRect(padX - 4 * scale, groundY - 0.6 * scale, 8 * scale, 0.6 * scale);
        ctx.fillStyle = '#9aa0ad';
        ctx.fillRect(padX - 3.2 * scale, groundY - 16 * scale, 0.5 * scale, 15.4 * scale);
        for (let i = 0; i < 8; i++) ctx.fillRect(padX - 3.2 * scale, groundY - (2 + i * 1.8) * scale, 1.6 * scale, 0.15 * scale);
      }
      // 움직임이 느껴지도록 나무를 60 m 간격으로 배치
      for (let k = -30; k <= 30; k++) {
        const dist = (Math.round(-padAng * PLANET.R / 60) + k) * 60; // 발사장으로부터 동쪽 거리
        const sx = padX + dist * scale;
        if (sx < -20 || sx > W + 20 || Math.abs(dist) < 15) continue;
        const hh = (2.5 + (Math.abs(dist * 7919) % 3)) * scale;
        ctx.fillStyle = '#2f5d2c';
        ctx.beginPath(); ctx.moveTo(sx, groundY - hh); ctx.lineTo(sx + hh * 0.35, groundY); ctx.lineTo(sx - hh * 0.35, groundY); ctx.fill();
      }
    }

    // 떨어져 나간 단
    for (const d of rk.debris) {
      const [sx, sy] = toScreen(d.x, d.y);
      if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-(d.att - up)); ctx.scale(scale, scale);
      drawStack(ctx, d.ids);
      ctx.restore();
    }

    // 배기 입자
    const tilt = rk.att - up;
    const rho = alt < PLANET.atm ? 1 - alt / PLANET.atm : 0;
    if (rk.thrustNow > 0) {
      const n = Math.min(6, 1 + Math.round(rk.thrustNow / 60000));
      for (let i = 0; i < n; i++) {
        const sp = 20 + Math.random() * 20;
        const a = Math.PI + (Math.random() - 0.5) * (0.3 + (1 - rho) * 0.9);
        particles.push({
          x: rk.x, y: rk.y,
          vx: rk.vx * 0.95 + Math.cos(rk.att + a) * sp, vy: rk.vy * 0.95 + Math.sin(rk.att + a) * sp,
          life: 1.2 + Math.random() * 1.2 * rho, max: 2.4, smoke: rho > 0.05,
        });
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dtReal; p.y += p.vy * dtReal; p.life -= dtReal;
      if (p.life <= 0 || particles.length > 600) { particles.splice(i, 1); continue; }
      const [sx, sy] = toScreen(p.x, p.y);
      if (sy > groundY) continue;
      const age = 1 - p.life / p.max;
      ctx.fillStyle = p.smoke ? 'rgba(235,235,240,' + (0.35 * (1 - age)) + ')' : 'rgba(255,190,110,' + (0.4 * (1 - age)) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, (0.5 + age * 2.2) * scale, 0, Math.PI * 2); ctx.fill();
    }

    // 로켓 (tilt = 0 이면 똑바로 위, +면 서쪽/왼쪽으로 기울어짐)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-tilt);
    ctx.scale(scale, scale);
    // 불꽃
    if (rk.thrustNow > 0) {
      const len = 2.5 + rk.thrustNow / 40000 + Math.random() * 1.2;
      const wid = 0.45 + (1 - rho) * 0.6;
      const fg = ctx.createLinearGradient(0, 0, 0, len);
      fg.addColorStop(0, 'rgba(255,255,230,1)'); fg.addColorStop(0.3, 'rgba(255,190,80,.95)'); fg.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(-wid, 0); ctx.quadraticCurveTo(-wid * 1.4, len * 0.4, 0, len); ctx.quadraticCurveTo(wid * 1.4, len * 0.4, wid, 0); ctx.fill();
    }
    // 낙하산
    if (rk.chute === 'open') {
      const hTop = -rk.height;
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(0, hTop); ctx.lineTo(-4, hTop - 6); ctx.moveTo(0, hTop); ctx.lineTo(4, hTop - 6); ctx.stroke();
      ctx.fillStyle = '#e8483f';
      ctx.beginPath(); ctx.moveTo(-4.4, hTop - 6); ctx.quadraticCurveTo(0, hTop - 12, 4.4, hTop - 6); ctx.quadraticCurveTo(0, hTop - 7.5, -4.4, hTop - 6); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-1, hTop - 8.6); ctx.quadraticCurveTo(0, hTop - 9.2, 1, hTop - 8.6); ctx.lineTo(0.6, hTop - 6.8); ctx.lineTo(-0.6, hTop - 6.8); ctx.fill();
    }
    const fuelFrac = rk.stageFuelFrac;
    const activeLen = rk.active ? rk.active.ids.length : 0;
    drawStack(ctx, rk.ids, {
      partOpt: i => ({ fuelFrac: i >= rk.ids.length - activeLen ? fuelFrac : 1, chuteUsed: rk.chute === 'open' }),
    });
    if (rk.state === 'crashed') {
      ctx.fillStyle = 'rgba(255,120,40,.85)';
      ctx.beginPath(); ctx.arc(0, -rk.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 고도 눈금
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '11px system-ui, sans-serif';
    const tick = niceStep(H / scale / 4);
    const first = Math.ceil((alt - (H - cy) / scale) / tick) * tick;
    for (let a = first; a < alt + cy / scale; a += tick) {
      if (a < 0) continue;
      const sy = cy - (a - alt) * scale;
      if (sy < 140 || sy > H - 260) continue;
      const label = Math.round(a).toLocaleString('ko-KR') + ' m';
      ctx.fillRect(W - 22, sy, 14, 1);
      ctx.fillText(label, W - 26 - ctx.measureText(label).width, sy + 4);
    }
  }

  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  // ── 지도 화면 ──
  function drawMap(ctx, W, H, rk, view) {
    ctx.fillStyle = '#03050d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    for (const s of stars) { ctx.globalAlpha = s.a * 0.6; ctx.fillRect(s.x * W, s.y * H, s.r, s.r); }
    ctx.globalAlpha = 1;

    const ob = rk.orbit();
    let extent = PLANET.R * 1.5;
    if (!ob.escape && isFinite(ob.ap)) extent = Math.max(extent, (ob.ap + PLANET.R) * 1.15);
    else extent = Math.max(extent, Math.hypot(rk.x, rk.y) * 1.3);
    extent = Math.min(extent, PLANET.R * 12) * (view.zoom || 1);
    const s = Math.min(W, H * 0.8) / 2 / extent;
    const cx = W / 2, cy = H * 0.52;
    const P = (x, y) => [cx + x * s, cy - y * s];

    // 대기권
    ctx.fillStyle = 'rgba(90,160,255,.18)';
    ctx.beginPath(); ctx.arc(cx, cy, (PLANET.R + PLANET.atm) * s, 0, Math.PI * 2); ctx.fill();
    // 궤도
    ctx.strokeStyle = '#5ab0ff'; ctx.lineWidth = 2;
    ctx.beginPath();
    const dir = ob.h >= 0 ? 1 : -1;
    let started = false;
    const nuMax = ob.e < 1 ? Math.PI : Math.acos(-1 / ob.e) - 0.02;
    for (let i = 0; i <= 360; i++) {
      const nu = -nuMax + (2 * nuMax * i) / 360;
      const r = ob.p / (1 + ob.e * Math.cos(nu));
      if (r <= 0 || r > extent * 3) { started = false; continue; }
      const ang = ob.omega + dir * nu;
      const [px, py] = P(r * Math.cos(ang), r * Math.sin(ang));
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    if (rk.lifted) ctx.stroke();

    // 행성
    const pg = ctx.createRadialGradient(cx - PLANET.R * s * 0.3, cy - PLANET.R * s * 0.3, PLANET.R * s * 0.1, cx, cy, PLANET.R * s);
    pg.addColorStop(0, '#5fb36a'); pg.addColorStop(0.6, '#2f7d5a'); pg.addColorStop(1, '#1d4a5e');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, PLANET.R * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40,110,190,.55)';
    [[0.3, -0.2, 0.35], [-0.35, 0.3, 0.28], [0.1, 0.55, 0.2], [-0.2, -0.5, 0.25]].forEach(([a, b, r]) => {
      ctx.beginPath(); ctx.arc(cx + a * PLANET.R * s, cy + b * PLANET.R * s, r * PLANET.R * s, 0, Math.PI * 2); ctx.fill();
    });
    // 발사장
    const [lx, ly] = P(0, PLANET.R);
    ctx.fillStyle = '#ffd166'; ctx.fillRect(lx - 2, ly - 2, 4, 4);

    // 원지점/근지점 표시
    ctx.font = 'bold 12px system-ui, sans-serif';
    if (rk.lifted) {
      const mark = (nu, label, value, color) => {
        const r = ob.p / (1 + ob.e * Math.cos(nu));
        const ang = ob.omega + dir * nu;
        const [px, py] = P(r * Math.cos(ang), r * Math.sin(ang));
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label + ' ' + fmtDist(value), px + 8, py - 6);
      };
      if (ob.pe > 0) mark(0, '근', ob.pe, '#ff9f5a');
      if (ob.e < 1) mark(Math.PI, '원', ob.ap, '#7fd0ff');
    }
    // 로켓
    const [rx, ry] = P(rk.x, rk.y);
    ctx.save(); ctx.translate(rx, ry); ctx.rotate(-rk.att);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '12px system-ui, sans-serif';
    let msg = '';
    if (!rk.lifted) msg = '로켓이 발사대 위에 있어요.';
    else if (ob.escape) msg = '행성을 탈출하는 궤도예요!';
    else if (ob.pe > PLANET.atm) msg = '🎉 궤도 진입! 근지점이 대기권(45 km) 밖에 있어요.';
    else msg = '근지점을 45 km 위로 올리면 궤도 진입!';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText(msg, W / 2, 150); ctx.textAlign = 'left';
  }

  // ── 자세 표시기 ──
  function drawDial(ctx, rk) {
    const S = ctx.canvas.width, c = S / 2, R = S / 2 - 8;
    ctx.clearRect(0, 0, S, S);
    // 하늘/땅 반원
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2f6fb8'; ctx.fillRect(0, 0, S, c);
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(0, c, S, c);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, c - 1, S, 2);
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('위', c, 26); ctx.font = '15px system-ui'; ctx.fillText('동', S - 18, c - 8); ctx.fillText('서', 18, c - 8);
    // 진행 방향 마커
    if (rk.speed > 3) {
      const pa = wrap(Math.atan2(rk.vy, rk.vx) - rk.up); // 0 = 위, + = 서쪽
      const mx = c - Math.sin(pa) * R * 0.78, my = c - Math.cos(pa) * R * 0.78;
      ctx.strokeStyle = '#7dff9b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my - 9); ctx.lineTo(mx, my - 16); ctx.stroke();
    }
    // 기수 방향
    const t = rk.att - rk.up;
    ctx.save(); ctx.translate(c, c); ctx.rotate(-wrap(t));
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, R * 0.55); ctx.lineTo(0, -R * 0.7); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(0, -R * 0.92); ctx.lineTo(13, -R * 0.62); ctx.lineTo(-13, -R * 0.62); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left';
  }

  global.Render = { drawFlight, drawMap, drawDial, fmtDist };
})(window);
