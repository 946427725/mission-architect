// Real missions placed on the same launch-window chart, computed by the same
// engine, so players (and judges) can check the physics against history.
import { directTransfer, GridSpec, jgaTransfer, Transfer } from '../physics/porkchop';
import { isoToJD } from '../physics/time';

export interface HistoryCase {
  mission: string; // real NASA mission name
  spec: GridSpec;
  transfer: () => Transfer | null;
  rows: (tr: Transfer) => [label: string, real: string, engine: string][];
  note: string;
}

const L_M2020 = isoToJD('2020-07-30');
const A_M2020 = isoToJD('2021-02-18');
const L_NH = isoToJD('2006-01-19');
const J_NH = isoToJD('2007-02-28');
const P_NH = isoToJD('2015-07-14');

export const HISTORY: Record<string, HistoryCase | undefined> = {
  mars: {
    mission: 'Perseverance (Mars 2020)',
    spec: { kind: 'direct', target: 'mars', launchStartJD: isoToJD('2020-06-10'), launchEndJD: isoToJD('2020-09-20'), nx: 80, tofMinDays: 120, tofMaxDays: 360, ny: 70 },
    transfer: () => directTransfer('mars', L_M2020, A_M2020 - L_M2020),
    rows: (tr) => [
      ['Launch', '30 Jul 2020', '30 Jul 2020'],
      ['Landing', '18 Feb 2021', '18 Feb 2021'],
      ['Launch energy C3 (km²/s²)', '≈14.5', tr.c3.toFixed(1)],
      ['Arrival speed v∞ (km/s)', '≈2.6', tr.vinfArr.toFixed(2)],
    ],
    note: 'Same launch and landing dates as the real mission; the engine computes the energy and arrival speed from planet positions alone.',
  },
  pluto: {
    mission: 'New Horizons',
    spec: { kind: 'jga', target: 'pluto', launchStartJD: isoToJD('2005-11-01'), launchEndJD: isoToJD('2006-04-15'), nx: 40, tofMinDays: 6 * 365.25, tofMaxDays: 14 * 365.25, ny: 50 },
    transfer: () => jgaTransfer('pluto', L_NH, J_NH - L_NH, P_NH - J_NH),
    rows: (tr) => [
      ['Launch → Jupiter → Pluto', '19 Jan 2006 → 28 Feb 2007 → 14 Jul 2015', 'same dates'],
      ['Launch energy C3 (km²/s²)', '157.7', tr.c3.toFixed(1)],
      ['Closest approach to Jupiter', '≈32 Jupiter radii', `${tr.flyby!.rpRadii.toFixed(1)} Jupiter radii`],
      ['Speed past Pluto (km/s)', '13.8', tr.vinfArr.toFixed(2)],
    ],
    note: 'The engine finds the real gravity-assist geometry on its own: given only the three dates, it predicts the Jupiter flyby distance and the Pluto arrival speed.',
  },
  jupiter: undefined, // Juno used an Earth flyby (ΔV-EGA), which the game does not model
};
