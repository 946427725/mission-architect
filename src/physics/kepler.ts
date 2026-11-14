// Two-body propagation with universal variables (Curtis, "Orbital Mechanics for
// Engineering Students", Algorithms 3.3 & 3.4). Works for ellipses and hyperbolas.

import { V3, add, dot, norm, scale } from './vec';

export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}

/** Propagate a state (r0, v0) by dt seconds under gravity parameter mu. */
export function propagate(r0: V3, v0: V3, dt: number, mu: number): { r: V3; v: V3 } {
  const r0n = norm(r0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - dot(v0, v0) / mu;
  const smu = Math.sqrt(mu);

  let chi = smu * Math.abs(alpha) * dt;
  if (!isFinite(chi) || chi === 0) chi = smu * dt / r0n;
  for (let i = 0; i < 200; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F =
      ((r0n * vr0) / smu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - smu * dt;
    const dF = ((r0n * vr0) / smu) * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    let step = F / dF;
    // damp huge Newton steps (helps long hyperbolic arcs)
    if (Math.abs(step) > Math.abs(chi) * 0.5 + 1) step = Math.sign(step) * (Math.abs(chi) * 0.5 + 1);
    chi -= step;
    if (Math.abs(step) < 1e-9) break;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - (chi * chi * chi * S) / smu;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = norm(r);
  const fdot = (smu / (rn * r0n)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - ((chi * chi) / rn) * C;
  const v = add(scale(r0, fdot), scale(v0, gdot));
  return { r, v };
}

/** Sample a trajectory arc, propagating step by step for numerical robustness. */
export function sampleArc(r0: V3, v0: V3, tof: number, mu: number, n = 200): V3[] {
  const pts: V3[] = [r0];
  let r = r0;
  let v = v0;
  const dt = tof / n;
  for (let i = 1; i <= n; i++) {
    const s = propagate(r, v, dt, mu);
    r = s.r;
    v = s.v;
    pts.push(r);
  }
  return pts;
}
