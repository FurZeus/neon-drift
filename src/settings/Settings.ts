import { CAR_PAINTS, RACE, type QualitySetting } from '../config';
import { CARS, DEFAULT_CAR } from '../vehicle/cars';
import { TRACKS } from '../world/tracks';

export interface GameSettings {
  /** 0..1 — varsayılan düşük. */
  sfxVolume: number;
  /** 0..1 — varsayılan kapalı. */
  musicVolume: number;
  quality: QualitySetting;
  laps: number;
  paint: number;
  cameraShake: boolean;
  vibration: boolean;
  ghost: boolean;
  hints: boolean;
  /** Garajda seçili araç. */
  car: string;
  /** Seçili pist. */
  track: string;
  /** Öğretici ipuçları bir kez tamamlandı mı. */
  tutorialDone: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sfxVolume: 0.3,
  musicVolume: 0,
  quality: 'auto',
  laps: RACE.defaultLaps,
  paint: 0,
  cameraShake: true,
  vibration: true,
  ghost: true,
  hints: true,
  car: DEFAULT_CAR,
  track: 'neon',
  tutorialDone: false,
};

const KEY = 'neon-drift:settings:v1';
const RECORDS_PREFIX = 'neon-drift:records:v1:';

/**
 * Rekorlar ve hayalet pist düzenine ve araca bağlıdır: pist değişirse eski kayıtlar kullanılmaz.
 * Anahtar: `trackSignature(...) + ':' + aracKimligi`.
 */
export function trackSignature(points: ReadonlyArray<readonly [number, number]>): string {
  let h = 5381;
  const str = points.map(([x, z]) => `${x},${z}`).join(';');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* gizli pencere / depolama kapalı: ayarlar yalnızca bu oturumda geçerli */
  }
}

export function loadSettings(): GameSettings {
  const raw = safeGet(KEY);
  const s: GameSettings = { ...DEFAULT_SETTINGS };
  if (!raw) return s;
  try {
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const num = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    s.sfxVolume = num(parsed.sfxVolume, 0, 1, s.sfxVolume);
    s.musicVolume = num(parsed.musicVolume, 0, 1, s.musicVolume);
    if (['auto', 'low', 'medium', 'high', 'ultra'].includes(parsed.quality as string)) s.quality = parsed.quality!;
    if ((RACE.lapOptions as readonly number[]).includes(parsed.laps as number)) s.laps = parsed.laps!;
    s.paint = Math.round(num(parsed.paint, 0, CAR_PAINTS.length - 1, s.paint));
    if (typeof parsed.car === 'string' && CARS.some((c) => c.id === parsed.car)) s.car = parsed.car;
    if (typeof parsed.track === 'string' && TRACKS.some((t) => t.id === parsed.track)) s.track = parsed.track;
    for (const k of ['cameraShake', 'vibration', 'ghost', 'hints', 'tutorialDone'] as const) {
      if (typeof parsed[k] === 'boolean') s[k] = parsed[k]!;
    }
  } catch {
    /* bozuk kayıt: varsayılanlar */
  }
  return s;
}

export function saveSettings(s: GameSettings): void {
  safeSet(KEY, JSON.stringify(s));
}

export interface GhostData {
  /** Örnekleme aralığı (s) */
  dt: number;
  /** [x, z, yaw, x, z, yaw, ...] */
  frames: number[];
  lapTime: number;
}

export interface Records {
  /** Tur sayısına göre en iyi toplam süre. */
  bestTotal: Record<string, number>;
  bestLap: number | null;
  ghost: GhostData | null;
}

export function loadRecords(trackId: string): Records {
  const r: Records = { bestTotal: {}, bestLap: null, ghost: null };
  const raw = safeGet(RECORDS_PREFIX + trackId);
  if (!raw) return r;
  try {
    const p = JSON.parse(raw) as Partial<Records>;
    if (p.bestTotal && typeof p.bestTotal === 'object') {
      for (const [k, v] of Object.entries(p.bestTotal)) if (typeof v === 'number' && v > 0) r.bestTotal[k] = v;
    }
    if (typeof p.bestLap === 'number' && p.bestLap > 0) r.bestLap = p.bestLap;
    if (
      p.ghost &&
      Array.isArray(p.ghost.frames) &&
      typeof p.ghost.dt === 'number' &&
      typeof p.ghost.lapTime === 'number' &&
      p.ghost.frames.length % 3 === 0
    ) {
      r.ghost = p.ghost;
    }
  } catch {
    /* yok say */
  }
  return r;
}

export function saveRecords(trackId: string, r: Records): void {
  safeSet(RECORDS_PREFIX + trackId, JSON.stringify(r));
}
