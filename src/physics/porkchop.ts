// Launch-window ("porkchop") grids. For every launch date and flight time we
// solve Lambert's problem with real planet positions and record the launch
// energy C3 = v_inf^2 the rocket must supply.

import { BODIES, BodyId, DAY, MU_SUN, YEAR_DAYS } from './constants';
import { planetState } from './ephemeris';
import { lambert } from './lambert';
import { V3, angleBetween, norm, sub } from './vec';

export type TrajectoryKind = 'direct' | 'jga';

export interface Leg {
  from: BodyId;
  to: BodyId;
  departJD: number;
  arriveJD: number;
  r1: V3;
  v1: V3; // heliocentric velocity at leg start
}

export interface Transfer {
  kind: TrajectoryKind;
  target: BodyId;
  launchJD: number;
  arriveJD: number;
  tofDays: number;
  c3: number; // km^2/s^2
  vinfDep: number; // km/s
  vinfArr: number; // km/s, hyperbolic excess at the target
  legs: Leg[];
  flyby?: {
    body: BodyId;
    jd: number;
    dv: number; // km/s powered-flyby burn
    rpRadii: number; // closest approach in planet radii
  };
}

export interface GridSpec {
  kind: TrajectoryKind;
  target: BodyId;
  launchStartJD: number;
  launchEndJD: number;
  nx: number;
  tofMinDays: number;
  tofMaxDays: number;
  ny: number;
}

export interface PorkchopGrid {
  spec: GridSpec;
  c3: Float32Array; // NaN = no solution
  extra: Float32Array; // JGA: flyby leg-1 time of flight (days); direct: arrival v_inf
  flybyDv: Float32Array; // JGA: powered-flyby burn (km/s); direct: 0
  best: { ix: number; iy: number; c3: number } | null;
}

export const launchJDAt = (s: GridSpec, ix: number) =>
  s.launchStartJD + ((s.launchEndJD - s.launchStartJD) * ix) / (s.nx - 1);
export const tofAt = (s: GridSpec, iy: number) => s.tofMinDays + ((s.tofMaxDays - s.tofMinDays) * iy) / (s.ny - 1);

export function directTransfer(target: BodyId, launchJD: number, tofDays: number): Transfer | null {
  const e = planetState('earth', launchJD);
  const arriveJD = launchJD + tofDays;
  const t = planetState(target, arriveJD);
  const sol = lambert(e.r, t.r, tofDays * DAY, MU_SUN);
  if (!sol) return null;
  const vinfDep = norm(sub(sol.v1, e.v));
  const vinfArr = norm(sub(sol.v2, t.v));
  return {
    kind: 'direct',
    target,
    launchJD,
    arriveJD,
    tofDays,
    c3: vinfDep * vinfDep,
    vinfDep,
    vinfArr,
    legs: [{ from: 'earth', to: target, departJD: launchJD, arriveJD, r1: e.r, v1: sol.v1 }],
  };
}

const FLYBY_MIN_RADII = 2; // don't skim closer than 2 Jupiter radii (radiation + atmosphere)
const MAX_FLYBY_DV = 1.0; // km/s

/** Earth -> Jupiter (gravity assist) -> target, for a fixed leg-1 and leg-2 flight time. */
export function jgaTransfer(target: BodyId, launchJD: number, tof1: number, tof2: number): Transfer | null {
  const e = planetState('earth', launchJD);
  const flybyJD = launchJD + tof1;
  const j = planetState('jupiter', flybyJD);
  const leg1 = lambert(e.r, j.r, tof1 * DAY, MU_SUN);
  if (!leg1) return null;
  const arriveJD = flybyJD + tof2;
  const t = planetState(target, arriveJD);
  const leg2 = lambert(j.r, t.r, tof2 * DAY, MU_SUN);
  if (!leg2) return null;
  const vin = sub(leg1.v2, j.v);
  const vout = sub(leg2.v1, j.v);
  const vinN = norm(vin);
  const voutN = norm(vout);
  const turn = angleBetween(vin, vout);
  const vavg = 0.5 * (vinN + voutN);
  const mu = BODIES.jupiter.mu;
  // periapsis radius that produces this turn angle for a hyperbola with v_inf = vavg
  const ecc = 1 / Math.sin(Math.max(turn, 1e-6) / 2);
  const rp = ((ecc - 1) * mu) / (vavg * vavg);
  const rpRadii = rp / BODIES.jupiter.radius;
  if (rpRadii < FLYBY_MIN_RADII) return null;
  const dv = Math.abs(Math.sqrt(voutN * voutN + (2 * mu) / rp) - Math.sqrt(vinN * vinN + (2 * mu) / rp));
  if (dv > MAX_FLYBY_DV) return null;
  const vinfDep = norm(sub(leg1.v1, e.v));
  return {
    kind: 'jga',
    target,
    launchJD,
    arriveJD,
    tofDays: tof1 + tof2,
    c3: vinfDep * vinfDep,
    vinfDep,
    vinfArr: norm(sub(leg2.v2, t.v)),
    legs: [
      { from: 'earth', to: 'jupiter', departJD: launchJD, arriveJD: flybyJD, r1: e.r, v1: leg1.v1 },
      { from: 'jupiter', to: target, departJD: flybyJD, arriveJD, r1: j.r, v1: leg2.v1 },
    ],
    flyby: { body: 'jupiter', jd: flybyJD, dv, rpRadii },
  };
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export async function computeGrid(spec: GridSpec, onProgress?: (f: number) => void): Promise<PorkchopGrid> {
  const { nx, ny } = spec;
  const c3 = new Float32Array(nx * ny).fill(NaN);
  const extra = new Float32Array(nx * ny).fill(NaN);
  const flybyDv = new Float32Array(nx * ny).fill(0);
  let best: PorkchopGrid['best'] = null;

  for (let ix = 0; ix < nx; ix++) {
    const L = launchJDAt(spec, ix);
    if (spec.kind === 'direct') {
      for (let iy = 0; iy < ny; iy++) {
        const tr = directTransfer(spec.target, L, tofAt(spec, iy));
        if (!tr) continue;
        c3[iy * nx + ix] = tr.c3;
        extra[iy * nx + ix] = tr.vinfArr;
        if (!best || tr.c3 < best.c3) best = { ix, iy, c3: tr.c3 };
      }
    } else {
      // search the Jupiter flyby date; bin by total flight time
      const bestCost = new Float32Array(ny).fill(Infinity);
      for (let tof1 = 300; tof1 <= 1100; tof1 += 25) {
        const e = planetState('earth', L);
        const j = planetState('jupiter', L + tof1);
        const leg1 = lambert(e.r, j.r, tof1 * DAY, MU_SUN);
        if (!leg1) continue;
        const vinfDep = norm(sub(leg1.v1, e.v));
        if (vinfDep > 16) continue;
        for (let tof2y = 3; tof2y <= 16; tof2y += 0.33) {
          const total = tof1 + tof2y * YEAR_DAYS;
          const iy = Math.round(((total - spec.tofMinDays) / (spec.tofMaxDays - spec.tofMinDays)) * (ny - 1));
          if (iy < 0 || iy >= ny) continue;
          const tr = jgaTransfer(spec.target, L, tof1, tof2y * YEAR_DAYS);
          if (!tr || !tr.flyby) continue;
          const cost = tr.vinfDep + 2 * tr.flyby.dv;
          if (cost < bestCost[iy]) {
            bestCost[iy] = cost;
            c3[iy * nx + ix] = tr.c3;
            extra[iy * nx + ix] = tof1; // leg-2 time is rebuilt from the bin
            flybyDv[iy * nx + ix] = tr.flyby.dv;
            if (!best || tr.c3 < best.c3) best = { ix, iy, c3: tr.c3 };
          }
        }
      }
    }
    if (ix % 4 === 3) {
      onProgress?.((ix + 1) / nx);
      await yieldFrame();
    }
  }
  onProgress?.(1);
  return { spec, c3, extra, flybyDv, best };
}

/** Rebuild the full transfer for a grid cell (detail view / selection). */
export function transferAt(grid: PorkchopGrid, ix: number, iy: number): Transfer | null {
  const { spec } = grid;
  const L = launchJDAt(spec, ix);
  const total = tofAt(spec, iy);
  if (spec.kind === 'direct') return directTransfer(spec.target, L, total);
  const tof1 = grid.extra[iy * spec.nx + ix];
  if (!isFinite(tof1)) return null;
  // refine leg-2 time of flight around the bin centre
  let bestTr: Transfer | null = null;
  for (let d = -60; d <= 60; d += 10) {
    const tr = jgaTransfer(spec.target, L, tof1, total - tof1 + d);
    if (tr && tr.flyby && (!bestTr || tr.vinfDep + 2 * tr.flyby.dv < bestTr.vinfDep + 2 * bestTr.flyby!.dv)) bestTr = tr;
  }
  return bestTr;
}
