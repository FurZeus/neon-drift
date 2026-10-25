import {
  AdditiveBlending,
  BoxGeometry,
  type Object3D as Obj3D,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { COLORS } from '../config';
import { createTrackQuery, Track } from './Track';
import { laneOffsets } from './tracks';
import { asphaltTexture, checkerTexture, chevronTexture, radialGlowTexture, runoffTexture, textTexture, wetTexture } from './textures';
import type { PlanarReflection } from '../fx/PlanarReflection';

/** Bloom'u besleyen, ışıksız "neon" malzeme. */
export function neon(color: number, intensity = 2.2, extra: Partial<MeshBasicMaterial> = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) });
  Object.assign(m, extra);
  return m;
}

interface RibbonOptions {
  step?: number;
  vRepeat?: number;
  y?: number;
}

/** Merkez çizgisine paralel düz şerit: yan ofsetler a→b (sağ = +). */
function ribbon(track: Track, a: number, b: number, o: RibbonOptions = {}): BufferGeometry {
  const step = o.step ?? 2;
  const y = o.y ?? 0;
  const n = Math.floor(track.count / step);
  const vRepeat = o.vRepeat ?? 10;
  const tiles = Math.max(1, Math.round(track.length / vRepeat));
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const nor = new Float32Array((n + 1) * 2 * 3);
  for (let k = 0; k <= n; k++) {
    const i = (k * step) % track.count;
    const cx = track.px[i];
    const cz = track.pz[i];
    const nx = track.nx[i];
    const nz = track.nz[i];
    const v = (k / n) * tiles;
    const p = k * 6;
    pos[p] = cx + nx * a;
    pos[p + 1] = y;
    pos[p + 2] = cz + nz * a;
    pos[p + 3] = cx + nx * b;
    pos[p + 4] = y;
    pos[p + 5] = cz + nz * b;
    uv.set([0, v, 1, v], k * 4);
    nor.set([0, 1, 0, 0, 1, 0], p);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const i0 = k * 2;
    // Yukarı bakan yüzler için sarım yönü ofset sırasına bağlı
    if (a < b) idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    else idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Dikey şerit (bariyer yüzü / neon tüp). */
function wall(track: Track, offset: number, y0: number, y1: number, step = 2): BufferGeometry {
  const n = Math.floor(track.count / step);
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let k = 0; k <= n; k++) {
    const i = (k * step) % track.count;
    const x = track.px[i] + track.nx[i] * offset;
    const z = track.pz[i] + track.nz[i] * offset;
    pos.set([x, y0, z, x, y1, z], k * 6);
    const v = (track.sAt[i] || (k === n ? track.length : 0)) / 4;
    uv.set([v, 0, v, 1], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const i0 = k * 2;
    idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Pist boyunca s aralıklarına yerleştirilen dörtgenler (kesikli çizgi, bordür şeritleri). */
function quadsAlong(
  track: Track,
  segments: Array<{ s0: number; s1: number; a: number; b: number; color?: Color }>,
  y: number,
): BufferGeometry {
  const q = createTrackQuery();
  const pos: number[] = [];
  const col: number[] = [];
  const corner = (s: number, off: number) => {
    track.frameAt(s, q);
    return [q.cx + q.nx * off, y, q.cz + q.nz * off];
  };
  for (const seg of segments) {
    // Uzun parçaları bükülme için böl
    const parts = Math.max(1, Math.ceil((seg.s1 - seg.s0) / 1.5));
    for (let p = 0; p < parts; p++) {
      const sa = seg.s0 + ((seg.s1 - seg.s0) * p) / parts;
      const sb = seg.s0 + ((seg.s1 - seg.s0) * (p + 1)) / parts;
      const A = corner(sa, seg.a);
      const B = corner(sa, seg.b);
      const C = corner(sb, seg.a);
      const D = corner(sb, seg.b);
      // Yukarı bakan iki üçgen (a<b varsayımıyla; değilse ters)
      const tri = seg.a < seg.b ? [A, B, C, B, D, C] : [A, C, B, B, C, D];
      for (const v of tri) pos.push(...v);
      if (seg.color) for (let k = 0; k < 6; k++) col.push(seg.color.r, seg.color.g, seg.color.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  if (col.length) g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class TrackMesh {
  readonly group = new Group();
  private startLamps: Mesh[] = [];
  private lampOff = new Color(0x2a0b16);
  private lampRed = new Color(2.6, 0.05, 0.12);
  private lampGreen = new Color(0.1, 2.4, 0.6);
  private readonly materials: Material[] = [];
  private roadMaterial!: MeshStandardMaterial;
  /** Yansıma çiziminde gizlenecek düz zemin parçaları. */
  readonly noReflect: Obj3D[] = [];
  private readonly wetUniforms = {
    tReflect: { value: null as unknown },
    uReflectMatrix: { value: null as unknown },
    uReflectStrength: { value: 0 },
    tWet: { value: null as unknown },
  };

  constructor(private readonly track: Track, opts: { propDensity?: number } = {}) {
    const density = opts.propDensity ?? 1;
    this.buildSurface();
    this.buildLines();
    this.buildKerbs();
    this.buildBarriers(density);
    this.buildChevrons();
    const def = track.def;
    this.buildGantry(def.startS, 'NEON DRIFT', true);
    if (def.kind === 'sprint' && def.finishS !== undefined) {
      this.buildCheckerLine(def.finishS);
      this.buildGantry(def.finishS, 'BİTİŞ', false);
    }
    if (def.arches) this.buildArches();
    for (const sign of def.signs) this.buildSign(sign.s, sign.text, sign.sub);
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private buildSurface(): void {
    const t = this.track;
    const asphalt = asphaltTexture();
    asphalt.repeat.set(2, 1);
    const roadMat = this.mat(new MeshStandardMaterial({ map: asphalt, color: 0xb8b2cc, roughness: 0.62, metalness: 0.18 }));
    this.roadMaterial = roadMat;
    const road = new Mesh(ribbon(t, -t.roadHalfWidth, t.roadHalfWidth, { vRepeat: 12, y: 0 }), roadMat);
    this.noReflect.push(road);
    road.receiveShadow = true;
    road.name = 'road';
    this.group.add(road);

    const runoffTex = runoffTexture();
    runoffTex.repeat.set(1, 1);
    const runoffMat = this.mat(new MeshStandardMaterial({ map: runoffTex, roughness: 0.9, metalness: 0 }));
    for (const side of [-1, 1]) {
      const g = ribbon(t, side * t.roadHalfWidth, side * (t.barrierOffset + 0.2), { vRepeat: 6, y: -0.01 });
      const m = new Mesh(g, runoffMat);
      m.receiveShadow = true;
      this.group.add(m);
      this.noReflect.push(m);
    }
  }

  private buildLines(): void {
    const t = this.track;
    const edgeMat = this.mat(neon(0xf3eeff, 0.85));
    for (const side of [-1, 1]) {
      const inner = side * (t.roadHalfWidth - 0.55);
      const outer = side * (t.roadHalfWidth - 0.3);
      const edge = new Mesh(ribbon(t, Math.min(inner, outer), Math.max(inner, outer), { y: 0.012 }), edgeMat);
      this.group.add(edge);
      this.noReflect.push(edge);
      // Asfalt kenarındaki ince renkli neon hat
      const c = side < 0 ? COLORS.magenta : COLORS.cyan;
      const a = side * (t.roadHalfWidth - 0.08);
      const b = side * (t.roadHalfWidth + 0.08);
      const glowLine = new Mesh(ribbon(t, Math.min(a, b), Math.max(a, b), { y: 0.014 }), this.mat(neon(c, 2.0)));
      this.group.add(glowLine);
      this.noReflect.push(glowLine);
    }
    const lanes = laneOffsets(t.def);
    const dashes: Array<{ s0: number; s1: number; a: number; b: number }> = [];
    if (lanes.forward.length) {
      // Otoyol: yön içi şerit ayırıcıları kesikli, iki yön arası çift sürekli amber çizgi
      const w = t.def.laneWidth ?? 3.75;
      for (let k = 1; k < lanes.forward.length; k++) {
        for (const side of [-1, 1]) {
          const x = side * w * k;
          for (let s = 4; s < t.length - 4; s += 12) dashes.push({ s0: s, s1: s + 6, a: x - 0.09, b: x + 0.09 });
        }
      }
      const amber = this.mat(neon(COLORS.amber, 1.6));
      for (const x of [-0.22, 0.22]) {
        const line = new Mesh(ribbon(t, x - 0.07, x + 0.07, { y: 0.013 }), amber);
        this.group.add(line);
        this.noReflect.push(line);
      }
    } else {
      // Tur pisti: kesikli orta çizgi
      for (let s = 6; s < t.length - 6; s += 9) dashes.push({ s0: s, s1: s + 4.5, a: -0.14, b: 0.14 });
    }
    const dashMesh = new Mesh(quadsAlong(t, dashes, 0.012), this.mat(neon(0xd9d2ff, 0.7)));
    this.group.add(dashMesh);
    this.noReflect.push(dashMesh);
    this.buildCheckerLine(t.def.startS);
  }

  /** Damalı başlangıç / bitiş çizgisi. */
  private buildCheckerLine(s: number): void {
    const t = this.track;
    const checker = new Mesh(
      new PlaneGeometry(t.roadHalfWidth * 2, 3),
      this.mat(new MeshStandardMaterial({ map: checkerTexture(), roughness: 0.5 })),
    );
    const q = createTrackQuery();
    t.frameAt(s, q);
    checker.rotation.x = -Math.PI / 2;
    checker.rotation.z = Track.yawOf(q.tx, q.tz);
    checker.position.set(q.cx, 0.016, q.cz);
    checker.receiveShadow = true;
    this.group.add(checker);
    this.noReflect.push(checker);
  }

  /** Yolun üzerinden geçen tabela köprüsü (otoyol mesafe tabelaları). */
  private buildSign(s: number, text: string, sub: string): void {
    const t = this.track;
    const q = createTrackQuery();
    t.frameAt(s, q);
    const g = new Group();
    g.position.set(q.cx, 0, q.cz);
    g.rotation.y = Track.yawOf(q.tx, q.tz);
    const span = t.barrierOffset + 0.8;
    const frameMat = this.mat(new MeshStandardMaterial({ color: 0x1a1430, metalness: 0.85, roughness: 0.3 }));
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.5, 8, 0.5), frameMat);
      post.position.set(side * span, 4, 0);
      g.add(post);
    }
    const truss = new Mesh(new BoxGeometry(span * 2 + 0.5, 0.4, 0.4), frameMat);
    truss.position.set(0, 7.6, 0);
    g.add(truss);
    const tex = textTexture(text, { width: 1024, height: 320, color: '#ffffff', glow: '#29f0ff', background: '#06303a', subtitle: sub, subtitleColor: '#8ff6ff' });
    const panelMat = this.mat(new MeshBasicMaterial({ map: tex, color: new Color(1.1, 1.1, 1.1) }));
    // Gidiş yönüne bakan tabela sağ şeritlerin üstünde, karşı yöne bakan sol şeritlerin üstünde
    for (const side of [1, -1]) {
      const panel = new Mesh(new PlaneGeometry(7.6, 2.4), panelMat);
      // Yerel +X pistin soluna bakar; gidiş yönündeki araçlar −Z tarafından yaklaşır.
      panel.position.set(-side * span * 0.48, 6.1, side < 0 ? 0.25 : -0.25);
      if (side > 0) panel.rotation.y = Math.PI;
      g.add(panel);
      const edge = new Mesh(new BoxGeometry(7.8, 0.08, 0.08), this.mat(neon(COLORS.cyan, 2.4)));
      edge.position.set(-side * span * 0.48, 7.34, side < 0 ? 0.25 : -0.25);
      g.add(edge);
    }
    this.group.add(g);
  }

  private buildKerbs(): void {
    const t = this.track;
    const segs: Array<{ s0: number; s1: number; a: number; b: number; color: Color }> = [];
    const white = new Color(0xe9e4ff);
    const mag = new Color(COLORS.magenta).multiplyScalar(0.9);
    const stripe = 2.6;
    let n = 0;
    for (let s = 0; s < t.length; s += stripe) {
      const i = Math.floor(s / t.spacing) % t.count;
      const k = t.curvature[i];
      if (Math.abs(k) < 1 / 85) continue;
      const color = n++ % 2 ? white : mag;
      // Viraj içi ve dışı
      for (const side of [-1, 1]) {
        const a = side * (t.roadHalfWidth - 1.2);
        const b = side * (t.roadHalfWidth + 0.35);
        segs.push({ s0: s, s1: s + stripe, a: Math.min(a, b), b: Math.max(a, b), color });
      }
    }
    const mesh = new Mesh(
      quadsAlong(t, segs, 0.02),
      this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x220a2a })),
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.noReflect.push(mesh);
  }

  private buildBarriers(density: number): void {
    const t = this.track;
    const wallMat = this.mat(
      new MeshStandardMaterial({ color: 0x1b1530, roughness: 0.35, metalness: 0.7, side: DoubleSide }),
    );
    const step = 2;
    for (const side of [-1, 1]) {
      const off = side * t.barrierOffset;
      const neonColor = side < 0 ? COLORS.magenta : COLORS.cyan;
      this.group.add(new Mesh(wall(t, off, 0, 0.95, step), wallMat));
      this.group.add(new Mesh(wall(t, off + side * 0.35, 0, 0.95, step), wallMat));
      // Üst kapak
      const capA = off;
      const capB = off + side * 0.35;
      this.group.add(
        new Mesh(ribbon(t, Math.min(capA, capB), Math.max(capA, capB), { y: 0.95 }), wallMat),
      );
      // Neon tüpler: üst ve alt
      const tubeMat = this.mat(neon(neonColor, 2.4, { side: DoubleSide }));
      this.group.add(new Mesh(wall(t, off - side * 0.02, 0.8, 0.93, step), tubeMat));
      this.group.add(
        new Mesh(wall(t, off - side * 0.02, 0.12, 0.18, step), this.mat(neon(neonColor, 1.4, { side: DoubleSide }))),
      );
    }

    // Işık direkleri (instanced)
    const spacing = 34 / Math.max(0.3, density);
    const count = Math.floor(t.length / spacing);
    const poleGeo = new CylinderGeometry(0.12, 0.16, 7, 6);
    poleGeo.translate(0, 3.5, 0);
    const headGeo = new BoxGeometry(0.5, 0.25, 2.4);
    const poleMat = this.mat(new MeshStandardMaterial({ color: 0x17122a, metalness: 0.8, roughness: 0.4 }));
    const poles = new InstancedMesh(poleGeo, poleMat, count * 2);
    const headsL = new InstancedMesh(headGeo, this.mat(neon(COLORS.magenta, 3)), count);
    const headsR = new InstancedMesh(headGeo, this.mat(neon(COLORS.cyan, 3)), count);
    const dummy = new Object3D();
    const q = createTrackQuery();
    let pi = 0;
    for (let k = 0; k < count; k++) {
      t.frameAt(k * spacing + spacing * 0.5, q);
      const yaw = Track.yawOf(q.tx, q.tz);
      for (const side of [-1, 1]) {
        const off = side * (t.barrierOffset + 1.1);
        dummy.position.set(q.cx + q.nx * off, 0, q.cz + q.nz * off);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(pi++, dummy.matrix);
        const headOff = side * (t.barrierOffset + 0.2);
        dummy.position.set(q.cx + q.nx * headOff, 7, q.cz + q.nz * headOff);
        dummy.rotation.set(0, yaw + Math.PI / 2, 0);
        dummy.updateMatrix();
        (side < 0 ? headsL : headsR).setMatrixAt(k, dummy.matrix);
      }
    }
    this.group.add(poles, headsL, headsR);

    // Direklerin yola düşürdüğü renkli ışık havuzları (ucuz, katmanlı decal)
    const poolTex = radialGlowTexture('rgba(255,255,255,0.75)', 'rgba(255,255,255,0.22)');
    const poolGeo = new PlaneGeometry(13, 13);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = (c: number) =>
      this.mat(
        new MeshBasicMaterial({
          map: poolTex,
          color: new Color(c).multiplyScalar(0.42),
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
        }),
      );
    const poolsL = new InstancedMesh(poolGeo, poolMat(COLORS.magenta), count);
    const poolsR = new InstancedMesh(poolGeo, poolMat(COLORS.cyan), count);
    for (let k = 0; k < count; k++) {
      t.frameAt(k * spacing + spacing * 0.5, q);
      for (const side of [-1, 1]) {
        const off = side * (t.roadHalfWidth + 1.5);
        dummy.position.set(q.cx + q.nx * off, 0.025, q.cz + q.nz * off);
        dummy.rotation.set(0, Track.yawOf(q.tx, q.tz), 0);
        dummy.updateMatrix();
        (side < 0 ? poolsL : poolsR).setMatrixAt(k, dummy.matrix);
      }
    }
    poolsL.renderOrder = poolsR.renderOrder = 1;
    this.group.add(poolsL, poolsR);
    this.noReflect.push(poolsL, poolsR);
  }

  private buildChevrons(): void {
    const t = this.track;
    const tex = chevronTexture();
    const matR = this.mat(new MeshBasicMaterial({ map: tex, color: new Color(COLORS.amber).multiplyScalar(2.2) }));
    const geo = new PlaneGeometry(3.2, 1.2);
    const q = createTrackQuery();
    let last = -999;
    for (let s = 0; s < t.length; s += 9) {
      t.frameAt(s, q);
      const k = q.curvature;
      if (Math.abs(k) < 1 / 42 || s - last < 9) continue;
      last = s;
      const outside = -Math.sign(k); // sağa dönüşte dış taraf sol
      const off = outside * (t.barrierOffset + 0.5);
      const m = new Mesh(geo, matR);
      m.position.set(q.cx + q.nx * off, 1.9, q.cz + q.nz * off);
      // Yaklaşan araca ve biraz piste dönük
      const lookX = m.position.x - q.tx * 10 - q.nx * outside * 6;
      const lookZ = m.position.z - q.tz * 10 - q.nz * outside * 6;
      m.lookAt(lookX, 1.9, lookZ);
      if (k < 0) m.scale.x = -1; // sola dönüşte oklar sola
      this.group.add(m);
    }
  }

  /** Başlangıç (ışıklı) veya bitiş kapısı. */
  private buildGantry(s: number, label: string, withLights: boolean): void {
    const t = this.track;
    const q = createTrackQuery();
    t.frameAt(s, q);
    const yaw = Track.yawOf(q.tx, q.tz);
    const g = new Group();
    g.position.set(q.cx, 0, q.cz);
    g.rotation.y = yaw;
    const span = t.barrierOffset + 1.2;
    const frameMat = this.mat(new MeshStandardMaterial({ color: 0x1a1430, metalness: 0.85, roughness: 0.3 }));
    for (const side of [-1, 1]) {
      const pillar = new Mesh(new BoxGeometry(1, 9, 1), frameMat);
      pillar.position.set(side * span, 4.5, 0);
      pillar.castShadow = true;
      g.add(pillar);
      const strip = new Mesh(new BoxGeometry(0.12, 8.6, 0.12), this.mat(neon(side < 0 ? COLORS.magenta : COLORS.cyan, 3)));
      strip.position.set(side * span - side * 0.52, 4.5, -0.52);
      g.add(strip);
    }
    const beam = new Mesh(new BoxGeometry(span * 2 + 1, 2.2, 1.2), frameMat);
    beam.position.set(0, 8.6, 0);
    g.add(beam);
    const banner = textTexture(label, {
      width: 1024,
      height: 128,
      color: '#ffffff',
      glow: '#ff2bd6',
      background: '#0b0716',
    });
    const bannerMat = this.mat(new MeshBasicMaterial({ map: banner, color: new Color(0.85, 0.85, 0.85) }));
    for (const dir of [-1, 1]) {
      const b = new Mesh(new PlaneGeometry(span * 2 - 2, 1.7), bannerMat);
      b.position.set(0, 8.6, dir * 0.61);
      if (dir < 0) b.rotation.y = Math.PI;
      g.add(b);
    }
    if (!withLights) {
      this.group.add(g);
      return;
    }
    // Start ışıkları: yaklaşan araca dönük (−Z yüzü)
    const lampGeo = new BoxGeometry(1.2, 1.2, 0.3);
    for (let i = 0; i < 3; i++) {
      const lamp = new Mesh(lampGeo, new MeshBasicMaterial({ color: this.lampOff.clone() }));
      this.materials.push(lamp.material as Material);
      lamp.position.set((i - 1) * 1.8, 6.6, -0.5);
      g.add(lamp);
      this.startLamps.push(lamp);
    }
    const lampBack = new Mesh(new BoxGeometry(6.4, 1.8, 0.4), frameMat);
    lampBack.position.set(0, 6.6, -0.25);
    g.add(lampBack);
    this.group.add(g);
  }

  private buildArches(): void {
    const t = this.track;
    const q = createTrackQuery();
    const R = t.barrierOffset + 1.4;
    const geo = new TorusGeometry(R, 0.22, 8, 48, Math.PI);
    const mats = [this.mat(neon(COLORS.magenta, 3)), this.mat(neon(COLORS.cyan, 3)), this.mat(neon(COLORS.violet, 3))];
    let n = 0;
    for (let s = 90; s < t.length - 60; s += 140) {
      t.frameAt(s, q);
      if (Math.abs(q.curvature) > 1 / 60) continue; // keskin virajda değil
      for (let k = 0; k < 2; k++) {
        const m = new Mesh(geo, mats[n % mats.length]);
        t.frameAt(s + k * 3.5, q);
        m.position.set(q.cx, 0, q.cz);
        m.rotation.y = Track.yawOf(q.tx, q.tz);
        m.scale.set(1, 0.6, 1);
        this.group.add(m);
      }
      n++;
    }
  }

  /**
   * Islak asfalt: düzlemsel yansımayı su birikintisi maskesiyle karıştır, birikintilerde
   * pürüzlülüğü düşür. Yansıma kapalıyken (düşük kalite) güç 0 olur.
   */
  enableWetRoad(reflection: PlanarReflection): void {
    const u = this.wetUniforms;
    u.tReflect.value = reflection.target.texture;
    u.uReflectMatrix.value = reflection.textureMatrix;
    u.tWet.value = wetTexture();
    const mat = this.roadMaterial;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflectMatrix;\nvarying vec4 vReflectUv;\nvarying vec3 vWorldWet;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvec4 wpWet = modelMatrix * vec4(transformed, 1.0);\nvWorldWet = wpWet.xyz;\nvReflectUv = uReflectMatrix * wpWet;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D tReflect;\nuniform sampler2D tWet;\nuniform float uReflectStrength;\nvarying vec4 vReflectUv;\nvarying vec3 vWorldWet;',
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float wetMask = smoothstep(0.42, 0.62, texture2D(tWet, vWorldWet.xz * 0.018).r);
          float wetness = mix(0.3, 1.0, wetMask) * step(0.001, uReflectStrength);
          roughnessFactor = mix(roughnessFactor, 0.08, wetness * 0.9);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            vec2 ruv = vReflectUv.xy / vReflectUv.w;
            vec3 wn = texture2D(tWet, vWorldWet.xz * 0.35).gba;
            vec2 ripple = (wn.xy - 0.5) * mix(0.009, 0.0025, wetMask);
            // Islak asfaltta yansıma dikeyde uzar: dikey eksende ağırlıklı örnekleme
            float spread = mix(0.012, 0.004, wetMask);
            vec3 refl = texture2D(tReflect, ruv + ripple).rgb * 0.3
              + texture2D(tReflect, ruv + ripple + vec2(0.0, spread)).rgb * 0.2
              + texture2D(tReflect, ruv + ripple - vec2(0.0, spread)).rgb * 0.2
              + texture2D(tReflect, ruv + ripple + vec2(0.0, spread * 2.2)).rgb * 0.15
              + texture2D(tReflect, ruv + ripple - vec2(0.0, spread * 2.2)).rgb * 0.15;
            float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            float fres = 0.22 + 0.78 * pow(max(1.0 - ndv, 1e-4), 4.0);
            float k = uReflectStrength * mix(0.32, 1.0, wetMask) * fres;
            outgoingLight = outgoingLight * (1.0 - k * 0.3) + refl * k;
          }
          #include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => 'wet-road';
    mat.needsUpdate = true;
  }

  setWetStrength(v: number): void {
    this.wetUniforms.uReflectStrength.value = v;
  }

  /** Geri sayım ışıkları: `lit` kadar kırmızı; `go` true ise hepsi yeşil. */
  setStartLights(lit: number, go: boolean): void {
    this.startLamps.forEach((lamp, i) => {
      const m = lamp.material as MeshBasicMaterial;
      m.color.copy(go ? this.lampGreen : i < lit ? this.lampRed : this.lampOff);
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
