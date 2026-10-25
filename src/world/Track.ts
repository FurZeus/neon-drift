import { CatmullRomCurve3, Vector3 } from 'three';

import { NEON_CIRCUIT, type TrackDef } from './tracks';

/** Geriye uyumluluk: Neon Pist'in kontrol noktaları (analiz betikleri kullanır). */
export const TRACK_POINTS = NEON_CIRCUIT.points;

export interface TrackQuery {
  /** En yakın segmentin başlangıç örneği. */
  index: number;
  /** Merkez çizgisi boyunca sürekli konum, [0, length). */
  s: number;
  /** Merkez çizgisine işaretli uzaklık; + = gidiş yönüne göre sağ. */
  lateral: number;
  cx: number;
  cz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  curvature: number;
}

export function createTrackQuery(): TrackQuery {
  return { index: -1, s: 0, lateral: 0, cx: 0, cz: 0, tx: 0, tz: 1, nx: -1, nz: 0, curvature: 0 };
}

export class Track {
  readonly def: TrackDef;
  /** Kapalı tur pisti mi, yoksa iki ucu olan düz yol mu. */
  readonly closed: boolean;
  /** Asfaltın yarı genişliği. */
  readonly roadHalfWidth: number;
  /** Pist dışı (yavaşlatan) bölgenin bittiği, bariyerin iç yüzü. */
  readonly barrierOffset: number;

  readonly count: number;
  readonly length: number;
  readonly spacing: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly nx: Float32Array;
  readonly nz: Float32Array;
  readonly sAt: Float32Array;
  /** İşaretli eğrilik (1/m), + = sağa dönüş. Hafif yumuşatılmış. */
  readonly curvature: Float32Array;

  /**
   * Pist geometrisi ve hızlı yakın nokta sorguları. Kapalı pistte s sarılır (tur); açık yolda
   * uçlara kenetlenir.
   */
  constructor(def: TrackDef = NEON_CIRCUIT, count?: number) {
    this.def = def;
    this.closed = def.closed;
    this.roadHalfWidth = def.roadHalfWidth;
    this.barrierOffset = def.barrierOffset;
    const curve = new CatmullRomCurve3(
      def.points.map(([x, z]) => new Vector3(x, 0, z)),
      def.closed,
      'centripetal',
    );
    const length = curve.getLength();
    count ??= def.closed ? 2400 : Math.max(64, Math.round(length / 1.0) + 1);
    // Kapalı eğride son nokta ilkine eşittir; açık yolda iki uç da dahil.
    const pts = curve.getSpacedPoints(def.closed ? count : count - 1);
    this.count = count;
    this.length = length;
    this.spacing = def.closed ? length / count : length / (count - 1);

    this.px = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.nx = new Float32Array(count);
    this.nz = new Float32Array(count);
    this.sAt = new Float32Array(count);
    this.curvature = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
      this.sAt[i] = i * this.spacing;
    }
    for (let i = 0; i < count; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      // Sağ normal: (-tz, tx)
      this.nx[i] = -dz;
      this.nz[i] = dx;
    }
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = this.wrap(i - 2);
      const b = this.wrap(i + 2);
      const dtx = this.tx[b] - this.tx[a];
      const dtz = this.tz[b] - this.tz[a];
      raw[i] = (dtx * this.nx[i] + dtz * this.nz[i]) / (4 * this.spacing);
    }
    const r = 10;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += raw[this.wrap(i + k)];
      this.curvature[i] = sum / (2 * r + 1);
    }
  }

  wrap(i: number): number {
    const n = this.count;
    if (!this.closed) return i < 0 ? 0 : i >= n ? n - 1 : i;
    return ((i % n) + n) % n;
  }

  wrapS(s: number): number {
    const L = this.length;
    if (!this.closed) return s < 0 ? 0 : s > L ? L : s;
    return ((s % L) + L) % L;
  }

  /** b - a; kapalı pistte en kısa işaretli fark. */
  deltaS(a: number, b: number): number {
    if (!this.closed) return b - a;
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /**
   * (x, z) noktasına en yakın merkez çizgisi noktası. `hint` önceki karedeki indeks;
   * negatifse tüm pist taranır.
   */
  query(x: number, z: number, hint: number, out: TrackQuery, window = 48): TrackQuery {
    let best = -1;
    let bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < this.count; i++) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    } else {
      for (let k = -window; k <= window; k++) {
        const i = this.wrap(hint + k);
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // Örnek pencerenin kenarına yapıştıysa (ışınlanma vb.) tam tarama yap.
      const edge = this.deltaS(this.sAt[this.wrap(hint)], this.sAt[best]);
      if (Math.abs(edge) > (window - 2) * this.spacing) return this.query(x, z, -1, out, window);
    }

    // Komşu iki segmentten hangisine izdüşüm daha yakınsa onu kullan.
    const prev = this.wrap(best - 1);
    const d1 = this.project(x, z, best, out);
    const tmp = scratch;
    const d0 = this.project(x, z, prev, tmp);
    if (d0 < d1) {
      out.index = tmp.index;
      out.s = tmp.s;
      out.lateral = tmp.lateral;
      out.cx = tmp.cx;
      out.cz = tmp.cz;
      out.tx = tmp.tx;
      out.tz = tmp.tz;
      out.nx = tmp.nx;
      out.nz = tmp.nz;
      out.curvature = tmp.curvature;
    }
    return out;
  }

  /** i→i+1 segmentine izdüşüm; uzaklığın karesini döndürür. */
  private project(x: number, z: number, i: number, out: TrackQuery): number {
    const j = this.wrap(i + 1);
    const ax = this.px[i];
    const az = this.pz[i];
    const abx = this.px[j] - ax;
    const abz = this.pz[j] - az;
    const ab2 = abx * abx + abz * abz || 1;
    let t = ((x - ax) * abx + (z - az) * abz) / ab2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + abx * t;
    const cz = az + abz * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    out.index = i;
    out.s = this.wrapS(this.sAt[i] + t * this.spacing);
    out.cx = cx;
    out.cz = cz;
    out.tx = tx;
    out.tz = tz;
    out.nx = nx;
    out.nz = nz;
    out.lateral = (x - cx) * nx + (z - cz) * nz;
    out.curvature = this.curvature[i] + (this.curvature[j] - this.curvature[i]) * t;
    const dx = x - cx;
    const dz = z - cz;
    return dx * dx + dz * dz;
  }

  /** Yay uzunluğu s'deki merkez noktası ve yönü. */
  frameAt(s: number, out: TrackQuery): TrackQuery {
    const ss = this.wrapS(s);
    const f = ss / this.spacing;
    let i = Math.floor(f) % this.count;
    if (!this.closed && i >= this.count - 1) i = this.count - 2;
    const t = f - i;
    const j = this.wrap(i + 1);
    out.index = i;
    out.s = ss;
    out.cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    out.tx = tx;
    out.tz = tz;
    out.nx = -tz;
    out.nz = tx;
    out.lateral = 0;
    out.curvature = this.curvature[i] + (this.curvature[j] - this.curvature[i]) * t;
    return out;
  }

  /** Yönün (tx, tz) yaw açısı: ileri = (sin yaw, cos yaw). */
  static yawOf(tx: number, tz: number): number {
    return Math.atan2(tx, tz);
  }
}

const scratch = createTrackQuery();
