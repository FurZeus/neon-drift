import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial } from 'three';

const vert = /* glsl */ `
attribute vec4 aColor;
attribute float aBirth;
uniform float uTime;
uniform float uLife;
varying vec4 vColor;
void main() {
  float age = uTime - aBirth;
  float fade = clamp(1.0 - age / uLife, 0.0, 1.0);
  vColor = vec4(aColor.rgb, aColor.a * fade * fade);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec4 vColor;
void main() {
  if (vColor.a < 0.004) discard;
  gl_FragColor = vColor;
}`;

interface WheelTrail {
  x: number;
  z: number;
  active: boolean;
}

/** Halka arabellekli lastik izleri; eski izler zamanla solar. */
export class SkidMarks {
  readonly mesh: Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly birth: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly birthAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  private cursor = 0;
  private readonly trails: WheelTrail[] = [];
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private readonly halfWidth = 0.15;

  constructor(maxSegments = 1600) {
    this.max = maxSegments;
    this.pos = new Float32Array(maxSegments * 4 * 3);
    this.col = new Float32Array(maxSegments * 4 * 4);
    this.birth = new Float32Array(maxSegments * 4).fill(-1e6);
    const idx = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 4);
    this.birthAttr = new BufferAttribute(this.birth, 1);
    this.posAttr.setUsage(35048); // DynamicDrawUsage
    this.colAttr.setUsage(35048);
    this.birthAttr.setUsage(35048);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aBirth', this.birthAttr);
    g.setIndex(new BufferAttribute(idx, 1));
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uLife: { value: 14 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    for (let i = 0; i < 4; i++) this.trails.push({ x: 0, z: 0, active: false });
  }

  /** `wheel` için iz noktası ekle. Aktif değilse yeni şerit başlatır. */
  add(wheel: number, x: number, z: number, strength: number, color: Color, time: number): void {
    const t = this.trails[wheel];
    if (!t.active) {
      t.x = x;
      t.z = z;
      t.active = true;
      return;
    }
    const dx = x - t.x;
    const dz = z - t.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return;
    if (d > 4) {
      t.x = x;
      t.z = z;
      return;
    }
    const px = (-dz / d) * this.halfWidth;
    const pz = (dx / d) * this.halfWidth;
    const y = 0.03;
    const i = this.cursor;
    const p = i * 12;
    this.pos.set([t.x + px, y, t.z + pz, t.x - px, y, t.z - pz, x + px, y, z + pz, x - px, y, z - pz], p);
    const a = Math.min(1, strength);
    const c = i * 16;
    for (let k = 0; k < 4; k++) {
      this.col[c + k * 4] = color.r;
      this.col[c + k * 4 + 1] = color.g;
      this.col[c + k * 4 + 2] = color.b;
      this.col[c + k * 4 + 3] = a * 0.75;
      this.birth[i * 4 + k] = time;
    }
    this.markDirty(i);
    this.cursor = (this.cursor + 1) % this.max;
    t.x = x;
    t.z = z;
  }

  end(wheel: number): void {
    this.trails[wheel].active = false;
  }

  clear(): void {
    this.birth.fill(-1e6);
    this.birthAttr.needsUpdate = true;
    this.trails.forEach((t) => (t.active = false));
  }

  private markDirty(i: number): void {
    if (this.dirtyFrom < 0) {
      this.dirtyFrom = this.dirtyTo = i;
    } else if (i < this.dirtyFrom) {
      // Halka başa döndü: tümünü güncelle
      this.dirtyFrom = 0;
      this.dirtyTo = this.max - 1;
    } else {
      this.dirtyTo = Math.max(this.dirtyTo, i);
    }
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (this.dirtyFrom < 0) return;
    const from = this.dirtyFrom;
    const count = this.dirtyTo - this.dirtyFrom + 1;
    for (const [attr, size] of [
      [this.posAttr, 12],
      [this.colAttr, 16],
      [this.birthAttr, 4],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(from * size, count * size);
      attr.needsUpdate = true;
    }
    this.dirtyFrom = this.dirtyTo = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
