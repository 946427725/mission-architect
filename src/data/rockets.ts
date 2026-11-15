// Launch vehicles. Payload-vs-C3 curves are approximations built from public
// performance data (NASA Launch Services Program Launch Vehicle Performance
// Website, published mission launch masses). Costs are rounded public estimates.

export interface Rocket {
  id: string;
  name: string;
  costM: number; // $ million
  reliability: number; // historic success rate (rounded)
  curve: [c3: number, kg: number][];
  desc: string;
  flew: string;
  /** launch provider agency (Space Agency Partners are highlighted) */
  agency?: string;
}

export const ROCKETS: Rocket[] = [
  {
    id: 'falcon9',
    name: 'Falcon 9',
    costM: 70,
    reliability: 0.99,
    curve: [[0, 4000], [10, 2900], [20, 2050], [30, 1400], [40, 900], [50, 520], [60, 220], [70, 0]],
    desc: 'Cheap, reusable workhorse. Great for Mars-class energies, far too weak for the outer planets.',
    flew: 'Hundreds of missions incl. NASA science missions (IXPE, SWOT, PACE)',
  },
  {
    id: 'atlasv551',
    name: 'Atlas V 551',
    costM: 160,
    reliability: 0.995,
    curve: [[0, 6750], [10, 5500], [15, 4950], [20, 4450], [30, 3700], [40, 2950], [60, 1700], [80, 850], [100, 300], [110, 0]],
    desc: 'Proven and extremely reliable. Launched Juno (Jupiter) and New Horizons (Pluto).',
    flew: 'Juno, New Horizons, Perseverance (541 variant)',
  },
  {
    id: 'atlasv551s48',
    name: 'Atlas V 551 + Star 48B',
    costM: 190,
    reliability: 0.99,
    curve: [[0, 2400], [40, 2400], [60, 1800], [80, 1300], [100, 980], [120, 760], [140, 600], [160, 470], [180, 340], [200, 230], [230, 0]],
    desc: 'Adds a solid-rocket kick stage for extreme speeds. Only worth it for small, very fast probes.',
    flew: 'New Horizons - the fastest launch of any spacecraft (16.26 km/s)',
  },
  {
    id: 'falconheavy',
    name: 'Falcon Heavy (expendable)',
    costM: 150,
    reliability: 0.98,
    curve: [[0, 15000], [10, 12900], [20, 10600], [30, 8700], [40, 7100], [60, 4700], [80, 2900], [100, 1700], [120, 900], [140, 400], [160, 0]],
    desc: 'Three Falcon 9 cores. Heavy lift at a bargain price.',
    flew: 'Europa Clipper, Psyche',
  },
  {
    id: 'ariane64',
    name: 'Ariane 64',
    costM: 125,
    reliability: 0.95,
    curve: [[0, 7600], [10, 6200], [20, 4900], [30, 3800], [40, 2900], [60, 1500], [80, 600], [95, 0]],
    desc: "ESA's new heavy rocket with four solid boosters. Strong for Mars and Jupiter energies; still building its flight record.",
    flew: 'Ariane 6 first flew in 2024; its predecessor Ariane 5 launched ESA JUICE (Jupiter) and the James Webb Space Telescope',
    agency: 'ESA',
  },
  {
    id: 'h3',
    name: 'H3-24',
    costM: 55,
    reliability: 0.9,
    curve: [[0, 4300], [10, 3300], [20, 2500], [30, 1800], [40, 1200], [55, 500], [65, 0]],
    desc: "JAXA's new low-cost rocket (four solid boosters). Cheap, but lighter than Falcon 9 for deep-space energies.",
    flew: 'H3 launched in 2024-2025; its predecessor H-IIA launched Hayabusa2 and the SLIM Moon lander',
    agency: 'JAXA',
  },
  {
    id: 'sls',
    name: 'SLS Block 1',
    costM: 2500,
    reliability: 0.97,
    curve: [[0, 27000], [20, 19000], [40, 14000], [60, 10000], [80, 7200], [100, 5000], [120, 3500], [140, 2300], [160, 1300], [180, 600], [200, 0]],
    desc: "NASA's most powerful rocket. Enormous capability - and an enormous price tag.",
    flew: 'Artemis I',
  },
];

export const rocketById = (id: string) => ROCKETS.find((r) => r.id === id) ?? ROCKETS[0];

/** Max payload (kg) the rocket can send to a given launch energy C3 (km^2/s^2). */
export function payloadAt(rocket: Rocket, c3: number): number {
  const c = rocket.curve;
  if (c3 <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (c3 <= c[i][0]) {
      const [x0, y0] = c[i - 1];
      const [x1, y1] = c[i];
      return y0 + ((y1 - y0) * (c3 - x0)) / (x1 - x0);
    }
  }
  return 0;
}
