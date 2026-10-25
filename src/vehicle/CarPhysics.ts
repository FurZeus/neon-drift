import { PHYSICS, type PhysicsParams } from '../config';
import type { Track, TrackQuery } from '../world/Track';

export interface DriveInput {
  /** -1 sol, +1 sağ */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 (duruyorken geri vites) */
  brake: number;
  handbrake: boolean;
}

export const NO_INPUT: Readonly<DriveInput> = { steer: 0, throttle: 0, brake: 0, handbrake: false };

export interface WallHit {
  strength: number;
  x: number;
  z: number;
  /** Çarpılan duvarın dış normali */
  nx: number;
  nz: number;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Arcade araç modeli. Burun yönü (yaw) direksiyonla döner; gidiş yönü (travel) yol
 * tutuşu oranında burun yönüne yaklaşır. Drift'te yol tutuşu düşer, araç daha keskin
 * döner ve kayar; drift ne kadar uzun tutulursa bırakınca o kadar güçlü turbo verir.
 */
export class CarPhysics {
  /** Etkin araç parametreleri (araç seçimine göre değişir). */
  p: PhysicsParams = { ...PHYSICS };
  x = 0;
  z = 0;
  yaw = 0;
  travel = 0;
  /** Gidiş yönündeki işaretli hız (m/s); negatif = geri. */
  speed = 0;
  yawRate = 0;
  steer = 0;
  grip: number = PHYSICS.gripNormal;
  slip = 0;
  /** Boylamsal ivme (görsel eğilme için, yumuşatılmış). */
  accel = 0;

  drifting = false;
  driftDir = 0;
  driftTime = 0;
  driftLevel = 0;
  private counterSteerTime = 0;

  boostTime = 0;
  boostDuration = 0;

  offroad = false;
  scraping = false;
  input: DriveInput = { ...NO_INPUT };

  onDriftStart?: () => void;
  onDriftLevel?: (level: number) => void;
  onBoost?: (level: number) => void;
  onWallHit?: (hit: WallHit) => void;

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.travel = yaw;
    this.speed = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.grip = this.p.gripNormal;
    this.slip = 0;
    this.accel = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftLevel = 0;
    this.counterSteerTime = 0;
    this.boostTime = 0;
    this.boostDuration = 0;
    this.offroad = false;
    this.scraping = false;
    this.input = { ...NO_INPUT };
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  /** Varsayılan değerlerin üzerine araç farklarını uygula. */
  setParams(overrides: Partial<PhysicsParams>): void {
    this.p = { ...PHYSICS, ...overrides };
  }

  /** En yüksek dönüş hızı (rad/s) bu hızda — otopilot da kullanır. */
  maxYawAt(speedAbs: number): number {
    const P = this.p;
    return (P.maxYawRate / (1 + speedAbs * P.yawSpeedFalloff)) * clamp(speedAbs / 5, 0, 1);
  }

  /**
   * Tek fizik adımı. `q` aracın konumu için güncel pist sorgusu olmalı; adım sonunda
   * yeni konuma göre güncellenir.
   */
  step(h: number, input: DriveInput, track: Track, q: TrackQuery): void {
    if (!(h > 0)) return; // sıfır / geçersiz adım: bölme hatası (NaN) üretme
    const P = this.p;
    this.input = input;
    const sAbsStart = Math.abs(this.speed);

    // Direksiyon yumuşatma (merkeze dönüş daha hızlı)
    const steerTarget = clamp(input.steer, -1, 1);
    const resp = Math.abs(steerTarget) < Math.abs(this.steer) ? P.steerReturn : P.steerResponse;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-resp * h));

    this.offroad = Math.abs(q.lateral) > track.roadHalfWidth + 0.4;

    // ---- Drift durumu ----
    if (!this.drifting) {
      if (input.handbrake && Math.abs(this.steer) > 0.2 && this.speed > P.driftMinSpeed) {
        this.drifting = true;
        this.driftDir = Math.sign(this.steer);
        this.driftTime = 0;
        this.driftLevel = 0;
        this.counterSteerTime = 0;
        this.onDriftStart?.();
      }
    } else {
      const counter = this.steer * this.driftDir < -0.45;
      this.counterSteerTime = counter ? this.counterSteerTime + h : 0;
      if (!input.handbrake) this.endDrift(true);
      else if (this.speed < P.driftExitSpeed || this.counterSteerTime > 0.35) this.endDrift(false);
    }

    // ---- Boylamsal ----
    let maxSpd: number = this.offroad ? P.offroadMaxSpeed : P.maxSpeed;
    if (this.boostTime > 0) maxSpd += P.boostExtraSpeed;
    const thr = clamp(input.throttle, 0, 1);
    const brk = clamp(input.brake, 0, 1);
    const dir = this.speed >= 0 ? 1 : -1;
    let acc = 0;
    if (this.speed >= -0.3) {
      if (thr > 0) {
        const t = clamp(this.speed / maxSpd, 0, 1);
        acc += P.engineAccel * thr * (1 - t * t);
      }
      if (brk > 0) {
        if (this.speed > 0.6) acc -= P.brakeDecel * brk;
        else if (thr < 0.1) acc -= P.reverseAccel * brk;
      }
    } else {
      if (brk > 0 && thr < 0.1) acc -= P.reverseAccel * brk * clamp(1 - -this.speed / P.reverseMax, 0, 1);
      if (thr > 0) acc += P.brakeDecel * thr;
    }
    if (this.boostTime > 0) {
      acc += P.boostAccel;
      this.boostTime = Math.max(0, this.boostTime - h);
    }
    if (input.handbrake && !this.drifting && this.speed > 0.5) acc -= P.handbrakeDecel;

    acc -= dir * (P.rolling + P.air * this.speed * this.speed);
    if (sAbsStart > maxSpd) acc -= dir * (sAbsStart - maxSpd) * 1.4;
    if (this.offroad) acc -= dir * P.offroadDrag * clamp(sAbsStart / 8, 0, 1);
    acc -= dir * P.slipDrag * Math.abs(Math.sin(this.slip)) * sAbsStart;

    const before = this.speed;
    this.speed += acc * h;
    if (before > 0 && this.speed < 0) this.speed = 0;
    if (before < 0 && this.speed > 0) this.speed = 0;
    if (thr === 0 && brk === 0 && Math.abs(this.speed) < 0.25) this.speed = 0;
    this.accel += ((this.speed - before) / h - this.accel) * (1 - Math.exp(-6 * h));

    // ---- Dönüş ----
    const sAbs = Math.abs(this.speed);
    const lowF = clamp(sAbs / 5, 0, 1);
    let yawTarget: number;
    if (this.drifting) {
      const falloff = 1 / (1 + sAbs * P.driftYawFalloff);
      yawTarget = -(this.driftDir * P.driftBaseYaw + this.steer * P.driftSteerYaw) * falloff * lowF;
      // Kontra direksiyon dönüşü yavaşlatır ama ters yöne savurmaz.
      if (yawTarget * -this.driftDir < 0.15) yawTarget = -this.driftDir * 0.15 * lowF;
    } else {
      yawTarget = -this.steer * this.maxYawAt(sAbs) * (this.speed >= 0 ? 1 : -1);
      if (this.offroad) yawTarget *= 0.8;
    }
    const yawResp = this.drifting ? 6 : 10;
    this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-yawResp * h));
    this.yaw = wrapAngle(this.yaw + this.yawRate * h);

    // ---- Yol tutuşu: gidiş yönü burun yönünü izler ----
    const gripTarget = this.drifting ? P.gripDrift : this.offroad ? P.gripOffroad : P.gripNormal;
    const gResp = gripTarget < this.grip ? 14 : 3.2;
    this.grip += (gripTarget - this.grip) * (1 - Math.exp(-gResp * h));
    const g = this.grip + (sAbs < 4 ? (4 - sAbs) * 8 : 0);
    const diff = wrapAngle(this.yaw - this.travel);
    this.travel = wrapAngle(this.travel + diff * (1 - Math.exp(-g * h)));
    this.slip = wrapAngle(this.yaw - this.travel);
    if (Math.abs(this.slip) > P.maxSlip) {
      this.travel = wrapAngle(this.yaw - Math.sign(this.slip) * P.maxSlip);
      this.slip = Math.sign(this.slip) * P.maxSlip;
    }

    // ---- Drift şarjı ----
    if (this.drifting) {
      if (Math.abs(this.slip) > 0.2 && this.speed > 10 && !this.offroad) this.driftTime += h;
      const lvl =
        this.driftTime >= P.boostLevel2Time ? 2 : this.driftTime >= P.boostLevel1Time ? 1 : 0;
      if (lvl > this.driftLevel) {
        this.driftLevel = lvl;
        this.onDriftLevel?.(lvl);
      }
    }

    // ---- Konum ----
    this.x += Math.sin(this.travel) * this.speed * h;
    this.z += Math.cos(this.travel) * this.speed * h;

    track.query(this.x, this.z, q.index, q);
    this.resolveWalls(h, track, q);
  }

  private resolveWalls(h: number, track: Track, q: TrackQuery): void {
    const P = this.p;
    this.scraping = false;
    // Açık yolun iki ucu: ileri/geri duvar
    if (!track.closed) {
      const along = (this.x - q.cx) * q.tx + (this.z - q.cz) * q.tz;
      const atStart = q.s <= 0.01 && along < 0;
      const atEnd = q.s >= track.length - 0.01 && along > 0;
      if (atStart || atEnd) {
        const dir = atEnd ? 1 : -1;
        this.x -= q.tx * along;
        this.z -= q.tz * along;
        const vx = Math.sin(this.travel) * this.speed;
        const vz = Math.cos(this.travel) * this.speed;
        const vt = (vx * q.tx + vz * q.tz) * dir;
        if (vt > 0) this.applyVelocity(vx - q.tx * vt * dir, vz - q.tz * vt * dir);
      }
    }
    const limit = track.barrierOffset - P.carHalfWidth;
    if (Math.abs(q.lateral) <= limit) return;
    // Duvara yaslanarak viraj almak cezalı: temas sürdükçe hız erir.
    this.scraping = true;
    this.speed *= Math.exp(-P.wallScrapeDrag * h);

    const side = Math.sign(q.lateral);
    const onx = q.nx * side;
    const onz = q.nz * side;
    const push = Math.abs(q.lateral) - limit;
    this.x -= onx * push;
    this.z -= onz * push;
    q.lateral -= side * push;

    let vx = Math.sin(this.travel) * this.speed;
    let vz = Math.cos(this.travel) * this.speed;
    const vn = vx * onx + vz * onz;
    if (vn <= 0) return;

    vx -= (1 + P.wallRestitution) * vn * onx;
    vz -= (1 + P.wallRestitution) * vn * onz;
    const f = 1 - clamp((P.wallFriction * vn) / 12, 0.02, 0.6);
    vx *= f;
    vz *= f;
    const mag = Math.hypot(vx, vz);
    const hx = Math.sin(this.yaw);
    const hz = Math.cos(this.yaw);
    const fwd = vx * hx + vz * hz;
    this.speed = fwd >= 0 ? mag : -mag;
    if (mag > 0.5) this.travel = fwd >= 0 ? Math.atan2(vx, vz) : Math.atan2(-vx, -vz);
    // Duvara sürtünürken burun duvara paralelleşir.
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.travel - this.yaw) * clamp(vn / 18, 0.08, 0.5));
    this.yawRate *= 0.6;
    this.slip = wrapAngle(this.yaw - this.travel);
    if (vn > 3 && this.drifting) this.endDrift(false);

    this.onWallHit?.({
      strength: vn,
      x: this.x + onx * P.carHalfWidth,
      z: this.z + onz * P.carHalfWidth,
      nx: onx,
      nz: onz,
    });
  }

  /** Dünya hız vektörünü doğrudan ayarla (çarpışma yanıtı); işaretli hız ve gidiş yönü güncellenir. */
  applyVelocity(vx: number, vz: number): void {
    const mag = Math.hypot(vx, vz);
    const fwd = vx * Math.sin(this.yaw) + vz * Math.cos(this.yaw);
    this.speed = fwd >= 0 ? mag : -mag;
    if (mag > 0.3) this.travel = fwd >= 0 ? Math.atan2(vx, vz) : Math.atan2(-vx, -vz);
    this.slip = wrapAngle(this.yaw - this.travel);
    if (Math.abs(this.slip) > this.p.maxSlip) {
      this.travel = wrapAngle(this.yaw - Math.sign(this.slip) * this.p.maxSlip);
      this.slip = Math.sign(this.slip) * this.p.maxSlip;
    }
  }

  /** Çarpışma sonrası: drifti bitir, dönüşü sars. */
  knock(strength: number, spin: number): void {
    if (strength > 3 && this.drifting) this.endDrift(false);
    this.yawRate += spin;
  }

  private endDrift(award: boolean): void {
    const P = this.p;
    if (award && this.driftLevel > 0) {
      const dur = this.driftLevel === 2 ? P.boostDuration2 : P.boostDuration1;
      this.boostTime = Math.max(this.boostTime, dur);
      this.boostDuration = this.boostTime;
      this.onBoost?.(this.driftLevel);
    }
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftLevel = 0;
    this.counterSteerTime = 0;
  }

  /** Drift şarjının 0..1 arası gösterimi (HUD). */
  get driftCharge(): number {
    if (!this.drifting) return 0;
    return clamp(this.driftTime / this.p.boostLevel2Time, 0, 1);
  }
}
