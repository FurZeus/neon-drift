import { wrapAngle } from '../vehicle/CarPhysics';
import type { GhostData } from '../settings/Settings';

const SAMPLE_DT = 1 / 20;

/** Tur boyunca aracın konumunu kaydeder. */
export class GhostRecorder {
  private frames: number[] = [];
  private acc = 0;

  reset(): void {
    this.frames = [];
    this.acc = SAMPLE_DT; // ilk karede hemen örnekle
  }

  sample(dt: number, x: number, z: number, yaw: number): void {
    this.acc += dt;
    while (this.acc >= SAMPLE_DT) {
      this.acc -= SAMPLE_DT;
      this.frames.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 1000) / 1000);
      // Aşırı uzun tur (takılı kalma) kaydı şişirmesin
      if (this.frames.length > 3 * 20 * 240) this.frames.length = 3 * 20 * 240;
    }
  }

  finish(lapTime: number): GhostData {
    return { dt: SAMPLE_DT, frames: this.frames.slice(), lapTime };
  }
}

/** Kayıtlı turu zamana göre ara değerle oynatır. */
export class GhostPlayer {
  constructor(private readonly data: GhostData) {}

  get lapTime(): number {
    return this.data.lapTime;
  }

  /** t anındaki poz; tur bittiyse null. */
  poseAt(t: number, out: { x: number; z: number; yaw: number; speed: number }): boolean {
    const f = this.data.frames;
    const n = f.length / 3;
    if (n < 2 || t < 0) return false;
    const pos = t / this.data.dt;
    const i = Math.floor(pos);
    if (i >= n - 1) return false;
    const a = pos - i;
    const p = i * 3;
    const q = p + 3;
    out.x = f[p] + (f[q] - f[p]) * a;
    out.z = f[p + 1] + (f[q + 1] - f[p + 1]) * a;
    out.yaw = f[p + 2] + wrapAngle(f[q + 2] - f[p + 2]) * a;
    out.speed = Math.hypot(f[q] - f[p], f[q + 1] - f[p + 1]) / this.data.dt;
    return true;
  }
}
