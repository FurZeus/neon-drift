/** Pist tanımları: geometri, yarış biçimi, süs ve madalya hedefleri. */

export type TrackKind = 'circuit' | 'sprint';

export interface BillboardDef {
  s: number;
  side: number;
  text: string;
  sub: string;
  color: string;
}

/** Yolun üzerinden geçen tabela köprüsü (otoyol). */
export interface SignDef {
  s: number;
  text: string;
  sub: string;
}

export interface TrackDef {
  id: string;
  name: string;
  short: string;
  blurb: string;
  kind: TrackKind;
  /** Merkez çizgisi kontrol noktaları (m, XZ). */
  points: ReadonlyArray<readonly [number, number]>;
  closed: boolean;
  roadHalfWidth: number;
  /** Pist dışı (yavaşlatan) bölgenin bittiği bariyer iç yüzü. */
  barrierOffset: number;
  /** Otoyol: yön başına şerit sayısı ve genişliği (çizgiler, trafik ve yeniden doğma için). */
  lanesPerDirection?: number;
  laneWidth?: number;
  startS: number;
  /** Sprint bitiş çizgisi. */
  finishS?: number;
  gridS: number;
  gridLateral: number;
  /** Piste dönüldüğünde yerleşilen yan konum (otoyolda sağ şerit). */
  respawnLateral: number;
  arches: boolean;
  traffic: boolean;
  /** Tur pistinde tur başına, sprintte toplam süre (s). */
  medal: { gold: number; silver: number; bronze: number };
  billboards: BillboardDef[];
  signs: SignDef[];
  /** Tribünün başladığı s (yolun soluna, ileri doğru 90 m). */
  grandstandS: number;
  skyline: 'ring' | 'corridor';
}

export const NEON_CIRCUIT: TrackDef = {
  id: 'neon',
  name: 'Neon Pist',
  short: 'Neon Pist',
  blurb: '1.16 km teknik tur pisti: firkete, şikan ve iki uzun düzlük. 1, 3 veya 5 tur.',
  kind: 'circuit',
  points: [
    // Ana düzlük (+X) — başlangıç/bitiş çizgisi ilk noktada
    [-40, 0],
    [80, 0],
    // 1. viraj: sağ, R≈34
    [130, 6],
    [152, 34],
    [155, 75],
    [165, 112],
    // Firkete: sağ, R≈24
    [190, 148],
    [185, 186],
    [152, 200],
    [120, 182],
    // Şikan
    [100, 150],
    [65, 136],
    [32, 156],
    [0, 166],
    // Arka düzlük (−X)
    [-50, 186],
    [-110, 192],
    [-168, 186],
    // Sol uç viraj ve son S
    [-218, 166],
    [-242, 126],
    [-230, 84],
    [-213, 54],
    [-214, 24],
    [-194, 4],
    [-170, 0],
  ],
  closed: true,
  roadHalfWidth: 8,
  barrierOffset: 14.5,
  startS: 0,
  gridS: -12,
  gridLateral: 0,
  respawnLateral: 0,
  arches: true,
  traffic: false,
  // Başsız simülasyonda drift atmadan en hızlı temiz tur ~26 sn; duvara yaslanarak tam gaz ~29.5 sn.
  medal: { gold: 25.2, silver: 27.0, bronze: 29.5 },
  billboards: [
    { s: 40, side: 1, text: 'DRIFT = TURBO', sub: 'Viraja gir · tut · bırak', color: '#29f0ff' },
    { s: 118, side: 1, text: 'FREN!', sub: '1. viraj yaklaşıyor', color: '#ffb547' },
    { s: 290, side: -1, text: 'FİRKETE', sub: 'Fren yap · drift at', color: '#ff2bd6' },
    { s: 660, side: 1, text: 'HIZ SINIRI YOK', sub: 'Sadece zaman var', color: '#8b6cff' },
    { s: 760, side: -1, text: 'GECE TURNUVASI', sub: 'Neon Drift Ligi', color: '#ff2bd6' },
    { s: 905, side: 1, text: 'SON VİRAJLAR', sub: 'Bitiş çizgisine tam gaz', color: '#29f0ff' },
  ],
  signs: [],
  grandstandS: 20,
  skyline: 'ring',
};

/** Dümdüz otoyol: 2 şerit gidiş + 2 şerit geliş, ortada boyalı çift çizgi (fiziksel engel yok). */
const HIGHWAY_START = 200;
const HIGHWAY_LENGTH = 4000;

export const NIGHT_HIGHWAY: TrackDef = {
  id: 'otoyol',
  name: 'Gece Otoyolu',
  short: 'Otoyol',
  blurb: '4 km dümdüz sprint: 2 şerit gidiş, 2 şerit geliş. Trafikte sollayarak bitişe ilk sen var.',
  kind: 'sprint',
  points: Array.from({ length: 13 }, (_, i) => [-2400 + i * 400, 0] as const),
  closed: false,
  roadHalfWidth: 8.4,
  barrierOffset: 10.6,
  lanesPerDirection: 2,
  laneWidth: 3.75,
  startS: HIGHWAY_START,
  finishS: HIGHWAY_START + HIGHWAY_LENGTH,
  gridS: HIGHWAY_START - 10,
  gridLateral: 1.875,
  respawnLateral: 1.875,
  arches: false,
  traffic: true,
  // Trafiksiz kuramsal en iyi ~66 sn; otopilot (karşı şeride hiç geçmeden, temkinli) ~105 sn.
  medal: { gold: 78, silver: 86, bronze: 98 },
  billboards: [
    { s: 420, side: 1, text: 'SAĞDAN GİT', sub: 'Karşı şerit tehlikeli', color: '#ffb547' },
    { s: 1350, side: -1, text: 'GECE OTOYOLU', sub: 'Neon Drift Ligi', color: '#ff2bd6' },
    { s: 2500, side: 1, text: 'YAKIN GEÇ', sub: 'Trafikte boşluğu kolla', color: '#29f0ff' },
    { s: 3600, side: -1, text: 'SON DÜZLÜK', sub: 'Tam gaz bitişe', color: '#8b6cff' },
  ],
  signs: [
    { s: HIGHWAY_START + 1000, text: 'BİTİŞ 3 KM', sub: 'Neon Drift · Otoyol' },
    { s: HIGHWAY_START + 2000, text: 'BİTİŞ 2 KM', sub: 'Neon Drift · Otoyol' },
    { s: HIGHWAY_START + 3000, text: 'BİTİŞ 1 KM', sub: 'Neon Drift · Otoyol' },
  ],
  grandstandS: HIGHWAY_START + HIGHWAY_LENGTH - 60,
  skyline: 'corridor',
};

export const TRACKS: TrackDef[] = [NEON_CIRCUIT, NIGHT_HIGHWAY];

export function trackById(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Otoyolda şeritlerin yan konumları; + = gidiş yönü (sağ), − = karşı yön. */
export function laneOffsets(def: TrackDef): { forward: number[]; oncoming: number[] } {
  const n = def.lanesPerDirection ?? 0;
  const w = def.laneWidth ?? 3.75;
  const forward = Array.from({ length: n }, (_, i) => w * (i + 0.5));
  return { forward, oncoming: forward.map((x) => -x) };
}
