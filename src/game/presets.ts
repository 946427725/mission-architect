// "Fly NASA's design": designs modelled on the real missions. They are also the
// reference designs in tests/balance.test.ts, so they are known to be flyable.
import { missionById } from '../data/missions';
import { directTransfer, jgaTransfer } from '../physics/porkchop';
import { isoToJD } from '../physics/time';
import { autoPropellant } from './evaluate';
import { Design, Difficulty, defaultDesign } from './state';

export const NASA_PRESET_NAME: Record<string, string> = {
  mars: 'Perseverance-style rover',
  jupiter: 'Juno-style orbiter',
  pluto: 'New Horizons-style probe',
};

export function nasaPreset(missionId: string, difficulty: Difficulty): Design {
  const m = missionById(missionId);
  const d = defaultDesign(m, difficulty);
  d.programEvent = { id: 'none', title: '', text: '', budgetDeltaM: 0, costDeltaM: 0 };
  if (m.id === 'mars') {
    d.transfer = directTransfer('mars', isoToJD('2031-01-28'), 193);
    Object.assign(d, {
      powerId: 'mmrtg', batteryId: 'bat-m', landingId: 'skycrane', rocketId: 'atlasv551', antennaId: 'hga15', avionicsId: 'single',
      instruments: ['mastcam', 'supercam', 'pixl', 'sherloc', 'rimfax', 'meda', 'moxie', 'sampler', 'heli'],
    });
  } else if (m.id === 'jupiter') {
    d.transfer = directTransfer('jupiter', isoToJD('2031-02-24'), 767);
    Object.assign(d, {
      powerId: 'solar-l', shieldId: 'heavy', rocketId: 'falconheavy', antennaId: 'hga21', txId: 'tx25', dsnDish: 70, avionicsId: 'dual',
      instruments: ['mwr', 'mag', 'grav', 'cam', 'jiram', 'uvs', 'particles'], orbitId: 'polar14',
    });
  } else {
    d.trajectoryKind = 'jga';
    // Earth Jan 2030 -> Jupiter flyby (500 days) -> Pluto (11.6 years): found by the in-game launch-window search
    d.transfer = jgaTransfer('pluto', 2462524.653846154, 500, 4239.71484375);
    Object.assign(d, {
      powerId: 'gphs', rocketId: 'atlasv551s48', antennaId: 'hga21', txId: 'tx12', dsnDish: 70, dsnHours: 24, avionicsId: 'single',
      instruments: ['lorri', 'ralph', 'alice', 'rex', 'swap', 'pepssi', 'sdc'],
    });
  }
  d.propellantKg = autoPropellant(d);
  return d;
}
