// Planet positions from NASA/JPL "Approximate Positions of the Planets"
// (E.M. Standish, JPL Solar System Dynamics), Table 1: Keplerian elements and
// their rates, valid 1800 AD - 2050 AD, referred to the J2000 ecliptic.
// https://ssd.jpl.nasa.gov/planets/approx_pos.html

import { AU, BodyId, DAY, MU_SUN } from './constants';
import { J2000 } from './time';
import { V3 } from './vec';

type Elements = [a: number, e: number, I: number, L: number, varpi: number, Omega: number];

// [elements at J2000, rates per Julian century]
const TABLE: Partial<Record<BodyId, [Elements, Elements]>> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
  pluto: [
    [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  ],
};

const D2R = Math.PI / 180;

export interface StateVector {
  r: V3; // km, heliocentric J2000 ecliptic
  v: V3; // km/s
}

interface OrbitalElements {
  a: number; // km
  e: number;
  I: number; // rad
  omega: number; // argument of perihelion, rad
  Omega: number; // longitude of ascending node, rad
  M: number; // mean anomaly, rad
}

export function elementsAt(body: BodyId, jd: number): OrbitalElements {
  const row = TABLE[body];
  if (!row) throw new Error(`No ephemeris for ${body}`);
  const [el, rate] = row;
  const T = (jd - J2000) / 36525;
  const a = (el[0] + rate[0] * T) * AU;
  const e = el[1] + rate[1] * T;
  const I = (el[2] + rate[2] * T) * D2R;
  const L = el[3] + rate[3] * T;
  const varpi = el[4] + rate[4] * T;
  const Omega = el[5] + rate[5] * T;
  let M = (L - varpi) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  return { a, e, I, omega: (varpi - Omega) * D2R, Omega: Omega * D2R, M: M * D2R };
}

export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 50; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

function rotate(x: number, y: number, el: OrbitalElements): V3 {
  const cw = Math.cos(el.omega), sw = Math.sin(el.omega);
  const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
  const cI = Math.cos(el.I), sI = Math.sin(el.I);
  return [
    (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y,
    (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y,
    sw * sI * x + cw * sI * y,
  ];
}

function stateFromElements(el: OrbitalElements, E: number): StateVector {
  const { a, e } = el;
  const b = a * Math.sqrt(1 - e * e);
  const n = Math.sqrt(MU_SUN / (a * a * a));
  const Edot = n / (1 - e * Math.cos(E));
  const r = rotate(a * (Math.cos(E) - e), b * Math.sin(E), el);
  const v = rotate(-a * Math.sin(E) * Edot, b * Math.cos(E) * Edot, el);
  return { r, v };
}

const cache = new Map<string, StateVector>();

/** Heliocentric position (km) and velocity (km/s) of a planet at Julian date jd. */
export function planetState(body: BodyId, jd: number): StateVector {
  const key = body + Math.round(jd * 1000);
  const hit = cache.get(key);
  if (hit) return hit;
  const el = elementsAt(body, jd);
  const s = stateFromElements(el, solveKepler(el.M, el.e));
  if (cache.size > 200000) cache.clear();
  cache.set(key, s);
  return s;
}

/** Points along a planet's full orbit (km), for drawing. */
export function orbitPath(body: BodyId, jd: number, n = 256): V3[] {
  const el = elementsAt(body, jd);
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const E = (i / n) * 2 * Math.PI;
    pts.push(stateFromElements(el, E).r);
  }
  return pts;
}

export function orbitalPeriodDays(body: BodyId, jd: number): number {
  const { a } = elementsAt(body, jd);
  return (2 * Math.PI * Math.sqrt((a * a * a) / MU_SUN)) / DAY;
}
