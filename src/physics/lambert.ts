// Lambert's problem: find the orbit connecting two positions in a given time.
// Universal-variable formulation (Curtis, Algorithm 5.2), solved by bisection
// on z for a robust zero-revolution prograde solution. This is the same problem
// NASA mission designers solve to draw "porkchop" launch-window plots.

import { stumpffC, stumpffS } from './kepler';
import { V3, cross, dot, norm, scale, sub } from './vec';

export interface LambertResult {
  v1: V3; // departure velocity (km/s)
  v2: V3; // arrival velocity (km/s)
}

export function lambert(r1: V3, r2: V3, tof: number, mu: number): LambertResult | null {
  const r1n = norm(r1);
  const r2n = norm(r2);
  const c12 = cross(r1, r2);
  let cosTheta = dot(r1, r2) / (r1n * r2n);
  cosTheta = Math.min(1, Math.max(-1, cosTheta));
  let theta = Math.acos(cosTheta);
  if (c12[2] < 0) theta = 2 * Math.PI - theta; // prograde
  const A = Math.sin(theta) * Math.sqrt((r1n * r2n) / (1 - Math.cos(theta)));
  if (!isFinite(A) || Math.abs(A) < 1e-9) return null;

  const smu = Math.sqrt(mu);
  const y = (z: number) => r1n + r2n + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  const F = (z: number) => {
    const yz = y(z);
    if (yz < 0) return -Infinity;
    const C = stumpffC(z);
    return Math.pow(yz / C, 1.5) * stumpffS(z) + A * Math.sqrt(yz) - smu * tof;
  };

  let hi = 4 * Math.PI * Math.PI - 1e-7;
  let lo = -4 * Math.PI * Math.PI;
  let guard = 0;
  while (F(lo) > 0 && guard++ < 60) lo *= 2;
  if (F(lo) > 0) return null;
  if (!(F(hi) > 0)) return null;

  let z = 0;
  for (let i = 0; i < 90; i++) {
    z = 0.5 * (lo + hi);
    const f = F(z);
    if (f > 0) hi = z;
    else lo = z;
    if (hi - lo < 1e-10) break;
  }

  const yz = y(z);
  if (!(yz > 0)) return null;
  const f = 1 - yz / r1n;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / r2n;
  const v1 = scale(sub(r2, scale(r1, f)), 1 / g);
  const v2 = scale(sub(scale(r2, gdot), r1), 1 / g);
  if (!isFinite(v1[0]) || !isFinite(v2[0])) return null;
  return { v1, v2 };
}
