// Drift davranışı: düz zeminde belli hızda el freni + direksiyon.
import { Track, createTrackQuery } from '../src/world/Track';
import { NEON_CIRCUIT } from '../src/world/tracks';
import { CarPhysics } from '../src/vehicle/CarPhysics';

// Geniş, düz bir "pist" (duvarlar uzakta): büyük daire.
const pts: [number, number][] = [];
for (let i = 0; i < 24; i++) pts.push([Math.cos((i / 24) * Math.PI * 2) * 2000, Math.sin((i / 24) * Math.PI * 2) * 2000]);
const track = new Track({ ...NEON_CIRCUIT, points: pts, roadHalfWidth: 900, barrierOffset: 900 }, 4000);

for (const [v0, steer, label] of [[40, 1, 'drift tam içe'], [40, 0.3, 'drift hafif'], [40, -0.8, 'drift kontra'], [25, 1, 'drift yavaş']] as const) {
  for (const drift of [false, true]) {
    const car = new CarPhysics();
    const q = createTrackQuery();
    track.frameAt(0, q);
    car.reset(q.cx, q.cz, 0);
    car.speed = v0;
    track.query(car.x, car.z, -1, q);
    let boost = 0;
    car.onBoost = (l) => (boost = l);
    const h = 1 / 120;
    // 0.15 sn direksiyonla gir, sonra drift
    for (let t = 0; t < 2.2; t += h) {
      const s = t < 0.15 ? 1 : steer;
      car.step(h, { steer: s, throttle: 1, brake: 0, handbrake: drift }, track, q);
    }
    const r = Math.abs(car.speed / (car.yawRate || 1e-6));
    console.log(`${label.padEnd(14)} v0=${v0} drift=${drift ? 'E' : 'H'}  hız=${car.speed.toFixed(1)}  yarıçap≈${r.toFixed(1)}m  kayma=${((car.slip * 180) / Math.PI).toFixed(0)}°  şarj=${car.driftLevel}`);
    car.step(h, { steer: 0, throttle: 1, brake: 0, handbrake: false }, track, q);
    if (drift) console.log(`   bırakınca turbo seviyesi: ${boost}, turbo süresi ${car.boostTime.toFixed(2)}`);
  }
}
