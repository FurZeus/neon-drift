// Aday pist noktalarını analiz eder: npx vite-node scripts/try-track.ts
import { Track } from '../src/world/Track';
import { NEON_CIRCUIT } from '../src/world/tracks';
const P: [number, number][] = [
  [-170, 0], [-40, 0], [80, 0],
  [130, 6], [152, 34], [155, 75],
  [165, 112],
  [190, 148], [185, 186], [152, 200], [120, 182],
  [100, 150], [65, 136], [32, 156], [0, 166],
  [-50, 186], [-110, 192], [-168, 186],
  [-218, 166], [-242, 126], [-230, 84],
  [-213, 54], [-214, 24], [-194, 4],
];
const t = new Track({ ...NEON_CIRCUIT, points: P });
const n = t.count;
console.log(`uzunluk ${t.length.toFixed(0)} m`);
let inC = false, st = 0, pk = 0;
for (let i = 0; i <= n; i++) {
  const k = t.curvature[i % n];
  const c = Math.abs(k) > 1 / 75;
  if (c && !inC) { inC = true; st = i; pk = 0; }
  if (c) pk = Math.max(pk, Math.abs(k));
  if (!c && inC) { inC = false; const mid = Math.floor((st + i) / 2) % n; console.log(`  s=${t.sAt[st % n].toFixed(0)}..${t.sAt[i % n].toFixed(0)} R=${(1 / pk).toFixed(0)} ${t.curvature[mid] > 0 ? 'sağ' : 'sol'}`); }
}
let minSep = Infinity, at = [0, 0];
for (let i = 0; i < n; i += 2) for (let j = i + 2; j < n; j += 2) {
  if (Math.abs(t.deltaS(t.sAt[i], t.sAt[j])) < 90) continue;
  const d = Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]);
  if (d < minSep) { minSep = d; at = [i, j]; }
}
console.log(`min ayrım ${minSep.toFixed(1)} m @ ${t.sAt[at[0]].toFixed(0)} / ${t.sAt[at[1]].toFixed(0)} (gereken > 33)`);
const W = 96, H = 36;
let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
for (let i = 0; i < n; i++) { a = Math.min(a, t.px[i]); b = Math.max(b, t.px[i]); c = Math.min(c, t.pz[i]); d = Math.max(d, t.pz[i]); }
const g = Array.from({ length: H }, () => Array(W).fill(' '));
for (let i = 0; i < n; i++) {
  const x = Math.round(((t.px[i] - a) / (b - a)) * (W - 1));
  const y = Math.round(((t.pz[i] - c) / (d - c)) * (H - 1));
  g[y][x] = i < 25 ? 'S' : Math.abs(t.curvature[i]) > 1 / 35 ? '#' : '.';
}
console.log(g.map((r) => r.join('')).join('\n'));
