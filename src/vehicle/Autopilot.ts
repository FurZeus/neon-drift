import { wrapAngle, type CarPhysics, type DriveInput } from './CarPhysics';
import { createTrackQuery, type Track, type TrackQuery } from '../world/Track';

/**
 * Pist çizgisini takip eden basit sürücü. Ana menüdeki gösteri turu, yarış bitişindeki
 * yavaşlama ve geliştirme testleri için kullanılır.
 */
export class Autopilot {
  /** 0..1, hedef hızın ölçeği. */
  pace = 1;
  /** Yan kaydırma (m); gösteri turunda hafif yarış çizgisi için. */
  laneOffset = 0;
  private readonly look: TrackQuery = createTrackQuery();
  private readonly out: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false };

  /** Hız üst sınırı (m/s); otoyolda trafiğe göre ayarlanır. */
  speedCap = Infinity;

  constructor(private track: Track) {}

  setTrack(track: Track): void {
    this.track = track;
  }

  drive(car: CarPhysics, q: TrackQuery): DriveInput {
    const track = this.track;
    const speed = Math.abs(car.speed);

    // Saf takip (pure pursuit): ileri bakış noktasına yönel.
    const lookAhead = 9 + speed * 0.55;
    track.frameAt(q.s + lookAhead, this.look);
    const tx = this.look.cx + this.look.nx * this.laneOffset;
    const tz = this.look.cz + this.look.nz * this.laneOffset;
    const desired = Math.atan2(tx - car.x, tz - car.z);
    const alpha = wrapAngle(desired - car.yaw);
    const yawWanted = (2 * Math.max(speed, 6) * Math.sin(alpha)) / lookAhead;
    const maxYaw = Math.max(car.maxYawAt(speed), 0.4);
    this.out.steer = Math.max(-1, Math.min(1, -yawWanted / maxYaw));

    // Hız: önümüzdeki en keskin virajın izin verdiği hızı aşma.
    let kMax = 0;
    const span = 18 + speed * 1.6;
    for (let d = 4; d < span; d += 4) {
      track.frameAt(q.s + d, this.look);
      kMax = Math.max(kMax, Math.abs(this.look.curvature));
    }
    const vAllowed = Math.min(this.allowedSpeed(kMax, car) * this.pace, this.speedCap);
    const over = speed - vAllowed;
    this.out.throttle = over < -1.5 ? 1 : over < 0 ? 0.4 : 0;
    this.out.brake = over > 2.5 ? Math.min(1, over / 8) : 0;
    this.out.handbrake = false;
    return this.out;
  }

  /** v·κ ≤ 0.82·ω_max(v) eşitsizliğinin çözümü. */
  private allowedSpeed(k: number, car: CarPhysics): number {
    if (k < 1e-4) return 999;
    const a = car.p.yawSpeedFalloff * k;
    const c = -0.82 * car.p.maxYawRate;
    return (-k + Math.sqrt(k * k - 4 * a * c)) / (2 * a);
  }
}
