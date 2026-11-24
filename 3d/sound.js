// 발사 소리: 녹음 파일 없이 Web Audio로 합성
//  - 굉음(낮은 우르릉) + 거친 분사음(쉭쉭) + 바람 소리(속도·공기 압력)
//  - 점화·단 분리·폭발 때 '쿵' 소리, 발사 전 카운트다운 음성("십, 구, … 일, 발사!")과 삐 소리
//  - 공기가 옅어지면 소리도 작아지고, 우주에서는 들리지 않아요(소리는 공기가 있어야 전달됨)
export class RocketSound {
  constructor() { this.ctx = null; this.on = true; this.ready = false; }

  // 브라우저 정책상 사용자가 화면을 누른 뒤에만 소리를 낼 수 있음
  unlock() {
    if (!this.on) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // 음성 목록은 늦게 채워질 수 있음 (특히 크롬)
    if ('speechSynthesis' in window && !this._vw) { this._vw = true; speechSynthesis.addEventListener('voiceschanged', () => { this._v = null; this.koVoice(); }); this.koVoice(); }
  }

  noise(sec, brown) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }

  build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    this.white = this.noise(2.5, false); this.brown = this.noise(4, true);
    // 낮은 굉음
    this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; this.rumbleF = lp;
    this.loop(this.brown).connect(lp); lp.connect(this.rumbleG); this.rumbleG.connect(this.master);
    // 거친 분사음 (진폭이 빠르게 출렁여 '타닥타닥' 느낌)
    this.roarG = c.createGain(); this.roarG.gain.value = 0;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6; this.roarF = bp;
    const crackle = c.createGain(); crackle.gain.value = 0.6;
    const lfo = c.createBufferSource(); lfo.buffer = this.brown; lfo.loop = true; lfo.playbackRate.value = 6;
    const lfoG = c.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(crackle.gain); lfo.start();
    this.loop(this.white).connect(bp); bp.connect(crackle); crackle.connect(this.roarG); this.roarG.connect(this.master);
    // 바람 소리
    this.windG = c.createGain(); this.windG.gain.value = 0;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 1.2; this.windF = wf;
    this.loop(this.white).connect(wf); wf.connect(this.windG); this.windG.connect(this.master);
    // 이온 엔진: 작게 웅~ (우주에서도 기체 안에서 들리는 것처럼 아주 작게)
    this.ionO = c.createOscillator(); this.ionO.type = 'sine'; this.ionO.frequency.value = 220;
    this.ionG = c.createGain(); this.ionG.gain.value = 0; this.ionO.connect(this.ionG); this.ionG.connect(this.master); this.ionO.start();
    this.ready = true;
  }

  setOn(v) {
    this.on = v;
    if (!v && this.ctx) this.ctx.suspend();
    if (!v && 'speechSynthesis' in window) speechSynthesis.cancel();
    else if (v) this.unlock();
  }

  // 매 프레임: thrust 0~1(추력 비율), dens 공기 밀도 비율, dist 카메라 거리(m), q 동압(Pa), ion 이온엔진만 켜짐
  update({ thrust, dens, dist, q, ion, paused }) {
    if (!this.ready || !this.on) return;
    const t = this.ctx.currentTime, air = Math.min(1, Math.pow(Math.max(0, dens), 0.6));
    const near = 1 / (1 + Math.max(0, dist - 25) / 120);
    const k = paused ? 0 : 1;
    const eng = ion ? 0 : thrust * air * k;
    this.rumbleG.gain.setTargetAtTime(0.9 * eng * (0.6 + 0.4 * near), t, 0.08);
    this.roarG.gain.setTargetAtTime(0.55 * eng * near, t, 0.08);
    this.rumbleF.frequency.setTargetAtTime(90 + 90 * near, t, 0.2);
    this.roarF.frequency.setTargetAtTime(450 + 600 * near * air, t, 0.2);
    this.windG.gain.setTargetAtTime(Math.min(0.35, q / 90000) * k, t, 0.15);
    this.windF.frequency.setTargetAtTime(300 + Math.min(1200, q / 60), t, 0.2);
    this.ionG.gain.setTargetAtTime(ion && thrust > 0 ? 0.02 * k : 0, t, 0.2);
  }

  // '쿵' 소리 (size: 0.3 작은 분리 ~ 1.5 폭발), 공기가 없으면 안 들림
  boom(size, dens) {
    if (!this.ready || !this.on || dens < 0.02) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.brown;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900 * size, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.2 * size);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(Math.min(1.4, size) * Math.min(1, dens * 2), t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6 * size + 0.3);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 2); s.stop(t + 2.5 * size + 0.5);
  }

  // 카운트다운 음성 (브라우저 내장 음성 합성, 한국어 목소리가 없으면 false)
  koVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (!this._v) this._v = speechSynthesis.getVoices().find(v => /^ko/i.test(v.lang)) || null;
    return this._v;
  }
  say(text, opt) {
    if (!this.on || !this.koVoice()) return false;
    const ss = speechSynthesis, u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.voice = this.koVoice(); u.rate = (opt && opt.rate) || 1.25; u.pitch = (opt && opt.pitch) || 0.95; u.volume = 1;
    ss.cancel(); ss.speak(u);
    return true;
  }

  // 카운트다운 삐 소리
  beep(high) {
    if (!this.ready || !this.on) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = high ? 1320 : 880;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.5 : 0.18));
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.6);
  }
}
