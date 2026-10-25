import type { PhysicsParams } from '../config';

export interface CarCredit {
  title: string;
  author: string;
  url: string;
  license: string;
}

export interface CarModelConfig {
  /** `public/models/` altındaki GLB dosyası. */
  file: string;
  /** Gerçek boy (m); model buna ölçeklenir. */
  length: number;
  /** Modeli +Z ileri bakacak şekilde döndürmek için Y açısı (radyan). */
  rotationY: number;
  /** Gövde rengi değiştirilebilecek malzeme adları (küçük harf, içerir). */
  paintMaterials?: string[];
  /** Stop lambası malzeme adları. */
  tailMaterials?: string[];
  /** Far malzeme adları. */
  headMaterials?: string[];
  /** Tekerlek düğüm adları (dönme / direksiyon animasyonu için). */
  wheelNodes?: string[];
  /** Yukarı ekseni yanlış gelen modeller için X açısı (radyan), Y'den önce uygulanır. */
  rotationX?: number;
  /** Far/stop konumundan ön yönü otomatik bulma (varsayılan açık). */
  autoFront?: boolean;
  /** Gizlenecek parça / üst düğüm / malzeme adları (küçük harf, içerir; '=' tam ad). */
  hide?: string[];
  /** Tekerleksiz modellere kodla tekerlek (normalize edilmiş araç uzayında, m). */
  addWheels?: {
    frontZ: number;
    rearZ: number;
    trackX: number;
    radius: number;
    width?: number;
    style?: 'sport' | 'cap';
    /** Aks yerini bu adı taşıyan parçalardan oku (ör. 'hub'); bulunamazsa yukarıdaki değerler. */
    fromNodes?: string;
  };
  /** Dokusuz modellerde "Fabrika rengi". */
  factoryColor?: number;
  /** Taramalarda zemin dilimini kesme yüksekliği (m); dış hat dışında iki katına kadar kesilir. */
  groundCut?: number;
  /**
   * Parça rolleri (düğüm ya da malzeme adı içerir; '=' tam ad): dokusuz / tek malzemeli modelleri gerçek
   * malzemelerle giydirmek için. Roller: paint, glass, tire, rim, plastic, interior, chrome, light, tail.
   */
  parts?: Partial<Record<'paint' | 'glass' | 'tire' | 'rim' | 'plastic' | 'interior' | 'chrome' | 'light' | 'tail', string[]>>;
  /** Fotoğraf dokulu taramalara vernik (clearcoat) ekle. */
  glossy?: boolean;
  /** Plaka yazısı: modelin dokusuz / görünmez plaka parçalarının yerine konur. */
  plate?: string;
  /** Egzoz ucu parça adı (içerir): turbo alevi ve geri tepme patlamaları buradan çıkar. */
  exhaust?: string;
}

export interface CarSpec {
  id: string;
  /** Tam ad (garajda). */
  name: string;
  /** Kısa ad (menüde). */
  short: string;
  year: string;
  /** Garajda gösterilen tek cümle. */
  blurb: string;
  model?: CarModelConfig;
  credit?: CarCredit;
  /** Varsayılan fiziğe göre farklar. Tur süreleri ±%3 içinde dengelidir (scripts/sim-laps.ts). */
  physics: Partial<PhysicsParams>;
}

const CC_BY = 'CC BY 4.0';

export const CARS: CarSpec[] = [
  {
    id: 'golf6',
    name: 'Volkswagen Golf 6 GTI',
    short: 'Golf 6 GTI',
    year: '2009',
    blurb: 'Dengeli ve affedici; çıkışlarda güçlü, drift’e girmesi kolay.',
    // BeamNG kökenli Golf 6 modeli: her parçanın tüm donanım seçenekleri (4 ön tampon, 3 arka tampon,
    // 3 egzoz ucu, 2 bagaj kapağı, 2 far / stop) üst üste gelir; GTI takımı dışındakiler gizlenir.
    // Tekerlek düğümleri Lehçe kısaltmalı (KLP = koło lewe przednie: sol ön lastik, _tex = jant).
    // Kaportanın altındaki motor / süspansiyon parçaları ve yere düşmüş ralli sacı da gizlenir.
    model: {
      file: 'golf6.glb',
      length: 4.2,
      rotationY: 0,
      // Candy White: neon ışıkta rengi en temiz okunan seçenek
      factoryColor: 0xe6e8ec,
      wheelNodes: ['klp_', 'klz_', 'kpp_', 'kpz_'],
      plate: '34 GLF 06',
      exhaust: 'exhaust_tips_b',
      hide: [
        // GTI dışı donanım seçenekleri
        'bumper_a_f', 'bumper_gtd_f', 'bumper_r_f', 'bumper_a_r', 'bumper_race_r',
        '=vgolf6_tailgate_a', 'tailgate_a_light',
        '=vgolf6_taillight_l', '=vgolf6_taillight_r', '=vgolf6_taillightsglass_l', '=vgolf6_taillightsglass_r',
        'taillightsglass_r001', '=vgolf6_headlight_l', '=vgolf6_headlight_r', '=vgolf6_radio_2',
        'lettering_e', 'lettering_r', 'lettering_s001',
        '=vgolf6_exhaust', 'exhaust_race', 'exhaust_tips_a', 'exhaust_tips_c', 'exhaustpipe',
        // Kaporta altı
        'skidplate', 'hubcap', '_hub_', 'mechanical_rally', 'vivace_engine', 'airbox', 'coilover', 'diff_r',
        'driveshaft', 'engbay', 'engine_i', 'enginecover', 'fueltank', 'halfshaft', 'intake', 'intercooler',
        'lowerarm', 'podfilter', 'radfan', 'radiator', 'radsupport', 'shock_r', 'spring_r', 'strut_', 'subframe',
        'swaybar', 'tierod', 'toelink', 'torsionbeam', 'trailingarm', 'transfercase', 'transmission', 'tray_f',
        'tubs_f', 'turbo_i', 'underbody', 'upperarm', 'wishbone',
      ],
      parts: {
        rim: ['klp_tex', 'klz_tex', 'kpp_tex', 'kpz_tex'],
        tire: ['klp_p1b', 'klz_p1b', 'kpp_p1b', 'kpz_p1b'],
        chrome: ['exhaust_tips_b'],
        plastic: ['vgolf6_body2'],
      },
    },
    credit: {
      title: 'Volkswagen Golf 6. (A6)',
      author: 'GT Cars: Hyperspeed (Car2022)',
      url: 'https://sketchfab.com/3d-models/volkswagen-golf-6-a6-8d8a301cee5143e9a6f25519e32dde21',
      license: CC_BY,
    },
    physics: { carHalfWidth: 0.95, carHalfLength: 2.1, wheelRadius: 0.33 },
  },
  {
    id: 'r34',
    name: 'Nissan Skyline GT-R R34',
    short: 'Skyline R34',
    year: '1999',
    blurb: 'Dört çeker tutuş, yüksek son hız; ağır ama virajdan sert çıkar.',
    model: { file: 'r34.glb', length: 4.6, rotationY: 0 },
    credit: {
      title: 'Nissan Skyline R34 GT-R',
      author: 'Lexyc16',
      url: 'https://sketchfab.com/3d-models/ff8fb2251dfa4bb9979e7022c5a6666c',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 66,
      engineAccel: 26.5,
      gripNormal: 14,
      gripDrift: 3.6,
      driftBaseYaw: 1.08,
      carHalfWidth: 0.9,
      carHalfLength: 2.3,
      wheelRadius: 0.34,
    },
  },
  {
    id: 'ae86',
    name: 'Toyota Corolla AE86 Trueno',
    short: 'AE86 Trueno',
    year: '1985',
    blurb: 'Hafif ve oyuncu; düşük son hız ama drift şarjı en hızlı dolan araç.',
    model: { file: 'ae86.glb', length: 4.2, rotationY: 0 },
    credit: {
      title: 'Toyota Corolla AE86 Trueno',
      author: 'Lexyc16',
      url: 'https://sketchfab.com/3d-models/fe02fba6302e450ea8424591493341ea',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 59,
      engineAccel: 26,
      gripNormal: 13,
      gripDrift: 2.9,
      driftBaseYaw: 1.3,
      driftSteerYaw: 1.1,
      boostLevel1Time: 0.6,
      boostLevel2Time: 1.35,
      maxYawRate: 3.05,
      carHalfWidth: 0.84,
      carHalfLength: 2.1,
      wheelRadius: 0.29,
    },
  },
  {
    id: 'p930',
    name: 'Porsche 911 Turbo (930)',
    short: '911 Turbo',
    year: '1975',
    blurb: 'En yüksek son hız, arkası oynak; gazı dikkatli ver.',
    model: { file: 'p930.glb', length: 4.29, rotationY: 0 },
    credit: {
      title: 'Porsche 911 (930) Turbo 1975',
      author: 'Lexyc16',
      url: 'https://sketchfab.com/3d-models/de1ffd344c41481892511f7fd332c136',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 68,
      engineAccel: 28,
      gripNormal: 12,
      gripDrift: 3.0,
      driftBaseYaw: 1.22,
      yawSpeedFalloff: 0.036,
      carHalfWidth: 0.9,
      carHalfLength: 2.15,
      wheelRadius: 0.32,
    },
  },
  {
    id: 'e30',
    name: 'BMW M3 E30',
    short: 'M3 E30',
    year: '1986',
    blurb: 'Virajların kralı: en iyi yol tutuşu, keskin direksiyon, orta son hız.',
    model: { file: 'e30.glb', length: 4.35, rotationY: 0 },
    credit: {
      title: '[FREE] BMW M3 E30',
      author: 'TinoD2',
      url: 'https://sketchfab.com/3d-models/ac3c7013434e403e8faff87948caf422',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 61,
      engineAccel: 26,
      gripNormal: 15,
      maxYawRate: 3.0,
      yawSpeedFalloff: 0.033,
      driftBaseYaw: 1.12,
      carHalfWidth: 0.86,
      carHalfLength: 2.18,
      wheelRadius: 0.31,
    },
  },
  // ---- Türkiye'nin günlük araçları: daha yavaş ama karakterli ----
  {
    id: 'golf6b',
    name: 'Volkswagen Golf 6 (5 kapı)',
    short: 'Golf 6 5K',
    year: '2010',
    blurb: 'Günlük Golf 6 TSI: GTI kadar sert değil ama dengeli, sakin ve hızlı.',
    // Model dokusuz ve beyaz gelir: fabrika rengi Lapiz mavisi
    model: { file: 'golf6b.glb', length: 4.2, rotationY: 0, factoryColor: 0x1e47a8 },
    credit: {
      title: 'Volkswagen Golf 6',
      author: 'Nieve5677',
      url: 'https://sketchfab.com/3d-models/volkswagen-golf-6-46d9c43124b94f6293920944bef5b563',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 60,
      engineAccel: 25,
      gripNormal: 13.4,
      driftBaseYaw: 1.1,
      carHalfWidth: 0.9,
      carHalfLength: 2.1,
      wheelRadius: 0.32,
    },
  },
  {
    id: 'sahin',
    name: 'Tofaş Şahin',
    short: 'Şahin',
    year: '1993',
    blurb: 'Arkadan itişli efsane: son hızı düşük ama yan yan gitmeye en hevesli araç.',
    // Gerçek araç taraması: tek dokulu, tekerlekler ayrı değil; zemin dilimi kesilir, önü −Z'de gelir
    model: { file: 'sahin.glb', length: 4.26, rotationY: Math.PI, groundCut: 0.1, glossy: true },
    credit: {
      title: 'Sahin 1993 model retro Turkey model',
      author: 'oguzvideostudio',
      url: 'https://sketchfab.com/3d-models/ea8ec14f315f4247afceadb5b359a757',
      license: 'CC BY-NC-SA 4.0',
    },
    physics: {
      maxSpeed: 53,
      engineAccel: 22.5,
      gripNormal: 12.2,
      gripDrift: 2.7,
      driftBaseYaw: 1.34,
      driftSteerYaw: 1.1,
      boostLevel1Time: 0.6,
      boostLevel2Time: 1.35,
      carHalfWidth: 0.83,
      carHalfLength: 2.13,
      wheelRadius: 0.29,
    },
  },
  {
    id: 'doblo',
    name: 'Fiat Doblo',
    short: 'Doblo',
    year: '2005',
    blurb: 'Yüksek ve ağır hafif ticari; yavaş ama yolda heybetli. Meydan okuma için.',
    // Model burnunun üstünde dikine ve tek beyaz malzemeyle geliyor: X'te −90° yatır, parçaları
    // tek tek gerçek malzemelerle giydir (parçalar oyunda renklendirilerek tanındı).
    model: {
      file: 'doblo.glb',
      length: 4.16,
      rotationY: 0,
      rotationX: -Math.PI / 2,
      factoryColor: 0x7d848e,
      parts: {
        paint: ['=object_6'],
        glass: ['=object_5'],
        tire: ['=object_12', '=object_13'],
        rim: ['=object_11'],
        plastic: ['=object_4', '=object_2'],
        interior: ['=object_0', '=object_1', '=object_3', '=object_7'],
        light: ['=object_8', '=object_9'],
        chrome: ['=object_10'],
      },
    },
    credit: {
      title: 'Fiat Doblo 2005 MK1',
      author: 'szymonpasterczyk',
      url: 'https://sketchfab.com/3d-models/4a20dd92f0bd4e89b350eec83398b4be',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 50,
      engineAccel: 21.5,
      gripNormal: 12.5,
      yawSpeedFalloff: 0.038,
      driftBaseYaw: 1.05,
      carHalfWidth: 0.9,
      carHalfLength: 2.08,
      wheelRadius: 0.31,
    },
  },
  {
    id: 'egea',
    name: 'Fiat Egea',
    short: 'Egea',
    year: '2021',
    blurb: 'Bugünün yollarının sedanı: dengeli, sakin, uzun düzlükte istikrarlı.',
    model: { file: 'egea.glb', length: 4.53, rotationY: 0, glossy: true },
    credit: {
      title: 'Fiat Egea',
      author: 'superscriptdev2',
      url: 'https://sketchfab.com/3d-models/8b0bf29d19a24ceeb60c5312090d5477',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 57,
      engineAccel: 24,
      gripNormal: 13.5,
      driftBaseYaw: 1.08,
      carHalfWidth: 0.9,
      carHalfLength: 2.27,
      wheelRadius: 0.32,
    },
  },
  {
    id: 'corolla93',
    name: 'Toyota Corolla (E100)',
    short: 'Corolla 93',
    year: '1993',
    blurb: 'Bozulmaz Corolla: her işi orta karar yapar, hiç şikâyet etmez.',
    model: {
      file: 'corolla93.glb',
      length: 4.27,
      rotationY: 0,
      // Modelde lastikler yok, jant kapağı yerinden kopuk: gizle, kodla tekerlek tak; dokusuz → yeşil
      // Kaportanın içinde kalan motor / süspansiyon parçaları da gizlenir (gereksiz çizim çağrısı)
      hide: ['corolladx_wheel', 'hubcap', 'pessima', '4age', '2gr', 'digiclock'],
      paintMaterials: ['=corolladx'],
      tailMaterials: ['=corolladx_taillight'],
      // Camlar opaklığı 0 gelen malzemede (görünmez); koltuk / ızgara beyaz malzemede
      parts: { glass: ['=corolladx_detail_light'], plastic: ['=material_0', '=grille'] },
      addWheels: { frontZ: 1.265, rearZ: -1.195, trackX: 0.73, radius: 0.29, width: 0.19, style: 'cap', fromNodes: '_hub_' },
      factoryColor: 0x23877f,
    },
    credit: {
      title: 'Toyota Corolla MK7 (E100) 1992-1997',
      author: 'szymonpasterczyk',
      url: 'https://sketchfab.com/3d-models/c5ca8d403fbe40a1a438e1cb59d0469c',
      license: CC_BY,
    },
    physics: {
      maxSpeed: 55,
      engineAccel: 23.5,
      gripNormal: 13,
      driftBaseYaw: 1.12,
      carHalfWidth: 0.85,
      carHalfLength: 2.13,
      wheelRadius: 0.3,
    },
  },
];

export const DEFAULT_CAR = 'golf6';

export function carById(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Garajda gösterilen 1..10 değerler (fizikten türetilir). */
export function carStats(spec: CarSpec, base: PhysicsParams): { speed: number; accel: number; grip: number; drift: number } {
  const p = { ...base, ...spec.physics };
  const lerp = (v: number, a: number, b: number) => Math.max(1, Math.min(10, 1 + ((v - a) / (b - a)) * 9));
  return {
    speed: Math.round(lerp(p.maxSpeed, 54, 70)),
    accel: Math.round(lerp(p.engineAccel, 22, 30)),
    grip: Math.round(lerp(p.gripNormal * (p.maxYawRate / 2.9) * (0.035 / p.yawSpeedFalloff), 10, 16)),
    drift: Math.round(lerp(p.driftBaseYaw / p.gripDrift / p.boostLevel2Time, 0.15, 0.36)),
  };
}
