import {
  AdditiveBlending,
  Box3,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { CarPaint } from '../config';
import { plateTexture, radialGlowTexture } from '../world/textures';
import type { CarPhysics } from './CarPhysics';
import type { CarVisual } from './CarVisual';
import type { CarSpec } from './cars';
import { buildWheels } from './wheels';

const WHEEL_RE = /wheel|tire|tyre|rim\b|rims|rad\b|reifen|felge|roue|rueda|llanta|pneu/i;
const PAINT_RE = /paint|body|carpaint|car_paint|lack|exterior|chassis|kaross|shell/i;
const NOT_PAINT_RE = /glass|window|windshield|chrome|tire|tyre|rubber|light|lamp|interior|seat|black|plastic|grill|mirror|plate|logo|badge|emblem|rim|wheel|brake|disc/i;
const TAIL_RE = /tail|brake|rear.?light|stop|back.?light|taillight|heck|ruck|rear_lamp/i;

/** Fotoğraf dokulu taramalarda dokunun hafif kendinden ışıması (gece renkleri seçilsin). */
const SCAN_GLOW = 0.42;

export type PartRole = 'paint' | 'glass' | 'tire' | 'rim' | 'plastic' | 'interior' | 'chrome' | 'light' | 'tail';

/** Dokusuz modellerde malzeme adından rol (İngilizce / İspanyolca / Almanca adlar). */
const ROLE_BY_NAME: Array<[PartRole, RegExp]> = [
  ['glass', /glass|window|windshield|windscreen|cristal|vidrio|scheibe|verre|\bglas\b/i],
  ['tire', /tire|tyre|rubber|gum\d|\bgum|goma|reifen|pneu/i],
  ['chrome', /chrome|chr\d|cromo|chrom/i],
  ['rim', /\brim|alu\d|alloy|felge|llanta/i],
  ['interior', /interior|seat|leather|cuero|fabric|cosido|dashboard|tapiz/i],
  ['plastic', /black|negro|plastic|\btrim|grill/i],
];
const HEAD_RE = /head.?light|headlamp|front.?light|front_lamp|headlight/i;
const PLATE_RE = /licen[cs]e.?plate|number.?plate|kennzeichen|matricula|placa/i;

/**
 * Yalnız boyaya etki eden beyaz dolgu ışığı (üstten alta yumuşak). Sahnenin mor ışığında yeşil
 * bileşen ~7 kat zayıf: beyaz araç lila, kırmızı pembe görünüyordu. Sahne ışığı değişmez.
 */
const PAINT_FILL = { value: 0.6 };

/**
 * Araç boyası: düşük metalik + kalın vernik + nötr dolgu. Yüksek metaliklikte gövde rengi yerine neon
 * ortam yansıması (camgöbeği / pembe) görünüyordu; yansımalar artık vernik katmanında kalır.
 */
function paintMaterial(src: MeshStandardMaterial | null, color?: Color | number): MeshPhysicalMaterial {
  const phys = new MeshPhysicalMaterial();
  if (src) MeshStandardMaterial.prototype.copy.call(phys, src);
  if (color !== undefined) phys.color.set(color);
  phys.metalness = 0.15;
  phys.roughness = 0.3;
  phys.clearcoat = 1;
  phys.clearcoatRoughness = 0.03;
  phys.envMapIntensity = 0.9;
  phys.transparent = false;
  phys.opacity = 1;
  phys.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintFill = PAINT_FILL;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPaintFill;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float sky = 0.35 + 0.65 * clamp(dot(normal, upV) * 0.5 + 0.5, 0.0, 1.0);
          reflectedLight.indirectDiffuse += material.diffuseColor * uPaintFill * sky;
        }`,
      );
  };
  phys.customProgramCacheKey = () => 'neon-paint-fill';
  return phys;
}

interface Wheel {
  steer: Group;
  spin: Group;
  front: boolean;
  radius: number;
}

const tmpBox = new Box3();
const tmpV = new Vector3();

/** Ayardaki adlar küçük harfle "içerir" eşleşir; '=' ile başlayan ad tam eşleşme ister. */
function matches(names: string[] | undefined, value: string, fallback: RegExp): boolean {
  const v = value.toLowerCase().trim();
  if (names && names.length)
    return names.some((n) => (n.startsWith('=') ? v === n.slice(1).toLowerCase() : v.includes(n.toLowerCase())));
  return fallback.test(value);
}

function triangleArea(geo: BufferGeometry): number {
  const pos = geo.getAttribute('position');
  if (!pos) return 0;
  const count = geo.index ? geo.index.count / 3 : pos.count / 3;
  return count; // üçgen sayısı, kaba bir alan yerine geçer
}

/**
 * GLB'den yüklenen gerçek araç. Model +Z ileri, gerçek boyuna ölçeklenmiş ve zemine
 * oturtulmuş hâle getirilir; tekerlekler (bulunursa) döner ve öndekiler direksiyonla döner.
 */
export class GltfCarModel implements CarVisual {
  readonly root = new Group();
  readonly floorDecals: Mesh[] = [];
  readonly length: number;
  readonly width: number;
  readonly height: number;
  private readonly body = new Group();
  private readonly wheels: Wheel[] = [];
  private readonly paintMats: Array<{ mat: MeshStandardMaterial; original: Color }> = [];
  private readonly tailMats: MeshStandardMaterial[] = [];
  private readonly materials: Material[] = [];
  private readonly ownGeometries: BufferGeometry[] = [];
  private readonly glowMat: MeshBasicMaterial;
  private readonly flameMat: SpriteMaterial;
  private readonly flames: Sprite[] = [];
  private readonly rearLocal = { x: 0.75, z: -1.3 };
  /** Egzoz çıkışları (araç uzayı). */
  readonly exhaust: Vector3[] = [];
  private ghostMat: MeshBasicMaterial | null = null;
  private readonly roleMats = new Map<PartRole, Material>();
  /** Dokusuz (beyaz) gelen modellerde "Fabrika rengi" yerine kullanılacak gövde rengi. */
  private factoryColor: number | null = null;
  private readonly accent = new Color();
  private spinAngle = 0;
  private roll = 0;
  private pitch = 0;
  private time = 0;
  readonly headlight: SpotLight | null = null;

  constructor(source: Object3D, spec: CarSpec, paint: CarPaint, opts: { ghost?: boolean; headlight?: boolean } = {}) {
    const cfg = spec.model!;
    this.accent.set(paint.accent);
    this.root.add(this.body);

    // Malzemeleri kopyala: aynı kaynaktan oluşan oyuncu ve hayalet araç birbirini etkilemesin.
    const model = source.clone(true);
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map((mat) => this.prepareMaterial(mat, m, cfg));
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
    });

    const inner = new Group();
    inner.add(model);
    this.body.add(inner);
    model.rotation.set(cfg.rotationX ?? 0, cfg.rotationY, 0, 'YXZ');
    if (cfg.hide?.length) {
      const hide = cfg.hide.map((h) => h.toLowerCase());
      model.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const names = [((m.material as Material).name ?? '').toLowerCase()];
        for (let p: Object3D | null = m; p && p !== model; p = p.parent) names.push(p.name.toLowerCase());
        if (hide.some((h) => (h.startsWith('=') ? names.includes(h.slice(1)) : names.some((n) => n.includes(h)))))
          m.visible = false;
      });
    }
    const size = new Vector3();
    this.mainBox(model, size);
    // Uzun eksen X'teyse (model yana bakıyor) 90° çevir.
    if (size.x > size.z * 1.25) {
      model.rotation.y += Math.PI / 2;
      this.mainBox(model, size);
    }
    // Ön/arka: far ve stop parçalarının konumundan (ayar kapatmadıysa)
    if (cfg.autoFront !== false && this.frontIsBackwards(model, cfg)) {
      model.rotation.y += Math.PI;
      this.mainBox(model, size);
    }
    const s = cfg.length / Math.max(0.01, size.z);
    model.scale.multiplyScalar(s);
    const box = this.mainBox(model, size);
    const center = box.getCenter(new Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    // Taramalardan kalan zemin dilimini kes: her yerde groundCut (m) altı, araç dış hattının
    // dışında iki katı yüksekliğe kadar; sonra yeniden ortala ve zemine oturt.
    if (cfg.groundCut) {
      this.root.updateMatrixWorld(true);
      this.cutBelow(model, cfg.groundCut, spec.physics.carHalfWidth ?? 0.9, cfg.length / 2);
      const b = this.mainBox(model, size);
      const c = b.getCenter(new Vector3());
      model.position.x -= c.x;
      model.position.z -= c.z;
      model.position.y -= b.min.y;
    }
    this.root.updateMatrixWorld(true);
    this.mainBox(model, size);
    this.length = size.z;
    this.width = size.x;
    this.height = size.y;

    // Boya malzemesi adla bulunamadıysa en çok üçgene sahip "gövde benzeri" malzemeyi seç.
    if (!this.paintMats.length) this.guessPaint(model);
    if (cfg.addWheels) this.addWheels(cfg.addWheels, model);
    else this.findWheels(model, cfg.wheelNodes);
    this.factoryColor = cfg.factoryColor ?? null;
    if (cfg.plate) this.addPlates(model, cfg.plate);
    this.findExhaust(model, cfg.exhaust);

    // ---- Neon ekler: alt ışık, gölge, turbo alevi, far ----
    this.glowMat = this.track(
      new MeshBasicMaterial({
        map: radialGlowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)'),
        color: this.accent.clone().multiplyScalar(1.3),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    const under = new Mesh(new PlaneGeometry(this.width + 1.3, this.length + 1.4), this.glowMat);
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.04;
    under.renderOrder = 2;
    const blob = new Mesh(
      new PlaneGeometry(this.width + 0.6, this.length + 0.5),
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

    this.flameMat = new SpriteMaterial({
      map: radialGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'),
      color: new Color(0x5ad8ff).multiplyScalar(2),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.materials.push(this.flameMat);
    for (const e of this.exhaust) {
      const f = new Sprite(this.flameMat);
      f.position.set(e.x, e.y, e.z - 0.16);
      f.scale.setScalar(0.001);
      this.flames.push(f);
      this.body.add(f);
    }

    if (opts.headlight && !opts.ghost) {
      const spot = new SpotLight(0xdff6ff, 420, 95, 0.52, 0.55, 2);
      spot.position.set(0, 0.65, this.length / 2 - 0.3);
      spot.target.position.set(0, 0, 24);
      this.root.add(spot, spot.target);
      this.headlight = spot;
    }

    if (opts.ghost) this.makeGhost();
    else this.setPaint(paint);
  }

  private track<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** Rol başına paylaşılan gerçekçi malzeme (dokusuz modelleri giydirmek için). */
  private roleMaterial(role: PartRole, src: MeshStandardMaterial | null, cfg: NonNullable<CarSpec['model']>): Material {
    const cached = this.roleMats.get(role);
    if (cached) return cached;
    let mat: Material;
    switch (role) {
      case 'paint': {
        const phys = paintMaterial(null, cfg.factoryColor ?? src?.color ?? 0x888888);
        this.paintMats.push({ mat: phys, original: phys.color.clone() });
        mat = phys;
        break;
      }
      case 'glass':
        mat = new MeshPhysicalMaterial({
          color: 0x0b0f17,
          metalness: 0.2,
          roughness: 0.05,
          clearcoat: 1,
          envMapIntensity: 1.4,
          transparent: true,
          opacity: 0.86,
        });
        break;
      case 'tire':
        mat = new MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9, metalness: 0.05 });
        break;
      case 'rim':
        mat = new MeshStandardMaterial({ color: 0xaeb3bd, metalness: 0.9, roughness: 0.25, envMapIntensity: 1.3 });
        break;
      case 'chrome':
        mat = new MeshStandardMaterial({ color: 0xe0e4ea, metalness: 1, roughness: 0.12, envMapIntensity: 1.4 });
        break;
      case 'plastic':
        mat = new MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.6, metalness: 0.1 });
        break;
      case 'interior':
        mat = new MeshStandardMaterial({ color: 0x131317, roughness: 0.85, metalness: 0 });
        break;
      case 'light':
        mat = new MeshStandardMaterial({ color: 0xdfe8f2, emissive: new Color(0.9, 0.95, 1), emissiveIntensity: 1.6, roughness: 0.1 });
        break;
      case 'tail': {
        const t = new MeshStandardMaterial({ color: 0x5a0a10, emissive: new Color(1, 0.05, 0.1), emissiveIntensity: 1.2, roughness: 0.2 });
        this.tailMats.push(t);
        mat = t;
        break;
      }
    }
    this.materials.push(mat);
    this.roleMats.set(role, mat);
    return mat;
  }

  /** Ayardaki `parts` (düğüm adı → rol) ya da dokusuz malzemenin adından rol. */
  private roleOf(src: Material, mesh: Mesh, cfg: NonNullable<CarSpec['model']>): PartRole | null {
    if (cfg.parts) {
      // Düğüm zinciri ve malzeme adı
      const chain: string[] = [(src.name ?? '').toLowerCase()];
      for (let p: Object3D | null = mesh; p; p = p.parent) chain.push(p.name.toLowerCase());
      for (const [role, names] of Object.entries(cfg.parts) as Array<[PartRole, string[]]>) {
        if (names.some((n) => chain.some((c) => (n.startsWith('=') ? c === n.slice(1) : c.includes(n))))) return role;
      }
    }
    const std = src as MeshStandardMaterial;
    if (std.map) return null;
    for (const [role, re] of ROLE_BY_NAME) if (re.test(src.name ?? '')) return role;
    return null;
  }

  private prepareMaterial(src: Material, mesh: Mesh, cfg: NonNullable<CarSpec['model']>): Material {
    const name = `${src.name ?? ''} ${mesh.name ?? ''}`;
    const srcStd = (src as MeshStandardMaterial).isMeshStandardMaterial ? (src as MeshStandardMaterial) : null;
    const role = this.roleOf(src, mesh, cfg);
    if (role) return this.roleMaterial(role, srcStd, cfg);
    // Işıksız (unlit) tarama dokuları sahne ışığını görmez, gece düz ve yapışık durur:
    // aynı dokuyla ışık alan vernikli malzemeye çevir.
    const basic = src as MeshBasicMaterial;
    if (cfg.glossy && basic.isMeshBasicMaterial && basic.map) {
      const phys = new MeshPhysicalMaterial({
        map: basic.map,
        color: basic.color,
        roughness: 0.42,
        metalness: 0.15,
        clearcoat: 0.8,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.6,
        side: basic.side,
        // Taramanın kendi (gündüz) renkleri gece de seçilsin
        emissive: 0xffffff,
        emissiveMap: basic.map,
        emissiveIntensity: SCAN_GLOW,
      });
      this.materials.push(phys);
      return phys;
    }
    let mat: Material = src.clone();
    this.materials.push(mat);
    const std = mat as MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return mat;
    // Fotoğraf dokulu taramalar: vernik ekle, gece ışıkları yüzeyde görünsün
    if (cfg.glossy && std.map) {
      const phys = new MeshPhysicalMaterial();
      MeshStandardMaterial.prototype.copy.call(phys, std);
      phys.clearcoat = 0.8;
      phys.clearcoatRoughness = 0.08;
      phys.roughness = Math.min(0.45, std.roughness);
      phys.envMapIntensity = 1.6;
      phys.emissive.set(0xffffff);
      phys.emissiveMap = std.map;
      phys.emissiveIntensity = SCAN_GLOW;
      this.materials.push(phys);
      return phys;
    }

    const isPaint = matches(cfg.paintMaterials, src.name ?? '', PAINT_RE) && !(cfg.paintMaterials ? false : NOT_PAINT_RE.test(src.name ?? ''));
    if (isPaint) {
      // Vernikli araç boyası: clearcoat için fiziksel malzemeye yükselt
      const phys = paintMaterial(std);
      this.materials.push(phys);
      this.paintMats.push({ mat: phys, original: std.color.clone() });
      mat = phys;
    } else {
      std.envMapIntensity = 1.25;
    }
    const m = mat as MeshStandardMaterial;
    const listed = (list: string[] | undefined) =>
      !!list?.length && (matches(list, src.name ?? '', TAIL_RE) || matches(list, mesh.name ?? '', TAIL_RE));
    const isTail = cfg.tailMaterials?.length ? listed(cfg.tailMaterials) : TAIL_RE.test(name);
    const isHead = cfg.headMaterials?.length ? listed(cfg.headMaterials) : HEAD_RE.test(name);
    if (isTail) {
      m.emissive = new Color(1, 0.05, 0.1);
      m.emissiveIntensity = 1.2;
      this.tailMats.push(m);
    } else if (isHead) {
      m.emissive = new Color(0.9, 0.95, 1);
      m.emissiveIntensity = 1.6;
    }
    return mat;
  }

  /**
   * Ana gövdenin sınır kutusu: en büyük parçanın çevresinde kümelenmeyen (havada kalmış, kopuk)
   * parçalar gizlenir ve hesaba katılmaz.
   */
  private mainBox(model: Object3D, size: Vector3): Box3 {
    model.updateMatrixWorld(true);
    const parts: Array<{ mesh: Mesh; box: Box3 }> = [];
    model.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.visible) parts.push({ mesh: m, box: new Box3().setFromObject(m, true) });
    });
    const out = new Box3();
    if (!parts.length) return out;
    const area = (b: Box3) => {
      const v = b.getSize(tmpV);
      return v.x * v.z + v.y * Math.max(v.x, v.z) * 0.5;
    };
    const anchor = parts.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
    const grow = anchor.box.getSize(new Vector3());
    const reach = anchor.box.clone().expandByScalar(Math.max(grow.x, grow.y, grow.z) * 0.2);
    for (const p of parts) {
      if (reach.containsPoint(p.box.getCenter(tmpV))) out.union(p.box);
      else p.mesh.visible = false;
    }
    out.getSize(size);
    return out;
  }

  /**
   * Tüm köşeleri `y` yüksekliğinin altında kalan üçgenleri sil. Geometri önbellekteki kaynakla
   * paylaşıldığından bir kez yapılır (aynı kaynaktan üretilen her kopya aynı kesimi ister).
   */
  private cutBelow(model: Object3D, y: number, halfW: number, halfL: number): void {
    const v = new Vector3();
    const inv = this.root.matrixWorld.clone().invert();
    const m4 = new Matrix4();
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      const original = m.geometry;
      const cached = original.userData.cutGeometry as BufferGeometry | undefined;
      if (cached) {
        m.geometry = cached;
        return;
      }
      if (!original.index) return;
      m4.multiplyMatrices(inv, m.matrixWorld);
      const pos = original.getAttribute('position');
      const wp = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        wp.set([v.x, v.y, v.z], i * 3);
      }
      // Üçgen merkezine göre kes: her yerde y altı; dış hat dışında 2y altı; hat içinde 1.6y altındaki
      // yukarı bakan yüzeyler (zemin üstü). Lastiklerin aşağı bakan yüzleri korunur.
      const src = original.index.array;
      const kept: number[] = [];
      for (let t = 0; t < src.length; t += 3) {
        const a = src[t] * 3;
        const b = src[t + 1] * 3;
        const c = src[t + 2] * 3;
        const cx = (wp[a] + wp[b] + wp[c]) / 3;
        const cy = (wp[a + 1] + wp[b + 1] + wp[c + 1]) / 3;
        const cz = (wp[a + 2] + wp[b + 2] + wp[c + 2]) / 3;
        const e1x = wp[b] - wp[a], e1y = wp[b + 1] - wp[a + 1], e1z = wp[b + 2] - wp[a + 2];
        const e2x = wp[c] - wp[a], e2y = wp[c + 1] - wp[a + 1], e2z = wp[c + 2] - wp[a + 2];
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const up = ny / (Math.hypot(nx, ny, nz) || 1);
        const outside = Math.abs(cx) > halfW + 0.04 || Math.abs(cz) > halfL + 0.04;
        const cut = cy < y || (cy < y * 2 && outside) || (cy < y * 1.6 && up > 0.8);
        if (!cut) kept.push(src[t], src[t + 1], src[t + 2]);
      }
      // Kullanılmayan köşeleri at (sınır kutusu ve alt ışık boyutu doğru çıksın)
      const g = original.clone();
      g.setIndex(kept);
      const compact = g.toNonIndexed();
      g.dispose();
      compact.computeBoundingBox();
      compact.computeBoundingSphere();
      original.userData.cutGeometry = compact;
      m.geometry = compact;
    });
  }

  /** Far parçaları stoplardan daha geride (−Z) mi? */
  private frontIsBackwards(model: Object3D, cfg: NonNullable<CarSpec['model']>): boolean {
    let headZ = 0;
    let headN = 0;
    let tailZ = 0;
    let tailN = 0;
    const box = new Box3();
    const center = this.mainBox(model, new Vector3()).getCenter(new Vector3());
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      const name = `${m.name} ${(m.material as Material).name ?? ''}`;
      const z = box.setFromObject(m, true).getCenter(tmpV).z - center.z;
      if (matches(cfg.headMaterials, name, HEAD_RE)) {
        headZ += z;
        headN++;
      } else if (matches(cfg.tailMaterials, name, TAIL_RE)) {
        tailZ += z;
        tailN++;
      }
    });
    if (headN && tailN) return headZ / headN < tailZ / tailN;
    if (tailN) return tailZ / tailN > 0;
    if (headN) return headZ / headN < 0;
    return false;
  }

  /**
   * Modeli tekerleksiz (ya da bozuk tekerlekli) gelen araçlara kodla tekerlek tak. `fromNodes`
   * verilirse aks yerleri bu adla eşleşen parçalardan (ör. süspansiyon göbekleri) okunur ve gövde
   * tekerleklerin üstüne oturtulur.
   */
  private addWheels(layout: NonNullable<NonNullable<CarSpec['model']>['addWheels']>, model: Object3D): void {
    const l = { ...layout };
    if (l.fromNodes) {
      const key = l.fromNodes.toLowerCase();
      const front: Vector3[] = [];
      const rear: Vector3[] = [];
      const inv = this.root.matrixWorld.clone().invert();
      const box = new Box3();
      this.root.updateMatrixWorld(true);
      model.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        let named = false;
        for (let p: Object3D | null = m; p && p !== model; p = p.parent) if (p.name.toLowerCase().includes(key)) named = true;
        if (!named) return;
        const c = box.setFromObject(m, true).getCenter(new Vector3()).applyMatrix4(inv);
        (c.z > 0 ? front : rear).push(c);
      });
      const avg = (list: Vector3[], f: (v: Vector3) => number) => list.reduce((a, v) => a + f(v), 0) / list.length;
      if (front.length && rear.length) {
        l.frontZ = avg(front, (v) => v.z);
        l.rearZ = avg(rear, (v) => v.z);
        const all = [...front, ...rear];
        const spread = Math.max(...all.map((v) => Math.abs(v.x)));
        if (spread > 0.3) l.trackX = spread + (l.width ?? l.radius * 0.7) * 0.25;
        // Göbek yüksekliği = tekerlek yarıçapı olacak şekilde gövdeyi kaydır
        const hubY = avg(all, (v) => v.y);
        model.position.y += l.radius - hubY;
        this.root.updateMatrixWorld(true);
      }
    }
    const set = buildWheels({ ...l, ringMaterial: null });
    set.materials.forEach((m) => this.materials.push(m));
    for (let i = 0; i < set.pivots.length; i++) {
      this.body.add(set.pivots[i]);
      const front = set.front.includes(set.pivots[i]);
      this.wheels.push({ steer: set.pivots[i], spin: set.spinners[i], front, radius: l.radius });
    }
    this.rearLocal.x = l.trackX;
    this.rearLocal.z = l.rearZ;
  }

  /** Görünmez / dokusuz plaka parçalarının önüne oyunun plakasını koy (önde ve arkada birer tane). */
  private addPlates(model: Object3D, text: string): void {
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const mat = this.track(new MeshBasicMaterial({ map: plateTexture(text), color: new Color(0.85, 0.85, 0.85) }));
    const placed = new Set<string>();
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || Array.isArray(m.material) || !PLATE_RE.test((m.material as Material).name ?? '')) return;
      const box = new Box3().setFromObject(m, true).applyMatrix4(inv);
      m.visible = false;
      const c = box.getCenter(new Vector3());
      const side = c.z > 0 ? 'front' : 'rear';
      if (placed.has(side)) return;
      placed.add(side);
      const w = Math.min(0.56, Math.max(0.3, box.max.x - box.min.x));
      const plate = new Mesh(new PlaneGeometry(w, w * 0.22), mat);
      plate.position.set(c.x, c.y, side === 'front' ? box.max.z + 0.004 : box.min.z - 0.004);
      if (side === 'rear') plate.rotation.y = Math.PI;
      this.ownGeometries.push(plate.geometry);
      this.body.add(plate);
    });
  }

  /** Egzoz uçlarının çıkış noktaları: köşeleri yanlara ayırıp her yanın en arka merkezini al. */
  private findExhaust(model: Object3D, key?: string): void {
    if (key) {
      this.root.updateMatrixWorld(true);
      const inv = this.root.matrixWorld.clone().invert();
      const m4 = new Matrix4();
      const sides = new Map<number, Box3>();
      const k = key.toLowerCase();
      model.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.visible) return;
        let named = false;
        for (let p: Object3D | null = m; p && p !== model; p = p.parent) if (p.name.toLowerCase().includes(k)) named = true;
        if (!named) return;
        m4.multiplyMatrices(inv, m.matrixWorld);
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          tmpV.fromBufferAttribute(pos, i).applyMatrix4(m4);
          const side = tmpV.x < 0 ? -1 : 1;
          const b = sides.get(side) ?? new Box3();
          b.expandByPoint(tmpV);
          sides.set(side, b);
        }
      });
      for (const b of sides.values()) {
        const c = b.getCenter(new Vector3());
        this.exhaust.push(new Vector3(c.x, c.y, b.min.z));
      }
    }
    if (!this.exhaust.length)
      for (const side of [-1, 1]) this.exhaust.push(new Vector3(side * this.width * 0.25, 0.3, -this.length / 2 - 0.02));
  }

  private guessPaint(model: Object3D): void {
    // Tek dokulu (atlas / tarama) modellerde gövde ayrı malzeme değil: boyamak camları ve
    // lastikleri de boyar. En az üç ayrı malzeme yoksa orijinal dokuyu koru.
    // Malzemeler örnek başına kopyalandığı için ada göre say
    const distinct = new Set<string>();
    model.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.visible && !Array.isArray(m.material)) {
        const mat = m.material as Material;
        distinct.add(mat.name || mat.uuid);
      }
    });
    if (distinct.size < 3) return;
    const score = new Map<MeshStandardMaterial, number>();
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = m.material as MeshStandardMaterial;
      if (Array.isArray(m.material) || !mat.isMeshStandardMaterial) return;
      if (NOT_PAINT_RE.test(`${mat.name} ${m.name}`) || WHEEL_RE.test(m.name) || mat.transparent) return;
      const lum = mat.color.r * 0.3 + mat.color.g * 0.59 + mat.color.b * 0.11;
      if (lum < 0.04 && !mat.map) return;
      score.set(mat, (score.get(mat) ?? 0) + triangleArea(m.geometry));
    });
    let best: MeshStandardMaterial | null = null;
    let bestScore = 0;
    for (const [mat, sc] of score) if (sc > bestScore) [best, bestScore] = [mat, sc];
    if (!best) return;
    // Yerinde fiziksel malzemeye çevir
    const phys = paintMaterial(best);
    this.materials.push(phys);
    model.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material === best) m.material = phys;
    });
    this.paintMats.push({ mat: phys, original: best.color.clone() });
  }

  /** Tekerlek düğümlerini çeyrek bölgelere ayırıp dönen pivotlara bağla. */
  private findWheels(model: Object3D, names?: string[]): void {
    const isWheel = (o: Object3D): boolean => {
      for (let p: Object3D | null = o; p && p !== model.parent; p = p.parent) {
        if (names && names.length ? names.some((n) => p!.name.toLowerCase().includes(n.toLowerCase())) : WHEEL_RE.test(p.name))
          return true;
      }
      return false;
    };
    const quads: Record<string, Mesh[]> = { FL: [], FR: [], RL: [], RR: [] };
    const halfW = this.width / 2;
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !isWheel(m)) return;
      tmpBox.setFromObject(m, true);
      // İki yanı birden kapsayan (birleşik) tekerlek meshleri döndürülemez
      if (tmpBox.min.x < -halfW * 0.3 && tmpBox.max.x > halfW * 0.3) return;
      if (tmpBox.min.z < -this.length * 0.15 && tmpBox.max.z > this.length * 0.15) return;
      const c = tmpBox.getCenter(tmpV);
      const key = (c.z > 0 ? 'F' : 'R') + (c.x > 0 ? 'L' : 'R');
      quads[key].push(m);
    });
    for (const [key, meshes] of Object.entries(quads)) {
      if (!meshes.length) continue;
      const box = new Box3();
      for (const m of meshes) box.union(tmpBox.setFromObject(m, true));
      const c = box.getCenter(new Vector3());
      const sz = box.getSize(new Vector3());
      const steer = new Group();
      steer.position.copy(c);
      const spin = new Group();
      steer.add(spin);
      this.body.add(steer);
      this.root.updateMatrixWorld(true);
      for (const m of meshes) spin.attach(m);
      this.wheels.push({ steer, spin, front: key[0] === 'F', radius: Math.max(0.2, Math.max(sz.y, sz.z) / 2) });
      if (key === 'RL') {
        this.rearLocal.x = c.x;
        this.rearLocal.z = c.z;
      }
    }
    if (!this.wheels.length) {
      this.rearLocal.x = halfW - 0.18;
      this.rearLocal.z = -this.length * 0.31;
    }
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
    this.body.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.material = ghostMat;
        m.castShadow = false;
      }
    });
    this.flames.forEach((f) => (f.visible = false));
    this.floorDecals.forEach((d) => (d.visible = false));
  }

  get accentColor(): Color {
    return this.accent;
  }

  setGhostOpacity(o: number): void {
    if (this.ghostMat) this.ghostMat.opacity = o;
  }

  setPaint(paint: CarPaint): void {
    this.accent.set(paint.accent);
    for (const p of this.paintMats) {
      if (paint.body >= 0) p.mat.color.set(paint.body);
      else if (this.factoryColor !== null) p.mat.color.set(this.factoryColor);
      else p.mat.color.copy(p.original);
    }
    this.glowMat.color.copy(this.accent).multiplyScalar(1.3);
  }

  update(dt: number, car: CarPhysics): void {
    this.time += dt;
    this.root.position.set(car.x, 0, car.z);
    this.root.rotation.y = car.yaw;
    this.spinAngle += car.speed * dt;
    const steerAngle = -car.steer * 0.42;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.spinAngle / w.radius;
      if (w.front) w.steer.rotation.y = steerAngle;
    }
    const lat = car.speed * car.yawRate;
    const rollTarget = Math.max(-0.07, Math.min(0.07, lat * 0.0036));
    const pitchTarget = Math.max(-0.045, Math.min(0.05, -car.accel * 0.0024));
    const k = 1 - Math.exp(-8 * dt);
    this.roll += (rollTarget - this.roll) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    const speedF = Math.min(1, Math.abs(car.speed) / 60);
    this.body.position.y =
      Math.sin(this.time * 47) * 0.004 * speedF + (car.offroad ? Math.sin(this.time * 31) * 0.02 * speedF : 0);

    const braking = (car.input.brake > 0.1 && car.speed > 0.5) || car.input.handbrake;
    for (const m of this.tailMats) m.emissiveIntensity = braking ? 4 : 1.2;

    const boosting = car.boostTime > 0;
    for (const f of this.flames) {
      const target = boosting ? 0.8 + Math.random() * 0.45 : 0.001;
      f.scale.setScalar(f.scale.x + (target - f.scale.x) * Math.min(1, dt * 18));
    }
    this.flameMat.color.setHex(car.drifting && car.driftLevel === 2 ? 0xff5ad8 : 0x5ad8ff).multiplyScalar(2.6);
    const pulse = 1.2 + Math.sin(this.time * 5) * 0.15 + (boosting ? 0.6 : 0);
    this.glowMat.color.copy(this.accent).multiplyScalar(pulse);
  }

  placeGhost(x: number, z: number, yaw: number, spinSpeed: number, dt: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.spinAngle += spinSpeed * dt;
    for (const w of this.wheels) w.spin.rotation.x = this.spinAngle / w.radius;
  }

  rearWheelWorld(car: CarPhysics, out: { lx: number; lz: number; rx: number; rz: number }): void {
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    const x = Math.abs(this.rearLocal.x);
    const z = this.rearLocal.z;
    out.lx = car.x + x * c + z * s;
    out.lz = car.z - x * s + z * c;
    out.rx = car.x - x * c + z * s;
    out.rz = car.z + x * s + z * c;
  }

  dispose(): void {
    // Geometriler önbellekteki kaynakla paylaşılır; yalnızca kendi eklerimizi ve malzemeleri bırak.
    for (const d of this.floorDecals) d.geometry.dispose();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
