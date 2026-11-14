// Synthesized sound effects (Web Audio API) - no audio files needed.
// The audio context starts on the first user click, as browsers require.

const KEY = 'mission-architect-sound-v1';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private hold: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private drone: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) === 'off';
    } catch {
      /* storage blocked */
    }
  }

  /** Create/resume the audio context. Call from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? 'off' : 'on');
    } catch {
      /* storage blocked */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
    if (m) this.droneStop();
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number; attack?: number; lp?: number } = {}) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number; at?: number; attack?: number } = {}) {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.05, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- UI
  click() {
    this.tone(1900, 0.035, { type: 'triangle', to: 1200, gain: 0.05 });
  }
  select() {
    this.tone(880, 0.04, { type: 'triangle', gain: 0.06 });
    this.tone(1320, 0.05, { type: 'triangle', gain: 0.06, at: 0.045 });
  }
  /** Paper sliding: a short filtered-noise swoosh. */
  sheet() {
    this.noise(0.22, { freq: 900, to: 3200, q: 0.8, gain: 0.05, attack: 0.04 });
  }
  warn() {
    this.tone(330, 0.12, { type: 'square', gain: 0.035, lp: 1400 });
    this.tone(247, 0.18, { type: 'square', gain: 0.035, lp: 1400, at: 0.13 });
  }
  go() {
    this.tone(660, 0.12, { gain: 0.06 });
    this.tone(990, 0.22, { gain: 0.06, at: 0.1 });
  }

  // ---------------------------------------------------------------- launch
  holdStart() {
    const ctx = this.ready();
    if (!ctx || this.hold) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.1);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start();
    this.hold = { osc, gain, filter };
  }
  holdUpdate(p: number) {
    if (!this.hold || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.hold.osc.frequency.setTargetAtTime(70 + p * 260, t, 0.03);
    this.hold.filter.frequency.setTargetAtTime(300 + p * 2200, t, 0.03);
    this.hold.gain.gain.setTargetAtTime(0.05 + p * 0.06, t, 0.03);
  }
  holdStop() {
    if (!this.hold || !this.ctx) return;
    const { osc, gain } = this.hold;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    osc.stop(this.ctx.currentTime + 0.3);
    this.hold = null;
  }
  countBeep(n: number) {
    this.tone(n === 1 ? 1320 : 880, 0.16, { gain: 0.11 });
  }
  liftoff() {
    // rumble + sub-bass sweep + rising whoosh
    this.noise(4.2, { type: 'lowpass', freq: 380, to: 140, q: 0.7, gain: 0.5, attack: 0.25 });
    this.tone(38, 3.5, { to: 70, gain: 0.35, attack: 0.3 });
    this.noise(2.4, { type: 'bandpass', freq: 300, to: 2400, q: 0.6, gain: 0.08, attack: 0.6, at: 0.3 });
  }

  // ---------------------------------------------------------------- flight
  /** Apollo-style Quindar tone that marks a mission-control transmission. */
  quindar() {
    this.tone(2525, 0.25, { gain: 0.035, attack: 0.01 });
  }
  good() {
    this.quindar();
    this.tone(784, 0.5, { type: 'triangle', gain: 0.06, at: 0.28 });
    this.tone(1175, 0.7, { type: 'triangle', gain: 0.06, at: 0.38 });
  }
  bad() {
    this.quindar();
    this.tone(523, 0.35, { type: 'triangle', gain: 0.07, at: 0.28 });
    this.tone(392, 0.6, { type: 'triangle', gain: 0.07, at: 0.42 });
  }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone(880, 0.13, { type: 'square', gain: 0.04, lp: 2200, at: i * 0.3 });
      this.tone(660, 0.13, { type: 'square', gain: 0.04, lp: 2200, at: i * 0.3 + 0.15 });
    }
  }
  droneStart() {
    const ctx = this.ready();
    if (!ctx || this.drone) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 2);
    gain.connect(this.master!);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const f of [55, 55.4, 82.6]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      nodes.push(o);
    }
    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      src.connect(lp).connect(ng).connect(gain);
      src.start();
      nodes.push(src);
    }
    this.drone = { nodes, gain };
  }
  droneStop() {
    if (!this.drone || !this.ctx) return;
    const { nodes, gain } = this.drone;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    for (const n of nodes) n.stop(this.ctx.currentTime + 2);
    this.drone = null;
  }

  // ---------------------------------------------------------------- high bay
  private loops = new Map<string, { nodes: AudioScheduledSourceNode[]; gain: GainNode }>();

  private noiseLoop(name: string, vol: number, filters: { type: BiquadFilterType; freq: number; q?: number }[], fade = 0.6, extra?: (ctx: AudioContext, out: GainNode) => AudioScheduledSourceNode[]) {
    const ctx = this.ready();
    if (!ctx || this.loops.has(name) || !this.noiseBuf) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(vol, ctx.currentTime, fade / 3);
    gain.connect(this.master!);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    let node: AudioNode = src;
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.freq;
      b.Q.value = f.q ?? 0.7;
      node.connect(b);
      node = b;
    }
    node.connect(gain);
    src.start(0, Math.random());
    const nodes: AudioScheduledSourceNode[] = [src, ...(extra?.(ctx, gain) ?? [])];
    this.loops.set(name, { nodes, gain });
  }

  private stopLoop(name: string, fade = 0.4) {
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    l.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade / 3);
    for (const n of l.nodes) n.stop(this.ctx.currentTime + fade + 0.2);
    this.loops.delete(name);
  }

  /** Clean-room HVAC: a soft, constant air hum. */
  ambienceStart() {
    this.noiseLoop('hvac', 0.05, [{ type: 'lowpass', freq: 520 }, { type: 'highpass', freq: 60 }], 1.5, (ctx, out) => {
      const o = ctx.createOscillator();
      o.frequency.value = 120;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(out);
      o.start();
      return [o];
    });
  }
  ambienceStop() {
    this.stopLoop('hvac', 0.8);
  }
  /** Soft shoe-cover footstep on vinyl. */
  step(run: boolean) {
    this.noise(run ? 0.07 : 0.09, { type: 'bandpass', freq: 380 + Math.random() * 140, q: 1.2, gain: run ? 0.05 : 0.035, attack: 0.004 });
  }
  pickup() {
    this.noise(0.18, { type: 'bandpass', freq: 1400, to: 2600, q: 1, gain: 0.04, attack: 0.02 });
    this.tone(520, 0.08, { type: 'triangle', gain: 0.04, at: 0.05 });
  }
  whoosh() {
    this.noise(0.7, { type: 'bandpass', freq: 500, to: 2200, q: 0.8, gain: 0.05, attack: 0.25 });
  }
  clunk() {
    this.tone(110, 0.22, { to: 60, gain: 0.25 });
    this.noise(0.06, { type: 'lowpass', freq: 1800, gain: 0.12 });
  }
  /** A part locks into place: mechanical clunk + confirmation chirp. */
  install() {
    this.clunk();
    this.noise(0.12, { type: 'highpass', freq: 3000, gain: 0.03, at: 0.05 });
    this.tone(880, 0.09, { type: 'triangle', gain: 0.05, at: 0.12 });
    this.tone(1320, 0.14, { type: 'triangle', gain: 0.05, at: 0.2 });
  }
  craneStart() {
    this.noiseLoop('crane', 0.06, [{ type: 'bandpass', freq: 180, q: 2 }], 0.4, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 58;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 240;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      o.connect(f).connect(g).connect(out);
      o.start();
      return [o];
    });
    this.tone(1046, 0.12, { type: 'square', gain: 0.02, lp: 2000 });
    this.tone(1046, 0.12, { type: 'square', gain: 0.02, lp: 2000, at: 0.3 });
  }
  craneStop() {
    this.stopLoop('crane', 0.3);
  }
  pumpStart() {
    this.noiseLoop('pump', 0.07, [{ type: 'bandpass', freq: 700, q: 3 }], 0.2, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 92;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      o.connect(g).connect(out);
      o.start();
      return [o];
    });
  }
  pumpStop() {
    this.stopLoop('pump', 0.2);
    this.tone(330, 0.08, { type: 'triangle', gain: 0.04 });
  }
  doorOpen() {
    this.noise(3.2, { type: 'bandpass', freq: 240, to: 420, q: 1.5, gain: 0.12, attack: 0.3 });
    this.tone(70, 3.0, { type: 'sawtooth', gain: 0.05, lp: 300, attack: 0.3 });
    for (let i = 0; i < 3; i++) this.tone(740, 0.25, { type: 'square', gain: 0.025, lp: 1800, at: i * 0.6 });
  }
  /** Outdoors at the pad: wind. */
  padAmbience(on: boolean) {
    if (on) this.noiseLoop('wind', 0.06, [{ type: 'lowpass', freq: 700 }, { type: 'highpass', freq: 120 }], 1.2);
    else this.stopLoop('wind', 0.8);
  }
  /** Continuous rocket roar while the engines burn. */
  rumble(on: boolean) {
    if (on)
      this.noiseLoop('roar', 0.42, [{ type: 'lowpass', freq: 420 }], 0.8, (ctx, out) => {
        const o = ctx.createOscillator();
        o.frequency.value = 36;
        const g = ctx.createGain();
        g.gain.value = 0.6;
        o.connect(g).connect(out);
        o.start();
        return [o];
      });
    else this.stopLoop('roar', 1.5);
  }

  // ---------------------------------------------------------------- report
  stamp() {
    this.tone(140, 0.28, { to: 42, gain: 0.45 });
    this.noise(0.08, { type: 'lowpass', freq: 900, gain: 0.3 });
  }
  star(i: number) {
    this.tone([1568, 1760, 2093][i] ?? 2093, 0.45, { type: 'triangle', gain: 0.06 });
  }
  fanfare(outcome: 'success' | 'partial' | 'failure') {
    if (outcome === 'failure') {
      this.tone(196, 0.9, { type: 'triangle', gain: 0.08 });
      this.tone(185, 1.1, { type: 'triangle', gain: 0.06, at: 0.25 });
      return;
    }
    const notes = outcome === 'success' ? [523, 659, 784, 1047] : [523, 659, 587];
    notes.forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.07, at: i * 0.11 }));
  }
}

export const sound = new SoundEngine();
