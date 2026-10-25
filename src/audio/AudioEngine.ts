import { MusicPlayer } from './Music';

/**
 * Tamamen Web Audio API ile sentezlenen sesler — ses dosyası yok.
 * AudioContext yalnızca ilk kullanıcı etkileşiminden sonra oluşturulur (otomatik oynatma
 * kuralları). Efektler varsayılan olarak düşük, müzik kapalı gelir.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: MusicPlayer | null = null;

  private engine: {
    o1: OscillatorNode;
    o2: OscillatorNode;
    o3: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;
  private skid: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode } | null = null;
  private rumble: { gain: GainNode } | null = null;

  private sfxVolume = 0.3;
  private musicVolume = 0;
  private driving = false;
  private hidden = false;
  private paused = false;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Kullanıcı etkileşimi içinde çağrılmalı. */
  unlock(): void {
    try {
      if (!this.ctx) this.create();
      if (this.ctx && this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume().catch(() => undefined);
    } catch {
      /* Web Audio yok: oyun sessiz çalışır */
    }
  }

  private create(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.55;
    this.musicBus.connect(this.master);

    // 2 sn beyaz gürültü
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.music = new MusicPlayer(ctx, this.musicBus, this.noise);
    if (this.musicVolume > 0) this.music.start();
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 3;
    filter.connect(gain);
    gain.connect(this.sfx!);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o3 = ctx.createOscillator();
    o3.type = 'sawtooth';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    const g3 = ctx.createGain();
    g3.gain.value = 0.35;
    o1.connect(filter);
    o2.connect(g2).connect(filter);
    o3.connect(g3).connect(filter);
    o1.start();
    o2.start();
    o3.start();
    this.engine = { o1, o2, o3, filter, gain };

    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1400;
    skidFilter.Q.value = 1.2;
    const s = this.noiseSource();
    s.connect(skidFilter).connect(skidGain).connect(this.sfx!);
    s.start();
    this.skid = { gain: skidGain, filter: skidFilter };

    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 700;
    const w = this.noiseSource();
    w.playbackRate.value = 0.7;
    w.connect(windFilter).connect(windGain).connect(this.sfx!);
    w.start();
    this.wind = { gain: windGain };

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 180;
    const r = this.noiseSource();
    r.playbackRate.value = 0.5;
    r.connect(rumbleFilter).connect(rumbleGain).connect(this.sfx!);
    r.start();
    this.rumble = { gain: rumbleGain };
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx!.gain.setTargetAtTime(sfx, t, 0.05);
    this.musicBus!.gain.setTargetAtTime(music * 0.55, t, 0.05);
    if (music > 0) this.music?.start();
    else this.music?.stop();
  }

  /** Motor/rüzgâr/kayma seslerini aç-kapa (menüde ve duraklatmada kapalı). */
  setDriving(on: boolean): void {
    this.driving = on;
    if (!on && this.ctx && this.engine) {
      const t = this.ctx.currentTime;
      this.engine.gain.gain.setTargetAtTime(0, t, 0.08);
      this.skid!.gain.gain.setTargetAtTime(0, t, 0.05);
      this.wind!.gain.gain.setTargetAtTime(0, t, 0.1);
      this.rumble!.gain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume * (paused ? 0.25 : 0.55), this.ctx.currentTime, 0.1);
    }
    if (paused) this.setDriving(false);
  }

  /** Sekme gizlenince tüm sesi askıya al. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  updateCar(speedAbs: number, throttle: number, slip: number, offroad: boolean, boosting: boolean): void {
    if (!this.ctx || !this.engine || !this.driving || this.paused) return;
    const t = this.ctx.currentTime;
    // Sanal vites kutusu
    const gears = [0, 15, 27, 39, 50, 60, 80];
    let g = 1;
    while (g < gears.length - 1 && speedAbs > gears[g]) g++;
    const lo = gears[g - 1];
    const hi = gears[g];
    const rpm = 0.22 + 0.78 * Math.min(1, Math.max(0, (speedAbs - lo) / (hi - lo)));
    const rev = Math.max(rpm, throttle * 0.35);
    const f = 48 + rev * 150 + (boosting ? 18 : 0);
    this.engine.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engine.o3.frequency.setTargetAtTime(f * 1.505, t, 0.03);
    this.engine.filter.frequency.setTargetAtTime(260 + throttle * 1500 + rev * 900 + (boosting ? 900 : 0), t, 0.05);
    this.engine.gain.gain.setTargetAtTime(0.06 + throttle * 0.07 + (boosting ? 0.03 : 0), t, 0.05);

    const sk = Math.min(1, Math.max(0, slip));
    this.skid!.gain.gain.setTargetAtTime(sk * 0.16, t, 0.04);
    this.skid!.filter.frequency.setTargetAtTime(1100 + sk * 900, t, 0.05);
    const sp = Math.min(1, speedAbs / 64);
    this.wind!.gain.gain.setTargetAtTime(sp * sp * 0.09, t, 0.1);
    this.rumble!.gain.gain.setTargetAtTime(offroad ? 0.25 * Math.min(1, speedAbs / 20) : 0, t, 0.05);
  }

  // ---- Tek seferlik sesler ----

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, endFreq?: number): void {
    if (!this.ctx || !this.sfx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, vol: number, at = 0): void {
    if (!this.ctx || !this.sfx || !this.noise || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  countdown(): void {
    this.tone(520, 0.22, 'sine', 0.35);
  }

  go(): void {
    this.tone(1040, 0.55, 'sine', 0.38);
    this.tone(1560, 0.4, 'triangle', 0.12, 0.02);
  }

  impact(strength: number): void {
    const v = Math.min(1, strength / 18);
    if (v < 0.08) return;
    this.burst(0.25 + v * 0.2, 900, 'lowpass', 0.35 * v + 0.05);
    this.tone(90, 0.25, 'sine', 0.4 * v, 0, 40);
  }

  /** Gaz kesilince egzozdan geri tepme patlaması. */
  backfire(): void {
    if (!this.driving || this.paused) return;
    this.burst(0.06 + Math.random() * 0.04, 500 + Math.random() * 600, 'bandpass', 0.3);
    this.tone(60 + Math.random() * 40, 0.09, 'square', 0.05, 0, 35);
  }

  driftCharge(level: number): void {
    this.tone(level === 2 ? 1320 : 990, 0.12, 'triangle', 0.16);
  }

  boost(level: number): void {
    this.tone(180, 0.45, 'sawtooth', 0.1 + level * 0.04, 0, 900 + level * 200);
    this.burst(0.5, 2200, 'highpass', 0.12);
  }

  lap(best: boolean): void {
    const notes = best ? [784, 988, 1175, 1568] : [660, 880, 1320];
    notes.forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.18, i * 0.08));
  }

  finish(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.18, i * 0.11));
    this.tone(1047, 1.4, 'sine', 0.12, 0.55);
  }

  uiMove(): void {
    this.tone(1500, 0.04, 'sine', 0.08);
  }

  uiSelect(): void {
    this.tone(880, 0.07, 'triangle', 0.14, 0, 1320);
  }

  uiBack(): void {
    this.tone(700, 0.08, 'triangle', 0.12, 0, 440);
  }

  dispose(): void {
    this.music?.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
