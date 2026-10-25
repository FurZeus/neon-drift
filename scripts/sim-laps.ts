// Fizik + otopilotu başsız (headless) çalıştırır: tur süreleri, duvar teması, pist dışı süresi.
// Çalıştırma: npx vite-node scripts/sim-laps.ts
import { Track, createTrackQuery } from '../src/world/Track';
import { CarPhysics } from '../src/vehicle/CarPhysics';
import { Autopilot } from '../src/vehicle/Autopilot';
import { carById } from '../src/vehicle/cars';

const track = new Track();
const car = new CarPhysics();
const carId = process.argv[3] ?? 'golf6';
car.setParams(carById(carId).physics);
const q = createTrackQuery();
track.frameAt(track.length - 12, q);
car.reset(q.cx, q.cz, Track.yawOf(q.tx, q.tz));
track.query(car.x, car.z, -1, q);
const pilot = new Autopilot(track);
let hits = 0;
let off = 0;
car.onWallHit = (h) => { if (h.strength > 1) hits++; };
const h = 1 / 120;
let progress = -12;
let prevS = q.s;
let t = 0;
let lapStart = 0;
let lap = 1;
let maxKmh = 0;
let minLapKmh = 999;
const pace = Number(process.argv[2] ?? 1);
pilot.pace = pace;
while (lap <= 3 && t < 400) {
  const input = pilot.drive(car, q);
  car.step(h, input, track, q);
  progress += track.deltaS(prevS, q.s);
  prevS = q.s;
  t += h;
  if (car.offroad) off += h;
  maxKmh = Math.max(maxKmh, car.kmh);
  if (t - lapStart > 3) minLapKmh = Math.min(minLapKmh, car.kmh);
  if (progress >= lap * track.length) {
    console.log(`tur ${lap}: ${(t - lapStart).toFixed(2)} s`);
    lapStart = t;
    lap++;
  }
}
console.log(`${carId.padEnd(6)} pace=${pace} toplam ${t.toFixed(2)} s, duvar ${hits}, pist dışı ${off.toFixed(1)} s, max ${maxKmh.toFixed(0)} km/h, min ${minLapKmh.toFixed(0)} km/h`);
