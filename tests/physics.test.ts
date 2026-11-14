import { describe, expect, it } from 'vitest';
import { AU, MU_SUN, DAY } from '../src/physics/constants';
import { planetState } from '../src/physics/ephemeris';
import { lambert } from '../src/physics/lambert';
import { propagate } from '../src/physics/kepler';
import { directTransfer, jgaTransfer } from '../src/physics/porkchop';
import { isoToJD } from '../src/physics/time';
import { norm, sub } from '../src/physics/vec';

describe('ephemeris (JPL approximate elements)', () => {
  it('puts Earth ~1 AU from the Sun at J2000', () => {
    const e = planetState('earth', 2451545.0);
    expect(norm(e.r) / AU).toBeCloseTo(0.983, 2);
    expect(e.r[0] / AU).toBeCloseTo(-0.177, 1);
    expect(e.r[1] / AU).toBeCloseTo(0.967, 1);
    expect(norm(e.v)).toBeGreaterThan(29);
    expect(norm(e.v)).toBeLessThan(31);
  });
  it('puts Jupiter ~5.2 AU and Pluto ~30-50 AU away', () => {
    const jd = isoToJD('2026-11-14');
    expect(norm(planetState('jupiter', jd).r) / AU).toBeGreaterThan(4.9);
    expect(norm(planetState('jupiter', jd).r) / AU).toBeLessThan(5.5);
    expect(norm(planetState('pluto', jd).r) / AU).toBeGreaterThan(30);
  });
});

describe('Kepler propagation', () => {
  it('returns to the start after one circular orbit', () => {
    const r0: [number, number, number] = [AU, 0, 0];
    const v = Math.sqrt(MU_SUN / AU);
    const T = 2 * Math.PI * Math.sqrt(AU ** 3 / MU_SUN);
    const s = propagate(r0, [0, v, 0], T, MU_SUN);
    expect(norm(sub(s.r, r0)) / AU).toBeLessThan(1e-6);
  });
});

describe('Lambert solver', () => {
  it('reproduces a known quarter-orbit transfer', () => {
    const v = Math.sqrt(MU_SUN / AU);
    const T = 2 * Math.PI * Math.sqrt(AU ** 3 / MU_SUN);
    const sol = lambert([AU, 0, 0], [0, AU, 0], T / 4, MU_SUN)!;
    expect(sol).not.toBeNull();
    expect(sol.v1[1]).toBeCloseTo(v, 3);
    expect(Math.abs(sol.v1[0])).toBeLessThan(1e-3);
  });
});

// Validation against real missions. These are the exact numbers quoted in the
// game, README and pitch, so they are asserted tightly.
describe('validation against real NASA missions', () => {
  it('Mars 2020 / Perseverance (launch 30 Jul 2020, land 18 Feb 2021): C3 14.4 vs ~14.5 published', () => {
    const tr = directTransfer('mars', isoToJD('2020-07-30'), isoToJD('2021-02-18') - isoToJD('2020-07-30'))!;
    expect(tr.c3).toBeGreaterThan(13.9);
    expect(tr.c3).toBeLessThan(14.9);
    expect(Number(tr.c3.toFixed(1))).toBe(14.4);
    expect(tr.vinfArr).toBeGreaterThan(2);
    expect(tr.vinfArr).toBeLessThan(3.2);
  });

  it('New Horizons (launch 19 Jan 2006, Jupiter 28 Feb 2007, Pluto 14 Jul 2015)', () => {
    const L = isoToJD('2006-01-19');
    const J = isoToJD('2007-02-28');
    const P = isoToJD('2015-07-14');
    const e = planetState('earth', L);
    const j = planetState('jupiter', J);
    const leg1 = lambert(e.r, j.r, (J - L) * DAY, MU_SUN)!;
    const c3 = norm(sub(leg1.v1, e.v)) ** 2;
    // Published launch C3: 157.75 km^2/s^2 -> engine 158.8
    expect(Math.abs(c3 - 157.75)).toBeLessThan(2);
    expect(Number(c3.toFixed(1))).toBe(158.8);
    const tr = jgaTransfer('pluto', L, J - L, P - J)!;
    expect(tr).not.toBeNull();
    // Real closest approach to Jupiter: ~32 Jupiter radii -> engine 32.6
    expect(tr.flyby!.rpRadii).toBeGreaterThan(31);
    expect(tr.flyby!.rpRadii).toBeLessThan(34);
    expect(Number(tr.flyby!.rpRadii.toFixed(1))).toBe(32.6);
    // Real Pluto encounter speed: ~13.8 km/s -> engine 13.79
    expect(Math.abs(tr.vinfArr - 13.8)).toBeLessThan(0.2);
    // Real flyby needed essentially no engine burn
    expect(tr.flyby!.dv).toBeLessThan(0.1);
  });
});
