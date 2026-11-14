// Procedural sound: every effect is synthesised with WebAudio, so the game ships
// no audio files and makes no network request. One shared AudioContext, lazily
// created on the first user gesture (browsers block audio before that).
// Each effect is a short function: noise through a filter for shots and booms,
// a sine blip for UI, a two-tone beep for the planted charge.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      const length = Math.floor(context.sampleRate * 0.5);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function noise(when, duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, freq, duration, gainValue, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, when + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  function now() {
    return ensure() ? context.currentTime : 0;
  }

  // weapon: 'rifle' | 'smg' | 'shotgun' | 'marksman' | 'pistol'. A crack (high
  // noise) plus a body thump (low noise); the shotgun adds a longer tail.
  function shot(weapon) {
    if (!ensure()) return;
    const t = now();
    const table = {
      rifle: [2600, 0.32, 0.11],
      smg: [3200, 0.24, 0.07],
      shotgun: [1500, 0.5, 0.22],
      marksman: [2000, 0.42, 0.2],
      pistol: [3000, 0.26, 0.08],
    };
    const [freq, gain, dur] = table[weapon] || table.rifle;
    noise(t, dur, freq, gain);
    noise(t, dur * 0.8, 320, gain * 0.8);
  }

  function distantShot() {
    if (!ensure()) return;
    noise(now(), 0.09, 900, 0.1);
  }

  function reload() {
    if (!ensure()) return;
    const t = now();
    tone(t, 1400, 0.03, 0.12, 'square');
    tone(t + 0.16, 900, 0.03, 0.12, 'square');
    tone(t + 0.32, 1600, 0.04, 0.14, 'square');
  }

  function dryFire() {
    if (!ensure()) return;
    tone(now(), 2200, 0.03, 0.1, 'square');
  }

  function hit() {
    if (!ensure()) return;
    tone(now(), 2100, 0.05, 0.16, 'sine', 1500);
  }

  function kill() {
    if (!ensure()) return;
    const t = now();
    tone(t, 1800, 0.06, 0.18, 'sine', 1200);
    tone(t + 0.07, 2400, 0.08, 0.18, 'sine', 1600);
  }

  function hurt() {
    if (!ensure()) return;
    const t = now();
    tone(t, 160, 0.18, 0.3, 'sawtooth', 90);
    noise(t, 0.12, 500, 0.15);
  }

  function explosion() {
    if (!ensure()) return;
    const t = now();
    noise(t, 0.9, 420, 0.7);
    noise(t, 0.5, 2400, 0.25, 'bandpass');
    tone(t, 90, 0.8, 0.5, 'sine', 35);
  }

  function grenadeBounce() {
    if (!ensure()) return;
    tone(now(), 700, 0.05, 0.1, 'triangle', 420);
  }

  function plantBeep() {
    if (!ensure()) return;
    tone(now(), 1250, 0.09, 0.16, 'square');
  }

  function plantDone() {
    if (!ensure()) return;
    const t = now();
    tone(t, 880, 0.12, 0.18, 'square');
    tone(t + 0.14, 1320, 0.2, 0.18, 'square');
  }

  function roundWin() {
    if (!ensure()) return;
    const t = now();
    [523, 659, 784].forEach((freq, i) => tone(t + i * 0.12, freq, 0.22, 0.16, 'triangle'));
  }

  function roundLose() {
    if (!ensure()) return;
    const t = now();
    [392, 330, 262].forEach((freq, i) => tone(t + i * 0.14, freq, 0.26, 0.15, 'triangle'));
  }

  function buy() {
    if (!ensure()) return;
    const t = now();
    tone(t, 980, 0.06, 0.14, 'triangle');
    tone(t + 0.07, 1470, 0.09, 0.14, 'triangle');
  }

  function deny() {
    if (!ensure()) return;
    tone(now(), 220, 0.12, 0.16, 'square', 160);
  }

  return {
    unlock, shot, distantShot, reload, dryFire, hit, kill, hurt, explosion,
    grenadeBounce, plantBeep, plantDone, roundWin, roundLose, buy, deny,
  };
}
