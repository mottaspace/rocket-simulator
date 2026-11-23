/* 화면 흐름, 조립 UI, 비행 조종, 임무, 클라우드 연동 */
(function () {
  'use strict';
  const { PARTS, PALETTE_ORDER, EXAMPLES, analyze, drawPart, drawStack, totalHeight } = window.Parts;
  const { PLANET, Rocket } = window.Physics;
  const { drawFlight, drawMap, drawDial, fmtDist } = window.Render;
  const $ = id => document.getElementById(id);
  const fmtN = (n, d) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ORBIT_DV = 2700;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
  };

  const app = {
    user: null,
    guest: false,
    design: store.get('rocket.design', EXAMPLES[0].parts.slice()),
    designName: store.get('rocket.designName', EXAMPLES[0].name),
    selected: -1,
    rocket: null,
    map: false,
    warpIdx: 0,
    missions: null,
    ended: false,
  };
  const WARPS = [1, 2, 4, 10, 50];

  // ───────── 화면 전환 ─────────
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id === 'buildScreen') requestAnimationFrame(renderBuild);
    if (id === 'flightScreen') resizeWorld();
  }

  // ───────── 시트(팝업) ─────────
  function sheet(html, actions) {
    $('sheetBody').innerHTML = html;
    const box = $('sheetActions'); box.innerHTML = '';
    (actions || [{ label: '닫기' }]).forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label; if (a.primary) b.className = 'primary';
      b.onclick = () => { if (!a.keep) closeSheet(); if (a.fn) a.fn(); };
      box.appendChild(b);
    });
    $('sheetBg').hidden = false;
  }
  function closeSheet() { $('sheetBg').hidden = true; }
  $('sheetBg').addEventListener('click', e => { if (e.target === $('sheetBg') && !app.ended) closeSheet(); });

  // ───────── 로그인 ─────────
  function whenCloud(cb) {
    if (window.Cloud) cb(window.Cloud);
    else window.addEventListener('cloud-ready', () => cb(window.Cloud), { once: true });
  }
  const cloudTimeout = setTimeout(() => {
    if (!window.Cloud) {
      $('loginMsg').textContent = '로그인 서비스를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
      $('guestBtn').hidden = false;
    }
  }, 8000);

  whenCloud(Cloud => {
    clearTimeout(cloudTimeout);
    if (!Cloud.configured) {
      $('loginMsg').textContent = 'Firebase 설정이 아직 없어요 (js/firebase-config.js). 저장 없이 체험할 수 있어요.';
      $('guestBtn').hidden = false;
      $('googleBtn').disabled = true;
      return;
    }
    Cloud.onAuth(user => {
      app.user = user;
      if (user) enterApp();
      else if (!app.guest) { show('loginScreen'); }
    });
  });

  $('googleBtn').onclick = async () => {
    $('loginMsg').textContent = '';
    try { await window.Cloud.signIn(); }
    catch (e) { $('loginMsg').textContent = '로그인에 실패했어요: ' + (e && e.code ? e.code : e); }
  };
  $('guestBtn').onclick = () => { app.guest = true; enterApp(); };

  function enterApp() {
    const u = app.user;
    const btn = $('userBtn');
    if (u && u.photoURL) { btn.style.backgroundImage = 'url("' + u.photoURL + '")'; btn.textContent = ''; }
    else { btn.style.backgroundImage = ''; btn.textContent = u ? (u.displayName || '?').slice(0, 1) : '손'; }
    show('buildScreen');
    if (!store.get('rocket.helpSeen', false)) { store.set('rocket.helpSeen', true); showHelp(); }
  }

  $('userBtn').onclick = () => {
    if (!app.user) {
      sheet('<h2>손님 모드</h2><p>Firebase 설정 전이라 기록이 저장되지 않아요.</p>');
      return;
    }
    sheet('<h2>' + esc(app.user.displayName || '우주비행사') + '</h2><p class="muted">' + esc(app.user.email || '') + '</p>', [
      { label: '로그아웃', fn: async () => { await window.Cloud.signOut(); show('loginScreen'); } },
      { label: '닫기', primary: true },
    ]);
  };

  // ───────── 조립 화면 ─────────
  const preview = $('preview');
  let previewLayout = null;

  function buildPalette() {
    const pal = $('palette');
    PALETTE_ORDER.forEach(id => {
      const p = PARTS[id];
      const b = document.createElement('button');
      b.className = 'part-card';
      const c = document.createElement('canvas');
      c.width = 88; c.height = 108;
      const ctx = c.getContext('2d');
      const s = Math.min(70 / 1.6, 92 / Math.max(p.h, 0.8));
      ctx.translate(44, 54 + (p.h * s) / 2); ctx.scale(s, s);
      drawPart(ctx, id);
      b.appendChild(c);
      const info = p.thrust ? fmtN(p.thrust / 1000) + ' kN' : p.fuel ? '연료 ' + fmtN(p.fuel) + ' kg' : fmtN(p.mass) + ' kg';
      b.insertAdjacentHTML('beforeend', '<b>' + p.short + '</b><small>' + info + '</small>');
      b.onclick = () => addPart(id);
      b.title = p.desc;
      pal.appendChild(b);
    });
    const ex = $('example');
    EXAMPLES.forEach((e, i) => ex.insertAdjacentHTML('beforeend', '<option value="' + i + '">' + e.name + '</option>'));
    ex.onchange = () => {
      if (ex.value === '') return;
      const e = EXAMPLES[+ex.value];
      setDesign(e.parts.slice(), e.name);
      ex.value = '';
    };
  }

  function setDesign(parts, name) {
    app.design = parts; app.selected = -1;
    if (name) app.designName = name;
    saveLocal(); renderBuild();
  }
  function saveLocal() { store.set('rocket.design', app.design); store.set('rocket.designName', app.designName); }

  function addPart(id) {
    if (app.design.length >= 24) return toastBuild('부품은 24개까지 쌓을 수 있어요.');
    const at = app.selected >= 0 ? app.selected + 1 : app.design.length;
    app.design.splice(at, 0, id);
    app.selected = at;
    app.designName = '나만의 로켓';
    saveLocal(); renderBuild();
  }
  function toastBuild(msg) { sheet('<p>' + esc(msg) + '</p>'); }

  $('moveUp').onclick = () => { const i = app.selected; if (i > 0) { [app.design[i - 1], app.design[i]] = [app.design[i], app.design[i - 1]]; app.selected--; saveLocal(); renderBuild(); } };
  $('moveDown').onclick = () => { const i = app.selected; if (i >= 0 && i < app.design.length - 1) { [app.design[i + 1], app.design[i]] = [app.design[i], app.design[i + 1]]; app.selected++; saveLocal(); renderBuild(); } };
  $('removePart').onclick = () => { if (app.selected >= 0) { app.design.splice(app.selected, 1); app.selected = Math.min(app.selected, app.design.length - 1); saveLocal(); renderBuild(); } };
  $('clearBtn').onclick = () => sheet('<h2>모두 지울까요?</h2><p>조립 중인 로켓의 부품이 모두 사라져요.</p>', [
    { label: '취소' }, { label: '지우기', primary: true, fn: () => setDesign([], '나만의 로켓') },
  ]);

  preview.addEventListener('click', e => {
    if (!previewLayout) return;
    const r = preview.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const { ox, oy, s, ranges } = previewLayout;
    const wx = (x - ox) / s, wy = (y - oy) / s;
    let hit = -1;
    if (Math.abs(wx) < 1.2) ranges.forEach((rg, i) => { if (wy >= rg[0] && wy <= rg[1]) hit = i; });
    app.selected = hit === app.selected ? -1 : hit;
    renderBuild();
  });

  function renderBuild() {
    const dpr = window.devicePixelRatio || 1;
    const W = preview.clientWidth, H = preview.clientHeight;
    if (!W || !H) return;
    preview.width = W * dpr; preview.height = H * dpr;
    const ctx = preview.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ids = app.design;
    $('previewHint').hidden = ids.length > 0;
    $('partTools').hidden = app.selected < 0;

    // 바닥
    ctx.fillStyle = '#26304f'; ctx.fillRect(0, H - 24, W, 24);
    const th = Math.max(totalHeight(ids), 2);
    const s = Math.min(46, (H - 60) / th, (W - 70) / 3);
    const ox = W / 2, oy = H - 24;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    const ranges = drawStack(ctx, ids, { selected: app.selected });
    ctx.restore();
    previewLayout = { ox, oy, s, ranges };

    // 단 구분 표시
    const segs = window.Parts.splitStages(ids);
    if (segs.length > 1) {
      let idx = ids.length; ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#ffd166';
      segs.forEach((seg, k) => {
        const bottom = idx - 1; idx -= seg.length;
        const y1 = oy + ranges[idx][0] * s, y2 = oy + ranges[bottom][1] * s;
        ctx.fillRect(ox - 1.25 * s - 14, y1 + 2, 3, y2 - y1 - 4);
        ctx.fillText((k + 1) + '단', ox - 1.25 * s - 44, (y1 + y2) / 2 + 4);
      });
    }
    renderStats();
  }

  function renderStats() {
    const a = analyze(app.design);
    let html = '<h3>' + esc(app.designName) + '</h3>';
    html += '<div class="stat-row"><span>총 질량</span><b>' + fmtN(a.mass / 1000, 2) + ' t</b></div>';
    html += '<div class="stat-row"><span>속도 변화량 Δv</span></div><div class="stat-big">' + fmtN(a.totalDv) + ' m/s</div>';
    const pct = Math.min(100, a.totalDv / ORBIT_DV * 100);
    html += '<div class="meter"><i style="width:' + pct + '%;background:' + (pct >= 100 ? 'var(--go)' : '#ffd166') + '"></i></div>';
    html += '<div class="muted" style="font-size:11.5px">궤도까지 약 ' + fmtN(ORBIT_DV) + ' m/s 필요</div><br>';
    a.stages.forEach(st => {
      html += '<div class="stage-card"><div class="t">' + st.index + '단' + (st.index === 1 ? ' (먼저 점화)' : '') + '</div>' +
        '<div class="stat-row"><span>Δv</span><b>' + fmtN(st.dv) + '</b></div>' +
        '<div class="stat-row"><span>추력/무게</span><b style="color:' + (st.info.thrust && st.twr < 1 && st.index === 1 ? 'var(--danger)' : 'inherit') + '">' + (st.info.thrust ? fmtN(st.twr, 2) : '-') + '</b></div>' +
        '<div class="stat-row"><span>연소</span><b>' + (st.burn ? fmtN(st.burn) + '초' : '-') + '</b></div></div>';
    });
    a.warnings.forEach(w => { html += '<p class="warn">⚠ ' + esc(w) + '</p>'; });
    if (a.ok && a.totalDv >= ORBIT_DV) html += '<p class="goodmsg">✔ 궤도에 갈 수 있을 만큼 연료가 충분해요!</p>';
    if (app.selected >= 0) { const p = PARTS[app.design[app.selected]]; html += '<hr style="border-color:var(--line)"><b>' + p.name + '</b><p class="muted" style="font-size:12px;margin:4px 0">' + p.desc + '</p>'; }
    $('stats').innerHTML = html;
    $('toPadBtn').disabled = !a.ok;
  }

  $('toPadBtn').onclick = () => startFlight();
  $('helpBtn').onclick = () => showHelp();

  function showHelp() {
    sheet(
      '<h2>🚀 로켓 발사 체험 안내</h2>' +
      '<p><b>1. 조립</b> — 아래 부품을 누르면 로켓이 쌓여요. 맨 위에 <b>낙하산·캡슐</b>, 그 아래 <b>연료탱크</b>, 맨 아래 <b>엔진</b>! 부품을 눌러 선택하면 옮기거나 지울 수 있어요. <b>분리기</b>로 여러 단을 만들 수 있어요.</p>' +
      '<p><b>2. 발사</b> — 큰 주황 버튼을 누르면 점화! 연료가 떨어지면 다시 눌러 <b>단 분리</b>.</p>' +
      '<p><b>3. 궤도에 오르는 법</b></p><ol>' +
      '<li>똑바로 올라가다가 속도가 <b>100 m/s</b> 쯤 되면 ⟳ 버튼으로 살짝 <b>오른쪽(동쪽)</b>으로 기울여요.</li>' +
      '<li><b>진행</b> 버튼을 켜면 로켓이 날아가는 방향을 따라가요(중력 선회).</li>' +
      '<li><b>지도</b>에서 원지점이 <b>60 km</b>를 넘으면 엔진을 꺼요.</li>' +
      '<li>원지점 근처에 도착하면 로켓을 <b>수평(동쪽)</b>으로 눕히고 다시 엔진을 켜요.</li>' +
      '<li>근지점이 <b>45 km</b>보다 높아지면 궤도 진입 성공! 🎉</li></ol>' +
      '<p><b>4. 귀환</b> — 역진행 방향으로 엔진을 켜서 속도를 줄이고, 마지막에 <b>낙하산</b>을 펴요. 12 m/s 이하로 내려오면 무사 귀환!</p>' +
      '<p class="muted">키보드: A/D 회전 · Shift/Ctrl 추력 · Z 최대 · X 끄기 · Space 단 분리 · M 지도</p>',
      [{ label: '알겠어요!', primary: true }]);
  }

  // ───────── 비행 ─────────
  const world = $('world'), wctx = world.getContext('2d');
  const dial = $('dial'), dctx = dial.getContext('2d');
  let W = 0, H = 0, lastT = 0, rafId = 0;

  function resizeWorld() {
    const dpr = window.devicePixelRatio || 1;
    W = world.clientWidth; H = world.clientHeight;
    world.width = W * dpr; world.height = H * dpr;
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => {
    if ($('flightScreen').classList.contains('active')) resizeWorld();
    if ($('buildScreen').classList.contains('active')) renderBuild();
  });

  const MISSIONS = [
    { id: 'lift', name: '이륙하기', test: r => r.lifted },
    { id: 'alt10', name: '고도 10 km 돌파', test: r => r.max.alt >= 10000 },
    { id: 'space', name: '우주 도착 (고도 45 km)', test: r => r.reachedSpace },
    { id: 'orbit', name: '궤도 진입 (근지점 45 km 이상)', test: r => r.orbited },
    { id: 'home', name: '무사 귀환 (낙하산 착륙)', test: r => r.state === 'landed' && r.max.alt > 1000 },
  ];

  function startFlight() {
    app.rocket = new Rocket(app.design);
    app.missions = {};
    app.ended = false; app.saved = false;
    app.map = false; app.warpIdx = 0;
    app.lastEvent = 0;
    $('mapBtn').classList.remove('on');
    setSas('off');
    setThrottle(1);
    show('flightScreen');
    updateMissionPill();
    cancelAnimationFrame(rafId);
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    const dtReal = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const rk = app.rocket;
    if (!$('flightScreen').classList.contains('active') || !rk) return;

    let warp = WARPS[app.warpIdx];
    if (rk.alt < PLANET.atm && warp > 4) warp = 4;
    if (!$('sheetBg').hidden && !app.ended) warp = 0; // 메뉴 열면 일시정지
    if (warp) rk.update(dtReal * warp);

    // 궤도 판정
    const ob = rk.lifted ? rk.orbit() : null;
    if (ob && !ob.escape && ob.ap > rk.max.ap) rk.max.ap = ob.ap;

    if (app.map) drawMap(wctx, W, H, rk, {});
    else drawFlight(wctx, W, H, rk, dtReal * (warp || 0));
    drawDial(dctx, rk);
    updateHud(rk, ob, warp);
    checkMissions(rk);
    flushEvents(rk);

    if ((rk.state === 'landed' || rk.state === 'crashed') && !app.ended) {
      app.ended = true;
      setTimeout(showResult, 1500);
    }
    rafId = requestAnimationFrame(loop);
  }

  function updateHud(rk, ob, warp) {
    $('hAlt').textContent = fmtDist(Math.max(0, rk.alt));
    $('hVel').textContent = fmtN(rk.speed) + ' m/s';
    $('hAp').textContent = ob ? (ob.escape ? '탈출' : fmtDist(ob.ap)) : '-';
    $('hPe').textContent = ob ? (ob.pe < -PLANET.R * 0.9 ? '-' : fmtDist(ob.pe)) : '-';
    $('fuelFill').style.width = (rk.stageFuelFrac * 100) + '%';
    const realWarp = WARPS[app.warpIdx];
    $('warpBtn').textContent = (warp && warp < realWarp ? warp + '×*' : realWarp + '×');
    const act = rk.nextAction;
    const btn = $('stageBtn');
    btn.disabled = act === 'none';
    btn.classList.toggle('chute', act === 'chute');
    btn.textContent = act === 'launch' ? '발사!' : act === 'stage' ? '단 분리' : act === 'chute' ? '낙하산' : rk.chute === 'armed' ? '대기중' : '—';
    let info = '';
    if (act === 'stage') info = '남은 단: ' + rk.segs.length + ' · 추력 ' + fmtN(rk.thrustNow / 1000) + ' kN';
    else if (rk.chute === 'armed') info = '낙하산: 속도 250 m/s 이하·고도 20 km 아래에서 펴져요';
    else if (rk.ignited) info = '수직 속도 ' + fmtN(rk.vertSpeed) + ' m/s';
    else info = '추력을 맞추고 발사 버튼을 누르세요';
    $('stageInfo').textContent = info;
  }

  function checkMissions(rk) {
    let changed = false;
    MISSIONS.forEach(m => {
      if (!app.missions[m.id] && m.test(rk)) { app.missions[m.id] = true; changed = true; toast('임무 완료: ' + m.name); }
    });
    if (changed) updateMissionPill();
  }
  function updateMissionPill() {
    $('missionPill').textContent = '임무 ' + Object.keys(app.missions || {}).length + '/' + MISSIONS.length;
  }
  function flushEvents(rk) {
    while (app.lastEvent < rk.events.length) {
      const e = rk.events[app.lastEvent++];
      if (e.kind !== 'info' || /분리|점화|낙하산/.test(e.text)) toast(e.text, e.kind === 'bad');
    }
  }

  let toastTimer = 0;
  function toast(text, bad) {
    const t = $('toast');
    t.textContent = text; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function missionListHtml() {
    return '<ul class="mlist">' + MISSIONS.map(m => '<li class="' + (app.missions[m.id] ? 'done' : '') + '"><span class="ck">' + (app.missions[m.id] ? '✔' : '') + '</span>' + m.name + '</li>').join('') + '</ul>';
  }
  $('missionPill').onclick = () => sheet('<h2>임무</h2>' + missionListHtml());

  function showResult() {
    const rk = app.rocket;
    const done = Object.keys(app.missions).length;
    const ok = rk.state === 'landed';
    const html = '<h2>' + (ok ? '🎉 무사 귀환!' : '💥 비행 종료') + '</h2>' +
      '<div class="result-grid">' +
      '<div><span>최고 고도</span><b>' + fmtDist(rk.max.alt) + '</b></div>' +
      '<div><span>최고 속도</span><b>' + fmtN(rk.max.vel) + ' m/s</b></div>' +
      '<div><span>비행 시간</span><b>' + fmtN(rk.t) + ' 초</b></div>' +
      '<div><span>임무</span><b>' + done + ' / ' + MISSIONS.length + '</b></div></div>' +
      missionListHtml() + '<p class="muted" id="saveMsg"></p>';
    sheet(html, [
      { label: '조립으로', fn: () => { app.ended = false; show('buildScreen'); } },
      { label: '다시 비행', primary: true, fn: startFlight },
    ]);
    saveFlightRecord();
  }

  async function saveFlightRecord() {
    if (app.saved || !app.user || !window.Cloud) return;
    app.saved = true;
    const rk = app.rocket;
    try {
      await window.Cloud.saveFlight({
        designName: app.designName.slice(0, 40),
        parts: app.design.slice(0, 24),
        maxAlt: Math.round(rk.max.alt),
        maxVel: Math.round(rk.max.vel),
        flightTime: Math.round(rk.t),
        missions: Object.keys(app.missions).length,
        orbit: !!rk.orbited,
        landed: rk.state === 'landed',
      });
      const m = $('saveMsg'); if (m) m.textContent = '☁ 비행 기록이 저장됐어요.';
    } catch (e) {
      const m = $('saveMsg'); if (m) m.textContent = '기록 저장 실패: ' + (e.code || e.message || e);
    }
  }

  // ───────── 비행 조종 ─────────
  $('stageBtn').onclick = () => { if (app.rocket) app.rocket.stage(); };
  $('mapBtn').onclick = () => { app.map = !app.map; $('mapBtn').classList.toggle('on', app.map); };
  $('warpBtn').onclick = () => { app.warpIdx = (app.warpIdx + 1) % WARPS.length; };
  $('menuBtn').onclick = () => sheet('<h2>메뉴</h2>' + missionListHtml(), [
    { label: '조립으로', fn: () => show('buildScreen') },
    { label: '처음부터', fn: startFlight },
    { label: '도움말', fn: showHelp },
    { label: '계속하기', primary: true },
  ]);

  function setSas(mode) {
    if (app.rocket) app.rocket.sas = mode;
    document.querySelectorAll('.sas button').forEach(b => b.classList.toggle('on', b.dataset.sas === mode));
  }
  document.querySelectorAll('.sas button').forEach(b => b.onclick = () => setSas(b.dataset.sas));

  function holdButton(el, val) {
    const on = e => { e.preventDefault(); if (app.rocket) app.rocket.rotInput = val; el.classList.add('held'); try { el.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } };
    const off = () => { if (app.rocket && app.rocket.rotInput === val) app.rocket.rotInput = 0; el.classList.remove('held'); };
    el.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => el.addEventListener(ev, off));
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  holdButton($('rotL'), -1);
  holdButton($('rotR'), 1);

  function setThrottle(v) {
    v = Math.max(0, Math.min(1, v));
    if (app.rocket) app.rocket.throttle = v;
    $('thFill').style.height = (v * 100) + '%';
    $('thKnob').style.bottom = 'calc(' + (v * 100) + '% - ' + (v * 6) + 'px)';
    $('thVal').textContent = Math.round(v * 100) + '%';
  }
  (function throttleDrag() {
    const el = $('throttle');
    const set = e => { const r = el.getBoundingClientRect(); setThrottle(1 - (e.clientY - r.top) / r.height); };
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(e); });
    el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  })();
  $('thMax').onclick = () => setThrottle(1);
  $('thCut').onclick = () => setThrottle(0);

  const keys = {};
  window.addEventListener('keydown', e => {
    if (!$('flightScreen').classList.contains('active') || !app.rocket || e.repeat && e.code === 'Space') return;
    const rk = app.rocket;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') rk.rotInput = -1;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') rk.rotInput = 1;
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowUp') setThrottle(rk.throttle + 0.1);
    else if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'ArrowDown') setThrottle(rk.throttle - 0.1);
    else if (e.code === 'KeyZ') setThrottle(1);
    else if (e.code === 'KeyX') setThrottle(0);
    else if (e.code === 'Space') { e.preventDefault(); rk.stage(); }
    else if (e.code === 'KeyM') $('mapBtn').click();
    keys[e.code] = true;
  });
  window.addEventListener('keyup', e => {
    if (!app.rocket) return;
    if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) app.rocket.rotInput = 0;
  });

  // ───────── 클라우드: 내 로켓 / 순위표 ─────────
  function needLogin() {
    if (app.user && window.Cloud && window.Cloud.configured) return false;
    sheet('<h2>로그인이 필요해요</h2><p>Google로 로그인하면 로켓 설계와 비행 기록을 저장할 수 있어요.</p>');
    return true;
  }

  $('cloudBtn').onclick = async () => {
    if (needLogin()) return;
    sheet('<h2>💾 내 로켓</h2><div class="save-row"><input id="saveName" maxlength="30" value="' + esc(app.designName) + '" aria-label="로켓 이름"><button id="saveDo" class="primary">저장</button></div><div id="designList"><p class="muted">불러오는 중…</p></div>');
    $('saveDo').onclick = async () => {
      const name = ($('saveName').value || '').trim() || '나만의 로켓';
      if (!app.design.length) return;
      try {
        await window.Cloud.saveDesign(name, app.design);
        app.designName = name; saveLocal(); renderBuild();
        loadDesigns();
      } catch (e) { $('designList').innerHTML = '<p class="warn">저장 실패: ' + esc(e.code || e.message) + '</p>'; }
    };
    loadDesigns();
  };

  async function loadDesigns() {
    const box = $('designList'); if (!box) return;
    try {
      const list = await window.Cloud.listDesigns();
      if (!list.length) { box.innerHTML = '<p class="muted">저장한 로켓이 없어요.</p>'; return; }
      box.innerHTML = '';
      list.forEach(d => {
        const row = document.createElement('div'); row.className = 'design-row';
        const dv = analyze(d.parts).totalDv;
        row.innerHTML = '<div class="nm"><b>' + esc(d.name) + '</b><small>부품 ' + d.parts.length + '개 · Δv ' + fmtN(dv) + ' m/s</small></div>';
        const load = document.createElement('button'); load.textContent = '불러오기';
        load.onclick = () => { setDesign(d.parts.filter(id => PARTS[id]), d.name); closeSheet(); };
        const del = document.createElement('button'); del.textContent = '삭제'; del.className = 'danger';
        del.onclick = async () => { await window.Cloud.deleteDesign(d.id); loadDesigns(); };
        row.append(load, del); box.appendChild(row);
      });
    } catch (e) { box.innerHTML = '<p class="warn">불러오기 실패: ' + esc(e.code || e.message) + '</p>'; }
  }

  $('rankBtn').onclick = () => {
    if (needLogin()) return;
    sheet('<h2>🏆 순위표</h2><div class="tabs"><button data-k="maxAlt" class="on">최고 고도</button><button data-k="maxVel">최고 속도</button><button data-k="mine">내 기록</button></div><div id="rankBox"><p class="muted">불러오는 중…</p></div>');
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      loadRank(b.dataset.k);
    });
    loadRank('maxAlt');
  };

  async function loadRank(key) {
    const box = $('rankBox'); box.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      const rows = key === 'mine' ? await window.Cloud.myFlights() : await window.Cloud.topFlights(key);
      if (!rows.length) { box.innerHTML = '<p class="muted">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!</p>'; return; }
      const val = r => key === 'maxVel' ? fmtN(r.maxVel) + ' m/s' : fmtDist(r.maxAlt);
      box.innerHTML = '<table class="rank"><thead><tr><th>#</th><th>' + (key === 'mine' ? '로켓' : '이름') + '</th><th class="n">' + (key === 'maxVel' ? '속도' : '고도') + '</th><th class="n">임무</th></tr></thead><tbody>' +
        rows.map((r, i) => '<tr class="' + (app.user && r.uid === app.user.uid ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(key === 'mine' ? r.designName : r.displayName || '익명') + (r.orbit ? ' 🛰' : '') + '</td><td class="n">' + val(r) + '</td><td class="n">' + r.missions + '/5</td></tr>').join('') +
        '</tbody></table>';
    } catch (e) { box.innerHTML = '<p class="warn">불러오기 실패: ' + esc(e.code || e.message) + '</p>'; }
  }

  // 시작
  buildPalette();
  window.__app = app; // 디버깅용
})();
