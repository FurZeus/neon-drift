import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarSpec } from './cars';

/**
 * Araç modelleri `public/models/` altında, `manifest.json` ile listelenir (scripts/import-car.mjs
 * yazar). Manifestte olmayan dosya hiç istenmez; böylece eksik model konsolda 404 bırakmaz.
 */
interface Manifest {
  cars: Record<string, { file: string; bytes?: number; triangles?: number }>;
}

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<Object3D | null>>();
let manifest: Manifest = { cars: {} };

export async function loadManifest(): Promise<void> {
  try {
    const res = await fetch(`${BASE}models/manifest.json`, { cache: 'no-cache' });
    if (res.ok) manifest = (await res.json()) as Manifest;
  } catch {
    manifest = { cars: {} };
  }
}

export function hasModel(spec: CarSpec): boolean {
  return !!spec.model && !!manifest.cars[spec.id];
}

export function loadCarSource(spec: CarSpec): Promise<Object3D | null> {
  if (!hasModel(spec)) return Promise.resolve(null);
  let p = cache.get(spec.id);
  if (!p) {
    const entry = manifest.cars[spec.id];
    p = loader
      .loadAsync(`${BASE}models/${entry.file}`)
      .then((gltf) => gltf.scene as Object3D)
      .catch((err) => {
        console.warn(`Araç modeli yüklenemedi (${spec.id}):`, err);
        return null;
      });
    cache.set(spec.id, p);
  }
  return p;
}
