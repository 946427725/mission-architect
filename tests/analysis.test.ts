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

describe('Mission Control decisions', () => {
  it('a call only changes the future: same luck before it, different outcome after', () => {
    const d = nasaPreset('pluto', 'normal');
    const ev = evaluate(d);
    const safe = simulate(d, ev, 7, false, { tcm: 'now', hazard: 'safe' });
    const close = simulate(d, ev, 7, false, { tcm: 'now', hazard: 'close' });
    const at = (s: typeof safe) => s.events.findIndex((e) => e.call?.id === 'hazard');
    const before = (s: typeof safe) => s.events.slice(0, at(s)).map((e) => `${e.jd.toFixed(1)} ${e.title}`);
    expect(before(safe)).toEqual(before(close));
    // the safe-haven path costs science; the close path keeps it unless the dust hits
    if (close.outcome !== 'failure') expect(close.science).toBeGreaterThan(safe.science);
  });
  it('every mission asks at least two calls, and unanswered calls use the safe default', () => {
    for (const id of ['mars', 'jupiter', 'pluto']) {
      const d = nasaPreset(id, 'normal');
      const s = simulate(d, evaluate(d), 3, false);
      const calls = s.events.filter((e) => e.call).map((e) => e.call!);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const c of calls) {
        expect(c.chosen).toBe(c.auto);
        expect(c.decided).toBe(false);
        expect(c.result.length).toBeGreaterThan(10);
      }
    }
  });
  it('skipping the course correction makes a Mars landing riskier, never safer', () => {
    const d = nasaPreset('mars', 'normal');
    const ev = evaluate(d);
    let lostNow = 0;
    let lostSkip = 0;
    for (let seed = 1; seed <= 400; seed++) {
      if (simulate(d, ev, seed, false, { tcm: 'now', site: 'delta' }).lostAt === 'landing') lostNow++;
      if (simulate(d, ev, seed, false, { tcm: 'skip', site: 'delta' }).lostAt === 'landing') lostSkip++;
    }
    expect(lostSkip).toBeGreaterThanOrEqual(lostNow);
  });
});

import { tutorialDesign } from '../src/game/presets';

describe('training mission', () => {
  it('starts with exactly two jobs: a launch date and a landing system for the heavy rover', () => {
    const ev = evaluate(tutorialDesign());
    const failing = ev.checks.filter((c) => c.status === 'fail').map((c) => c.id).sort();
    expect(failing).toEqual(['rover', 'traj']);
  });
  it('is ready to launch once the player does both jobs', () => {
    const d = { ...tutorialDesign(), landingId: 'skycrane', transfer: nasaPreset('mars', 'easy').transfer };
    expect(evaluate(d).launchable).toBe(true);
  });
});
