import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  type PerspectiveCamera,
} from 'three';

/** Yüksek hızda kameranın etrafından akan ince ışık çizgileri (kamera uzayında). */
export class SpeedLines {
  readonly lines: LineSegments;
  private readonly count: number;
  private readonly pos: Float32Array;
  private readonly z: Float32Array;
  private readonly material: LineBasicMaterial;
  private readonly base = new Color(0xc9b8ff);
  private readonly boostTint = new Color(0x7ff0ff).multiplyScalar(2.4);
  enabled = true;

  constructor(camera: PerspectiveCamera, count = 90) {
    this.count = count;
    this.pos = new Float32Array(count * 6);
    this.z = new Float32Array(count);
    for (let i = 0; i < count; i++) this.respawn(i, -10 - Math.random() * 80);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.material = new LineBasicMaterial({
      color: this.base.clone(),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.lines = new LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    camera.add(this.lines);
  }

  private respawn(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = 2.6 + Math.random() * 9;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.6 + 0.6;
    const p = i * 6;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 3] = x;
    this.pos[p + 4] = y;
    this.z[i] = z;
  }

  /** `intensity` 0..1 (hız + turbo). */
  update(dt: number, speed: number, intensity: number, boost: boolean): void {
    const visible = this.enabled && intensity > 0.01;
    this.lines.visible = visible;
    if (!visible) return;
    const len = 2 + intensity * 7;
    const v = speed * 1.6 + 20;
    for (let i = 0; i < this.count; i++) {
      this.z[i] += v * dt;
      if (this.z[i] > -1.5) this.respawn(i, -70 - Math.random() * 20);
      const p = i * 6;
      this.pos[p + 2] = this.z[i];
      this.pos[p + 5] = this.z[i] - len;
    }
    (this.lines.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    this.material.opacity = Math.min(0.75, intensity * 0.65);
    this.material.color.copy(this.base).multiplyScalar(boost ? 2.4 : 1.3);
    if (boost) this.material.color.lerp(this.boostTint, 0.5);
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
