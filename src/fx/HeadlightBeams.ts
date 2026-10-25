import { AdditiveBlending, ConeGeometry, DoubleSide, Group, Mesh, ShaderMaterial } from 'three';
import type { CarPhysics } from '../vehicle/CarPhysics';

const LENGTH = 18;

const vert = /* glsl */ `
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  // Geometri tepesi (far) orijinde, koni +Z boyunca: 0 = farda, 1 = uçta
  vAlong = clamp(position.z / ${LENGTH.toFixed(1)}, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uIntensity;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  // pow(0, y) bazı sürücülerde NaN verir; NaN bloom'la tüm ekrana yayılır → tabanı 0'dan uzak tut.
  float facing = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1e-4, 1.0);
  float fade = max(1.0 - vAlong, 1e-4);
  float a = uIntensity * pow(fade, 1.6) * smoothstep(0.0, 0.08, vAlong) * pow(facing, 1.4);
  gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * clamp(a, 0.0, 1.0), 1.0);
}`;

/** Gece sisinde farların hacimsel ışık konileri (ucuz, katmanlı saydam mesh). */
export class HeadlightBeams {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly beams: Mesh[] = [];

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uIntensity: { value: 0.16 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
    });
    const geo = new ConeGeometry(2.6, LENGTH, 24, 1, true);
    // Tepe noktasını orijine al, koniyi +Z (ileri) yönüne çevir
    geo.translate(0, -LENGTH / 2, 0);
    geo.rotateX(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const m = new Mesh(geo, this.material);
      m.renderOrder = 4;
      m.frustumCulled = false;
      m.userData.side = side;
      this.beams.push(m);
      this.group.add(m);
    }
  }

  setEnabled(on: boolean): void {
    this.group.visible = on;
  }

  /** Aracın önündeki farlara yerleştir. */
  update(car: CarPhysics, halfLength: number): void {
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    for (const b of this.beams) {
      const lx = (b.userData.side as number) * 0.6;
      const lz = halfLength - 0.15;
      b.position.set(car.x + lx * c + lz * s, 0.68, car.z - lx * s + lz * c);
      b.rotation.set(0.07, car.yaw, 0, 'YXZ');
    }
  }

  dispose(): void {
    this.beams[0]?.geometry.dispose();
    this.material.dispose();
  }
}
