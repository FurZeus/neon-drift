import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';

export interface WheelLayout {
  frontZ: number;
  rearZ: number;
  /** Tekerlek merkezinin yan konumu (|x|). */
  trackX: number;
  radius: number;
  width?: number;
  /** 'sport' = 5 kollu alaşım + kaliper, 'cap' = jant kapaklı sac jant. */
  style?: 'sport' | 'cap';
  /** Jant kenarındaki neon halka (yoksa çizilmez). */
  ringMaterial?: Material | null;
}

export interface WheelSet {
  /** Direksiyon ekseni (Y) — öndekiler döner. */
  pivots: Group[];
  /** Dönme ekseni (X). */
  spinners: Group[];
  front: Group[];
  materials: Material[];
  geometries: BufferGeometry[];
}

/** Kodla üretilen dört tekerlek: modeli tekerleksiz gelen araçlar ve prosedürel Golf için. */
export function buildWheels(layout: WheelLayout): WheelSet {
  const r = layout.radius;
  const w = layout.width ?? r * 0.72;
  const style = layout.style ?? 'sport';
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const mat = (m: MeshStandardMaterial) => (materials.push(m), m);
  const geo = <T extends BufferGeometry>(g: T) => (geometries.push(g), g);

  const tireMat = mat(new MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.85, metalness: 0.1 }));
  const rimMat = mat(new MeshStandardMaterial({ color: 0x9ea3b0, metalness: 0.95, roughness: 0.22 }));
  const hubMat = mat(new MeshStandardMaterial({ color: 0x24252c, metalness: 0.7, roughness: 0.35 }));
  const chromeMat = mat(new MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.14 }));
  const caliperMat = mat(new MeshStandardMaterial({ color: 0xc8121f, metalness: 0.3, roughness: 0.4 }));

  const tireGeo = geo(new CylinderGeometry(r, r, w, 28));
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = geo(new CylinderGeometry(r * 0.71, r * 0.71, w + 0.005, 24));
  rimGeo.rotateZ(Math.PI / 2);
  const discGeo = geo(new CylinderGeometry(r * 0.58, r * 0.58, 0.03, 20));
  discGeo.rotateZ(Math.PI / 2);
  const capGeo = geo(new CylinderGeometry(r * 0.66, r * 0.62, 0.03, 24));
  capGeo.rotateZ(Math.PI / 2);
  const hubGeo = geo(new CylinderGeometry(r * 0.15, r * 0.15, 0.03, 12));
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = geo(new BoxGeometry(0.03, r * 0.58, r * 0.14));
  const slotGeo = geo(new BoxGeometry(0.012, r * 0.22, r * 0.07));
  const ringGeo = geo(new TorusGeometry(r * 0.715, r * 0.033, 6, 32));
  ringGeo.rotateY(Math.PI / 2);
  const caliperGeo = geo(new BoxGeometry(0.06, r * 0.39, r * 0.27));

  const set: WheelSet = { pivots: [], spinners: [], front: [], materials, geometries };
  const face = w / 2 + 0.006;
  for (const [z, isFront] of [
    [layout.frontZ, true],
    [layout.rearZ, false],
  ] as const) {
    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(side * layout.trackX, r, z);
      const spinner = new Group();
      const tire = new Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spinner.add(tire, new Mesh(rimGeo, hubMat));
      if (style === 'sport') {
        const disc = new Mesh(discGeo, rimMat);
        disc.position.x = side * 0.02;
        spinner.add(disc);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          const spoke = new Mesh(spokeGeo, rimMat);
          spoke.position.set(side * (face - 0.004), Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
          spoke.rotation.x = a; // uzun kenar radyal: yerel y → (cos a, sin a)
          spinner.add(spoke);
        }
        const caliper = new Mesh(caliperGeo, caliperMat);
        caliper.position.set(side * 0.06, r * 0.3, isFront ? -r * 0.36 : r * 0.36);
        pivot.add(caliper);
      } else {
        // Jant kapağı: gümüş disk ve havalandırma yuvaları
        const cap = new Mesh(capGeo, rimMat);
        cap.position.x = side * (face - 0.01);
        spinner.add(cap);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const slot = new Mesh(slotGeo, hubMat);
          slot.position.set(side * (face + 0.004), Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
          slot.rotation.x = a;
          spinner.add(slot);
        }
      }
      const hub = new Mesh(hubGeo, chromeMat);
      hub.position.x = side * (face + 0.004);
      spinner.add(hub);
      if (layout.ringMaterial) {
        const ring = new Mesh(ringGeo, layout.ringMaterial);
        ring.position.x = side * (face - 0.002);
        spinner.add(ring);
      }
      pivot.add(spinner);
      set.pivots.push(pivot);
      set.spinners.push(spinner);
      if (isFront) set.front.push(pivot);
    }
  }
  return set;
}
