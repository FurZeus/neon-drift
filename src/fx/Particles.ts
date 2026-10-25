import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
} from 'three';

const vert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
uniform float uSoft;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, uSoft, d) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  r: number;
  g: number;
  b: number;
  alpha?: number;
  drag?: number;
  gravity?: number;
}

/** CPU güdümlü, tek çizim çağrılı parçacık havuzu. */
export class ParticleSystem {
  readonly points: Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly material: ShaderMaterial;
  private cursor = 0;
  private alive = 0;
  /** Kaliteye göre emisyon ölçeği (0..1). */
  scale = 1;

  constructor(max: number, blending: Blending = AdditiveBlending, soft = 0.0) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    g.setAttribute('aColor', new BufferAttribute(this.col, 3).setUsage(35048));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1).setUsage(35048));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(35048));
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  static additive(max: number): ParticleSystem {
    return new ParticleSystem(max, AdditiveBlending, 0.05);
  }

  static smoke(max: number): ParticleSystem {
    return new ParticleSystem(max, NormalBlending, 0.0);
  }

  /** Ekran yüksekliği (piksel) ve dikey FOV'a göre nokta boyutu ölçeği. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = i * 3;
    this.pos[p] = o.x;
    this.pos[p + 1] = o.y;
    this.pos[p + 2] = o.z;
    this.vel[p] = o.vx ?? 0;
    this.vel[p + 1] = o.vy ?? 0;
    this.vel[p + 2] = o.vz ?? 0;
    this.col[p] = o.r;
    this.col[p + 1] = o.g;
    this.col[p + 2] = o.b;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.sizeEnd ?? o.size;
    this.alpha0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.size[i] = o.size;
    this.alpha[i] = this.alpha0[i];
  }

  /** Kalite ölçeğine göre olasılıklı emisyon. */
  maybe(chance: number): boolean {
    return Math.random() < chance * this.scale;
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const p = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[p] *= dr;
      this.vel[p + 1] = this.vel[p + 1] * dr - this.grav[i] * dt;
      this.vel[p + 2] *= dr;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      if (this.pos[p + 1] < 0.02 && this.vel[p + 1] < 0) {
        this.pos[p + 1] = 0.02;
        this.vel[p + 1] *= -0.35;
      }
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    if (alive === 0 && this.alive === 0) return;
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    const g = this.points.geometry;
    g.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
