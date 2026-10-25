import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  QuadraticBezierCurve,
  Shape,
  ShapeGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector2,
  type Material,
} from 'three';
import { type CarPaint, PHYSICS } from '../config';
import { plateTexture, radialGlowTexture } from '../world/textures';
import type { CarPhysics } from './CarPhysics';
import type { CarVisual } from './CarVisual';
import { buildWheels } from './wheels';

/** Prosedürel Golf'te "Fabrika rengi" (body < 0) Tornado Kırmızı'dır. */
const paintBody = (p: CarPaint) => (p.body < 0 ? 0xb0101c : p.body);

// ---- Golf 6 ölçüleri (metre). Orijin: gövde ortası, zemin seviyesi; +Z ileri, +X sol.
const WHEEL_R = PHYSICS.wheelRadius;
const FRONT_Z = 1.24;
const REAR_Z = -1.34;
const TRACK_X = 0.77;
const ARCH_R = 0.41;

/**
 * Alt gövde: 1.78 m en (yan yüzey x = ±0.89). Ekstrüzyon pahı (bevelSize 0.06) ön/arka yüzü
 * profilin 6 cm dışına taşır; far, ızgara, plaka gibi parçalar buna göre konumlanır.
 */
const BODY_DEPTH = 1.62;
const BODY_BEVEL = 0.08;
const BODY_SIDE = BODY_DEPTH / 2 + BODY_BEVEL;
/** Kabin: belden yukarı, içe eğik (tumblehome). Yan yüzey x = ±0.80. */
const CABIN_DEPTH = 1.42;
const CABIN_BEVEL = 0.09;
const CABIN_SIDE = CABIN_DEPTH / 2 + CABIN_BEVEL;

/** Ön cam, tavan ve arka cam profil eğrileri (z, y). */
const WINDSHIELD = new QuadraticBezierCurve(new Vector2(1.0, 0.97), new Vector2(0.55, 1.2), new Vector2(0.1, 1.4));
const ROOF = new QuadraticBezierCurve(new Vector2(0.1, 1.4), new Vector2(-0.6, 1.475), new Vector2(-1.3, 1.44));
const REAR_GLASS = new QuadraticBezierCurve(new Vector2(-1.56, 1.4), new Vector2(-1.8, 1.2), new Vector2(-1.95, 0.98));

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Kuşbakışı köşe yuvarlatma: ön ve arka uçlar daralır. */
function planScale(z: number): number {
  let k = 1;
  if (z > 1.62) k -= 0.13 * ((z - 1.62) / 0.5) ** 2;
  if (z < -1.72) k -= 0.1 * ((-1.72 - z) / 0.4) ** 2;
  return k;
}

function bodyDeform(x: number, y: number, z: number): number {
  return x * planScale(z) * (1 - 0.035 * clamp01((y - 0.84) / 0.18));
}

function cabinDeform(x: number, y: number, z: number): number {
  let k = planScale(z) * (1 - 0.13 * clamp01((y - 0.98) / 0.48));
  if (z > 0.55) k *= 1 - 0.06 * ((z - 0.55) / 0.5) ** 2;
  return x * k;
}

function deform(g: BufferGeometry, fn: (x: number, y: number, z: number) => number): BufferGeometry {
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, fn(p.getX(i), p.getY(i), p.getZ(i)));
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** Yan profil (z, y) şeklini genişlik boyunca ekstrüde et; şekil x → dünya z. */
function extrudeSide(shape: Shape, depth: number, bevel: number, bevelSize = bevel * 0.75): ExtrudeGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 18,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Yan yüzeye yapışık düz parça (cam, sütun). */
function sidePlate(points: Array<[number, number]>, x: number, fn: (x: number, y: number, z: number) => number): BufferGeometry {
  const g = new ShapeGeometry(new Shape(points.map(([z, y]) => new Vector2(z, y))));
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return deform(g, fn);
}

/** Profil eğrisini dışa doğru öteleyip genişlik boyunca şerit yap (ön / arka cam). */
function curveRibbon(
  curve: QuadraticBezierCurve,
  t0: number,
  t1: number,
  halfWidth: number,
  offset: number,
  fn: (x: number, y: number, z: number) => number,
): BufferGeometry {
  const steps = 10;
  const pos: number[] = [];
  const cz = -0.6;
  const cy = 1.1;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    let nz = -tan.y;
    let ny = tan.x;
    if ((p.x - cz) * nz + (p.y - cy) * ny < 0) {
      nz = -nz;
      ny = -ny;
    }
    const z = p.x + nz * offset;
    const y = p.y + ny * offset;
    pos.push(-halfWidth, y, z, halfWidth, y, z);
  }
  const idx: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  deform(g, fn);
  g.computeVertexNormals();
  return g;
}

/**
 * Kodla üretilmiş Golf 6 (Mk6): hatchback silüeti, kalın C sütunu, ızgarayla birleşen farlar,
 * yatay stoplar, 5 kollu jantlar ve kırmızı kaliperler. Marka logosu yoktur.
 */
export class CarModel implements CarVisual {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly frontPivots: Group[] = [];
  private readonly spinners: Object3D[] = [];
  private readonly paintMats: MeshPhysicalMaterial[] = [];
  private readonly accentMats: MeshBasicMaterial[] = [];
  private readonly tailMat: MeshBasicMaterial;
  private readonly glowMat: MeshBasicMaterial;
  /** Zemine yatık alt ışık ve gölge düzlemleri (yansımada gizlenir). */
  readonly floorDecals: Mesh[] = [];
  private ghostMat: MeshBasicMaterial | null = null;
  private readonly flames: Sprite[] = [];
  readonly exhaust = [
    { x: -0.55, y: 0.28, z: -2.23 },
    { x: 0.55, y: 0.28, z: -2.23 },
  ];
  private readonly flameMat: SpriteMaterial;
  private readonly materials: Material[] = [];
  readonly headlight: SpotLight | null = null;
  private spin = 0;
  private roll = 0;
  private pitch = 0;
  private time = 0;
  private accent = new Color();

  constructor(paint: CarPaint, opts: { ghost?: boolean; headlight?: boolean } = {}) {
    const ghost = !!opts.ghost;
    this.root.add(this.body);
    this.accent.set(paint.accent);

    // ---- Malzemeler ----
    const paintMat = (side: Material['side'] = 0) => {
      const m = this.track(
        new MeshPhysicalMaterial({
          color: paintBody(paint),
          metalness: 0.5,
          roughness: 0.24,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          envMapIntensity: 2.1,
          side,
        }),
      );
      this.paintMats.push(m);
      return m;
    };
    const bodyMat = paintMat();
    const glassMat = this.track(
      new MeshPhysicalMaterial({
        color: 0x0a0c13,
        metalness: 0.25,
        roughness: 0.06,
        clearcoat: 1,
        envMapIntensity: 1.0,
        side: DoubleSide,
      }),
    );
    const trimMat = this.track(new MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.3, roughness: 0.4 }));
    const pianoMat = this.track(
      new MeshStandardMaterial({ color: 0x050507, metalness: 0.5, roughness: 0.12, side: DoubleSide }),
    );
    const chromeMat = this.track(new MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.14 }));
    const lensMat = this.track(new MeshStandardMaterial({ color: 0x2a303c, metalness: 0.9, roughness: 0.12 }));
    const glow = (r: number, g: number, b: number) => this.track(new MeshBasicMaterial({ color: new Color(r, g, b) }));

    // ---- Alt gövde (yan profil + çamurluk kavisleri) ----
    const lower = new Shape();
    lower.moveTo(-2.04, 0.27);
    lower.lineTo(REAR_Z - ARCH_R, 0.27);
    lower.absarc(REAR_Z, WHEEL_R, ARCH_R, Math.PI, 0, true);
    lower.lineTo(FRONT_Z - ARCH_R, 0.27);
    lower.absarc(FRONT_Z, WHEEL_R, ARCH_R, Math.PI, 0, true);
    lower.lineTo(1.98, 0.25);
    lower.quadraticCurveTo(2.12, 0.27, 2.13, 0.4);
    lower.lineTo(2.12, 0.62);
    lower.quadraticCurveTo(2.11, 0.765, 2.02, 0.8);
    lower.quadraticCurveTo(1.5, 0.925, 0.98, 0.985);
    lower.lineTo(-1.62, 1.03);
    lower.quadraticCurveTo(-1.98, 1.02, -2.05, 0.9);
    lower.lineTo(-2.1, 0.55);
    lower.quadraticCurveTo(-2.12, 0.3, -2.04, 0.27);
    const lowerMesh = new Mesh(deform(extrudeSide(lower, BODY_DEPTH, BODY_BEVEL, 0.06), bodyDeform), bodyMat);
    lowerMesh.castShadow = true;
    this.body.add(lowerMesh);

    // ---- Kabin (gövde rengi; camlar üstüne kaplanır, aradaki kalın C sütunu boyalı kalır) ----
    const cabin = new Shape();
    cabin.moveTo(1.0, 0.92);
    cabin.lineTo(WINDSHIELD.v0.x, WINDSHIELD.v0.y);
    cabin.quadraticCurveTo(WINDSHIELD.v1.x, WINDSHIELD.v1.y, WINDSHIELD.v2.x, WINDSHIELD.v2.y);
    cabin.quadraticCurveTo(ROOF.v1.x, ROOF.v1.y, ROOF.v2.x, ROOF.v2.y);
    cabin.lineTo(REAR_GLASS.v0.x, REAR_GLASS.v0.y);
    cabin.quadraticCurveTo(REAR_GLASS.v1.x, REAR_GLASS.v1.y, REAR_GLASS.v2.x, REAR_GLASS.v2.y);
    cabin.lineTo(-1.9, 0.92);
    cabin.closePath();
    const cabinMesh = new Mesh(deform(extrudeSide(cabin, CABIN_DEPTH, CABIN_BEVEL, 0.07), cabinDeform), bodyMat);
    cabinMesh.castShadow = true;
    this.body.add(cabinMesh);

    // Ön ve arka cam (kabin duvarının bevel payı kadar dışında)
    this.body.add(new Mesh(curveRibbon(WINDSHIELD, 0.06, 0.97, CABIN_DEPTH / 2 - 0.05, 0.075, cabinDeform), glassMat));
    this.body.add(new Mesh(curveRibbon(REAR_GLASS, 0.1, 0.9, CABIN_DEPTH / 2 - 0.1, 0.075, cabinDeform), glassMat));

    // Yan camlar: arka kenar öne yatar → Golf'ün kalın C sütunu
    const dlo: Array<[number, number]> = [
      [0.8, 1.012],
      [0.06, 1.372],
      [-0.98, 1.388],
      [-1.36, 1.042],
    ];
    for (const side of [-1, 1]) {
      this.body.add(new Mesh(sidePlate(dlo, side * (CABIN_SIDE + 0.006), cabinDeform), glassMat));
      // Parlak siyah B sütunu
      const bPillar: Array<[number, number]> = [
        [-0.05, 1.022],
        [-0.05, 1.38],
        [-0.16, 1.382],
        [-0.16, 1.025],
      ];
      this.body.add(new Mesh(sidePlate(bPillar, side * (CABIN_SIDE + 0.009), cabinDeform), pianoMat));
    }

    // Tavan rüzgârlığı + üçüncü stop
    const spoiler = new Shape();
    spoiler.moveTo(-1.42, 1.445);
    spoiler.lineTo(-1.72, 1.415);
    spoiler.lineTo(-1.69, 1.375);
    spoiler.lineTo(-1.45, 1.4);
    spoiler.closePath();
    const spoilerMesh = new Mesh(deform(extrudeSide(spoiler, 1.2, 0.04), cabinDeform), bodyMat);
    spoilerMesh.castShadow = true;
    this.body.add(spoilerMesh);

    // Köpekbalığı yüzgeci anten
    const fin = new Mesh(new BoxGeometry(0.05, 0.06, 0.16), trimMat);
    fin.position.set(0, 1.49, -1.12);
    fin.rotation.x = -0.15;
    this.body.add(fin);

    // ---- Ön yüz ----
    const headMat = this.track(new MeshBasicMaterial({ color: new Color(0xeaf6ff).multiplyScalar(2.6) }));
    const fogMat = glow(1.6, 1.4, 1.1);
    for (const side of [-1, 1]) {
      // Far gövdesi: dışa doğru geriye süpürülmüş, iç kenar hafif aşağıda
      const housing = new Mesh(new BoxGeometry(0.42, 0.13, 0.3), lensMat);
      housing.position.set(side * 0.52, 0.7, 2.04);
      housing.rotation.set(0, side * 0.3, side * -0.06);
      this.body.add(housing);
      const projector = new Mesh(new CylinderGeometry(0.045, 0.045, 0.05, 14), headMat);
      projector.rotation.x = Math.PI / 2;
      projector.position.set(side * 0.44, 0.705, 2.19);
      this.body.add(projector);
      // LED gündüz farı şeridi
      const drl = new Mesh(new BoxGeometry(0.3, 0.018, 0.02), headMat);
      drl.position.set(side * 0.58, 0.652, 2.18);
      drl.rotation.y = side * 0.3;
      this.body.add(drl);
      // Sis farı
      const fogHousing = new Mesh(new BoxGeometry(0.16, 0.09, 0.08), trimMat);
      fogHousing.position.set(side * 0.66, 0.36, 2.15);
      const fog = new Mesh(new CylinderGeometry(0.035, 0.035, 0.03, 12), fogMat);
      fog.rotation.x = Math.PI / 2;
      fog.position.set(side * 0.66, 0.36, 2.198);
      this.body.add(fogHousing, fog);
    }
    // Izgara bandı: farları birleştiren ince siyah şerit, krom çizgi ve GTI kırmızısı
    const grille = new Mesh(new BoxGeometry(0.62, 0.1, 0.2), pianoMat);
    grille.position.set(0, 0.69, 2.09);
    const chrome = new Mesh(new BoxGeometry(0.62, 0.012, 0.012), chromeMat);
    chrome.position.set(0, 0.723, 2.194);
    const redLine = new Mesh(new BoxGeometry(0.62, 0.012, 0.012), glow(1.4, 0.04, 0.06));
    redLine.position.set(0, 0.652, 2.194);
    // Alt hava girişi
    const intake = new Mesh(new BoxGeometry(0.98, 0.17, 0.2), trimMat);
    intake.position.set(0, 0.37, 2.09);
    this.body.add(grille, chrome, redLine, intake);
    // Plakalar
    const plateMat = this.track(
      new MeshBasicMaterial({ map: plateTexture('34 GLF 06'), color: new Color(0.9, 0.9, 0.9) }),
    );
    const frontPlate = new Mesh(new PlaneGeometry(0.52, 0.114), plateMat);
    frontPlate.position.set(0, 0.5, 2.197);
    this.body.add(frontPlate);

    // ---- Arka yüz ----
    this.tailMat = this.track(new MeshBasicMaterial({ color: new Color(1.3, 0.05, 0.13) }));
    const tailInnerMat = glow(0.25, 0.02, 0.03);
    const reflectorMat = glow(0.5, 0.03, 0.05);
    for (const side of [-1, 1]) {
      // Köşeleri saran yatay stoplar
      const tail = new Mesh(new BoxGeometry(0.44, 0.13, 0.3), this.tailMat);
      tail.position.set(side * 0.6, 0.885, -2.02);
      tail.rotation.y = side * -0.3;
      const tailInner = new Mesh(new BoxGeometry(0.2, 0.05, 0.02), tailInnerMat);
      tailInner.position.set(side * 0.5, 0.875, -2.175);
      tailInner.rotation.y = side * -0.3;
      const reflector = new Mesh(new BoxGeometry(0.1, 0.03, 0.02), reflectorMat);
      reflector.position.set(side * 0.74, 0.44, -2.18);
      this.body.add(tail, tailInner, reflector);
    }
    const thirdBrake = new Mesh(new BoxGeometry(0.4, 0.02, 0.02), this.tailMat);
    thirdBrake.position.set(0, 1.39, -1.72);
    const rearPlate = new Mesh(new PlaneGeometry(0.52, 0.114), plateMat);
    rearPlate.position.set(0, 0.66, -2.175);
    rearPlate.rotation.y = Math.PI;
    const diffuser = new Mesh(new BoxGeometry(1.3, 0.1, 0.14), trimMat);
    diffuser.position.set(0, 0.29, -2.1);
    this.body.add(thirdBrake, rearPlate, diffuser);

    // Çift egzoz ve turbo alevi
    this.flameMat = new SpriteMaterial({
      map: radialGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'),
      color: new Color(0x5ad8ff).multiplyScalar(2),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.materials.push(this.flameMat);
    for (const side of [-1, 1]) {
      const pipe = new Mesh(new CylinderGeometry(0.045, 0.05, 0.14, 14), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(side * 0.55, 0.28, -2.16);
      this.body.add(pipe);
      const f = new Sprite(this.flameMat);
      f.position.set(side * 0.55, 0.28, -2.36);
      f.scale.setScalar(0.001);
      this.flames.push(f);
      this.body.add(f);
    }

    // ---- Yan detaylar ----
    const accentMat = (k: number) => {
      const m = this.track(new MeshBasicMaterial({ color: this.accent.clone().multiplyScalar(k) }));
      m.userData.k = k;
      this.accentMats.push(m);
      return m;
    };
    const blinkerMat = glow(2, 1.1, 0.2);
    for (const side of [-1, 1]) {
      // Aynalar
      const arm = new Mesh(new BoxGeometry(0.12, 0.05, 0.08), trimMat);
      arm.position.set(side * 0.86, 1.03, 0.82);
      const cap = new Mesh(new BoxGeometry(0.08, 0.12, 0.2), bodyMat);
      cap.position.set(side * 0.95, 1.06, 0.8);
      cap.rotation.y = side * 0.12;
      cap.castShadow = true;
      const blinker = new Mesh(new BoxGeometry(0.012, 0.018, 0.12), blinkerMat);
      blinker.position.set(side * 0.992, 1.025, 0.81);
      this.body.add(arm, cap, blinker);
      // Kapı kolları
      for (const z of [0.22, -0.8]) {
        const handle = new Mesh(new BoxGeometry(0.02, 0.03, 0.14), bodyMat);
        handle.position.set(side * (BODY_SIDE + 0.008), 0.93, z);
        this.body.add(handle);
      }
      // Kapı aralıkları (5 kapı)
      for (const [z, y0, y1] of [
        [0.86, 0.3, 0.98],
        [-0.08, 0.3, 1.0],
        [-0.91, 0.76, 1.01],
      ] as const) {
        const line = new Mesh(new BoxGeometry(0.006, y1 - y0, 0.008), trimMat);
        line.position.set(side * (BODY_SIDE + 0.002), (y0 + y1) / 2, z);
        this.body.add(line);
      }
      // Marşpiye ve altındaki neon şerit
      const sill = new Mesh(new BoxGeometry(0.05, 0.09, 1.66), trimMat);
      sill.position.set(side * (BODY_SIDE - 0.015), 0.3, -0.05);
      const glowStrip = new Mesh(new BoxGeometry(0.03, 0.02, 1.5), accentMat(1.8));
      glowStrip.position.set(side * (BODY_SIDE - 0.025), 0.245, -0.05);
      this.body.add(sill, glowStrip);
    }

    // ---- Tekerlekler (225/40 R18, 5 kollu jant, kırmızı kaliper) ----
    const wheels = buildWheels({
      frontZ: FRONT_Z,
      rearZ: REAR_Z,
      trackX: TRACK_X,
      radius: WHEEL_R,
      width: 0.24,
      style: 'sport',
      ringMaterial: accentMat(0.9),
    });
    wheels.materials.forEach((m) => this.track(m));
    this.root.add(...wheels.pivots);
    this.spinners.push(...wheels.spinners);
    this.frontPivots.push(...wheels.front);

    // ---- Alt ışık ve yumuşak gölge ----
    this.glowMat = this.track(
      new MeshBasicMaterial({
        map: radialGlowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)'),
        color: this.accent.clone().multiplyScalar(1.3),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    const under = new Mesh(new PlaneGeometry(3.1, 5.8), this.glowMat);
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.04;
    under.renderOrder = 2;
    const blob = new Mesh(
      new PlaneGeometry(2.4, 4.8),
      this.track(
        new MeshBasicMaterial({
          map: radialGlowTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0.5)'),
          transparent: true,
          depthWrite: false,
          color: 0x000000,
        }),
      ),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    this.root.add(under, blob);
    this.floorDecals.push(under, blob);

    if (opts.headlight && !ghost) {
      const spot = new SpotLight(0xdff6ff, 420, 95, 0.52, 0.55, 2);
      spot.position.set(0, 0.66, 1.9);
      spot.target.position.set(0, 0, 24);
      this.root.add(spot, spot.target);
      this.headlight = spot;
    }

    if (ghost) this.makeGhost();
  }

  private track<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private makeGhost(): void {
    const ghostMat = new MeshBasicMaterial({
      color: new Color(0x9ff7ff).multiplyScalar(0.55),
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.materials.push(ghostMat);
    this.ghostMat = ghostMat;
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.material = ghostMat;
        m.castShadow = false;
      }
    });
    this.flames.forEach((f) => (f.visible = false));
    this.floorDecals.forEach((d) => (d.visible = false));
  }

  setGhostOpacity(o: number): void {
    if (this.ghostMat) this.ghostMat.opacity = o;
  }

  setPaint(paint: CarPaint): void {
    for (const m of this.paintMats) m.color.set(paintBody(paint));
    this.accent.set(paint.accent);
    for (const m of this.accentMats) m.color.copy(this.accent).multiplyScalar(m.userData.k as number);
    this.glowMat.color.copy(this.accent).multiplyScalar(1.3);
  }

  /** Fizik durumundan görsel animasyon. */
  update(dt: number, car: CarPhysics): void {
    this.time += dt;
    this.root.position.set(car.x, 0, car.z);
    this.root.rotation.y = car.yaw;

    this.spin += (car.speed * dt) / WHEEL_R;
    for (const s of this.spinners) s.rotation.x = this.spin;
    const steerAngle = -car.steer * 0.42;
    for (const p of this.frontPivots) p.rotation.y = steerAngle;

    const lat = car.speed * car.yawRate;
    const rollTarget = Math.max(-0.075, Math.min(0.075, lat * 0.0038));
    const pitchTarget = Math.max(-0.05, Math.min(0.055, -car.accel * 0.0026));
    const k = 1 - Math.exp(-8 * dt);
    this.roll += (rollTarget - this.roll) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    const speedF = Math.min(1, Math.abs(car.speed) / 60);
    this.body.position.y =
      Math.sin(this.time * 47) * 0.005 * speedF + (car.offroad ? Math.sin(this.time * 31) * 0.02 * speedF : 0);

    const braking = (car.input.brake > 0.1 && car.speed > 0.5) || car.input.handbrake;
    const tailI = braking ? 3.4 : 1.3;
    this.tailMat.color.setRGB(tailI, tailI * 0.04, tailI * 0.1);

    const boosting = car.boostTime > 0;
    for (const f of this.flames) {
      const target = boosting
        ? 0.8 + Math.random() * 0.45
        : car.input.throttle > 0.5 && Math.abs(car.speed) < 30
          ? 0.2
          : 0.001;
      f.scale.setScalar(f.scale.x + (target - f.scale.x) * Math.min(1, dt * 18));
    }
    const lvlColor = car.drifting && car.driftLevel === 2 ? 0xff5ad8 : 0x5ad8ff;
    this.flameMat.color.setHex(lvlColor).multiplyScalar(boosting ? 2.6 : 1.2);

    const pulse = 1.2 + Math.sin(this.time * 5) * 0.15 + (boosting ? 0.6 : 0);
    this.glowMat.color.copy(this.accent).multiplyScalar(pulse);
  }

  /** Hayalet araç için yalnızca konum. */
  placeGhost(x: number, z: number, yaw: number, spinSpeed: number, dt: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.spin += (spinSpeed * dt) / WHEEL_R;
    for (const s of this.spinners) s.rotation.x = this.spin;
  }

  /** Arka tekerleklerin dünya konumları (iz ve duman için). */
  rearWheelWorld(car: CarPhysics, out: { lx: number; lz: number; rx: number; rz: number }): void {
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    // yerel (x, z) → dünya: x' = x cos + z sin, z' = -x sin + z cos
    out.lx = car.x + TRACK_X * c + REAR_Z * s;
    out.lz = car.z - TRACK_X * s + REAR_Z * c;
    out.rx = car.x - TRACK_X * c + REAR_Z * s;
    out.rz = car.z + TRACK_X * s + REAR_Z * c;
  }

  get accentColor(): Color {
    return this.accent;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
