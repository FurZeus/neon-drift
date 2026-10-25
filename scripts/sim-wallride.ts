// "Tam gaz + duvara yaslan" sürüşü: duvar sürtünmesi yeterince cezalandırıyor mu?
import { Track, createTrackQuery } from '../src/world/Track';
import { CarPhysics } from '../src/vehicle/CarPhysics';
import { Autopilot } from '../src/vehicle/Autopilot';

const track = new Track();
const car = new CarPhysics();
const q = createTrackQuery();
track.frameAt(track.length - 12, q);
car.reset(q.cx, q.cz, Track.yawOf(q.tx, q.tz));
track.query(car.x, car.z, -1, q);
const pilot = new Autopilot(track);
pilot.pace = 100; // hiç frenleme yok
let contact = 0;
car.onWallHit = () => contact++;
const h = 1 / 120;
let progress = -12, prevS = q.s, t = 0, lapStart = 0, lap = 1, minK = 999;
while (lap <= 3 && t < 400) {
  const input = pilot.drive(car, q);
  input.throttle = 1; input.brake = 0;
  car.step(h, input, track, q);
  progress += track.deltaS(prevS, q.s); prevS = q.s; t += h;
  if (t - lapStart > 3) minK = Math.min(minK, car.kmh);
  if (progress >= lap * track.length) { console.log(`tur ${lap}: ${(t - lapStart).toFixed(2)} s`); lapStart = t; lap++; }
}
console.log(`duvar temas adımı ${contact}, min ${minK.toFixed(0)} km/h`);

// Hız profili (2. tur), 25 m aralıklarla
{
  const c2 = new CarPhysics();
  const q2 = createTrackQuery();
  track.frameAt(track.length - 12, q2);
  c2.reset(q2.cx, q2.cz, Track.yawOf(q2.tx, q2.tz));
  track.query(c2.x, c2.z, -1, q2);
  let prog = -12, ps = q2.s, nextMark = track.length;
  const rows: string[] = [];
  for (let i = 0; i < 120 * 80 && prog < 2 * track.length; i++) {
    const inp = pilot.drive(c2, q2);
    inp.throttle = 1; inp.brake = 0;
    c2.step(h, inp, track, q2);
    prog += track.deltaS(ps, q2.s); ps = q2.s;
    if (prog >= nextMark) {
      rows.push(`s=${(prog - track.length).toFixed(0).padStart(4)} v=${c2.kmh.toFixed(0).padStart(3)} lat=${q2.lateral.toFixed(1).padStart(5)} slip=${((c2.slip*180)/Math.PI).toFixed(0).padStart(3)} R=${(1/Math.max(1e-4,Math.abs(q2.curvature))).toFixed(0).padStart(4)}${c2.offroad ? ' OFF' : ''}`);
      nextMark += 25;
    }
  }
  console.log(rows.join('\n'));
}
