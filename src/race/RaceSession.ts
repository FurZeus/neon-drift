import { RACE } from '../config';
import type { Track } from '../world/Track';
import type { TrackDef } from '../world/tracks';

export type RaceEvent =
  | { type: 'lap'; lap: number; time: number; best: boolean; delta: number | null }
  | { type: 'finalLap' }
  | { type: 'split'; km: number; time: number }
  | { type: 'finish'; total: number; laps: number[]; splits: number[] };

export type Medal = 'gold' | 'silver' | 'bronze' | null;

/**
 * Tur ve süre takibi. İlerleme, pist merkez çizgisindeki konumun karelere göre farkının
 * toplamıdır; bu sayede geri gitmek ilerlemeyi azaltır ve kestirme yapılamaz.
 */
export class RaceSession {
  readonly laps: number;
  /** 1 tabanlı, şu an sürülen tur. */
  lap = 1;
  raceTime = 0;
  lapStart = 0;
  readonly lapTimes: number[] = [];
  finished = false;
  /** Bitiş çizgisine göre metre cinsinden toplam ilerleme. */
  progress: number;
  private prevS: number;
  private wrongWayTime = 0;
  /** Bu oturumda karşılaştırma için önceki en iyi tur. */
  private bestLapRef: number | null;
  /** Sprint (otoyol): tur yerine başlangıçtan bitişe mesafe. */
  readonly sprint: boolean;
  readonly distance: number;
  /** Sprintte her kilometrenin geçiş süresi. */
  readonly splits: number[] = [];

  constructor(private readonly track: Track, laps: number, startS: number, previousBestLap: number | null) {
    const def = track.def;
    this.sprint = def.kind === 'sprint';
    this.laps = this.sprint ? 1 : laps;
    this.distance = this.sprint ? (def.finishS ?? track.length) - def.startS : this.laps * track.length;
    this.prevS = startS;
    this.progress = track.deltaS(def.startS, startS);
    this.bestLapRef = previousBestLap;
  }

  /** Sprintte kat edilen mesafe (m, 0..distance). */
  get covered(): number {
    return Math.max(0, Math.min(this.distance, this.progress));
  }

  get currentLapTime(): number {
    return this.raceTime - this.lapStart;
  }

  get bestLap(): number | null {
    return this.lapTimes.length ? Math.min(...this.lapTimes) : null;
  }

  /** Bu tur içinde 0..1 ilerleme (minimap / ipuçları için). */
  get lapFraction(): number {
    const p = this.progress - (this.lap - 1) * this.track.length;
    return Math.max(0, Math.min(1, p / this.track.length));
  }

  get isWrongWay(): boolean {
    return this.wrongWayTime > 0.9;
  }

  /**
   * @param s aracın pist üzerindeki konumu
   * @param speed aracın işaretli hızı (m/s)
   * @param facingDot aracın burun yönü ile pist yönünün iç çarpımı; ters yön tespiti için
   */
  update(dt: number, s: number, speed: number, facingDot: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.finished) return events;
    this.raceTime += dt;
    this.progress += this.track.deltaS(this.prevS, s);
    this.prevS = s;

    if (facingDot < -0.3 && speed > 4) this.wrongWayTime += dt;
    else this.wrongWayTime = Math.max(0, this.wrongWayTime - dt * 3);

    if (this.sprint) {
      // Kilometre ara süreleri
      while ((this.splits.length + 1) * 1000 <= Math.min(this.progress, this.distance - 1)) {
        const km = this.splits.length + 1;
        const t = this.raceTime - (this.progress - km * 1000) / Math.max(4, Math.abs(speed));
        this.splits.push(t);
        events.push({ type: 'split', km, time: t });
      }
      if (this.progress >= this.distance) {
        const crossTime = this.raceTime - (this.progress - this.distance) / Math.max(4, Math.abs(speed));
        this.finished = true;
        this.raceTime = crossTime;
        this.lapTimes.push(crossTime);
        events.push({ type: 'finish', total: crossTime, laps: [crossTime], splits: [...this.splits] });
      }
      return events;
    }

    const target = this.lap * this.track.length;
    if (this.progress >= target) {
      // Çizgiyi geçiş anını hıza göre ara değerle bul
      const overshoot = this.progress - target;
      const crossTime = this.raceTime - overshoot / Math.max(4, Math.abs(speed));
      const lapTime = crossTime - this.lapStart;
      const prevBest = this.bestLap ?? this.bestLapRef;
      const delta = prevBest !== null ? lapTime - prevBest : null;
      const best = prevBest === null || lapTime < prevBest;
      this.lapTimes.push(lapTime);
      this.lapStart = crossTime;
      events.push({ type: 'lap', lap: this.lap, time: lapTime, best, delta });
      if (this.lap >= this.laps) {
        this.finished = true;
        this.raceTime = crossTime;
        events.push({ type: 'finish', total: crossTime, laps: [...this.lapTimes], splits: [] });
      } else {
        this.lap++;
        if (this.lap === this.laps && this.laps > 1) events.push({ type: 'finalLap' });
      }
    }
    return events;
  }

  /** Işınlanma sonrası ilerlemeyi yeni konuma göre düzelt. */
  resync(s: number): void {
    const d = this.track.deltaS(this.prevS, s);
    this.progress += d;
    this.prevS = s;
  }

  static medalTargets(def: TrackDef, laps: number): { gold: number; silver: number; bronze: number } {
    const m = def.medal;
    if (def.kind === 'sprint') return { ...m };
    const a = RACE.medalStartAllowance;
    return { gold: m.gold * laps + a, silver: m.silver * laps + a, bronze: m.bronze * laps + a };
  }

  static medalFor(total: number, def: TrackDef, laps: number): Medal {
    const t = RaceSession.medalTargets(def, laps);
    if (total <= t.gold) return 'gold';
    if (total <= t.silver) return 'silver';
    if (total <= t.bronze) return 'bronze';
    return null;
  }
}
