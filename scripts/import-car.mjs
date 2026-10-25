// Sketchfab'dan indirilen araçları oyuna aktarır.
//
//   npm run import-car -- <arac-kimligi> <zip | .gltf | .glb yolu>
//   npm run import-car -- --scan            # ~/Downloads içindeki tüm bilinen araçları bul ve aktar
//   npm run import-car -- --scan --force    # zaten aktarılmış olanları da yeniden aktar
//
// Zip geçici, boş bir klasöre açılır (indirilen dosyalar güvenilmeyen veri olarak ele alınır).
// Dokular en çok 1024 px WebP'ye küçültülür, 150 bin üçgenden ağır modeller sadeleştirilir,
// geometri meshopt ile sıkıştırılır; düğüm adları korunur (tekerlek animasyonu için).
// Sonuç: public/models/<kimlik>.glb + manifest.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TRIANGLES = 150_000;

// Araç kimlikleri tek kaynaktan: src/vehicle/cars.ts
const carsSrc = fs.readFileSync(path.join(root, 'src/vehicle/cars.ts'), 'utf8');
const KNOWN = [...carsSrc.matchAll(/^\s{4}id: '([a-z0-9]+)'/gm)].map((m) => m[1]);

// Sketchfab indirme adları (küçük harf, '-', '_' ya da boşluk ayraçlı) → araç kimliği
// Desenler marka + model içerir: rakam içeren rastgele dosya adlarıyla (ör. "...1775930343...") karışmasın.
const PATTERNS = [
  ['golf6', /golf[\W_]+6[\W_]+a6|golf[\W_]*mk[\W_]*6|2008[\W_]+volkswagen[\W_]+golf/],
  ['golf6b', /^volkswagen[\W_]+golf[\W_]+6(?![\W_]+a6)([\W_]|$)/],
  ['r34', /skyline|nissan[\W_]+r34/],
  ['ae86', /ae86|trueno/],
  ['p930', /porsche/],
  ['e30', /bmw[\W_]+m3[\W_]+e30|free[\W_]+bmw/],
  ['sahin', /sahin|şahin/],
  ['doblo', /fiat[\W_]+doblo/],
  ['egea', /fiat[\W_]+egea/],
  ['corolla93', /corolla[\W_]+(mk7|e100)/],
];

function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(n);
}

async function importOne(id, inputPath) {
  const input = path.resolve(inputPath.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(input)) throw new Error(`Dosya bulunamadı: ${input}`);
  let source = input;
  let tmp = null;
  try {
    if (input.toLowerCase().endsWith('.zip')) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-car-'));
      execFileSync('unzip', ['-q', '-o', input, '-d', tmp]);
      const found = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(gltf|glb)$/i.test(e.name)) found.push(p);
        }
      };
      walk(tmp);
      if (!found.length) throw new Error('Zip içinde .gltf/.glb yok. Sketchfab\'da "glTF" biçimini seçin.');
      source = found.find((f) => /scene\.gltf$/i.test(f)) ?? found[0];
    }

    await MeshoptEncoder.ready;
    await MeshoptSimplifier.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    const doc = await io.read(source);
    const before = triangleCount(doc);
    const steps = [dedup(), prune(), weld()];
    if (before > MAX_TRIANGLES) {
      const ratio = Math.max(0.12, MAX_TRIANGLES / before);
      steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
    }
    steps.push(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await doc.transform(...steps);

    const outDir = path.join(root, 'public', 'models');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${id}.glb`);
    await io.write(outFile, doc);
    const bytes = fs.statSync(outFile).size;
    const triangles = triangleCount(doc);

    const manifestPath = path.join(outDir, 'manifest.json');
    let manifest = { cars: {} };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      /* yeni manifest */
    }
    manifest.cars ??= {};
    manifest.cars[id] = { file: `${id}.glb`, bytes, triangles };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log(
      `✓ ${id}: ${path.relative(root, outFile)}  ${(bytes / 1024 / 1024).toFixed(2)} MB, ${triangles} üçgen` +
        (before > triangles ? ` (sadeleştirildi: ${before} → ${triangles})` : ''),
    );
    console.log('  Malzemeler:', doc.getRoot().listMaterials().map((m) => m.getName()).join(', '));
    console.log('  Düğümler:', doc.getRoot().listNodes().map((n) => n.getName()).filter(Boolean).slice(0, 60).join(', '));
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args[0] === '--scan') {
  const force = args.includes('--force');
  const dir = path.join(os.homedir(), 'Downloads');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(zip|glb)$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const chosen = new Map();
  for (const { f } of files) {
    const name = f.toLowerCase();
    const hit = PATTERNS.find(([, re]) => re.test(name));
    if (hit && KNOWN.includes(hit[0]) && !chosen.has(hit[0])) chosen.set(hit[0], path.join(dir, f));
  }
  if (!chosen.size) {
    console.log('~/Downloads içinde tanınan araç dosyası yok. Dosyayı elle verin: npm run import-car -- <kimlik> <dosya>');
    console.log('Kimlikler:', KNOWN.join(', '));
    process.exit(0);
  }
  for (const [id, file] of chosen) {
    const out = path.join(root, 'public', 'models', `${id}.glb`);
    if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(file).mtimeMs) {
      console.log(`• ${id}: zaten aktarılmış (${path.basename(file)}), atlandı`);
      continue;
    }
    console.log(`→ ${id} ← ${path.basename(file)}`);
    try {
      await importOne(id, file);
    } catch (err) {
      console.error(`✗ ${id}: ${err.message}`);
    }
  }
  const missing = KNOWN.filter((id) => !chosen.has(id) && !fs.existsSync(path.join(root, 'public', 'models', `${id}.glb`)));
  if (missing.length) console.log('Henüz dosyası olmayanlar:', missing.join(', '));
} else {
  const [id, input] = args;
  if (!id || !input || !KNOWN.includes(id)) {
    console.error(`Kullanım: npm run import-car -- <${KNOWN.join('|')}> <zip|gltf|glb>\n         npm run import-car -- --scan`);
    process.exit(1);
  }
  try {
    await importOne(id, input);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
