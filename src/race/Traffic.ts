import { AdditiveBlending, Color, Group, Sprite, SpriteMaterial, type Scene } from 'three';
import type { CarPhysics } from '../vehicle/CarPhysics';
import { radialGlowTexture } from '../world/textures';
import { createTrackQuery, Track } from '../world/Track';
import { laneOffsets } from '../world/tracks';
import type { TrafficFactory, TrafficTemplate } from './TrafficFactory';

interface TrafficCar {
  obj: Group;
  tpl: TrafficTemplate;
  s: number;
  lateral: number;
  targetLateral: number;
  /** +1 gidiş yönü (s artar), −1 karşı yön. */
  dir: 1 | -1;
  speed: number;
  desired: number;
  latVel: number;
  yawOff: number;
  yawVel: number;
  bumped: number;
  blocked: number;
  braking: boolean;
  tails: Sprite[];
  active: boolean;
}

export interface TrafficHit {
  strength: number;
  x: number;
  z: number;
  nx: number;
  nz: number;
}

const FORWARD_COUNT = 13;
const ONCOMING_COUNT = 12;
const BEHIND = 160;
const AHEAD = 950;

/**
 * Otoyol trafiği: şeritlerde akan, öndekini izleyen, tıkanınca şerit değiştiren, oyuncunun
 * önüne çıktığında fren yapan araçlar. Oyuncu ile yönlü kutu (OBB) çarpışması ve itki yanıtı.
 */
export class Traffic {
  readonly group = new Group();
  private readonly cars: TrafficCar[] = [];
  private readonly lanes: { forward: number[]; oncoming: number[] };
  private readonly q = createTrackQuery();
  private readonly headMat: SpriteMaterial;
  private readonly tailMat: SpriteMaterial;
  private readonly brakeMat: SpriteMaterial;
  private readonly minS: number;
  private readonly maxS: number;
  /** Bu yarıştaki çarpışma sayısı (HUD). */
  crashes = 0;

  constructor(
    private readonly scene: Scene,
    private readonly track: Track,
    factory: TrafficFactory,
  ) {
    this.lanes = laneOffsets(track.def);
    this.minS = 30;
    this.maxS = track.length - 30;
    const glow = radialGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.3)');
    const spriteMat = (c: Color) =>
      new SpriteMaterial({ map: glow, color: c, blending: AdditiveBlending, depthWrite: false, transparent: true });
    this.headMat = spriteMat(new Color(0.9, 0.95, 1).multiplyScalar(2.2));
    this.tailMat = spriteMat(new Color(1, 0.05, 0.08).multiplyScalar(1.3));
    this.brakeMat = spriteMat(new Color(1, 0.05, 0.08).multiplyScalar(3.4));

    const total = FORWARD_COUNT + ONCOMING_COUNT;
    for (let i = 0; i < total; i++) {
      const tpl = factory.pick();
      const obj = new Group();
      obj.add(tpl.object.clone(true));
      const tails: Sprite[] = [];
      for (const side of [-1, 1]) {
        const head = new Sprite(this.headMat);
        head.position.set(side * tpl.halfWidth * 0.68, Math.min(0.7, tpl.height * 0.5), tpl.halfLength + 0.05);
        head.scale.setScalar(1.1);
        const tail = new Sprite(this.tailMat);
        tail.position.set(side * tpl.halfWidth * 0.72, Math.min(0.9, tpl.height * 0.62), -tpl.halfLength - 0.05);
        tail.scale.setScalar(0.85);
        obj.add(head, tail);
        tails.push(tail);
      }
      this.cars.push({
        obj,
        tpl,
        s: 0,
        lateral: 0,
        targetLateral: 0,
        dir: i < FORWARD_COUNT ? 1 : -1,
        speed: 0,
        desired: 0,
        latVel: 0,
        yawOff: 0,
        yawVel: 0,
        bumped: 0,
        blocked: 0,
        braking: false,
        tails,
        active: false,
      });
      this.group.add(obj);
    }
    scene.add(this.group);
  }

  private laneList(dir: 1 | -1): number[] {
    return dir > 0 ? this.lanes.forward : this.lanes.oncoming;
  }

  private desiredFor(dir: 1 | -1, lateral: number): number {
    // İç şerit (orta çizgiye yakın) daha hızlı akar
    const inner = Math.abs(lateral) < (this.lanes.forward[1] ?? 99) - 0.5;
    const base = dir > 0 ? (inner ? 29 : 23) : inner ? 30 : 25;
    return base + (Math.random() - 0.5) * 5;
  }

  /** Şerit ve s etrafında boşluk var mı. */
  private laneFree(s: number, lateral: number, dir: number, ahead: number, behind: number, except?: TrafficCar): boolean {
    for (const c of this.cars) {
      if (!c.active || c === except || c.dir !== dir) continue;
      if (Math.abs(c.lateral - lateral) > 2 && Math.abs(c.targetLateral - lateral) > 2) continue;
      const d = (c.s - s) * dir;
      if (d < ahead && d > -behind) return false;
    }
    return true;
  }

  private spawn(c: TrafficCar, s0: number, s1: number): void {
    const lanes = this.laneList(c.dir);
    for (let attempt = 0; attempt < 12; attempt++) {
      const s = s0 + Math.random() * (s1 - s0);
      const lateral = lanes[Math.floor(Math.random() * lanes.length)];
      if (s < this.minS || s > this.maxS) continue;
      if (!this.laneFree(s, lateral, c.dir, 32, 32, c)) continue;
      c.s = s;
      c.lateral = c.targetLateral = lateral;
      c.desired = this.desiredFor(c.dir, lateral);
      c.speed = c.desired;
      c.latVel = c.yawOff = c.yawVel = c.bumped = c.blocked = 0;
      c.active = true;
      c.obj.visible = true;
      return;
    }
    c.active = false;
    c.obj.visible = false;
  }

  /** Yarış başında: başlangıcın önünden itibaren yolu doldur. */
  reset(playerS: number): void {
    this.crashes = 0;
    for (const c of this.cars) c.active = false;
    for (const c of this.cars) {
      if (c.dir > 0) this.spawn(c, playerS + 70, playerS + 800);
      else this.spawn(c, playerS + 120, playerS + AHEAD);
    }
    this.place();
  }

  /** Piste dönüşte oyuncunun etrafını boşalt. */
  clearAround(s: number, radius: number): void {
    for (const c of this.cars) {
      if (c.active && Math.abs(c.s - s) < radius) this.spawn(c, s + 500, s + AHEAD);
    }
  }

  update(dt: number, player: CarPhysics, playerS: number, playerLateral: number): TrafficHit | null {
    const t = this.track;
    // Oyuncunun pist boyunca hızı (+s yönünde)
    t.frameAt(playerS, this.q);
    const pvx = Math.sin(player.travel) * player.speed;
    const pvz = Math.cos(player.travel) * player.speed;
    const playerAlong = pvx * this.q.tx + pvz * this.q.tz;

    for (const c of this.cars) {
      if (!c.active) continue;
      // ---- Takip: aynı şeritte öndeki araç ya da oyuncu ----
      let target = c.desired;
      let gapMin = Infinity;
      for (const o of this.cars) {
        if (o === c || !o.active || o.dir !== c.dir || Math.abs(o.lateral - c.lateral) > 2.2) continue;
        const gap = (o.s - c.s) * c.dir - o.tpl.halfLength - c.tpl.halfLength;
        if (gap > 0 && gap < gapMin) {
          gapMin = gap;
          if (gap < 34) target = Math.min(target, o.speed - (34 - gap) * 0.25);
        }
      }
      if (Math.abs(playerLateral - c.lateral) < 2.4) {
        const gap = (playerS - c.s) * c.dir - c.tpl.halfLength - 2.2;
        const pv = playerAlong * c.dir;
        if (gap > -1 && gap < (c.dir > 0 ? 40 : 70)) {
          target = Math.min(target, c.dir > 0 ? pv - (40 - gap) * 0.3 : c.desired * 0.35);
        }
      }
      if (c.bumped > 0) {
        c.bumped -= dt;
        target = Math.min(target, c.desired * 0.4);
      }
      target = Math.max(0, target);
      c.braking = target < c.speed - 0.5;
      c.speed += Math.max(-8 * dt, Math.min(3 * dt, target - c.speed));

      // ---- Şerit değiştirme (yalnızca gidiş yönü) ----
      if (c.dir > 0 && c.bumped <= 0) {
        c.blocked = target < c.desired - 4 ? c.blocked + dt : 0;
        if (c.blocked > 1.4 && Math.abs(c.lateral - c.targetLateral) < 0.1) {
          for (const lane of this.lanes.forward) {
            if (Math.abs(lane - c.lateral) < 0.5) continue;
            if (this.laneFree(c.s, lane, 1, 30, 14, c)) {
              c.targetLateral = lane;
              c.desired = this.desiredFor(1, lane);
              c.blocked = 0;
              break;
            }
          }
        }
      }
      const dl = c.targetLateral - c.lateral;
      c.lateral += Math.sign(dl) * Math.min(Math.abs(dl), 1.3 * dt);
      // Çarpışma itkisi
      c.lateral += c.latVel * dt;
      c.latVel *= Math.exp(-2.5 * dt);
      c.yawOff += c.yawVel * dt;
      c.yawVel *= Math.exp(-1.8 * dt);
      c.yawOff *= Math.exp(-0.8 * dt);
      const edge = this.track.roadHalfWidth - c.tpl.halfWidth;
      c.lateral = Math.max(-edge, Math.min(edge, c.lateral));
      if (c.bumped <= 0 && Math.abs(c.latVel) < 0.3) {
        // Savrulan araç kendi şeridine geri döner
        const lanes = this.laneList(c.dir);
        if (!lanes.some((l) => Math.abs(l - c.targetLateral) < 0.1)) {
          c.targetLateral = lanes.reduce((a, b) => (Math.abs(b - c.lateral) < Math.abs(a - c.lateral) ? b : a));
        }
      }

      c.s += c.speed * c.dir * dt;

      // ---- Görünüm penceresi dışına çıkanı yeniden yerleştir ----
      const rel = c.s - playerS;
      if (rel < -BEHIND || c.s < this.minS || c.s > this.maxS) {
        if (c.dir > 0) this.spawn(c, playerS + 600, playerS + 900);
        else this.spawn(c, playerS + 700, playerS + AHEAD);
      } else if (rel > AHEAD + 40) {
        if (c.dir > 0) this.spawn(c, playerS - BEHIND + 10, playerS - 90);
        else this.spawn(c, playerS + 600, playerS + AHEAD);
      }
    }
    this.place();
    return this.collide(player);
  }

  private place(): void {
    for (const c of this.cars) {
      if (!c.active) continue;
      this.track.frameAt(c.s, this.q);
      c.obj.position.set(this.q.cx + this.q.nx * c.lateral, 0, this.q.cz + this.q.nz * c.lateral);
      c.obj.rotation.y = Track.yawOf(this.q.tx, this.q.tz) + (c.dir < 0 ? Math.PI : 0) + c.yawOff;
      const mat = c.braking ? this.brakeMat : this.tailMat;
      for (const t of c.tails) if (t.material !== mat) t.material = mat;
    }
  }

  /** Oyuncu ile en derin çakışan trafik aracı arasında itki yanıtı. */
  private collide(player: CarPhysics): TrafficHit | null {
    const px = player.x;
    const pz = player.z;
    let hit: TrafficHit | null = null;
    for (const c of this.cars) {
      if (!c.active) continue;
      const bx = c.obj.position.x;
      const bz = c.obj.position.z;
      if (Math.abs(bx - px) > 7 || Math.abs(bz - pz) > 7) continue;
      const res = obb(
        px,
        pz,
        player.yaw,
        player.p.carHalfLength,
        player.p.carHalfWidth,
        bx,
        bz,
        c.obj.rotation.y,
        c.tpl.halfLength,
        c.tpl.halfWidth,
      );
      if (!res) continue;
      const { depth, nx, nz } = res; // normal: trafik → oyuncu
      // Ayır
      player.x += nx * depth * 0.65;
      player.z += nz * depth * 0.65;
      this.track.frameAt(c.s, this.q);
      const pushAlong = -(nx * this.q.tx + nz * this.q.tz) * depth * 0.35;
      const pushLat = -(nx * this.q.nx + nz * this.q.nz) * depth * 0.35;
      c.s += pushAlong;
      c.lateral += pushLat;

      // Göreli hız ve itki (trafik aracı biraz daha ağır)
      const avx = Math.sin(player.travel) * player.speed;
      const avz = Math.cos(player.travel) * player.speed;
      const bvx = this.q.tx * c.speed * c.dir + this.q.nx * c.latVel;
      const bvz = this.q.tz * c.speed * c.dir + this.q.nz * c.latVel;
      const vn = (avx - bvx) * nx + (avz - bvz) * nz;
      if (vn >= 0) continue;
      const e = 0.25;
      const mA = 1;
      const mB = 1.3;
      const j = (-(1 + e) * vn) / (1 / mA + 1 / mB);
      // Sürtünme: teğetsel göreli hızın bir kısmını da sönümle
      const rtx = avx - bvx - vn * nx;
      const rtz = avz - bvz - vn * nz;
      const fr = 0.18;
      player.applyVelocity(avx + (j * nx) / mA - rtx * fr, avz + (j * nz) / mA - rtz * fr);
      const strength = -vn;
      player.knock(strength, (Math.random() - 0.5) * Math.min(2.5, strength * 0.06));
      const nbx = bvx - (j * nx) / mB + rtx * fr * 0.5;
      const nbz = bvz - (j * nz) / mB + rtz * fr * 0.5;
      c.speed = Math.max(0, (nbx * this.q.tx + nbz * this.q.tz) * c.dir);
      c.latVel = nbx * this.q.nx + nbz * this.q.nz;
      c.yawVel += (Math.random() - 0.5) * Math.min(3, strength * 0.09);
      c.bumped = Math.min(4, 1 + strength * 0.12);
      if (strength > 4) this.crashes++;
      if (!hit || strength > hit.strength) {
        hit = { strength, x: (px + bx) / 2, z: (pz + bz) / 2, nx, nz };
      }
    }
    return hit;
  }

  /** Oyuncunun önündeki en yakın aynı yönlü aracın uzaklığı (otopilot şerit seçimi için). */
  gapAhead(s: number, lateral: number, dir: 1 | -1 = 1): { gap: number; speed: number } {
    let gap = Infinity;
    let speed = 0;
    for (const c of this.cars) {
      if (!c.active || Math.abs(c.lateral - lateral) > 2.2) continue;
      const d = (c.s - s) * dir;
      if (d > 0 && d < gap) {
        gap = d;
        speed = c.speed * c.dir * dir;
      }
    }
    return { gap, speed };
  }

  /** Yansıma çiziminde uzak araçları gizlemek için. */
  setFarHidden(camX: number, camZ: number, radius: number, hidden: boolean): void {
    for (const c of this.cars) {
      if (!c.active) continue;
      if (!hidden) c.obj.visible = true;
      else if (Math.hypot(c.obj.position.x - camX, c.obj.position.z - camZ) > radius) c.obj.visible = false;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.headMat.dispose();
    this.tailMat.dispose();
    this.brakeMat.dispose();
  }
}

/** İki yönlü kutunun (XZ) ayrık eksen testi; çakışma derinliği ve B→A normali. */
function obb(
  ax: number,
  az: number,
  ayaw: number,
  ahl: number,
  ahw: number,
  bx: number,
  bz: number,
  byaw: number,
  bhl: number,
  bhw: number,
): { depth: number; nx: number; nz: number } | null {
  const afx = Math.sin(ayaw);
  const afz = Math.cos(ayaw);
  const bfx = Math.sin(byaw);
  const bfz = Math.cos(byaw);
  const axes = [
    [afx, afz],
    [afz, -afx],
    [bfx, bfz],
    [bfz, -bfx],
  ];
  const dx = ax - bx;
  const dz = az - bz;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  for (const [ux, uz] of axes) {
    const ra = ahl * Math.abs(afx * ux + afz * uz) + ahw * Math.abs(afz * ux - afx * uz);
    const rb = bhl * Math.abs(bfx * ux + bfz * uz) + bhw * Math.abs(bfz * ux - bfx * uz);
    const d = dx * ux + dz * uz;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      const sgn = d >= 0 ? 1 : -1;
      bnx = ux * sgn;
      bnz = uz * sgn;
    }
  }
  return { depth: best, nx: bnx, nz: bnz };
}
