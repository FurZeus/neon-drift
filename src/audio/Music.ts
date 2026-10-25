/**
 * Küçük, sentezlenmiş bir synthwave döngüsü (112 BPM, Am–F–C–G). Önden zamanlamalı
 * planlayıcı: setInterval yalnızca notaları AudioContext saatine göre sıraya koyar; bağlam
 * askıya alınınca (sekme gizli) saat durur, döngü güvenle bekler.
 */
export class MusicPlayer {
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private readonly bpm = 112;
  private readonly chords = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62], // G
  ];

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: GainNode,
    private readonly noise: AudioBuffer,
  ) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const now = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return;
    // Geride kaldıysak (uzun duraklama) ileri sar, birikmiş notaları çalma.
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.05;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < now + 0.2) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private playStep(step: number, t: number, sd: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = this.chords[bar];

    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 4 === 2) this.hat(t);
    if (s % 2 === 0) this.bass(this.midi(chord[0] - 24 + (s % 4 === 2 ? 12 : 0)), t, sd * 1.6);
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    const note = chord[arp[s % 8]] + 12 + (s >= 8 ? 12 : 0);
    this.lead(this.midi(note), t, sd * 0.9);
    if (s === 0) this.pad(chord.map((n) => this.midi(n)), t, sd * 16);
  }

  private env(t: number, peak: number, attack: number, dur: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out);
    return g;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(this.env(t, 0.7, 0.004, 0.3));
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    src.connect(f).connect(this.env(t, 0.32, 0.003, 0.16));
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  private hat(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    src.connect(f).connect(this.env(t, 0.12, 0.002, 0.05));
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }

  private bass(freq: number, t: number, dur: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    o.connect(f).connect(this.env(t, 0.22, 0.005, dur));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private lead(freq: number, t: number, dur: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    o.connect(f).connect(this.env(t, 0.045, 0.004, dur));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private pad(freqs: number[], t: number, dur: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1100;
    f.connect(this.env(t, 0.07, 0.5, dur));
    for (const fr of freqs) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }
}
