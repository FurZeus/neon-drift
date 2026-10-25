import type { Track } from '../world/Track';

const NS = 'http://www.w3.org/2000/svg';

/** Pistin kuşbakışı SVG haritası; araç ve hayalet noktası. Kuzey = −Z. */
export class Minimap {
  private readonly car: SVGCircleElement;
  private readonly ghost: SVGCircleElement;
  private minX = 0;
  private minZ = 0;
  private scale = 1;
  private pad = 8;

  constructor(svg: SVGSVGElement, track: Track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    const w = 200;
    this.scale = (w - this.pad * 2) / (maxX - minX);
    const h = (maxZ - minZ) * this.scale + this.pad * 2;
    this.minX = minX;
    this.minZ = minZ;
    svg.setAttribute('viewBox', `0 0 ${w} ${h.toFixed(1)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.replaceChildren();

    let d = '';
    for (let i = 0; i < track.count; i += 6) {
      const [x, y] = this.map(track.px[i], track.pz[i]);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    if (track.closed) d += 'Z';
    const base = document.createElementNS(NS, 'path');
    base.setAttribute('d', d);
    base.setAttribute('class', 'mm-track');
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('class', 'mm-line');

    // Başlangıç (ve sprintte bitiş) çizgisi
    const marks: SVGLineElement[] = [];
    const mark = (sPos: number, cls: string) => {
      const i = Math.round(track.wrapS(sPos) / track.spacing) % track.count;
      const [sx, sy] = this.map(track.px[i], track.pz[i]);
      const nx = track.nx[i];
      const nz = track.nz[i];
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', (sx - nx * 6).toFixed(1));
      l.setAttribute('y1', (sy - nz * 6).toFixed(1));
      l.setAttribute('x2', (sx + nx * 6).toFixed(1));
      l.setAttribute('y2', (sy + nz * 6).toFixed(1));
      l.setAttribute('class', cls);
      marks.push(l);
    };
    mark(track.def.startS, 'mm-start');
    if (track.def.finishS !== undefined) mark(track.def.finishS, 'mm-start mm-finish');
    this.ghost = document.createElementNS(NS, 'circle');
    this.ghost.setAttribute('r', '3.2');
    this.ghost.setAttribute('class', 'mm-ghost');
    this.ghost.style.display = 'none';
    this.car = document.createElementNS(NS, 'circle');
    this.car.setAttribute('r', '4.6');
    this.car.setAttribute('class', 'mm-car');
    svg.append(base, line, ...marks, this.ghost, this.car);
  }

  private map(x: number, z: number): [number, number] {
    return [(x - this.minX) * this.scale + this.pad, (z - this.minZ) * this.scale + this.pad];
  }

  update(carX: number, carZ: number, ghost: { x: number; z: number } | null): void {
    const [x, y] = this.map(carX, carZ);
    this.car.setAttribute('cx', x.toFixed(1));
    this.car.setAttribute('cy', y.toFixed(1));
    if (ghost) {
      const [gx, gy] = this.map(ghost.x, ghost.z);
      this.ghost.style.display = '';
      this.ghost.setAttribute('cx', gx.toFixed(1));
      this.ghost.setAttribute('cy', gy.toFixed(1));
    } else {
      this.ghost.style.display = 'none';
    }
  }
}
