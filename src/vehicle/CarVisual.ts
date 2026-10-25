import type { Color, Group, Mesh } from 'three';
import type { CarPaint } from '../config';
import type { CarPhysics } from './CarPhysics';

/** Prosedürel (CarModel) ve GLB (GltfCarModel) araç görsellerinin ortak arayüzü. */
export interface CarVisual {
  readonly root: Group;
  /** Zemine yatık alt ışık / gölge düzlemleri (yansımada gizlenir). */
  readonly floorDecals: Mesh[];
  readonly accentColor: Color;
  /** Egzoz çıkışları (araç uzayı: +Z ileri). */
  readonly exhaust: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>;
  update(dt: number, car: CarPhysics): void;
  placeGhost(x: number, z: number, yaw: number, spinSpeed: number, dt: number): void;
  rearWheelWorld(car: CarPhysics, out: { lx: number; lz: number; rx: number; rz: number }): void;
  setPaint(paint: CarPaint): void;
  setGhostOpacity(o: number): void;
  dispose(): void;
}
