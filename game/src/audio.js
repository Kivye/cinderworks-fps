// audio.js — WebAudio synth sounds only (no audio files, no network).
export class Sfx {
  constructor() {
    this.ctx = null; this.master = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol, low) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low || 2400;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }
  shot(kind) {
    this.ensure();
    if (kind === 'marksman') { this.noise(0.22, 0.9, 1400); this.tone(140, 0.18, 'square', 0.25, 55); }
    else if (kind === 'shotgun') { this.noise(0.18, 0.85, 1100); this.tone(110, 0.14, 'square', 0.3, 45); }
    else if (kind === 'smg') { this.noise(0.07, 0.5, 3200); this.tone(220, 0.06, 'square', 0.14, 90); }
    else if (kind === 'pistol') { this.noise(0.09, 0.6, 2600); this.tone(190, 0.08, 'square', 0.18, 70); }
    else { this.noise(0.12, 0.7, 2200); this.tone(160, 0.1, 'square', 0.22, 60); }
  }
  hit(head) { this.tone(head ? 1250 : 880, 0.07, 'sine', 0.3); }
  hurt() { this.tone(160, 0.16, 'sawtooth', 0.3, 70); }
  reload() { this.tone(500, 0.06, 'square', 0.14); setTimeout(() => this.tone(700, 0.06, 'square', 0.14), 140); }
  plantBeep(final) { this.tone(final ? 1500 : 950, final ? 0.3 : 0.09, 'sine', 0.35); }
  boom() { this.noise(0.6, 1.0, 500); this.tone(90, 0.5, 'sine', 0.5, 35); }
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.3), i * 130)); }
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'triangle', 0.28), i * 150)); }
  click() { this.tone(700, 0.04, 'square', 0.15); }
  pickup() { this.tone(660, 0.08, 'sine', 0.25); setTimeout(() => this.tone(990, 0.1, 'sine', 0.25), 80); }
}
