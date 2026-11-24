// 3D 조립 화면(격납고): 끌어다 붙이기·탭해서 쌓기, 측면 부스터·날개 대칭, 도색·국기·이름·불꽃, 성능 표
import * as THREE from './vendor/three.module.min.js';
import { analyze3d, normalizeDesign, EXAMPLES3D, REAL_ROCKETS, FLAMES } from './physics3d.js';
import { buildRocket, setFlameType } from './rocketModel.js';
import { FLAGS, flagThumb } from './flags.js';

const { PARTS, CLUSTER_N, WIDTH_OPTS } = window.Parts;
const $ = id => document.getElementById(id);
const fmtN = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
};
const ORBIT_DV = 2700;
const CATS = [
  { name: '지휘·탑재', ids: ['pod', 'chute', 'shield', 'nose', 'fairing', 'satCom', 'satObs'] },
  { name: '연료', ids: ['tankS', 'tankM', 'tankL', 'tankXL'] },
  { name: '엔진', ids: ['engS', 'engL', 'engH', 'engV', 'srb'] },
  { name: '부스터·날개', ids: ['srbS', 'fin', 'dec'] },
  { name: '기발한 부품', ids: ['catPod', 'balloon', 'lab', 'sail', 'ion'] },
  { name: '실제 로켓 부품', ids: ['ssNose', 'les', 'flap', 'gridFin', 'legs', 'boosterCone', 'boosterCore', 'decTruss'] },
];
const TOP_KINDS = ['pod', 'chute', 'nose', 'sat', 'fairing', 'balloon', 'lab', 'sail'];
const COLORS = ['#f1f2f4', '#141518', '#ff7a2e', '#d23b2e', '#1f4fa8', '#2a7fd6', '#36c27a', '#d4a645', '#ffb7c5', '#7a3e9d', '#9aa0aa', '#1c2333'];

export class Builder {
  constructor({ renderer, canvas, getTier, onLaunch, env, sheet }) {
    this.renderer = renderer; this.canvas = canvas; this.getTier = getTier; this.onLaunch = onLaunch; this.sheet = sheet;
    this.active = true;
    this.design = normalizeDesign(store.get('rocket3d.build', EXAMPLES3D[0].design));
    this.name = store.get('rocket3d.buildName', EXAMPLES3D[0].name);
    this.sel = null; this.sym = 2; this.cat = 0;

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0d1117);
    s.environment = env;
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(8, 14, 10); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -15, right: 15, top: 34, bottom: -2, near: 1, far: 70 });
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2); rim.position.set(-10, 6, -8); s.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 64), new THREE.MeshBasicMaterial({ color: 0xffb020 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; s.add(ring);
    const grid = new THREE.GridHelper(28, 28, 0x56606e, 0x2c323b); grid.position.y = 0.005; s.add(grid);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.7 });
    for (const x of [-6, 6]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 30, 0.3), towerMat); t.position.set(x, 15, -5); s.add(t); }
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.cam = { az: 0.6, el: 0.25, dist: 30 };
    this.rocket = null;
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x5ab0ff); this.selBox.visible = false; s.add(this.selBox);
    // 끌어다 놓을 자리 표시 (빛나는 고리 / 상자)
    this.slotRing = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x7dff9b, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.slotRing.visible = false; s.add(this.slotRing);
    this.slotBox = new THREE.Box3Helper(new THREE.Box3(), 0x7dff9b); this.slotBox.visible = false; s.add(this.slotBox);

    this.makeThumbs();
    this.bindUI();
    this.rebuild();
  }

  makeThumbs() {
    this.thumbs = {};
    let r;
    try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return; }
    r.setSize(96, 96); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const sc = new THREE.Scene(); sc.environment = this.scene.environment;
    sc.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.0));
    const l = new THREE.DirectionalLight(0xffffff, 2.5); l.position.set(3, 5, 4); sc.add(l);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    for (const id of Object.keys(PARTS)) {
      if (PARTS[id].hidden) continue;
      const k = PARTS[id].kind;
      const d = k === 'fin' ? { stack: ['tankS'], radial: [{ at: 0, id, n: 3 }] } : k === 'fairing' ? { stack: ['fairing', 'satCom'], radial: [] } : { stack: [id], radial: [] };
      const obj = buildRocket(d, 'high').group;
      sc.add(obj);
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const dist = Math.max(size.y, size.x * 1.2, 1.2) / (2 * Math.tan(15 * Math.PI / 180)) * 1.15;
      cam.position.set(c.x + dist * 0.55, c.y + dist * 0.25, c.z + dist * 0.8); cam.lookAt(c);
      r.render(sc, cam);
      this.thumbs[id] = r.domElement.toDataURL();
      sc.remove(obj);
    }
    r.dispose(); r.forceContextLoss();
  }

  bindUI() {
    const tabs = $('bTabs');
    tabs.innerHTML = CATS.map((c, i) => `<button data-c="${i}" class="${i === this.cat ? 'on' : ''}">${c.name}</button>`).join('');
    tabs.onclick = e => { const b = e.target.closest('button'); if (!b) return; this.cat = +b.dataset.c; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderPalette(); };
    this.renderPalette();
    const ex = $('bExample');
    ex.innerHTML = '<option value="">예제 불러오기</option><optgroup label="🚀 실제 로켓">' + REAL_ROCKETS.map((e, i) => `<option value="r${i}">${esc(e.name)}</option>`).join('') + '</optgroup><optgroup label="연습용 예제">' +
      EXAMPLES3D.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join('') + '</optgroup>';
    ex.onchange = () => {
      if (ex.value === '') return;
      if (ex.value[0] === 'r') { const e = REAL_ROCKETS[+ex.value.slice(1)]; this.set(JSON.parse(JSON.stringify(e.design)), e.name); this.showReal(e); }
      else { const e = EXAMPLES3D[+ex.value]; this.set(JSON.parse(JSON.stringify(e.design)), e.name); }
      ex.value = '';
    };
    $('bName').value = this.name;
    $('bName').oninput = () => { this.name = $('bName').value.slice(0, 30); store.set('rocket3d.buildName', this.name); clearTimeout(this._nt); this._nt = setTimeout(() => this.rebuild(), 400); };
    $('bUp').onclick = () => this.move(-1);
    $('bDown').onclick = () => this.move(1);
    $('bDel').onclick = () => this.remove();
    $('bCluster').onclick = () => this.openCluster();
    $('bWidth').onclick = () => this.openWidth();
    $('bSym').onclick = e => { const b = e.target.closest('button'); if (!b) return; this.setSym(+b.dataset.n); };
    $('bClear').onclick = () => this.set({ stack: [], radial: [], livery: this.design.livery, flame: this.design.flame }, '나만의 로켓');
    $('bLaunch').onclick = () => { const a = analyze3d(this.design); if (a.ok) this.onLaunch(JSON.parse(JSON.stringify(this.design)), this.name || '나만의 로켓'); };
    $('bStatsToggle').onclick = () => $('bStats').classList.toggle('mini');
    $('bStyle').onclick = () => this.openStyle();
    if (window.innerWidth < 520) $('bStats').classList.add('mini');

    // 3D 화면: 끌기 = 회전, 두 손가락/휠 = 확대, 짧게 누르기 = 선택, 선택한 부품을 끌기 = 옮기기
    const pts = new Map(); let moved = 0, pinch = 0, partDrag = null;
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.active) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
      const hit = this.hitPart(e.clientX, e.clientY);
      partDrag = hit && this.sel && hit.stack === this.sel.stack && hit.radial === this.sel.radial ? { from: hit } : null;
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this.active || !pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved += Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1]);
      if (partDrag && moved > 8) { this.showSlot(this.slotAt(e.clientX, e.clientY, partDrag.from.radial != null ? this.design.radial[partDrag.from.radial].id : null)); return; }
      if (pts.size === 1) { this.cam.az -= (e.clientX - p[0]) * 0.008; this.cam.el = Math.max(-0.2, Math.min(1.4, this.cam.el + (e.clientY - p[1]) * 0.006)); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.cam.dist = Math.max(6, Math.min(110, this.cam.dist * pinch / d)); pinch = d; }
    });
    const up = e => {
      if (!this.active || !pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
      if (partDrag && moved > 8) { this.dropMove(partDrag.from, this.slotAt(e.clientX, e.clientY, partDrag.from.radial != null ? this.design.radial[partDrag.from.radial].id : null)); partDrag = null; this.showSlot(null); return; }
      partDrag = null;
      if (moved < 8 && pts.size === 0) this.pick(e);
    };
    this.canvas.addEventListener('pointerup', up); this.canvas.addEventListener('pointercancel', e => { pts.delete(e.pointerId); partDrag = null; this.showSlot(null); });
    this.canvas.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); this.cam.dist = Math.max(6, Math.min(110, this.cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  }

  renderPalette() {
    const pal = $('bPalette'); pal.innerHTML = '';
    for (const id of CATS[this.cat].ids) {
      const p = PARTS[id], b = document.createElement('button');
      b.className = 'part-card';
      const info = p.thrust ? fmtN(p.thrust / 1000) + ' kN' : p.fuel ? '연료 ' + fmtN(p.fuel) + ' kg' : fmtN(p.mass) + ' kg';
      b.innerHTML = (this.thumbs[id] ? `<img src="${this.thumbs[id]}" alt="" width="48" height="48" draggable="false">` : '') + `<b>${esc(p.short)}</b><small>${info}</small>`;
      b.title = p.desc;
      this.bindCardDrag(b, id);
      pal.appendChild(b);
    }
  }

  // 부품 카드: 짧게 누르면 쌓기, 위로 끌면 원하는 자리에 붙이기
  bindCardDrag(card, id) {
    let start = null, ghost = null, slot = null;
    card.addEventListener('pointerdown', e => { start = [e.clientX, e.clientY, e.pointerId]; });
    card.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start[2]) return;
      const dx = e.clientX - start[0], dy = e.clientY - start[1];
      if (!ghost && dy < -14 && Math.abs(dy) > Math.abs(dx)) {
        card.setPointerCapture(e.pointerId);
        ghost = document.createElement('img'); ghost.className = 'drag-ghost'; ghost.src = this.thumbs[id] || ''; document.body.appendChild(ghost);
      }
      if (ghost) {
        e.preventDefault();
        ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
        const r = this.canvas.getBoundingClientRect(), over = e.clientY < $('bPalette').getBoundingClientRect().top - 10 && e.clientY > r.top;
        slot = over ? this.slotAt(e.clientX, e.clientY, PARTS[id].radial ? id : null) : null;
        this.showSlot(slot);
      }
    });
    const end = e => {
      if (!start || e.pointerId !== start[2]) return;
      if (ghost) { ghost.remove(); ghost = null; this.showSlot(null); if (slot) this.dropNew(id, slot); slot = null; }
      else if (e.type === 'pointerup') this.add(id);
      start = null;
    };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  }

  hitPart(x, y) {
    if (!this.rocket) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.rocket.group, true)[0];
    if (!hit) return null;
    let o = hit.object; while (o && o.userData.stack == null && o.userData.radial == null) o = o.parent;
    return o ? (o.userData.stack != null ? { stack: o.userData.stack } : { radial: o.userData.radial }) : null;
  }
  screenY(yWorld) { const v = new THREE.Vector3(0, yWorld, 0).project(this.camera), r = this.canvas.getBoundingClientRect(); return r.top + (1 - v.y) / 2 * r.height; }
  partBottom(i) { const p = this.rocket.parts.find(q => q.stack === i); return p ? p.mesh.position.y : 0; }

  // 화면 좌표 → 붙일 자리: { insert: k } (k번째 앞) 또는 { radial: 스택 인덱스 }
  slotAt(x, y, radialId) {
    const st = this.design.stack;
    if (radialId) {
      const h = this.hitPart(x, y);
      let at = h && h.stack != null ? h.stack : -1;
      if (at < 0) { let best = 1e9; st.forEach((_, i) => { const yb = this.screenY(this.partBottom(i) + PARTS[st[i]].h / 2), d = Math.abs(yb - y); if (d < best) { best = d; at = i; } }); }
      if (at < 0) return null;
      if (PARTS[radialId].kind !== 'fin' && !['tank', 'srb'].includes(PARTS[st[at]].kind)) return null;
      return { radial: at };
    }
    if (!st.length) return { insert: 0 };
    let best = 1e9, k = 0;
    for (let i = 0; i <= st.length; i++) {
      const yw = i === 0 ? this.rocket.height : this.partBottom(i - 1), d = Math.abs(this.screenY(yw) - y);
      if (d < best) { best = d; k = i; }
    }
    return { insert: k };
  }
  showSlot(slot) {
    this.slotRing.visible = !!slot && slot.insert != null;
    this.slotBox.visible = !!slot && slot.radial != null;
    if (!slot) return;
    if (slot.insert != null) { const st = this.design.stack; this.slotRing.position.y = !st.length ? 0.05 : slot.insert === 0 ? this.rocket.height : this.partBottom(slot.insert - 1); }
    else { const p = this.rocket.parts.find(q => q.stack === slot.radial); if (p) { this.rocket.group.updateMatrixWorld(true); this.slotBox.box.setFromObject(p.mesh).expandByScalar(0.5); } }
  }

  dropNew(id, slot) {
    const d = this.design;
    if (slot.radial != null) { d.radial = d.radial.filter(r => !(r.at === slot.radial && r.id === id)); d.radial.push({ at: slot.radial, id, n: this.sym }); this.sel = { radial: d.radial.length - 1 }; }
    else {
      if (d.stack.length >= 28) return this.hint('부품은 28개까지 쌓을 수 있어요.');
      d.stack.splice(slot.insert, 0, id); d.radial.forEach(r => { if (r.at >= slot.insert) r.at++; }); this.sel = { stack: slot.insert };
    }
    this.save(); this.rebuild();
  }
  dropMove(from, slot) {
    const d = this.design;
    if (!slot) return;
    if (from.radial != null && slot.radial != null) { d.radial[from.radial].at = slot.radial; this.sel = { radial: from.radial }; }
    else if (from.stack != null && slot.insert != null) {
      const i = from.stack; let k = slot.insert; if (k === i || k === i + 1) return;
      const [id] = d.stack.splice(i, 1);
      const idxMap = []; for (let j = 0; j < d.stack.length + 1; j++) idxMap.push(j);
      if (k > i) k--;
      d.stack.splice(k, 0, id);
      // 측면 부품 인덱스 다시 계산
      d.radial.forEach(r => { let a = r.at; if (a === i) a = k; else { if (a > i) a--; if (a >= k) a++; } r.at = a; });
      this.sel = { stack: k };
    } else return;
    this.save(); this.rebuild();
  }

  set(design, name) {
    this.design = normalizeDesign(design); this.sel = null;
    if (name != null) { this.name = name; $('bName').value = name; store.set('rocket3d.buildName', name); }
    this.save(); this.rebuild();
  }
  save() { store.set('rocket3d.build', this.design); }

  add(id) {
    const d = this.design, p = PARTS[id];
    if (p.radial) {
      let at = this.sel && this.sel.stack != null ? this.sel.stack : -1;
      const ok = i => i >= 0 && (p.kind === 'fin' || ['tank', 'srb'].includes(PARTS[d.stack[i]].kind));
      if (!ok(at)) at = p.kind === 'fin' ? d.stack.length - 1 : d.stack.map((x, i) => [x, i]).filter(([x]) => PARTS[x].kind === 'tank').map(([, i]) => i).pop() ?? -1;
      if (!ok(at)) return this.hint(p.kind === 'fin' ? '먼저 로켓을 쌓아 주세요.' : '측면 부스터는 연료탱크 옆에 붙어요. 먼저 탱크를 쌓아 주세요.');
      d.radial = d.radial.filter(r => !(r.at === at && r.id === id));
      d.radial.push({ at, id, n: this.sym });
      this.sel = { radial: d.radial.length - 1 };
    } else {
      if (d.stack.length >= 28) return this.hint('부품은 28개까지 쌓을 수 있어요.');
      const at = this.sel && this.sel.stack != null ? this.sel.stack + 1 : TOP_KINDS.includes(p.kind) ? 0 : d.stack.length;
      d.stack.splice(at, 0, id);
      d.radial.forEach(r => { if (r.at >= at) r.at++; });
      this.sel = { stack: at };
    }
    this.save(); this.rebuild();
    this.hint('💡 부품 카드를 위로 끌어서 원하는 자리에 놓을 수도 있어요', true);
  }
  move(dir) {
    const d = this.design, i = this.sel && this.sel.stack;
    if (i == null) return;
    const j = i + dir; if (j < 0 || j >= d.stack.length) return;
    [d.stack[i], d.stack[j]] = [d.stack[j], d.stack[i]];
    d.radial.forEach(r => { if (r.at === i) r.at = j; else if (r.at === j) r.at = i; });
    this.sel = { stack: j }; this.save(); this.rebuild();
  }
  remove() {
    const d = this.design;
    if (!this.sel) return;
    if (this.sel.radial != null) d.radial.splice(this.sel.radial, 1);
    else { const i = this.sel.stack; d.stack.splice(i, 1); d.radial = d.radial.filter(r => r.at !== i).map(r => ({ ...r, at: r.at > i ? r.at - 1 : r.at })); }
    this.sel = null; this.save(); this.rebuild();
  }
  // 실제 로켓 소개 카드
  showReal(e) {
    const f = e.facts, row = (k, v) => `<div><span>${k}</span><b>${esc(v)}</b></div>`;
    this.sheet('<h2>🚀 ' + esc(e.name) + '</h2><div class="bench-grid">' + row('나라', f.country) + row('첫 발사', f.first) + row('높이', f.height) + row('구성', f.stages) + '</div>' +
      '<p><b>엔진</b> ' + esc(f.engines) + '</p><p class="fact">💡 ' + esc(e.story) + '</p>' +
      '<p class="muted">게임의 지구는 실제의 1/16 크기라서 로켓의 크기와 힘도 줄였어요. 단 구성·엔진 수·모양은 실제를 닮게 만들었어요. 부품을 바꿔 나만의 로켓으로 고쳐 볼 수도 있어요.</p>',
      [{ label: '조립 화면에서 보기' }, { label: '발사대로 ▶', primary: true, fn: () => { const a = analyze3d(this.design); if (a.ok) this.onLaunch(JSON.parse(JSON.stringify(this.design)), this.name); } }]);
  }

  // 선택한 엔진을 여러 개 묶기 (클러스터)
  selEngine() {
    const i = this.sel && this.sel.stack; if (i == null) return null;
    const id = this.design.stack[i], p = PARTS[id]; if (!p || p.kind !== 'engine' || p.ion) return null;
    return { i, id, base: p.base || id, n: p.cluster || 1 };
  }
  openCluster() {
    const e = this.selEngine(); if (!e) return;
    const NOTE = { 1: '하나만', 2: '나란히', 3: '세모', 4: '네모 · 누리호', 5: '새턴 5 1단', 7: '가운데+6', 9: '팰컨 9 1단', 30: 'N1 1단', 33: '슈퍼 헤비' };
    const html = '<h2>🔥 엔진 묶기 (클러스터)</h2><p class="muted">' + esc(PARTS[e.base].short) + '을(를) 몇 개 묶을까요? 힘과 무게가 개수만큼 늘어나요.</p><div class="cluster-grid">' +
      CLUSTER_N.map(n => `<button data-n="${n}" class="${n === e.n ? 'on' : ''}"><b>×${n}</b><small>${NOTE[n]}</small></button>`).join('') + '</div>' +
      '<p class="fact">💡 큰 엔진 하나를 새로 만드는 것보다 검증된 엔진 여러 개를 묶는 편이 쉬워요. 누리호 1단도 75톤 엔진 4개를 묶었어요. 대신 엔진이 많을수록 함께 맞춰 움직이기가 어려워요(N1 로켓의 고민).</p>';
    this.sheet(html, [{ label: '닫기' }]);
    $('sheetBody').querySelectorAll('.cluster-grid button').forEach(b => b.onclick = () => {
      const n = +b.dataset.n, cur = this.selEngine(); if (!cur) return;
      this.design.stack[cur.i] = n === 1 ? cur.base : cur.base + 'x' + n;
      $('sheetBody').querySelectorAll('.cluster-grid button').forEach(x => x.classList.toggle('on', x === b));
      this.save(); this.rebuild();
    });
  }

  // 선택한 탱크의 굵기 바꾸기 (원뿔 포함)
  selTank() {
    const i = this.sel && this.sel.stack; if (i == null) return null;
    const id = this.design.stack[i], p = PARTS[id]; if (!p || p.kind !== 'tank') return null;
    return { i, id, base: p.base || id, code: p.widthCode || '10' };
  }
  openWidth() {
    const t = this.selTank(); if (!t) return;
    const label = c => { const [b, w] = c.split('-').map(v => +v / 10); return w ? b + '→' + w : '×' + b; };
    const note = { '08': '가늘게', '10': '기본', '13': '조금 굵게', '16': '굵게 · 새턴 5', '20': '아주 굵게', '13-10': '원뿔', '16-13': '원뿔 · N1', '20-16': '원뿔 · N1 1단', '10-08': '원뿔(가늘게)' };
    const html = '<h2>📏 탱크 굵기</h2><p class="muted">굵게 하면 연료가 부피만큼 더 들어가요. 대신 무겁고 공기저항도 커져요. 엔진·분리기는 굵기에 맞춰 저절로 바뀌어요.</p><div class="cluster-grid">' +
      WIDTH_OPTS.map(c => `<button data-c="${c}" class="${c === t.code ? 'on' : ''}"><b>${label(c)}</b><small>${note[c] || ''}</small></button>`).join('') + '</div>' +
      '<p class="fact">💡 새턴 5 1단은 지름 10 m, 소유즈는 3 m예요. N1은 아래가 넓은 원뿔 모양이라 30개의 엔진을 바닥에 늘어놓을 수 있었어요.</p>';
    this.sheet(html, [{ label: '닫기' }]);
    $('sheetBody').querySelectorAll('.cluster-grid button').forEach(b => b.onclick = () => {
      const cur = this.selTank(); if (!cur) return;
      this.design.stack[cur.i] = b.dataset.c === '10' ? cur.base : cur.base + '@' + b.dataset.c;
      $('sheetBody').querySelectorAll('.cluster-grid button').forEach(x => x.classList.toggle('on', x === b));
      this.save(); this.rebuild();
    });
  }

  setSym(n) {
    this.sym = n;
    if (this.sel && this.sel.radial != null) { this.design.radial[this.sel.radial].n = n; this.save(); this.rebuild(); }
    else this.updateTools();
  }
  hint(t, once) {
    if (once) { if (this._hinted) return; this._hinted = true; }
    const h = $('bHint'); h.textContent = t; h.classList.add('show'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show'), 2600);
  }

  pick(e) {
    const s = this.hitPart(e.clientX, e.clientY);
    const same = s && this.sel && s.stack === this.sel.stack && s.radial === this.sel.radial;
    this.sel = same ? null : s;
    if (this.sel) this.hint('💡 선택한 부품을 끌면 다른 자리로 옮길 수 있어요', false);
    this.updateSelection(); this.updateTools(); this.renderStats();
  }

  // 꾸미기: 색·국기·마크·불꽃·발사 방식
  openStyle() {
    const d = this.design, lv = d.livery;
    const sw = (key) => `<div class="swatches" data-k="${key}">` + COLORS.map(c => `<button style="background:${c}" data-c="${c}" class="${lv[key] === c ? 'on' : ''}" aria-label="${c}"></button>`).join('') + `<input type="color" value="${lv[key]}" data-k="${key}" aria-label="직접 고르기"></div>`;
    const html = '<h2>🎨 로켓 꾸미기</h2>' +
      '<b>몸통 색</b>' + sw('body') + '<b>포인트 색 (띠·날개·글자)</b>' + sw('accent') +
      '<b>깃발</b><div class="flag-grid">' + FLAGS.map(f => `<button data-f="${f.id}" class="${lv.flag === f.id ? 'on' : ''}">${f.id === 'NONE' ? '' : `<img src="${flagThumb(f.id)}" alt="">`}<span>${f.name}</span></button>`).join('') + '</div>' +
      `<b>마크 (이모지나 글자 1~2개)</b><div class="save-row"><input id="sMark" maxlength="4" value="${esc(lv.mark || '')}" placeholder="예: 🐱 🚀 ⭐ 별"></div>` +
      '<b>불꽃 종류</b><div class="flame-list">' + Object.entries(FLAMES).map(([k, f]) => `<label class="${d.flame === k ? 'on' : ''}"><input type="radio" name="flame" value="${k}" ${d.flame === k ? 'checked' : ''}><span class="fdot" style="background:rgb(${f.mid.map(v => Math.round(v * 255)).join(',')})"></span><b>${f.name}</b><small>${f.fact}</small></label>`).join('') + '</div>' +
      '<b>발사 방식</b><div class="flame-list">' +
      `<label class="${d.launch !== 'rail' ? 'on' : ''}"><input type="radio" name="launch" value="pad" ${d.launch !== 'rail' ? 'checked' : ''}><span class="fdot" style="background:#9aa0aa"></span><b>일반 발사대</b><small>엔진 힘만으로 이륙해요.</small></label>` +
      `<label class="${d.launch === 'rail' ? 'on' : ''}"><input type="radio" name="launch" value="rail" ${d.launch === 'rail' ? 'checked' : ''}><span class="fdot" style="background:#5ab0ff"></span><b>⚡ 전자기 사출대</b><small>전자석으로 시속 400 km(110 m/s)까지 밀어 올려 연료를 아껴요. (실험 중인 기술!)</small></label></div>`;
    this.sheet(html, [{ label: '완료', primary: true }]);
    const body = $('sheetBody');
    const apply = () => { this.save(); this.rebuild(); };
    body.querySelectorAll('.swatches').forEach(box => {
      const k = box.dataset.k;
      box.querySelectorAll('button').forEach(b => b.onclick = () => { lv[k] = b.dataset.c; box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); box.querySelector('input').value = b.dataset.c; apply(); });
      box.querySelector('input').oninput = e => { lv[k] = e.target.value; box.querySelectorAll('button').forEach(x => x.classList.remove('on')); apply(); };
    });
    body.querySelectorAll('.flag-grid button').forEach(b => b.onclick = () => { lv.flag = b.dataset.f; body.querySelectorAll('.flag-grid button').forEach(x => x.classList.toggle('on', x === b)); apply(); });
    $('sMark').oninput = e => { lv.mark = [...e.target.value].slice(0, 2).join(''); clearTimeout(this._mt); this._mt = setTimeout(apply, 300); };
    body.querySelectorAll('input[name=flame]').forEach(r => r.onchange = () => { d.flame = r.value; body.querySelectorAll('input[name=flame]').forEach(x => x.parentElement.classList.toggle('on', x.checked)); setFlameType(FLAMES[d.flame]); this.save(); });
    body.querySelectorAll('input[name=launch]').forEach(r => r.onchange = () => { d.launch = r.value; body.querySelectorAll('input[name=launch]').forEach(x => x.parentElement.classList.toggle('on', x.checked)); this.save(); });
  }

  rebuild() {
    if (this.rocket) { this.scene.remove(this.rocket.group); this.rocket.group.traverse(o => o.geometry && o.geometry.dispose()); }
    this.rocket = buildRocket(this.design, this.getTier(), { name: this.name });
    this.scene.add(this.rocket.group);
    const h = Math.max(4, this.rocket.height);
    this.target = new THREE.Vector3(0, h * 0.45, 0);
    if (this._lastH !== h) this.cam.dist = Math.max(14, h * 1.5 + 8);
    this._lastH = h;
    setFlameType(FLAMES[this.design.flame] || FLAMES.kerosene);
    $('bHintEmpty').hidden = this.design.stack.length > 0;
    this.updateSelection(); this.updateTools(); this.renderStats();
  }

  updateSelection() {
    const part = this.sel && this.rocket.parts.find(p => (this.sel.stack != null && p.stack === this.sel.stack) || (this.sel.radial != null && p.radial === this.sel.radial));
    this.selBox.visible = !!part;
    if (part) { this.rocket.group.updateMatrixWorld(true); this.selBox.box.setFromObject(part.mesh).expandByScalar(0.08); }
  }
  updateTools() {
    const isStack = this.sel && this.sel.stack != null;
    $('bUp').disabled = $('bDown').disabled = !isStack;
    $('bDel').disabled = !this.sel;
    const tk = this.selTank(); $('bWidth').hidden = !tk; if (tk) $('bWidth').querySelector('b').textContent = tk.code === '10' ? '×1' : tk.code.includes('-') ? '원뿔' : '×' + (+tk.code / 10);
    const eng = this.selEngine(); $('bCluster').hidden = !eng; if (eng) $('bCluster').querySelector('b').textContent = '×' + eng.n;
    const n = this.sel && this.sel.radial != null ? this.design.radial[this.sel.radial].n : this.sym;
    $('bSym').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n === n));
  }

  renderStats() {
    const a = analyze3d(this.design), d = this.design;
    let html = `<div class="stat-row"><span>총 질량</span><b>${fmtN(a.mass / 1000, 2)} t</b></div>`;
    html += `<div class="stat-row"><span>속도 변화량 Δv</span><b>${fmtN(a.totalDv)} m/s</b></div>`;
    const pct = Math.min(100, a.totalDv / ORBIT_DV * 100);
    html += `<div class="meter"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--go)' : '#ffd166'}"></i></div><div class="muted mini-hide" style="font-size:11px">궤도까지 약 ${fmtN(ORBIT_DV)} m/s</div>`;
    if (a.stages[0]) html += `<div class="stat-row"><span>이륙 추력/무게</span><b style="color:${a.stages[0].twr < 1.25 ? '#ffcf8a' : 'inherit'}">${fmtN(a.stages[0].twr, 2)}</b></div>`;
    html += '<div class="mini-hide">' + a.stages.map(s => `<div class="stage-card"><div class="t">${s.index}단${s.index === 1 ? ' (먼저 점화)' : ''}${s.sat ? ' · 위성' : ''}${s.boosters ? ' · 부스터 ' + s.boosters + '개' : ''}</div>` +
      (s.sat ? '<div class="stat-row"><span>궤도에서 분리</span></div>' : `<div class="stat-row"><span>Δv</span><b>${fmtN(s.dv)}</b></div><div class="stat-row"><span>추력/무게</span><b>${s.thrust ? fmtN(s.twr, 2) : '-'}</b></div>`) + '</div>').reverse().join('') + '</div>';
    a.warnings.forEach(w => { html += `<p class="${w.fatal ? 'warn' : 'warn soft'}">⚠ ${esc(w.t)}</p>`; });
    if (a.ok && a.totalDv >= ORBIT_DV) html += '<p class="goodmsg mini-hide">✔ 궤도에 갈 수 있어요!</p>';
    if (this.sel) {
      const id = this.sel.stack != null ? d.stack[this.sel.stack] : d.radial[this.sel.radial] && d.radial[this.sel.radial].id, p = PARTS[id];
      if (p) html += `<p class="sel-info"><b>${esc(p.name)}</b><br>${esc(p.desc)}</p>`;
    }
    $('bStatsBody').innerHTML = html;
    $('bLaunch').disabled = !a.ok;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update() {
    const c = this.cam, t = this.target;
    this.camera.position.set(t.x + Math.sin(c.az) * Math.cos(c.el) * c.dist, t.y + Math.sin(c.el) * c.dist, t.z + Math.cos(c.az) * Math.cos(c.el) * c.dist);
    this.camera.lookAt(t);
    if (this.selBox.visible) this.updateSelection();
    this.slotRing.material.opacity = 0.55 + 0.35 * Math.sin(performance.now() / 150);
  }
}
