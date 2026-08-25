// ============================================================
//  Процедурный звук (WebAudio, без ассетов)
// ============================================================
import { G } from './state.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.last = {};
  }

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* нет аудио — играем молча */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.32;
    return this.muted;
  }

  _ok(name, interval) {
    if (!this.ctx || this.muted) return false;
    const t = performance.now();
    if (this.last[name] && t - this.last[name] < interval) return false;
    this.last[name] = t;
    return true;
  }

  _near(x, z) {
    if (x === undefined || !G.cam) return true;
    const dx = x - G.cam.target.x, dz = z - G.cam.target.z;
    return dx * dx + dz * dz < 300 * 300;
  }

  tone(freq, dur, type = 'square', vol = 0.08, slide = 0, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise(dur, vol, f0, f1, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, Math.max(1, n), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t0);
  }

  // --- игровые события ---
  click()   { if (this._ok('click', 60)) this.tone(920, 0.03, 'square', 0.04); }
  select()  { if (this._ok('sel', 90)) this.tone(660, 0.025, 'square', 0.03); }
  error()   { if (this._ok('err', 150)) this.tone(150, 0.16, 'sawtooth', 0.07); }
  place()   { if (this._ok('place', 120)) { this.tone(480, 0.07, 'triangle', 0.07); this.tone(720, 0.09, 'triangle', 0.05, 0, 0.07); } }
  done()    { if (this._ok('done', 200)) { this.tone(520, 0.06, 'triangle', 0.06); this.tone(780, 0.1, 'triangle', 0.05, 0, 0.06); } }

  shoot(x, z) {
    if (!this._near(x, z) || !this._ok('shoot', 70)) return;
    this.noise(0.06, 0.045, 2400, 500);
    this.tone(190, 0.05, 'square', 0.02, -60);
  }
  artyShot(x, z) {
    if (!this._near(x, z) || !this._ok('arty', 140)) return;
    this.tone(90, 0.22, 'sine', 0.12, -40);
    this.noise(0.2, 0.05, 700, 150);
  }
  explosion(power, x, z) {
    if (!this._near(x, z)) return;
    if (!this._ok('expl', 60)) return;
    const p = Math.min(3, power);
    this.noise(0.35 + p * 0.15, 0.1 + p * 0.06, 900, 70);
    this.tone(70, 0.3, 'sine', 0.1 + p * 0.04, -40);
  }
  nuke() {
    this.noise(1.8, 0.35, 1400, 40);
    this.tone(55, 1.4, 'sine', 0.3, -25);
    this.tone(110, 0.7, 'sawtooth', 0.08, -70, 0.05);
  }
  alert() {
    if (!this._ok('alert', 5000)) return;
    this.tone(520, 0.12, 'square', 0.05);
    this.tone(390, 0.16, 'square', 0.05, 0, 0.13);
  }
}
