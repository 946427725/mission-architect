// Interactive porkchop plot: launch date (x) vs flight time (y), coloured by
// launch energy C3. Hover previews the trajectory, click selects it.

import { PorkchopGrid, launchJDAt, tofAt } from '../physics/porkchop';
import { YEAR_DAYS } from '../physics/constants';
import { formatJD, jdToDate } from '../physics/time';

export interface PorkchopOverlay {
  readyJD: number;
  maxTofDays: number;
  /** max C3 the chosen rocket can reach with the current launch mass */
  reachC3: number;
  selected?: { launchJD: number; tofDays: number } | null;
}

const PAD = { l: 44, r: 10, t: 10, b: 30 };

function colormap(t: number): [number, number, number] {
  // deep blue -> cyan -> green -> yellow -> orange -> red
  const stops: [number, number, number][] = [
    [20, 40, 140], [30, 120, 230], [60, 210, 220], [120, 220, 120], [240, 220, 80], [250, 140, 50], [220, 50, 50],
  ];
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return [0, 1, 2].map((k) => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f) as [number, number, number];
}

export class PorkchopView {
  readonly canvas: HTMLCanvasElement;
  private heat: HTMLCanvasElement;
  private hover: { ix: number; iy: number } | null = null;
  private c3Min: number;
  private c3Max: number;

  constructor(
    host: HTMLElement,
    private grid: PorkchopGrid,
    private overlay: PorkchopOverlay,
    private onHover: (ix: number, iy: number) => void,
    private onLeave: () => void,
    private onPick: (ix: number, iy: number) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'porkchop-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Porkchop plot of launch date versus flight time coloured by launch energy');
    host.appendChild(this.canvas);
    const finite = Array.from(grid.c3).filter((v) => isFinite(v));
    this.c3Min = Math.max(0, Math.min(...finite));
    this.c3Max = this.c3Min * 3.2 + 25;
    this.heat = this.buildHeat();
    this.canvas.addEventListener('mousemove', (e) => this.move(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.draw();
      this.onLeave();
    });
    this.canvas.addEventListener('click', (e) => {
      const c = this.cellAt(e);
      if (c) this.onPick(c.ix, c.iy);
    });
    new ResizeObserver(() => this.draw()).observe(host);
    this.draw();
  }

  get range() {
    return { min: this.c3Min, max: this.c3Max };
  }

  setOverlay(o: PorkchopOverlay) {
    this.overlay = o;
    this.draw();
  }

  private buildHeat(): HTMLCanvasElement {
    const { nx, ny } = this.grid.spec;
    const c = document.createElement('canvas');
    c.width = nx;
    c.height = ny;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(nx, ny);
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const v = this.grid.c3[iy * nx + ix];
        const p = ((ny - 1 - iy) * nx + ix) * 4;
        if (!isFinite(v) || v > this.c3Max) {
          img.data.set([14, 18, 30, 255], p);
          continue;
        }
        const t = Math.log(1 + v - this.c3Min) / Math.log(1 + this.c3Max - this.c3Min);
        const [r, g, b] = colormap(t);
        img.data.set([r, g, b, 255], p);
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private plotRect() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: PAD.l, y: PAD.t, w: w - PAD.l - PAD.r, h: h - PAD.t - PAD.b };
  }

  private cellAt(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.plotRect();
    const x = (e.clientX - r.left - p.x) / p.w;
    const y = (e.clientY - r.top - p.y) / p.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    const { nx, ny } = this.grid.spec;
    const ix = Math.min(nx - 1, Math.floor(x * nx));
    const iy = Math.min(ny - 1, Math.floor((1 - y) * ny));
    if (!isFinite(this.grid.c3[iy * nx + ix])) return null;
    return { ix, iy };
  }

  private move(e: MouseEvent) {
    const c = this.cellAt(e);
    if (!c) {
      if (this.hover) {
        this.hover = null;
        this.draw();
        this.onLeave();
      }
      return;
    }
    if (this.hover && this.hover.ix === c.ix && this.hover.iy === c.iy) return;
    this.hover = c;
    this.draw();
    this.onHover(c.ix, c.iy);
  }

  draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = this.plotRect();
    const s = this.grid.spec;
    const { nx, ny } = s;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.heat, p.x, p.y, p.w, p.h);

    const xOf = (jd: number) => p.x + ((jd - s.launchStartJD) / (s.launchEndJD - s.launchStartJD)) * p.w;
    const yOf = (tof: number) => p.y + p.h - ((tof - s.tofMinDays) / (s.tofMaxDays - s.tofMinDays)) * p.h;

    // not-ready region
    const xr = Math.min(p.x + p.w, Math.max(p.x, xOf(this.overlay.readyJD)));
    if (xr > p.x) {
      ctx.save();
      ctx.fillStyle = 'rgba(5,8,16,0.72)';
      ctx.fillRect(p.x, p.y, xr - p.x, p.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      for (let k = -p.h; k < xr - p.x; k += 8) {
        ctx.moveTo(p.x + k, p.y + p.h);
        ctx.lineTo(p.x + k + p.h, p.y);
      }
      ctx.rect(p.x, p.y, xr - p.x, p.h);
      ctx.clip();
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#ffb84d';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xr, p.y);
      ctx.lineTo(xr, p.y + p.h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (xr - p.x > 70) {
        ctx.fillStyle = '#ffb84d';
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.fillText('NOT READY', p.x + 6, p.y + 14);
      }
    }
    // too-long region
    if (s.tofMaxDays > this.overlay.maxTofDays) {
      const y = yOf(this.overlay.maxTofDays);
      ctx.fillStyle = 'rgba(5,8,16,0.6)';
      ctx.fillRect(p.x, p.y, p.w, Math.max(0, y - p.y));
      ctx.strokeStyle = '#ff6b6b';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9b9b';
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText('TOO LONG', p.x + p.w - 64, y - 5);
    }

    // rocket reach outline
    const cw = p.w / nx;
    const chh = p.h / ny;
    const ok = (ix: number, iy: number) => {
      if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return false;
      const v = this.grid.c3[iy * nx + ix];
      return isFinite(v) && v <= this.overlay.reachC3;
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        if (!ok(ix, iy)) continue;
        const x0 = p.x + ix * cw;
        const y0 = p.y + p.h - (iy + 1) * chh;
        if (!ok(ix - 1, iy)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + chh); }
        if (!ok(ix + 1, iy)) { ctx.moveTo(x0 + cw, y0); ctx.lineTo(x0 + cw, y0 + chh); }
        if (!ok(ix, iy + 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cw, y0); }
        if (!ok(ix, iy - 1)) { ctx.moveTo(x0, y0 + chh); ctx.lineTo(x0 + cw, y0 + chh); }
      }
    ctx.stroke();
    ctx.lineWidth = 1;

    // axes
    ctx.strokeStyle = 'rgba(160,190,230,0.35)';
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w, p.h);
    ctx.fillStyle = '#9fb3cf';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    const y0 = jdToDate(s.launchStartJD).getUTCFullYear();
    const y1 = jdToDate(s.launchEndJD).getUTCFullYear();
    const step = y1 - y0 > 7 ? 2 : 1;
    for (let y = y0; y <= y1 + 1; y += step) {
      const jd = Date.UTC(y, 0, 1) / 86400000 + 2440587.5;
      if (jd < s.launchStartJD || jd > s.launchEndJD) continue;
      const x = xOf(jd);
      ctx.fillText(String(y), x, p.y + p.h + 14);
      ctx.fillRect(x, p.y + p.h, 1, 4);
    }
    ctx.fillText('Launch date →', p.x + p.w / 2, p.y + p.h + 27);
    ctx.textAlign = 'right';
    const years = s.tofMaxDays > 1500;
    const ticks = 5;
    for (let k = 0; k <= ticks; k++) {
      const tof = s.tofMinDays + ((s.tofMaxDays - s.tofMinDays) * k) / ticks;
      const y = yOf(tof);
      ctx.fillText(years ? `${(tof / YEAR_DAYS).toFixed(1)}y` : `${Math.round(tof)}d`, p.x - 5, y + 3);
    }
    ctx.save();
    ctx.translate(10, p.y + p.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Flight time', 0, 0);
    ctx.restore();

    // selected
    const sel = this.overlay.selected;
    if (sel) {
      const x = xOf(sel.launchJD);
      const y = yOf(sel.tofDays);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffa04d';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
    }
    // hover crosshair
    if (this.hover) {
      const x = p.x + (this.hover.ix + 0.5) * cw;
      const y = p.y + p.h - (this.hover.iy + 0.5) * chh;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, p.y);
      ctx.lineTo(x, p.y + p.h);
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  describe(ix: number, iy: number) {
    const s = this.grid.spec;
    const L = launchJDAt(s, ix);
    const tof = tofAt(s, iy);
    return { launch: formatJD(L), tof, c3: this.grid.c3[iy * s.nx + ix] };
  }
}

export function legendGradient(): string {
  const stops = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map((t) => {
    const [r, g, b] = colormap(t);
    return `rgb(${r | 0},${g | 0},${b | 0}) ${Math.round(t * 100)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(',')})`;
}
