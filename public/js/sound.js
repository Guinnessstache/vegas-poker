// Synthesized sound effects + casino ambience (Web Audio, no asset files).

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxOn = true;
    this.ambienceOn = true;
    this.ambience = null;
  }

  // Play game sounds on a chosen output device ('' = system default), where supported.
  setOutput(id) {
    this.sinkId = id || '';
    this.ctx?.setSinkId?.(this.sinkId).catch(() => {});
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
        this.noiseBuf = this.makeNoise(2);
        if (this.sinkId) this.setOutput(this.sinkId);
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  makeNoise(seconds, brown = false) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  burst({ at = 0, dur = 0.03, freq = 3000, q = 3, gain = 0.4, type = 'bandpass' }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  tone({ at = 0, freq = 440, dur = 0.2, gain = 0.15, type = 'sine', slide = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.sfxOn || !this.ensure()) return;
    switch (name) {
      case 'chips': {
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.burst({ at: i * 0.035 + Math.random() * 0.02, dur: 0.035, freq: 3200 + Math.random() * 2500, q: 6, gain: 0.35 });
        break;
      }
      case 'allin':
        for (let i = 0; i < 14; i++) this.burst({ at: i * 0.028 + Math.random() * 0.02, dur: 0.04, freq: 2800 + Math.random() * 3000, q: 5, gain: 0.35 });
        this.tone({ at: 0.05, freq: 220, dur: 0.5, gain: 0.08, type: 'triangle', slide: 1.5 });
        break;
      case 'card':
        this.burst({ dur: 0.07, freq: 5200, q: 0.8, gain: 0.22, type: 'highpass' });
        break;
      case 'fold':
        this.burst({ dur: 0.12, freq: 2500, q: 0.6, gain: 0.15, type: 'bandpass' });
        break;
      case 'check':
        this.tone({ freq: 140, dur: 0.08, gain: 0.35, type: 'sine', slide: 0.6 });
        this.tone({ at: 0.13, freq: 140, dur: 0.08, gain: 0.35, type: 'sine', slide: 0.6 });
        this.burst({ dur: 0.03, freq: 900, q: 2, gain: 0.3 });
        this.burst({ at: 0.13, dur: 0.03, freq: 900, q: 2, gain: 0.3 });
        break;
      case 'slide':
        this.burst({ dur: 0.25, freq: 1800, q: 0.7, gain: 0.05 });
        break;
      case 'turn':
        this.tone({ freq: 880, dur: 0.18, gain: 0.12 });
        this.tone({ at: 0.12, freq: 1320, dur: 0.3, gain: 0.1 });
        break;
      case 'win':
        [523, 659, 784].forEach((f, i) => this.tone({ at: i * 0.09, freq: f, dur: 0.35, gain: 0.08, type: 'triangle' }));
        break;
      case 'bigwin':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ at: i * 0.08, freq: f, dur: 0.45, gain: 0.1, type: 'triangle' }));
        for (let i = 0; i < 10; i++) this.burst({ at: 0.4 + i * 0.04, dur: 0.04, freq: 3500 + Math.random() * 2000, q: 5, gain: 0.3 });
        break;
      case 'tick':
        this.tone({ freq: 1500, dur: 0.05, gain: 0.08, type: 'square' });
        break;
      case 'chat':
        this.tone({ freq: 1200, dur: 0.08, gain: 0.05 });
        break;
      default:
        break;
    }
  }

  setAmbience(on) {
    this.ambienceOn = on;
    if (!on) { this.stopAmbience(); return; }
    if (!this.ensure() || this.ambience) return;
    const ctx = this.ctx;
    // Crowd murmur: brown noise through a couple of moving band filters.
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoise(6, true);
    src.loop = true;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 420; f1.Q.value = 0.8;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
    src.connect(f1).connect(f2).connect(g).connect(this.master);
    src.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(f1.frequency);
    lfo.start();
    // Random distant slot jingles + chip clatter.
    const timer = setInterval(() => {
      if (!this.ambienceOn || !this.ctx) return;
      const r = Math.random();
      const vol = 0.012 + Math.random() * 0.015;
      if (r < 0.35) {
        const base = [523, 587, 659, 784, 880][Math.floor(Math.random() * 5)];
        for (let i = 0; i < 6; i++) this.tone({ at: i * 0.07, freq: base * [1, 1.25, 1.5, 2, 1.5, 2][i], dur: 0.12, gain: vol, type: 'square' });
      } else if (r < 0.6) {
        for (let i = 0; i < 5; i++) this.burst({ at: i * 0.04, dur: 0.03, freq: 3000 + Math.random() * 2000, q: 5, gain: vol * 3 });
      }
    }, 1700);
    this.ambience = { src, lfo, g, timer };
  }

  stopAmbience() {
    if (!this.ambience) return;
    const { src, lfo, g, timer } = this.ambience;
    clearInterval(timer);
    try { g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5); src.stop(this.ctx.currentTime + 0.6); lfo.stop(this.ctx.currentTime + 0.6); } catch { /* ignore */ }
    this.ambience = null;
  }
}
