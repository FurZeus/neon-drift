// Pist geometrisini doğrular: uzunluk, en dar viraj yarıçapı, kendine yaklaşma mesafesi.
// Çalıştırma: npx vite-node scripts/analyze-track.ts
import { Track } from '../src/world/Track';

const track = new Track();
const n = track.count;
let maxK = 0;
let maxKAt = 0;
for (let i = 0; i < n; i++) {
  const k = Math.abs(track.curvature[i]);
  if (k > maxK) {
    maxK = k;
    maxKAt = i;
  }
}
console.log(`uzunluk: ${track.length.toFixed(1)} m, örnek aralığı ${track.spacing.toFixed(3)} m`);
console.log(`en dar viraj yarıçapı: ${(1 / maxK).toFixed(1)} m @ s=${track.sAt[maxKAt].toFixed(0)}`);

// Virajlar
let inCorner = false;
let start = 0;
let peak = 0;
for (let i = 0; i <= n; i++) {
  const k = track.curvature[i % n];
  const c = Math.abs(k) > 1 / 70;
  if (c && !inCorner) {
    inCorner = true;
    start = i;
    peak = 0;
  }
  if (c) peak = Math.max(peak, Math.abs(k));
  if (!c && inCorner) {
    inCorner = false;
    console.log(
      `  viraj s=${track.sAt[start % n].toFixed(0)}..${track.sAt[i % n].toFixed(0)}  R=${(1 / peak).toFixed(0)}m  ${track.curvature[Math.floor((start + i) / 2) % n] > 0 ? 'sağ' : 'sol'}`,
    );
  }
}

let minSep = Infinity;
let minAt: [number, number] = [0, 0];
for (let i = 0; i < n; i += 2) {
  for (let j = i + 2; j < n; j += 2) {
    const ds = Math.abs(track.deltaS(track.sAt[i], track.sAt[j]));
    if (ds < 90) continue;
    const d = Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]);
    if (d < minSep) {
      minSep = d;
      minAt = [i, j];
    }
  }
}
console.log(
  `kendine en yakın mesafe: ${minSep.toFixed(1)} m (gereken > ${(2 * track.barrierOffset + 4).toFixed(0)}) @ s=${track.sAt[minAt[0]].toFixed(0)} / ${track.sAt[minAt[1]].toFixed(0)}`,
);

// ASCII harita
const W = 90;
const H = 34;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < n; i++) {
  minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
  minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
}
const grid: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));
for (let i = 0; i < n; i++) {
  const gx = Math.round(((track.px[i] - minX) / (maxX - minX)) * (W - 1));
  const gz = Math.round(((track.pz[i] - minZ) / (maxZ - minZ)) * (H - 1));
  grid[gz][gx] = i < 30 ? 'S' : Math.abs(track.curvature[i]) > 1 / 40 ? '#' : '.';
}
console.log(grid.map((r) => r.join('')).join('\n'));
console.log(`x: ${minX.toFixed(0)}..${maxX.toFixed(0)}  z: ${minZ.toFixed(0)}..${maxZ.toFixed(0)}`);
