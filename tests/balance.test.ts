// Game balance: real-mission-like designs must be flyable, and every mission
// must have more than one winning design ("no single perfect solution").
import { describe, expect, it } from 'vitest';
import { missionById } from '../src/data/missions';
import { autoPropellant, evaluate } from '../src/game/evaluate';
import { ROCKETS, payloadAt } from '../src/data/rockets';
import { simulate } from '../src/game/simulate';
import { Design, defaultDesign } from '../src/game/state';
import { computeGrid, directTransfer, jgaTransfer, transferAt } from '../src/physics/porkchop';
import { isoToJD } from '../src/physics/time';

const fly = (d: Design) => {
  d.propellantKg = autoPropellant(d);
  const ev = evaluate(d);
  const fails = ev.checks.filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.detail}`);
  // several seeds so one unlucky event does not decide the test
  const sims = ev.launchable ? [1, 2, 3, 4, 5, 6].map((s) => simulate(d, ev, s, false)) : [];
  const successes = sims.filter((s) => s.outcome === 'success').length;
  return { ev, fails, successes };
};

describe('Mars: two different winning rovers', () => {
  it('Perseverance-like (sky crane, MMRTG, 9 instruments) in the 2031 window', () => {
    const d = defaultDesign(missionById('mars'), 'normal');
    d.transfer = directTransfer('mars', isoToJD('2031-01-28'), 193);
    Object.assign(d, { powerId: 'mmrtg', batteryId: 'bat-m', landingId: 'skycrane', rocketId: 'atlasv551', antennaId: 'hga15', avionicsId: 'single', instruments: ['mastcam', 'supercam', 'pixl', 'sherloc', 'rimfax', 'meda', 'moxie', 'sampler', 'heli'] });
    const r = fly(d);
    expect(r.fails).toEqual([]);
    expect(r.successes).toBeGreaterThanOrEqual(4);
  });
  it('solar rover on retro rockets (2028-29 window) is launchable', () => {
    const d = defaultDesign(missionById('mars'), 'normal');
    d.transfer = directTransfer('mars', isoToJD('2028-12-28'), 215);
    Object.assign(d, { instruments: ['mastcam', 'supercam', 'pixl', 'sherloc'], batteryId: 'bat-l', powerId: 'solar-s', landingId: 'retro' });
    const r = fly(d);
    expect(r.fails).toEqual([]);
  });
});

describe('Jupiter: two different winning orbiters', () => {
  it('Juno-like (giant solar, heavy vault, 14-day orbit)', () => {
    const d = defaultDesign(missionById('jupiter'), 'normal');
    d.transfer = directTransfer('jupiter', isoToJD('2031-02-24'), 767);
    Object.assign(d, { powerId: 'solar-l', shieldId: 'heavy', rocketId: 'falconheavy', antennaId: 'hga21', txId: 'tx25', dsnDish: 70, avionicsId: 'dual', instruments: ['mwr', 'mag', 'grav', 'cam', 'jiram', 'uvs', 'particles'], orbitId: 'polar14' });
    const r = fly(d);
    expect(r.fails).toEqual([]);
    expect(r.successes).toBeGreaterThanOrEqual(4);
  });
  it('nuclear moon-tour orbiter (2x RTG, heavy vault)', () => {
    const d = defaultDesign(missionById('jupiter'), 'normal');
    d.transfer = directTransfer('jupiter', isoToJD('2031-02-24'), 767);
    Object.assign(d, { powerId: 'gphs2', shieldId: 'light', rocketId: 'falconheavy', antennaId: 'hga21', txId: 'tx25', dsnDish: 70, avionicsId: 'dual', instruments: ['mag', 'cam', 'jiram', 'uvs'], orbitId: 'tour' });
    const r = fly(d);
    expect(r.fails).toEqual([]);
  });
});

describe('Pluto: gravity assist works, direct does not', () => {
  it('New Horizons-like probe via Jupiter (2030 launch)', async () => {
    const m = missionById('pluto');
    const g = await computeGrid({ ...m.grids.jga!, launchStartJD: isoToJD('2029-10-01'), launchEndJD: isoToJD('2030-05-01'), nx: 40 });
    let best: { tr: ReturnType<typeof transferAt>; score: number } | null = null;
    for (let ix = 0; ix < g.spec.nx; ix++)
      for (let iy = 0; iy < g.spec.ny; iy++) {
        const c3 = g.c3[iy * g.spec.nx + ix];
        const tof = g.spec.tofMinDays + ((g.spec.tofMaxDays - g.spec.tofMinDays) * iy) / (g.spec.ny - 1);
        if (!isFinite(c3) || tof > m.maxTofDays) continue;
        const score = c3 + 40 * g.flybyDv[iy * g.spec.nx + ix] + (tof / 365.25) * 3;
        if (!best || score < best.score) best = { tr: transferAt(g, ix, iy), score };
      }
    const d = defaultDesign(m, 'normal');
    d.trajectoryKind = 'jga';
    d.transfer = best!.tr;
    Object.assign(d, { powerId: 'gphs', rocketId: 'atlasv551s48', antennaId: 'hga21', txId: 'tx12', dsnDish: 70, dsnHours: 24, avionicsId: 'single', instruments: ['lorri', 'ralph', 'alice', 'rex', 'swap', 'pepssi', 'sdc'] });
    const r = fly(d);
    expect(r.fails).toEqual([]);
  }, 60000);
  it('no direct route in the game lets any rocket carry even a 450 kg probe', async () => {
    const m = missionById('pluto');
    const g = await computeGrid(m.grids.direct!);
    let minC3 = Infinity;
    let cells = 0;
    for (let iy = 0; iy < g.spec.ny; iy++) {
      const tof = g.spec.tofMinDays + ((g.spec.tofMaxDays - g.spec.tofMinDays) * iy) / (g.spec.ny - 1);
      if (tof > m.maxTofDays) continue;
      for (let ix = 0; ix < g.spec.nx; ix++) {
        const c3 = g.c3[iy * g.spec.nx + ix];
        if (!isFinite(c3)) continue;
        cells++;
        minC3 = Math.min(minC3, c3);
      }
    }
    const best = Math.max(...ROCKETS.map((r) => payloadAt(r, minC3)));
    console.log(`direct Pluto: ${cells} routes, cheapest C3 ${minC3.toFixed(0)}, best rocket lifts ${Math.round(best)} kg`);
    expect(cells).toBeGreaterThan(100);
    expect(best).toBeLessThan(450);
  }, 60000);
  it('solar power at Pluto fails with a clear explanation', () => {
    const d = defaultDesign(missionById('pluto'), 'normal');
    d.trajectoryKind = 'jga';
    d.transfer = jgaTransfer('pluto', isoToJD('2006-01-19'), 405, 3058);
    d.powerId = 'solar-l';
    const ev = evaluate(d);
    const power = ev.checks.find((c) => c.id === 'power')!;
    console.log('PITCH QUOTE:', power.detail);
    expect(power.status).toBe('fail');
  });
});
