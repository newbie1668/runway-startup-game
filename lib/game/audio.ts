/**
 * RUNWAY — synthesized sound effects.
 *
 * Every sound is generated with the WebAudio API at play time: oscillators,
 * envelopes and a pinch of noise. No audio files, no downloads — the whole
 * soundtrack is a few hundred bytes of code.
 */

export type SfxName =
  'click' | 'confirm' | 'cash' | 'raise' | 'fail' | 'week' | 'event' | 'unicorn' | 'gameover';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    startIn: number,
    duration: number,
    type: OscillatorType = 'triangle',
    peak = 1,
    glideTo?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + startIn;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noise(startIn: number, duration: number, peak = 0.5) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + startIn;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = peak;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  play(name: SfxName) {
    if (this.muted) return;
    switch (name) {
      case 'click':
        this.tone(660, 0, 0.06, 'square', 0.35);
        break;
      case 'confirm':
        this.tone(523, 0, 0.09, 'triangle', 0.7);
        this.tone(784, 0.07, 0.12, 'triangle', 0.7);
        break;
      case 'cash':
        this.tone(988, 0, 0.07, 'square', 0.5);
        this.tone(1319, 0.06, 0.09, 'square', 0.5);
        this.tone(1568, 0.12, 0.16, 'square', 0.45);
        break;
      case 'raise':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.09, 0.22, 'triangle', 0.8));
        this.noise(0.3, 0.35, 0.25);
        break;
      case 'fail':
        this.tone(330, 0, 0.22, 'sawtooth', 0.4, 262);
        this.tone(262, 0.18, 0.3, 'sawtooth', 0.35, 208);
        break;
      case 'week':
        this.tone(392, 0, 0.05, 'sine', 0.5);
        this.tone(523, 0.05, 0.06, 'sine', 0.4);
        break;
      case 'event':
        this.tone(880, 0, 0.08, 'sine', 0.6);
        this.tone(1109, 0.09, 0.14, 'sine', 0.5);
        break;
      case 'unicorn':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
          this.tone(f, i * 0.11, 0.3, 'triangle', 0.85),
        );
        [1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.7 + i * 0.05, 0.6, 'sine', 0.5));
        this.noise(0.66, 0.5, 0.3);
        break;
      case 'gameover':
        this.tone(392, 0, 0.3, 'triangle', 0.6);
        this.tone(349, 0.28, 0.3, 'triangle', 0.55);
        this.tone(311, 0.56, 0.34, 'triangle', 0.5);
        this.tone(262, 0.84, 0.7, 'triangle', 0.5);
        break;
    }
  }
}

export const sfx = new Sfx();
