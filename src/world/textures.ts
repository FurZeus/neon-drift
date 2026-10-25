import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/** Tüm dokular çalışma anında canvas ile üretilir; harici görsel dosyası yoktur. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas desteklenmiyor');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Deterministik sözde rastgele (her açılışta aynı şehir silüeti için). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function asphaltTexture(): Texture {
  const [c, ctx] = canvas(512, 512);
  const r = rng(7);
  ctx.fillStyle = '#16141f';
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 22 + (r() < 0.02 ? 26 : 0);
    d[i] = Math.max(0, d[i] + n);
    d[i + 1] = Math.max(0, d[i + 1] + n);
    d[i + 2] = Math.max(0, d[i + 2] + n * 1.1);
  }
  ctx.putImageData(img, 0, 0);
  // Lastik izleri / yamalar
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = r() < 0.5 ? '#0b0a10' : '#211e2c';
    const x = r() * 512;
    const y = r() * 512;
    ctx.beginPath();
    ctx.ellipse(x, y, 20 + r() * 60, 6 + r() * 20, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return finish(c);
}

export function runoffTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#0c0916';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(139,108,255,0.22)';
  ctx.lineWidth = 10;
  for (let i = -256; i < 512; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
  }
  return finish(c);
}

export function checkerTexture(): Texture {
  const [c, ctx] = canvas(256, 64);
  const cells = 16;
  const sz = 256 / cells;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#f4f1ff' : '#111018';
      ctx.fillRect(x * sz, y * sz, sz, sz);
    }
  }
  return finish(c, false);
}

/** Bina cephesi: koyu zemin, rastgele yanan pencereler. Sol üst köşe koyu kenar (çatılar için). */
export function windowTexture(): Texture {
  const [c, ctx] = canvas(512, 512);
  const r = rng(42);
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, 512, 512);
  const cols = 16;
  const rows = 32;
  const cw = 512 / cols;
  const rh = 512 / rows;
  const palette = ['#ffcf8a', '#ffd9a8', '#7ff6ff', '#ff8af0', '#b9a8ff', '#ffffff'];
  for (let y = 1; y < rows; y++) {
    // Kat boyunca aynı yoğunluk — gerçekçi kat ışıkları
    const floorLit = r();
    for (let x = 1; x < cols; x++) {
      const lit = r() < floorLit * 0.55;
      ctx.fillStyle = lit ? palette[Math.floor(r() * palette.length)] : r() < 0.4 ? '#1a1628' : '#100d1a';
      ctx.globalAlpha = lit ? 0.55 + r() * 0.45 : 1;
      ctx.fillRect(x * cw + 3, y * rh + 4, cw - 6, rh - 7);
    }
  }
  ctx.globalAlpha = 1;
  return finish(c);
}

export function radialGlowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)'): Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, false);
}

/** Viraj yön levhası: sağa bakan ok dizisi. Sola dönüşte mesh X'te aynalanır. */
export function chevronTexture(): Texture {
  const [c, ctx] = canvas(256, 96);
  ctx.fillStyle = '#0a0612';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const x = 34 + i * 70;
    ctx.beginPath();
    ctx.moveTo(x, 14);
    ctx.lineTo(x + 30, 14);
    ctx.lineTo(x + 62, 48);
    ctx.lineTo(x + 30, 82);
    ctx.lineTo(x, 82);
    ctx.lineTo(x + 32, 48);
    ctx.closePath();
    ctx.fill();
  }
  return finish(c, false);
}

export interface TextTextureOptions {
  width?: number;
  height?: number;
  font?: string;
  color?: string;
  background?: string;
  glow?: string;
  subtitle?: string;
  subtitleColor?: string;
}

export function textTexture(text: string, o: TextTextureOptions = {}): Texture {
  const w = o.width ?? 1024;
  const h = o.height ?? 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = o.background ?? 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = o.font ?? `italic 700 ${Math.round(h * 0.5)}px "Chakra Petch", "Arial Narrow", sans-serif`;
  ctx.font = font;
  const y = o.subtitle ? h * 0.42 : h * 0.52;
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = h * 0.12;
  }
  ctx.fillStyle = o.color ?? '#ffffff';
  ctx.fillText(text, w / 2, y, w * 0.92);
  if (o.subtitle) {
    ctx.shadowBlur = 0;
    ctx.font = `600 ${Math.round(h * 0.16)}px "Chakra Petch", "Arial Narrow", sans-serif`;
    ctx.fillStyle = o.subtitleColor ?? 'rgba(255,255,255,0.75)';
    ctx.fillText(o.subtitle, w / 2, h * 0.78, w * 0.9);
  }
  return finish(c, false);
}

/** Türk plakası: solda mavi TR şeridi, beyaz zemin, siyah yazı. */
export function plateTexture(text: string): Texture {
  const [c, ctx] = canvas(512, 112);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 512, 112);
  ctx.fillStyle = '#123c9c';
  ctx.fillRect(0, 0, 58, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 30px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TR', 29, 84);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 506, 106);
  ctx.fillStyle = '#111111';
  ctx.font = '700 76px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(text, 285, 60, 420);
  return finish(c, false);
}

/**
 * Islak zemin dokusu (döşenebilir): R = düşük frekanslı su birikintisi maskesi,
 * G/B = yansımayı hafifçe bozan yüksek frekanslı gürültü. Renk uzayı doğrusal (veri dokusu).
 */
export function wetTexture(): Texture {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const r = rng(2024);
  const layer = (period: number) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x: number, y: number) => {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (ix: number, iy: number) => g[((iy % period) + period) % period * period + (((ix % period) + period) % period)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const p1 = layer(4);
  const p2 = layer(8);
  const p3 = layer(16);
  const n1 = layer(32);
  const n2 = layer(64);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const puddle = p1(x, y) * 0.55 + p2(x, y) * 0.3 + p3(x, y) * 0.15;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(puddle * 255);
      img.data[i + 1] = Math.round(n1(x, y) * 255);
      img.data[i + 2] = Math.round(n2(x, y) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, true, false);
}
