import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../config';
import { neon } from './TrackMesh';
import { createTrackQuery, Track } from './Track';
import { radialGlowTexture, rng, textTexture, windowTexture } from './textures';

export const FOG_COLOR = new Color(0x0d0620);

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.7, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.16, h));
  col = mix(col, uTop, smoothstep(0.14, 0.75, h));
  // Şehir ışıklarının ufuktaki parıltısı
  col += uGlow * exp(-abs(h - 0.01) * 22.0) * 0.9;
  col += uGlow * 0.25 * exp(-abs(h) * 6.0);
  // Yıldızlar (hücre tabanlı, hafif yanıp sönme)
  if (h > 0.06) {
    vec3 cell = floor(d * 220.0);
    float r = hash(cell);
    if (r > 0.9965) {
      vec3 center = (cell + 0.5) / 220.0;
      float dist = length(d - normalize(center)) * 220.0;
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 6.0) + r * 40.0);
      col += vec3(0.85, 0.82, 1.0) * smoothstep(0.55, 0.0, dist) * tw * smoothstep(0.06, 0.3, h);
    }
  }
  if (h < 0.0) col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const groundVert = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const groundFrag = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uMajor;
varying vec3 vWorld;
#include <fog_pars_fragment>

float grid(vec2 p, float cell, float width) {
  vec2 g = p / cell;
  vec2 w = fwidth(g);
  vec2 a = abs(fract(g - 0.5) - 0.5) / max(w, vec2(1e-4));
  float l = 1.0 - min(min(a.x, a.y) / width, 1.0);
  // Uzakta moiré'yi bastır
  return l * (1.0 - smoothstep(0.25, 0.9, max(w.x, w.y)));
}

void main() {
  float minor = grid(vWorld.xz, 10.0, 1.0);
  float major = grid(vWorld.xz, 50.0, 1.6);
  vec3 col = uBase + uLine * minor * 0.55 + uMajor * major;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Environment {
  readonly group = new Group();
  readonly sun: DirectionalLight;
  /** Izgara zemin (yansımada gizlenir). */
  ground!: Mesh;
  private readonly sky: ShaderMaterial;
  private readonly beacons: InstancedMesh;
  private readonly beaconMat: MeshBasicMaterial;
  private readonly materials: Material[] = [];
  private readonly sunOffset = { x: 60, y: 120, z: -40 };
  /** Gökyüzü, ay, dağlar ve ikaz ışıkları: kamerayla yatayda birlikte gider (uzun otoyolda ufuk sabit kalsın). */
  private readonly skyGroup = new Group();

  constructor(private readonly scene: Scene, private readonly track: Track) {
    scene.background = FOG_COLOR.clone();

    // ---- Işıklar ----
    const hemi = new HemisphereLight(0x5a4a9a, 0x120a1e, 0.9);
    this.group.add(hemi);
    this.sun = new DirectionalLight(0xc9c0ff, 1.9);
    this.sun.position.set(this.sunOffset.x, this.sunOffset.y, this.sunOffset.z);
    this.sun.shadow.camera.left = -36;
    this.sun.shadow.camera.right = 36;
    this.sun.shadow.camera.top = 36;
    this.sun.shadow.camera.bottom = -36;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.normalBias = 0.02;
    this.group.add(this.sun, this.sun.target);

    // ---- Gökyüzü ----
    this.sky = new ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uTop: { value: new Color(0x030210) },
        uMid: { value: new Color(0x120933) },
        uHorizon: { value: new Color(0x26104a) },
        uGlow: { value: new Color(0xd42bd0).multiplyScalar(0.32) },
        uTime: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(this.sky);
    const skyMesh = new Mesh(new SphereGeometry(3000, 32, 16), this.sky);
    skyMesh.renderOrder = -10;
    skyMesh.frustumCulled = false;
    this.skyGroup.add(skyMesh);
    this.group.add(this.skyGroup);

    this.buildMoon();
    this.buildGround();
    this.buildSkyline();
    this.buildMountains();
    this.buildBillboards();
    this.buildGrandstand();

    // Çatı ikaz ışıkları
    this.beaconMat = new MeshBasicMaterial({ color: new Color(COLORS.red).multiplyScalar(3), fog: false });
    this.materials.push(this.beaconMat);
    this.beacons = this.buildBeacons();
    this.skyGroup.add(this.beacons);

    scene.add(this.group);
  }

  private get center(): [number, number] {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.count; i += 10) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    return [(minX + maxX) / 2, (minZ + maxZ) / 2];
  }

  private buildMoon(): void {
    const [cx, cz] = [0, 0];
    const dir = { x: 0.82, y: 0.2, z: -0.54 };
    const dist = 2200;
    const moon = new Mesh(
      new SphereGeometry(70, 32, 16),
      new MeshBasicMaterial({ color: new Color(0xe9e2ff).multiplyScalar(1.4), fog: false }),
    );
    moon.position.set(cx + dir.x * dist, dir.y * dist, cz + dir.z * dist);
    this.materials.push(moon.material as Material);
    const halo = new Sprite(
      new SpriteMaterial({
        map: radialGlowTexture('rgba(255,210,255,0.9)', 'rgba(170,120,255,0.25)'),
        color: 0xffffff,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
        transparent: true,
      }),
    );
    this.materials.push(halo.material);
    halo.scale.set(640, 640, 1);
    halo.position.copy(moon.position);
    this.skyGroup.add(moon, halo);
  }

  private buildGround(): void {
    const mat = new ShaderMaterial({
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      uniforms: {
        uBase: { value: new Color(0x07040f) },
        uLine: { value: new Color(0x5b2fb0) },
        uMajor: { value: new Color(0xb03cff).multiplyScalar(0.8) },
        fogColor: { value: FOG_COLOR },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
        fogDensity: { value: 0.0016 },
      },
      fog: true,
    });
    this.materials.push(mat);
    const ground = new Mesh(new PlaneGeometry(7000, 7000), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    this.group.add(ground);
    this.ground = ground;
  }

  private buildSkyline(): void {
    const [cx, cz] = this.center;
    const r = rng(1337);
    const boxes: BufferGeometry[] = [];
    const corridor = this.track.def.skyline === 'corridor';
    const t = this.track;
    const q = createTrackQuery();
    const count = corridor ? Math.min(900, Math.round(t.length / 10)) : 340;
    for (let i = 0; i < count; i++) {
      let px: number;
      let pz: number;
      let ring: number;
      if (corridor) {
        // Yol boyunca iki yanda şehir: yakında alçak, uzakta yüksek binalar
        t.frameAt(r() * t.length, q);
        const side = r() < 0.5 ? -1 : 1;
        ring = r() ** 1.4;
        const off = side * (t.barrierOffset + 45 + ring * 520);
        px = q.cx + q.nx * off;
        pz = q.cz + q.nz * off;
      } else {
        const ang = r() * Math.PI * 2;
        ring = r();
        const dist = 470 + ring * 900 + r() * 80;
        px = cx + Math.cos(ang) * dist;
        pz = cz + Math.sin(ang) * dist;
      }
      const w = 18 + r() * 42;
      const d = 18 + r() * 42;
      const h = (25 + r() * 70) * (0.6 + ring * 1.6) * (r() < 0.12 ? 2.2 : 1);
      const g = new BoxGeometry(w, h, d);
      // UV'leri boyutla ölçekle: pencereler gerilmesin. Yüz sırası: +x, -x, +y, -y, +z, -z
      const uv = g.getAttribute('uv') as BufferAttribute;
      const scaleFace = (face: number, su: number, sv: number, ou: number, ov: number) => {
        for (let k = 0; k < 4; k++) {
          const idx = face * 4 + k;
          uv.setXY(idx, uv.getX(idx) * su + ou, uv.getY(idx) * sv + ov);
        }
      };
      const ou = r();
      const ov = r();
      scaleFace(0, d / 60, h / 60, ou, ov);
      scaleFace(1, d / 60, h / 60, ou + 0.3, ov);
      scaleFace(4, w / 60, h / 60, ou + 0.6, ov);
      scaleFace(5, w / 60, h / 60, ou + 0.1, ov);
      // Çatı ve taban: koyu kenar bölgesi
      for (const face of [2, 3]) for (let k = 0; k < 4; k++) uv.setXY(face * 4 + k, 0.001, 0.001);
      g.rotateY(r() * Math.PI);
      g.translate(px, h / 2 - 0.5, pz);
      boxes.push(g);
    }
    const merged = mergeGeometries(boxes, false);
    boxes.forEach((b) => b.dispose());
    if (!merged) return;
    const mat = new MeshBasicMaterial({ map: windowTexture(), color: new Color(1.15, 1.1, 1.2) });
    this.materials.push(mat);
    const city = new Mesh(merged, mat);
    city.name = 'skyline';
    this.group.add(city);
  }

  private buildBeacons(): InstancedMesh {
    const [cx, cz] = [0, 0];
    const r = rng(99);
    const n = 60;
    const mesh = new InstancedMesh(new SphereGeometry(1.6, 8, 6), this.beaconMat, n);
    const d = new Object3D();
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2;
      const dist = 900 + r() * 500;
      d.position.set(cx + Math.cos(ang) * dist, 120 + r() * 160, cz + Math.sin(ang) * dist);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    return mesh;
  }

  private buildMountains(): void {
    const [cx, cz] = [0, 0];
    const r = rng(5);
    const segs = 160;
    const R = 2300;
    const pos: number[] = [];
    const ridge: number[] = [];
    let prevH = 0;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const hRaw = 60 + r() * 200 + Math.sin(a * 3) * 60 + Math.sin(a * 7 + 1) * 40;
      const h = i === segs ? ridge[1] : prevH * 0.35 + hRaw * 0.65;
      prevH = h;
      const x = cx + Math.cos(a) * R;
      const z = cz + Math.sin(a) * R;
      pos.push(x, -5, z, x, h, z);
      ridge.push(x, h, z);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    const mat = new MeshBasicMaterial({ color: 0x0a0618, side: DoubleSide, fog: false });
    this.materials.push(mat);
    this.skyGroup.add(new Mesh(g, mat));
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array(ridge), 3));
    const lineMat = new LineBasicMaterial({ color: new Color(COLORS.violet).multiplyScalar(1.3), fog: false });
    this.materials.push(lineMat);
    this.skyGroup.add(new LineLoop(rg, lineMat));
  }

  private buildBillboards(): void {
    const t = this.track;
    const q = createTrackQuery();
    const boards = this.track.def.billboards;
    const frameMat = new MeshStandardMaterial({ color: 0x15102a, metalness: 0.8, roughness: 0.35 });
    this.materials.push(frameMat);
    for (const b of boards) {
      t.frameAt(b.s, q);
      const off = b.side * (t.barrierOffset + 9);
      const g = new Group();
      g.position.set(q.cx + q.nx * off, 0, q.cz + q.nz * off);
      // Yaklaşan araca ve piste dönük
      g.lookAt(q.cx - q.tx * 40 - q.nx * b.side * 6, 0, q.cz - q.tz * 40 - q.nz * b.side * 6);
      const tex = textTexture(b.text, {
        width: 1024,
        height: 384,
        color: '#ffffff',
        glow: b.color,
        background: '#0a0614',
        subtitle: b.sub,
        subtitleColor: b.color,
      });
      const mat = new MeshBasicMaterial({ map: tex, color: new Color(1.5, 1.5, 1.5) });
      this.materials.push(mat);
      const panel = new Mesh(new PlaneGeometry(16, 6), mat);
      panel.position.y = 9;
      const back = new Mesh(new BoxGeometry(16.8, 6.8, 0.4), frameMat);
      back.position.set(0, 9, -0.25);
      const legs = new Mesh(new BoxGeometry(0.5, 6, 0.5), frameMat);
      legs.position.set(-5, 3, -0.3);
      const legs2 = legs.clone();
      legs2.position.x = 5;
      const edge = new Mesh(new BoxGeometry(16.8, 0.15, 0.15), neon(Number.parseInt(b.color.slice(1), 16), 3));
      this.materials.push(edge.material as Material);
      edge.position.set(0, 12.45, 0);
      const edge2 = edge.clone();
      edge2.position.y = 5.55;
      g.add(panel, back, legs, legs2, edge, edge2);
      this.group.add(g);
    }
  }

  /** Başlangıç düzlüğü boyunca tribün; kalabalığın telefon ışıkları. */
  private buildGrandstand(): void {
    const t = this.track;
    const q = createTrackQuery();
    t.frameAt(this.track.def.grandstandS, q);
    const side = -1;
    const off = side * (t.barrierOffset + 7);
    const g = new Group();
    g.position.set(q.cx + q.nx * off, 0, q.cz + q.nz * off);
    g.rotation.y = Track.yawOf(q.tx, q.tz);
    const mat = new MeshStandardMaterial({ color: 0x1a1430, metalness: 0.5, roughness: 0.6 });
    this.materials.push(mat);
    const len = 90;
    for (let row = 0; row < 6; row++) {
      const step = new Mesh(new BoxGeometry(2, 0.9 * (row + 1), len), mat);
      // Grubun yerel +X ekseni pistin soluna bakar: sıralar pistten uzaklaştıkça yükselir.
      step.position.set(-side * (row * 2), 0.45 * (row + 1), len / 2);
      g.add(step);
    }
    const roof = new Mesh(new BoxGeometry(14, 0.4, len), mat);
    roof.position.set(-side * 6, 10, len / 2);
    g.add(roof);
    const strip = new Mesh(new BoxGeometry(0.2, 0.2, len), neon(COLORS.magenta, 3));
    this.materials.push(strip.material as Material);
    strip.position.set(side, 9.8, len / 2);
    g.add(strip);
    // Kalabalık ışıkları
    const r = rng(77);
    const lights = new InstancedMesh(
      new BoxGeometry(0.18, 0.28, 0.05),
      neon(0xffffff, 1.6),
      260,
    );
    this.materials.push(lights.material as Material);
    const d = new Object3D();
    const palette = [0xffffff, 0x29f0ff, 0xff2bd6, 0xffd27a];
    const col = new Color();
    for (let i = 0; i < 260; i++) {
      const row = Math.floor(r() * 6);
      d.position.set(-side * (row * 2) + side * 0.95, 0.9 * (row + 1) + 0.5, r() * len);
      d.rotation.set(0, Math.PI / 2, 0);
      d.updateMatrix();
      lights.setMatrixAt(i, d.matrix);
      lights.setColorAt(i, col.setHex(palette[Math.floor(r() * palette.length)]).multiplyScalar(1.6));
    }
    g.add(lights);
    this.group.add(g);
  }

  /** Gölge kamerasını aracı izleyecek şekilde taşır; zamanla değişen efektleri günceller. */
  update(time: number, focusX: number, focusZ: number): void {
    this.sky.uniforms.uTime.value = time;
    this.skyGroup.position.set(focusX, 0, focusZ);
    this.sun.position.set(focusX + this.sunOffset.x, this.sunOffset.y, focusZ + this.sunOffset.z);
    this.sun.target.position.set(focusX, 0, focusZ);
    const blink = Math.sin(time * 2.4) > 0.2 ? 3 : 0.4;
    this.beaconMat.color.setRGB(blink, blink * 0.16, blink * 0.3);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.scene.remove(this.group);
  }
}
