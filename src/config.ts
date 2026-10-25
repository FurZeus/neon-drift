/** Oyunun ayarlanabilir sabitleri. Birimler: metre, saniye, radyan. */

export const PHYSICS = {
  /** Asfaltta tam gazla ulaşılan hız (m/s ≈ 230 km/h). */
  maxSpeed: 64,
  engineAccel: 27,
  brakeDecel: 44,
  reverseAccel: 11,
  reverseMax: 13,
  /** Direksiyon kırılmadan el freni çekilince uygulanan yavaşlama. */
  handbrakeDecel: 16,
  rolling: 1.1,
  air: 0.0011,

  offroadMaxSpeed: 21,
  offroadDrag: 14,

  /** Gidiş yönünün burun yönüne yaklaşma hızı (1/s). Düşük = daha çok kayma. */
  gripNormal: 13,
  gripDrift: 3.3,
  gripOffroad: 6.5,

  steerResponse: 9,
  steerReturn: 12,
  maxYawRate: 2.9,
  yawSpeedFalloff: 0.035,

  driftBaseYaw: 1.15,
  driftSteerYaw: 1.0,
  driftYawFalloff: 0.0065,
  driftMinSpeed: 13,
  driftExitSpeed: 8,
  maxSlip: 1.2,
  /** Kayma açısından kaynaklanan hız kaybı katsayısı. */
  slipDrag: 0.2,

  boostLevel1Time: 0.75,
  boostLevel2Time: 1.7,
  boostAccel: 22,
  boostExtraSpeed: 12,
  boostDuration1: 0.75,
  boostDuration2: 1.45,

  wallRestitution: 0.22,
  wallFriction: 0.35,
  /** Duvara sürtünürken saniyedeki hız kaybı katsayısı (exp). */
  wallScrapeDrag: 1.4,
  /** Golf 6 ölçüleri: 4.20 m boy, 1.78 m en (aynalarla ~1.9 m). */
  carHalfWidth: 0.95,
  carHalfLength: 2.1,
  wheelRadius: 0.33,
} as const;

/** Araç başına değiştirilebilen fizik parametreleri. */
export type PhysicsParams = { -readonly [K in keyof typeof PHYSICS]: number };

export const RACE = {
  countdownSeconds: 3,
  /** Başlangıçta aracın bitiş çizgisinin ne kadar gerisinde durduğu. */
  gridOffset: 12,
  lapOptions: [1, 3, 5] as const,
  defaultLaps: 3,
  /** Tur pistinde toplam madalya hedefine eklenen kalkış payı (hedefler: world/tracks.ts). */
  medalStartAllowance: 1.7,
  /** Bu kadar süre pist dışında / ters yönde takılı kalırsa ipucu göster. */
  stuckHintSeconds: 2.5,
};

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = QualityLevel | 'auto';

export interface QualityPreset {
  pixelRatio: number;
  bloom: boolean;
  shadows: boolean;
  shadowMapSize: number;
  msaa: number;
  particleScale: number;
  speedLines: boolean;
  chromatic: boolean;
  /** Islak yol yansıması çözünürlük oranı (0 = kapalı). */
  reflection: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    pixelRatio: 1,
    bloom: false,
    shadows: false,
    shadowMapSize: 0,
    msaa: 0,
    particleScale: 0.45,
    speedLines: false,
    chromatic: false,
    reflection: 0,
  },
  medium: {
    pixelRatio: 1.25,
    bloom: true,
    shadows: true,
    shadowMapSize: 1024,
    msaa: 2,
    particleScale: 0.75,
    speedLines: true,
    chromatic: false,
    reflection: 0.33,
  },
  high: {
    pixelRatio: 2,
    bloom: true,
    shadows: true,
    shadowMapSize: 2048,
    msaa: 4,
    particleScale: 1,
    speedLines: true,
    chromatic: true,
    reflection: 0.5,
  },
  /** Güçlü makineler: tam çözünürlüğe yakın yansıma, 4K gölge haritası. */
  ultra: {
    pixelRatio: 2,
    bloom: true,
    shadows: true,
    shadowMapSize: 4096,
    msaa: 4,
    particleScale: 1,
    speedLines: true,
    chromatic: true,
    reflection: 0.8,
  },
};

export interface CarPaint {
  name: string;
  body: number;
  accent: number;
}

/** Boyalar; `accent` alt ışık ve jant çizgisi gibi neon detaylarda kullanılır. */
export const CAR_PAINTS: CarPaint[] = [
  /** body < 0: modelin kendi (fabrika) rengi; prosedürel Golf'te Tornado Kırmızı. */
  { name: 'Fabrika rengi', body: -1, accent: 0x29f0ff },
  { name: 'Tornado Kırmızı', body: 0xb0101c, accent: 0x29f0ff },
  { name: 'Gece Mavisi', body: 0x163a86, accent: 0xff2bd6 },
  { name: 'Kandy Beyaz', body: 0xe6e8ec, accent: 0x8b6cff },
  { name: 'Derin Siyah', body: 0x101015, accent: 0xff2bd6 },
  { name: 'Reflex Gümüş', body: 0x9fa4ad, accent: 0x29f0ff },
  { name: 'Neon Moru', body: 0x45198a, accent: 0xff2bd6 },
];

export const COLORS = {
  magenta: 0xff2bd6,
  cyan: 0x29f0ff,
  amber: 0xffb547,
  violet: 0x8b6cff,
  red: 0xff2a4d,
  ink: 0x07050f,
};
