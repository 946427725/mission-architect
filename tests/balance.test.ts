import { describe, expect, it } from 'vitest';
import { missionById } from '../src/data/missions';
import { autoPropellant, evaluate } from '../src/game/evaluate';
import { simulate } from '../src/game/simulate';
import { Design, defaultDesign } from '../src/game/state';
import { computeGrid, directTransfer, transferAt } from '../src/physics/porkchop';
import { isoToJD } from '../src/physics/time';

const show = (label: string, d: Design) => {
  d.propellantKg = autoPropellant(d);
  const ev = evaluate(d);
  const fails = ev.checks.filter((c) => c.status !== 'ok').map((c) => `${c.status}:${c.id}: ${c.detail}`);
  const sim = ev.launchable ? simulate(d, ev, 42, false) : null;
  console.log(
    `\n== ${label}\n launch ${Math.round(ev.mass.launch)} kg cap ${Math.round(ev.mass.capacity ?? 0)} | power ${Math.round(ev.power.generated)}/${Math.round(ev.power.avgLoad)} W | dv ${(ev.dv.available * 1000).toFixed(0)}/${(ev.dv.required * 1000).toFixed(0)} | cost ${Math.round(ev.cost.total)}/${Math.round(ev.cost.cap)} | data ${(ev.data.fraction * 100).toFixed(0)}% | sci ${ev.science.potential.toFixed(0)} | ready ${ev.devYears.toFixed(1)}y`,
    '\n ' + fails.join('\n '),
    sim ? `\n => ${sim.outcome} score ${sim.score.total} ${sim.score.grade}` : '\n => NOT LAUNCHABLE',
  );
  return { ev, sim };
};

describe('balance', () => {
  it('Perseverance-like Mars design is launchable', () => {
    const m = missionById('mars');
    const d = defaultDesign(m, 'normal');
    d.transfer = directTransfer('mars', isoToJD('2031-03-20'), 220);
    Object.assign(d, { powerId: 'mmrtg', batteryId: 'bat-m', landingId: 'skycrane', rocketId: 'atlasv551', antennaId: 'hga15', avionicsId: 'dual', instruments: ['mastcam', 'supercam', 'pixl', 'sherloc', 'rimfax', 'meda', 'moxie', 'sampler', 'heli'] });
    const { ev } = show('Perseverance-like', d);
    const def = defaultDesign(m, 'normal');
    def.transfer = directTransfer('mars', isoToJD('2028-12-10'), 220);
    show('Mars default (2028)', def);
    const small = defaultDesign(m, 'normal');
    small.transfer = directTransfer('mars', isoToJD('2028-12-10'), 220);
    Object.assign(small, { instruments: ['mastcam', 'supercam', 'pixl', 'sherloc', 'rimfax'], batteryId: 'bat-m' });
    show('Mars small solar rover', small);
    expect(ev.mass.launch).toBeGreaterThan(2500);
  });

  it('Juno-like Jupiter design', () => {
    const m = missionById('jupiter');
    const d = defaultDesign(m, 'normal');
    d.transfer = directTransfer('jupiter', isoToJD('2030-01-28'), 900);
    Object.assign(d, { powerId: 'solar-l', shieldId: 'heavy', rocketId: 'falconheavy', antennaId: 'hga21', txId: 'tx25', dsnDish: 70, avionicsId: 'dual', instruments: ['mwr', 'mag', 'grav', 'cam', 'jiram', 'uvs', 'particles', 'waves'], propellantKg: 900, orbitId: 'polar14' });
    show('Juno-like', d);
    const def = defaultDesign(m, 'normal');
    def.transfer = directTransfer('jupiter', isoToJD('2030-01-28'), 900);
    show('Jupiter default', def);
  });

  it('New Horizons-like Pluto design', async () => {
    const m = missionById('pluto');
    const d = defaultDesign(m, 'normal');
    const g = await computeGrid({ ...m.grids.jga!, launchStartJD: isoToJD('2030-06-01') });
    const tr = transferAt(g, g.best!.ix, g.best!.iy);
    console.log('JGA best launch', tr && new Date((tr.launchJD - 2440587.5) * 864e5).toISOString().slice(0, 10), 'tof y', tr && (tr.tofDays / 365.25).toFixed(1));
    d.transfer = tr;
    d.trajectoryKind = 'jga';
    Object.assign(d, { powerId: 'gphs', rocketId: 'atlasv551s48', antennaId: 'hga21', txId: 'tx12', dsnDish: 70, avionicsId: 'dual', instruments: ['lorri', 'ralph', 'alice', 'rex', 'swap', 'pepssi', 'sdc'], propellantKg: 77, dsnHours: 24 });
    show('NH-like JGA ' + (tr ? tr.c3.toFixed(1) : 'null'), d);
    const def = defaultDesign(m, 'normal');
    def.transfer = tr;
    show('Pluto default', def);
  });
});
