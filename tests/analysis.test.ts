import { describe, expect, it } from 'vitest';
import { missionById } from '../src/data/missions';
import { whatIfs } from '../src/game/analysis';
import { autoPropellant, evaluate } from '../src/game/evaluate';
import { simulate } from '../src/game/simulate';
import { defaultDesign } from '../src/game/state';
import { directTransfer } from '../src/physics/porkchop';
import { isoToJD } from '../src/physics/time';

describe('what-if analysis', () => {
  it('suggests adding instruments to a rover that falls short on science', () => {
    const d = defaultDesign(missionById('mars'), 'normal');
    d.transfer = directTransfer('mars', isoToJD('2028-12-09'), 221);
    d.propellantKg = autoPropellant(d);
    const ev = evaluate(d);
    expect(ev.launchable).toBe(true);
    const sim = simulate(d, ev, 3, false);
    expect(sim.outcome).not.toBe('success');
    const w = whatIfs(d, sim, false);
    console.log('WHATIF', w.map((x) => `${x.label} +${x.delta} ${x.outcome}`).join(' | '));
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].delta).toBeGreaterThan(0);
    // every suggestion must itself be a launchable design
    for (const x of w) expect(evaluate(x.design).launchable).toBe(true);
  });
  it('same seed + same design = same flight (repeatable demos)', () => {
    const d = defaultDesign(missionById('mars'), 'normal');
    d.transfer = directTransfer('mars', isoToJD('2028-12-09'), 221);
    d.propellantKg = autoPropellant(d);
    const ev = evaluate(d);
    const a = simulate(d, ev, 7, false);
    const b = simulate(d, ev, 7, false);
    expect(a.events.map((e) => e.title)).toEqual(b.events.map((e) => e.title));
    expect(a.score.total).toBe(b.score.total);
  });
});

import { MISSIONS } from '../src/data/missions';
import { nasaPreset } from '../src/game/presets';

describe('science objectives', () => {
  it('every objective is reachable with the NASA-style design (moons with the moon tour)', () => {
    for (const m of MISSIONS) {
      for (const o of m.objectives) {
        const d = nasaPreset(m.id, 'normal');
        d.objectiveId = o.id;
        if (o.needsOrbit) {
          // the moon tour needs a lighter, nuclear-powered orbiter (see balance tests)
          Object.assign(d, { orbitId: o.needsOrbit, powerId: 'gphs2', shieldId: 'light', instruments: ['mag', 'cam', 'jiram', 'uvs'] });
        }
        d.propellantKg = autoPropellant(d);
        const ev = evaluate(d);
        console.log(`OBJ ${m.id}/${o.id}: science ${ev.science.potential.toFixed(0)} / ${m.scienceTarget}, launchable ${ev.launchable}`);
        expect(ev.launchable).toBe(true);
        expect(ev.science.potential).toBeGreaterThanOrEqual(m.scienceTarget);
      }
    }
  });
});
