import { Color, type PerspectiveCamera, type Scene } from 'three';
import type { CarVisual } from '../vehicle/CarVisual';
import type { CarPhysics, WallHit } from '../vehicle/CarPhysics';
import { ParticleSystem } from './Particles';
import { SkidMarks } from './SkidMarks';
import { SpeedLines } from './SpeedLines';

const RUBBER = new Color(0.05, 0.04, 0.07);
const CYAN = new Color(0x29f0ff);
const MAG = new Color(0xff2bd6);

/** Araçla ilgili tüm görsel geri bildirim: izler, duman, kıvılcım, turbo, hız çizgileri. */
export class CarEffects {
  readonly skids = new SkidMarks(1800);
  readonly smoke = ParticleSystem.smoke(700);
  readonly sparks = ParticleSystem.additive(1400);
  readonly speedLines: SpeedLines;
  private readonly wheels = { lx: 0, lz: 0, rx: 0, rz: 0 };
  private readonly markColor = new Color();
  private time = 0;
  private lastThrottle = 0;
  /** Sıradaki geri tepme patlamalarına kalan süreler. */
  private readonly pops: number[] = [];
  /** Her geri tepme patlamasında (ses için). */
  onBackfire: (() => void) | null = null;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    scene.add(this.skids.mesh, this.smoke.points, this.sparks.points);
    this.speedLines = new SpeedLines(camera);
  }

  setQuality(particleScale: number, speedLines: boolean): void {
    this.smoke.scale = particleScale;
    this.sparks.scale = particleScale;
    this.speedLines.enabled = speedLines;
  }

  setViewport(heightPx: number, fov: number): void {
    this.smoke.setViewport(heightPx, fov);
    this.sparks.setViewport(heightPx, fov);
  }

  clear(): void {
    this.pops.length = 0;
    this.skids.clear();
    this.smoke.clear();
    this.sparks.clear();
  }

  /** Işınlanma sonrası iz şeritlerini kopar. */
  breakTrails(): void {
    for (let i = 0; i < 4; i++) this.skids.end(i);
  }

  update(dt: number, car: CarPhysics, model: CarVisual, simulate: boolean): void {
    this.time += dt;
    if (simulate) this.emitFromCar(dt, car, model);
    this.skids.update(this.time);
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  updateSpeedLines(dt: number, car: CarPhysics, active: boolean): void {
    const speed = Math.abs(car.speed);
    const boost = car.boostTime > 0;
    const intensity = active ? Math.max(0, Math.min(1, (speed - 36) / 24)) * 0.8 + (boost ? 0.45 : 0) : 0;
    this.speedLines.update(dt, speed, intensity, boost);
  }

  private emitFromCar(dt: number, car: CarPhysics, model: CarVisual): void {
    const speed = Math.abs(car.speed);
    model.rearWheelWorld(car, this.wheels);
    const w = this.wheels;
    const slip = Math.abs(car.slip);
    const hardBrake = car.input.brake > 0.7 && car.speed > 22;
    let skid = 0;
    if (!car.offroad && speed > 4) {
      if (car.drifting) skid = 0.75 + car.driftCharge * 0.25;
      else skid = Math.max(0, Math.min(1, (slip - 0.1) * 5));
      if (car.input.handbrake && speed > 6) skid = Math.max(skid, 0.7);
      if (hardBrake) skid = Math.max(skid, 0.45);
    }

    // Lastik izleri: drift seviyesine göre neon tonlu
    if (skid > 0.15) {
      if (car.drifting && car.driftLevel === 2) this.markColor.copy(MAG).multiplyScalar(0.55);
      else if (car.drifting && car.driftLevel === 1) this.markColor.copy(CYAN).multiplyScalar(0.45);
      else if (car.drifting) this.markColor.copy(model.accentColor).multiplyScalar(0.28);
      else this.markColor.copy(RUBBER);
      this.skids.add(0, w.lx, w.lz, skid, this.markColor, this.time);
      this.skids.add(1, w.rx, w.rz, skid, this.markColor, this.time);
    } else {
      this.skids.end(0);
      this.skids.end(1);
    }

    const vx = Math.sin(car.travel) * car.speed;
    const vz = Math.cos(car.travel) * car.speed;
    const rate = dt * 60;

    // Duman: yalnızca drift / el freni (sert frende yalnız iz kalır, görüş kapanmasın)
    if (skid > 0.3 && (car.drifting || car.input.handbrake)) {
      for (const [x, z] of [
        [w.lx, w.lz],
        [w.rx, w.rz],
      ]) {
        if (this.smoke.maybe(0.4 * skid * rate)) {
          const tint = car.drifting && car.driftLevel > 0 ? (car.driftLevel === 2 ? MAG : CYAN) : null;
          this.smoke.emit({
            x: x + (Math.random() - 0.5) * 0.4,
            y: 0.25,
            z: z + (Math.random() - 0.5) * 0.4,
            vx: vx * 0.22 + (Math.random() - 0.5) * 1.5,
            vy: 0.6 + Math.random() * 0.8,
            vz: vz * 0.22 + (Math.random() - 0.5) * 1.5,
            life: 1.1 + Math.random() * 0.7,
            size: 0.9,
            sizeEnd: 3.4 + Math.random() * 1.2,
            r: tint ? 0.35 + tint.r * 0.25 : 0.42,
            g: tint ? 0.33 + tint.g * 0.2 : 0.38,
            b: tint ? 0.45 + tint.b * 0.2 : 0.52,
            alpha: 0.14,
            drag: 1.6,
            gravity: -0.35,
          });
        }
      }
    }

    // Drift kıvılcımları (şarj seviyesine göre renk)
    if (car.drifting && car.driftLevel > 0) {
      const c = car.driftLevel === 2 ? MAG : CYAN;
      for (const [x, z] of [
        [w.lx, w.lz],
        [w.rx, w.rz],
      ]) {
        const n = Math.floor(rate * 1.6 * this.sparks.scale + Math.random());
        for (let i = 0; i < n; i++) {
          this.sparks.emit({
            x,
            y: 0.12,
            z,
            vx: -vx * 0.08 + (Math.random() - 0.5) * 4,
            vy: 1.5 + Math.random() * 2.5,
            vz: -vz * 0.08 + (Math.random() - 0.5) * 4,
            life: 0.25 + Math.random() * 0.25,
            size: 0.16,
            sizeEnd: 0.04,
            r: c.r * 2.5,
            g: c.g * 2.5,
            b: c.b * 2.5,
            alpha: 1,
            drag: 2,
            gravity: 9,
          });
        }
      }
    }

    // Pist dışı toz
    if (car.offroad && speed > 6 && this.smoke.maybe(0.6 * rate)) {
      const [x, z] = Math.random() < 0.5 ? [w.lx, w.lz] : [w.rx, w.rz];
      this.smoke.emit({
        x,
        y: 0.2,
        z,
        vx: vx * 0.3 + (Math.random() - 0.5) * 2,
        vy: 1 + Math.random(),
        vz: vz * 0.3 + (Math.random() - 0.5) * 2,
        life: 0.9,
        size: 0.8,
        sizeEnd: 3,
        r: 0.36,
        g: 0.28,
        b: 0.55,
        alpha: 0.3,
        drag: 2,
        gravity: -0.2,
      });
    }

    // Egzoz: çıkışlar dünya uzayında
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    const exhaust = model.exhaust;
    const at = (e: { x: number; z: number }, back: number): [number, number] => {
      const lz = e.z - back;
      return [car.x + e.x * c + lz * s, car.z - e.x * s + lz * c];
    };

    // Turbo alevi
    if (car.boostTime > 0) {
      for (const e of exhaust) {
        if (!this.sparks.maybe(0.9 * rate)) continue;
        const [x, z] = at(e, 0.12);
        this.sparks.emit({
          x,
          y: e.y,
          z,
          vx: vx * 0.6 - s * 6,
          vy: (Math.random() - 0.3) * 0.6,
          vz: vz * 0.6 - c * 6,
          life: 0.16 + Math.random() * 0.08,
          size: 0.55,
          sizeEnd: 0.1,
          r: 0.6,
          g: 1.6,
          b: 2.6,
          alpha: 0.9,
          drag: 3,
        });
      }
    }

    // Geri tepme: hızlıyken gaz birden kesilince egzozdan art arda turuncu patlamalar
    const throttle = car.input.throttle;
    if (this.lastThrottle > 0.6 && throttle < 0.15 && speed > 14 && car.boostTime <= 0 && Math.random() < 0.8) {
      this.pops.length = 0;
      let t = 0.03;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.pops.push(t);
        t += 0.06 + Math.random() * 0.1;
      }
    }
    this.lastThrottle = throttle;
    if (throttle > 0.5) this.pops.length = 0;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i] -= dt;
      if (this.pops[i] > 0) continue;
      this.pops.splice(i, 1);
      this.onBackfire?.();
      for (const e of exhaust) {
        const [x, z] = at(e, 0.06);
        // Ateş topu çekirdeği + saçılan kıvılcımlar
        this.sparks.emit({
          x,
          y: e.y,
          z,
          vx: vx * 0.9 - s * 2,
          vy: 0,
          vz: vz * 0.9 - c * 2,
          life: 0.07,
          size: 0.95,
          sizeEnd: 0.3,
          r: 2.8,
          g: 1.3,
          b: 0.35,
          alpha: 1,
          drag: 6,
        });
        const n = Math.ceil(8 * this.sparks.scale);
        for (let k = 0; k < n; k++) {
          const hot = Math.random();
          this.sparks.emit({
            x,
            y: e.y,
            z,
            vx: vx * 0.8 - s * (2 + Math.random() * 4) + (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.2) * 1.2,
            vz: vz * 0.8 - c * (2 + Math.random() * 4) + (Math.random() - 0.5) * 1.2,
            life: 0.08 + Math.random() * 0.1,
            size: 0.4 + Math.random() * 0.35,
            sizeEnd: 0.06,
            r: 2.6,
            g: 0.9 + hot * 0.9,
            b: 0.2 + hot * 0.3,
            alpha: 0.95,
            drag: 5,
          });
        }
      }
    }

    // Yavaşken gaza basınca egzozdan ince buhar
    if (throttle > 0.3 && speed < 14 && !car.drifting) {
      for (const e of exhaust) {
        if (!this.smoke.maybe(0.25 * rate)) continue;
        const [x, z] = at(e, 0.05);
        this.smoke.emit({
          x,
          y: e.y,
          z,
          vx: vx * 0.4 - s * 1.2 + (Math.random() - 0.5) * 0.4,
          vy: 0.3 + Math.random() * 0.3,
          vz: vz * 0.4 - c * 1.2 + (Math.random() - 0.5) * 0.4,
          life: 0.8,
          size: 0.2,
          sizeEnd: 1.1,
          r: 0.5,
          g: 0.5,
          b: 0.62,
          alpha: 0.13,
          drag: 2.5,
          gravity: -0.3,
        });
      }
    }
  }

  wallHit(hit: WallHit, speed: number): void {
    const n = Math.min(40, Math.floor(hit.strength * 2.2 + 3)) * this.sparks.scale;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 8;
      this.sparks.emit({
        x: hit.x,
        y: 0.3 + Math.random() * 0.6,
        z: hit.z,
        vx: -hit.nx * (2 + Math.random() * 4) + -hit.nz * spread + (Math.random() - 0.5) * speed * 0.15,
        vy: 1 + Math.random() * 4,
        vz: -hit.nz * (2 + Math.random() * 4) + hit.nx * spread + (Math.random() - 0.5) * speed * 0.15,
        life: 0.3 + Math.random() * 0.4,
        size: 0.14,
        sizeEnd: 0.03,
        r: 3,
        g: 1.9,
        b: 0.8,
        alpha: 1,
        drag: 1.5,
        gravity: 12,
      });
    }
  }

  /** Bitiş havai fişeği. */
  firework(x: number, y: number, z: number): void {
    const palette = [MAG, CYAN, new Color(0xffb547), new Color(0x8b6cff), new Color(0x3dffa0)];
    const c = palette[Math.floor(Math.random() * palette.length)];
    const n = Math.floor(90 * Math.max(0.4, this.sparks.scale));
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 9 + Math.random() * 5;
      this.sparks.emit({
        x,
        y,
        z,
        vx: r * Math.cos(th) * sp,
        vy: u * sp + 2,
        vz: r * Math.sin(th) * sp,
        life: 1.2 + Math.random() * 0.6,
        size: 0.9,
        sizeEnd: 0.2,
        r: c.r * 3,
        g: c.g * 3,
        b: c.b * 3,
        alpha: 1,
        drag: 1.2,
        gravity: 5,
      });
    }
  }

  dispose(): void {
    this.skids.dispose();
    this.smoke.dispose();
    this.sparks.dispose();
    this.speedLines.dispose();
  }
}
