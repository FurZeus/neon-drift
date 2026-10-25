import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Vector3,
  type Material,
  type MeshPhysicalMaterial,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_PAINTS, type CarPaint } from '../config';
import { CarModel } from '../vehicle/CarModel';
import { GltfCarModel } from '../vehicle/GltfCarModel';
import type { CarSpec } from '../vehicle/cars';
import type { CarVisual } from '../vehicle/CarVisual';

export interface TrafficTemplate {
  object: Group;
  halfLength: number;
  halfWidth: number;
  height: number;
  name: string;
}

const inv = new Matrix4();
const m4 = new Matrix4();

/** Nicemlenmiş / iç içe geçmiş öznitelikleri düz Float32 kopyaya çevir. */
function floatAttr(attr: BufferAttribute, itemSize: number, count: number): BufferAttribute {
  const out = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new BufferAttribute(out, itemSize);
}

/**
 * Görünüşü aynı malzemeler tek grupta birleşir: modeller parça başına malzeme kopyası taşır
 * (Golf 6: 17 ayrı boya kopyası), kimliğe göre gruplamak çizim çağrısını düşürmüyordu.
 */
function materialKey(m: Material): string {
  const s = m as Partial<MeshPhysicalMaterial>;
  return [
    m.type,
    m.name,
    s.color?.getHexString(),
    s.map?.uuid,
    s.emissive?.getHexString(),
    s.emissiveIntensity,
    s.emissiveMap?.uuid,
    s.metalness,
    s.roughness,
    s.clearcoat,
    s.envMapIntensity,
    m.transparent,
    m.opacity,
    m.side,
  ].join('|');
}

/**
 * Araç görselini malzeme başına tek mesh'e "pişir": trafikte onlarca araç çizim çağrısı
 * patlatmadan çizilebilsin. Saydam / ışık süsleri (alt ışık, alev) atlanır.
 */
function bake(visual: CarVisual): Group {
  const root = visual.root;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: Material; geos: BufferGeometry[] }>();
  const skip = new Set<Object3D>(visual.floorDecals);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || skip.has(mesh)) return;
    // Gizli (kopuk / iç) parçalar ve gizli üst düğümler pişirilmez
    for (let p: Object3D | null = mesh; p && p !== root; p = p.parent) if (!p.visible) return;
    const mat = mesh.material as Material;
    if (Array.isArray(mesh.material) || (mat as { blending?: number }).blending === 2) return; // additive süsler
    const src = mesh.geometry;
    const pos = src.getAttribute('position') as BufferAttribute | undefined;
    if (!pos) return;
    let g = new BufferGeometry();
    const count = pos.count;
    g.setAttribute('position', floatAttr(pos, 3, count));
    const nor = src.getAttribute('normal') as BufferAttribute | undefined;
    if (nor) g.setAttribute('normal', floatAttr(nor, 3, count));
    const uv = src.getAttribute('uv') as BufferAttribute | undefined;
    g.setAttribute('uv', uv ? floatAttr(uv, 2, count) : new BufferAttribute(new Float32Array(count * 2), 2));
    if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
    g = g.index ? g.toNonIndexed() : g;
    if (!nor) g.computeVertexNormals();
    m4.multiplyMatrices(inv, mesh.matrixWorld);
    g.applyMatrix4(m4);
    const key = materialKey(mat);
    const group = groups.get(key) ?? { mat, geos: [] };
    group.geos.push(g);
    groups.set(key, group);
  });
  const out = new Group();
  for (const { mat, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    out.add(new Mesh(merged, mat));
  }
  return out;
}

/** Garajdaki gerçek araçlardan (modeli olanlar + prosedürel Golf) trafik şablonları üretir. */
export class TrafficFactory {
  readonly templates: TrafficTemplate[] = [];
  private readonly visuals: CarVisual[] = [];

  add(spec: CarSpec, source: Object3D | null): void {
    const paints: CarPaint[] = source
      ? [CAR_PAINTS[0], CAR_PAINTS[1 + Math.floor(Math.random() * (CAR_PAINTS.length - 1))]]
      : [CAR_PAINTS[1], CAR_PAINTS[2], CAR_PAINTS[3], CAR_PAINTS[4], CAR_PAINTS[5]];
    for (const paint of paints) {
      const visual: CarVisual = source
        ? new GltfCarModel(source, spec, paint, { headlight: false })
        : new CarModel(paint, { headlight: false });
      const object = bake(visual);
      const box = new Box3().setFromObject(object);
      const size = box.getSize(new Vector3());
      this.templates.push({
        object,
        halfLength: size.z / 2,
        halfWidth: size.x / 2,
        height: size.y,
        name: spec.short,
      });
      this.visuals.push(visual);
    }
  }

  get ready(): boolean {
    return this.templates.length > 0;
  }

  pick(): TrafficTemplate {
    return this.templates[Math.floor(Math.random() * this.templates.length)];
  }

  dispose(): void {
    for (const t of this.templates) t.object.traverse((o) => (o as Mesh).isMesh && (o as Mesh).geometry.dispose());
    for (const v of this.visuals) v.dispose();
    this.templates.length = 0;
    this.visuals.length = 0;
  }
}
