import { PerspectiveCamera, Vector3 } from 'three';
import type { CarPhysics } from '../vehicle/CarPhysics';
import { wrapAngle } from '../vehicle/CarPhysics';

export type CameraMode = 'chase' | 'orbit' | 'cinematic' | 'showroom';

/** Basit değer gürültüsü: sarsıntı için pürüzsüz rastgelelik. */
function noise1(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}

/**
 * Üçüncü şahıs takip kamerası: hıza göre uzaklaşır, FOV genişler; drift'te gidiş yönüne
 * bakarak kayma açısını gösterir; çarpma ve hızla sarsılır.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  shakeEnabled = true;
  private trauma = 0;
  private time = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly tmp = new Vector3();
  private heading = 0;
  private dist = 6.2;
  private baseFov = 62;
  private fov = 62;
  private aspect = 1;
  private orbitAngle = 0;
  private cineShot = 0;
  private cineTimer = 0;
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(62, aspect, 0.1, 6000);
    this.setAspect(aspect);
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    // Dar (dikey) ekranlarda yatay görüşü korumak için dikey FOV'u büyüt.
    this.baseFov = aspect < 1 ? Math.min(92, 62 / Math.max(0.55, aspect) ** 0.6) : 62;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get verticalFov(): number {
    return this.camera.fov;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Bir sonraki karede yumuşatmadan doğrudan hedefe geç. */
  snap(): void {
    this.initialized = false;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.cineTimer = 0;
    if (mode === 'orbit' || mode === 'showroom') this.orbitAngle = 0;
  }

  update(dt: number, car: CarPhysics, boost: number): void {
    this.time += dt;
    const speed = Math.abs(car.speed);
    const speedF = Math.min(1, speed / 64);

    if (this.mode === 'chase') this.updateChase(dt, car, speedF, boost);
    else if (this.mode === 'orbit') this.updateOrbit(dt, car);
    else if (this.mode === 'showroom') this.updateShowroom(dt, car);
    else this.updateCinematic(dt, car);

    // Sarsıntı
    const speedShake = this.mode === 'chase' ? Math.max(0, speedF - 0.55) * 0.35 + (car.offroad ? 0.25 * speedF : 0) : 0;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const amount = this.shakeEnabled ? Math.min(1, this.trauma * this.trauma + speedShake * speedShake) : 0;
    const t = this.time * 22;
    const ox = noise1(t) * 0.35 * amount;
    const oy = noise1(t + 31.7) * 0.25 * amount;
    const roll = noise1(t + 77.1) * 0.035 * amount;

    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(roll);

    const targetFov =
      this.mode === 'chase'
        ? this.baseFov + speedF * 11 + boost * 7
        : this.mode === 'orbit'
          ? this.baseFov - 6
          : this.mode === 'showroom'
            ? this.baseFov - 22
            : this.baseFov - 10;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateChase(dt: number, car: CarPhysics, speedF: number, boost: number): void {
    // Drift'te kamera burun ile gidiş yönü arasına bakar → kayma açısı görünür.
    const dirTarget = car.speed >= -1 ? car.yaw - wrapAngle(car.yaw - car.travel) * 0.6 : car.yaw;
    if (!this.initialized) this.heading = dirTarget;
    this.heading += wrapAngle(dirTarget - this.heading) * (1 - Math.exp(-5.5 * dt));
    // Konum aracı gecikmesiz izler (yüksek hızda geride kalmasın); ivmelenmede hafif uzaklaşma.
    const accelPull = Math.max(-0.5, Math.min(0.7, car.accel * 0.025));
    const distTarget = 6.2 + speedF * 1.5 + boost * 0.9 + accelPull;
    this.dist += (distTarget - this.dist) * (this.initialized ? 1 - Math.exp(-4 * dt) : 1);
    const height = 2.3 + speedF * 0.3;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.pos.set(car.x - fx * this.dist, height, car.z - fz * this.dist);
    const lookAhead = 3.5 + speedF * 3;
    this.look.set(car.x + Math.sin(car.yaw) * lookAhead, 1.0, car.z + Math.cos(car.yaw) * lookAhead);
    this.initialized = true;
  }

  private updateOrbit(dt: number, car: CarPhysics): void {
    this.orbitAngle += dt * 0.35;
    const a = car.yaw + Math.PI * 0.85 + this.orbitAngle;
    const r = 8.5;
    this.tmp.set(car.x + Math.sin(a) * r, 2.2 + Math.sin(this.orbitAngle * 0.7) * 0.6, car.z + Math.cos(a) * r);
    const k = this.initialized ? 1 - Math.exp(-3 * dt) : 1;
    this.pos.lerp(this.tmp, k);
    this.tmp.set(car.x, 0.8, car.z);
    this.look.lerp(this.tmp, this.initialized ? 1 - Math.exp(-6 * dt) : 1);
    this.initialized = true;
  }

  /** Garaj: duran aracın çevresinde yavaşça dönen vitrin çekimi (araç ekranın sağında). */
  private updateShowroom(dt: number, car: CarPhysics): void {
    this.orbitAngle += dt * 0.22;
    const a = car.yaw + 0.9 + this.orbitAngle;
    const r = 9.4;
    this.tmp.set(car.x + Math.sin(a) * r, 1.55 + Math.sin(this.orbitAngle * 0.8) * 0.25, car.z + Math.cos(a) * r);
    const k = this.initialized ? 1 - Math.exp(-4 * dt) : 1;
    this.pos.lerp(this.tmp, k);
    // Bakış noktasını kameranın soluna kaydır: araç panelin sağında kalsın
    const side = this.aspect > 1 ? 0.9 : 0;
    const rx = Math.cos(a);
    const rz = -Math.sin(a);
    this.tmp.set(car.x - rx * side, 0.7, car.z - rz * side);
    this.look.lerp(this.tmp, this.initialized ? 1 - Math.exp(-6 * dt) : 1);
    this.initialized = true;
  }

  /** Ana menü: aracın çevresinde dönen sinematik çekimler. */
  private updateCinematic(dt: number, car: CarPhysics): void {
    this.cineTimer -= dt;
    let cut = false;
    if (this.cineTimer <= 0) {
      this.cineShot = (this.cineShot + 1) % 3;
      this.cineTimer = 7;
      cut = true;
    }
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const rx = -Math.cos(car.yaw);
    const rz = Math.sin(car.yaw);
    const t = 7 - this.cineTimer;
    if (this.cineShot === 0) {
      // Önden 3/4 alçak çekim
      this.tmp.set(car.x + fx * 7.5 + rx * 3.5, 0.9, car.z + fz * 7.5 + rz * 3.5);
    } else if (this.cineShot === 1) {
      // Yandan takip
      this.tmp.set(car.x + rx * (7 + t * 0.15) - fx * 1.5, 1.6, car.z + rz * (7 + t * 0.15) - fz * 1.5);
    } else {
      // Yüksek arka çekim
      this.tmp.set(car.x - fx * 10 - rx * 2, 4.2, car.z - fz * 10 - rz * 2);
    }
    const k = cut || !this.initialized ? 1 : 1 - Math.exp(-6 * dt);
    this.pos.lerp(this.tmp, k);
    this.tmp.set(car.x + fx * 1.2, 0.75, car.z + fz * 1.2);
    this.look.lerp(this.tmp, cut || !this.initialized ? 1 : 1 - Math.exp(-10 * dt));
    this.initialized = true;
  }

  get aspectRatio(): number {
    return this.aspect;
  }
}
