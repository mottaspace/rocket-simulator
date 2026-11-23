// 3D 조립 화면(격납고): 부품을 골라 쌓고, 측면 부스터를 대칭으로 붙이고, 성능을 확인한 뒤 발사대로 보낸다
import * as THREE from './vendor/three.module.min.js';
import { analyze3d, normalizeDesign, EXAMPLES3D } from './physics3d.js';
import { buildRocket } from './rocketModel.js';

const { PARTS } = window.Parts;
const $ = id => document.getElementById(id);
const fmtN = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
};
const ORBIT_DV = 2700;
const CATS = [
  { name: '지휘·탑재', ids: ['pod', 'chute', 'nose', 'satCom', 'satObs'] },
  { name: '연료', ids: ['tankS', 'tankM', 'tankL'] },
  { name: '엔진', ids: ['engS', 'engL', 'engV', 'srb'] },
  { name: '부스터·구조', ids: ['srbS', 'dec'] },
];
const TOP_KINDS = ['pod', 'chute', 'nose', 'sat'];

export class Builder {
  constructor({ renderer, canvas, getTier, onLaunch, env }) {
    this.renderer = renderer; this.canvas = canvas; this.getTier = getTier; this.onLaunch = onLaunch;
    this.active = true;
    this.design = normalizeDesign(store.get('rocket3d.build', EXAMPLES3D[0].design));
    this.name = store.get('rocket3d.buildName', EXAMPLES3D[0].name);
    this.sel = null;            // { stack: i } | { radial: i }
    this.sym = 2;
    this.cat = 0;

    // 격납고 장면
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0d1117);
    s.environment = env;
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(8, 14, 10); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -15, right: 15, top: 30, bottom: -2, near: 1, far: 60 });
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2); rim.position.set(-10, 6, -8); s.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 64), new THREE.MeshBasicMaterial({ color: 0xffb020 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; s.add(ring);
    const grid = new THREE.GridHelper(28, 28, 0x56606e, 0x2c323b); grid.position.y = 0.005; s.add(grid);
    // 작업대 기둥(크기 비교)
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.7 });
    for (const x of [-6, 6]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 26, 0.3), towerMat); t.position.set(x, 13, -5); s.add(t); }
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.cam = { az: 0.6, el: 0.25, dist: 30 };
    this.rocket = null;
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x5ab0ff); this.selBox.visible = false; s.add(this.selBox);

    this.makeThumbs();
    this.bindUI();
    this.rebuild();
  }

  // 부품 미리보기 그림 (별도 작은 렌더러로 한 번만 그림)
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
      const obj = buildRocket({ stack: [id], radial: [] }, 'high').group;
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
    ex.innerHTML = '<option value="">예제 불러오기</option>' + EXAMPLES3D.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join('');
    ex.onchange = () => { if (ex.value === '') return; const e = EXAMPLES3D[+ex.value]; this.set(JSON.parse(JSON.stringify(e.design)), e.name); ex.value = ''; };
    $('bName').value = this.name;
    $('bName').oninput = () => { this.name = $('bName').value.slice(0, 30); store.set('rocket3d.buildName', this.name); };
    $('bUp').onclick = () => this.move(-1);
    $('bDown').onclick = () => this.move(1);
    $('bDel').onclick = () => this.remove();
    $('bSym').onclick = e => { const b = e.target.closest('button'); if (!b) return; this.setSym(+b.dataset.n); };
    $('bClear').onclick = () => this.set({ stack: [], radial: [] }, '나만의 로켓');
    $('bLaunch').onclick = () => { const a = analyze3d(this.design); if (a.ok) this.onLaunch(JSON.parse(JSON.stringify(this.design)), this.name || '나만의 로켓'); };
    $('bStatsToggle').onclick = () => $('bStats').classList.toggle('mini');
    if (window.innerWidth < 520) $('bStats').classList.add('mini');

    // 시점: 끌기 = 회전, 휠/두 손가락 = 확대, 짧게 누르기 = 부품 선택
    const pts = new Map(); let moved = 0, pinch = 0;
    this.canvas.addEventListener('pointerdown', e => { if (!this.active) return; pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; });
    this.canvas.addEventListener('pointermove', e => {
      if (!this.active || !pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved += Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1]);
      if (pts.size === 1) { this.cam.az -= (e.clientX - p[0]) * 0.008; this.cam.el = Math.max(-0.2, Math.min(1.4, this.cam.el + (e.clientY - p[1]) * 0.006)); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.cam.dist = Math.max(6, Math.min(90, this.cam.dist * pinch / d)); pinch = d; }
    });
    const up = e => { if (!this.active || !pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (moved < 8 && pts.size === 0) this.pick(e); };
    this.canvas.addEventListener('pointerup', up); this.canvas.addEventListener('pointercancel', e => pts.delete(e.pointerId));
    this.canvas.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); this.cam.dist = Math.max(6, Math.min(90, this.cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  }

  renderPalette() {
    const pal = $('bPalette'); pal.innerHTML = '';
    for (const id of CATS[this.cat].ids) {
      const p = PARTS[id], b = document.createElement('button');
      b.className = 'part-card';
      const info = p.thrust ? fmtN(p.thrust / 1000) + ' kN' : p.fuel ? '연료 ' + fmtN(p.fuel) + ' kg' : fmtN(p.mass) + ' kg';
      b.innerHTML = (this.thumbs[id] ? `<img src="${this.thumbs[id]}" alt="" width="48" height="48">` : '') + `<b>${esc(p.short)}</b><small>${info}</small>`;
      b.title = p.desc;
      b.onclick = () => this.add(id);
      pal.appendChild(b);
    }
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
      if (at < 0 || !['tank', 'srb'].includes(PARTS[d.stack[at]].kind)) at = d.stack.map((x, i) => [x, i]).filter(([x]) => PARTS[x].kind === 'tank').map(([, i]) => i).pop() ?? -1;
      if (at < 0) return this.hint('측면 부스터는 연료탱크 옆에 붙어요. 먼저 탱크를 쌓아 주세요.');
      d.radial = d.radial.filter(r => r.at !== at);
      d.radial.push({ at, id, n: this.sym });
      this.sel = { radial: d.radial.length - 1 };
    } else {
      if (d.stack.length >= 24) return this.hint('부품은 24개까지 쌓을 수 있어요.');
      let at;
      if (this.sel && this.sel.stack != null) at = this.sel.stack + 1;
      else at = TOP_KINDS.includes(p.kind) ? 0 : d.stack.length;
      d.stack.splice(at, 0, id);
      d.radial.forEach(r => { if (r.at >= at) r.at++; });
      this.sel = { stack: at };
    }
    this.save(); this.rebuild();
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
  setSym(n) {
    this.sym = n;
    if (this.sel && this.sel.radial != null) { this.design.radial[this.sel.radial].n = n; this.save(); this.rebuild(); }
    else this.updateTools();
  }
  hint(t) { const h = $('bHint'); h.textContent = t; h.classList.add('show'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show'), 2600); }

  pick(e) {
    if (!this.rocket) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.rocket.group, true)[0];
    let s = null;
    if (hit) { let o = hit.object; while (o && o.userData.stack == null && o.userData.radial == null) o = o.parent; if (o) s = o.userData.stack != null ? { stack: o.userData.stack } : { radial: o.userData.radial }; }
    const same = s && this.sel && s.stack === this.sel.stack && s.radial === this.sel.radial;
    this.sel = same ? null : s;
    this.updateSelection(); this.updateTools(); this.renderStats();
  }

  rebuild() {
    if (this.rocket) { this.scene.remove(this.rocket.group); this.rocket.group.traverse(o => o.geometry && o.geometry.dispose()); }
    this.rocket = buildRocket(this.design, this.getTier());
    this.rocket.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.rocket.group);
    const h = Math.max(4, this.rocket.height);
    this.target = new THREE.Vector3(0, h * 0.45, 0);
    this.cam.dist = Math.max(this.cam.dist > 0 && this._lastH === h ? this.cam.dist : 0, h * 1.5 + 8);
    this._lastH = h;
    $('bHintEmpty').hidden = this.design.stack.length > 0;
    this.updateSelection(); this.updateTools(); this.renderStats();
  }

  updateSelection() {
    const part = this.sel && this.rocket.parts.find(p => (this.sel.stack != null && p.stack === this.sel.stack) || (this.sel.radial != null && p.radial === this.sel.radial));
    this.selBox.visible = !!part;
    if (part) { this.rocket.group.updateMatrixWorld(true); this.selBox.box.setFromObject(part.mesh).expandByScalar(0.08); }
  }
  updateTools() {
    const t = $('bTools');
    t.hidden = !this.sel && !CATS[this.cat].ids.includes('srbS');
    const isStack = this.sel && this.sel.stack != null;
    $('bUp').disabled = $('bDown').disabled = !isStack;
    $('bDel').disabled = !this.sel;
    const n = this.sel && this.sel.radial != null ? this.design.radial[this.sel.radial].n : this.sym;
    $('bSym').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n === n));
  }

  renderStats() {
    const a = analyze3d(this.design), d = this.design;
    let html = `<div class="stat-row"><span>총 질량</span><b>${fmtN(a.mass / 1000, 2)} t</b></div>`;
    html += `<div class="stat-row"><span>속도 변화량 Δv</span><b>${fmtN(a.totalDv)} m/s</b></div>`;
    const pct = Math.min(100, a.totalDv / ORBIT_DV * 100);
    html += `<div class="meter"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--go)' : '#ffd166'}"></i></div><div class="muted mini-hide" style="font-size:11px">궤도까지 약 ${fmtN(ORBIT_DV)} m/s</div>`;
    html += '<div class="mini-hide">' + a.stages.map(s => `<div class="stage-card"><div class="t">${s.index}단${s.index === 1 ? ' (먼저 점화)' : ''}${s.sat ? ' · 위성' : ''}${s.boosters ? ' · 부스터 ' + s.boosters + '개' : ''}</div>` +
      (s.sat ? '<div class="stat-row"><span>궤도에서 분리</span></div>' : `<div class="stat-row"><span>Δv</span><b>${fmtN(s.dv)}</b></div><div class="stat-row"><span>추력/무게</span><b style="color:${s.index === 1 && s.thrust && s.twr < 1 ? 'var(--danger)' : 'inherit'}">${s.thrust ? fmtN(s.twr, 2) : '-'}</b></div>`) + '</div>').reverse().join('') + '</div>';
    a.warnings.forEach(w => { html += `<p class="${w.fatal ? 'warn' : 'warn soft'}">⚠ ${esc(w.t)}</p>`; });
    if (a.ok && a.totalDv >= ORBIT_DV) html += '<p class="goodmsg mini-hide">✔ 궤도에 갈 수 있어요!</p>';
    if (this.sel) {
      const id = this.sel.stack != null ? d.stack[this.sel.stack] : d.radial[this.sel.radial].id, p = PARTS[id];
      html += `<p class="sel-info"><b>${esc(p.name)}</b><br>${esc(p.desc)}</p>`;
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
  }
}
