import { BodyId } from '../physics/constants';
import { GridSpec } from '../physics/porkchop';
import { isoToJD } from '../physics/time';

export interface Instrument {
  id: string;
  name: string;
  analog: string; // the real NASA instrument it is modelled on
  desc: string;
  mass: number; // kg
  power: number; // W while operating
  costM: number;
  data: number; // lander/orbiter: Mbit per day; flyby: Gbit for the whole encounter
  science: number; // science value points
  needsHGA?: boolean;
  outreach?: boolean;
}

export interface NasaReference {
  name: string;
  facts: [label: string, value: string][];
  lesson: string;
  url: string;
}

export type MissionType = 'lander' | 'orbiter' | 'flyby';

export interface MissionDef {
  id: string;
  name: string;
  target: BodyId;
  type: MissionType;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  tagline: string;
  brief: string;
  objective: string;
  budgetCapM: number;
  busMass: number; // kg structure/thermal/attitude control/propulsion hardware
  busCostM: number;
  busPowerW: number; // baseline electrical load
  isp: number; // s, spacecraft main engine
  tcmDv: number; // km/s, trajectory corrections
  devBaseYears: number;
  cruiseOpsM: number; // $M per year
  scienceOpsM: number; // $M per year
  primaryDays: number; // science phase (flyby: downlink period)
  maxTofDays: number;
  scienceTarget: number;
  grids: Partial<Record<'direct' | 'jga', GridSpec>>;
  powerIds: string[];
  instruments: Instrument[];
  defaults: {
    powerId: string;
    instruments: string[];
    antennaId: string;
    txId: string;
    propellantKg: number;
    landingId?: string;
    orbitId?: string;
    rocketId: string;
    shieldId?: string;
    dsnDish?: 34 | 70;
    dsnHours?: number;
  };
  nasa: NasaReference;
  hints: Record<'trajectory' | 'spacecraft' | 'science' | 'comms' | 'launch', string>;
}

const START = isoToJD('2027-01-01');

export const MISSIONS: MissionDef[] = [
  {
    id: 'mars',
    name: 'Red Horizon',
    target: 'mars',
    type: 'lander',
    level: 'Beginner',
    tagline: 'Land a rover on Mars and search for signs of ancient life.',
    brief:
      'Billions of years ago Mars had rivers and lakes. Your mission: deliver a rover safely to the surface and study the rocks for one full Mars year (687 days).',
    objective: 'Land safely and collect at least 100 science points in one Mars year.',
    budgetCapM: 2800,
    busMass: 540, // cruise stage
    busCostM: 720,
    busPowerW: 55,
    isp: 230,
    tcmDv: 0.05,
    devBaseYears: 1.4,
    cruiseOpsM: 20,
    scienceOpsM: 70,
    primaryDays: 687,
    maxTofDays: 480,
    scienceTarget: 100,
    grids: {
      direct: { kind: 'direct', target: 'mars', launchStartJD: START, launchEndJD: isoToJD('2031-09-01'), nx: 160, tofMinDays: 120, tofMaxDays: 480, ny: 90 },
    },
    powerIds: ['solar-s', 'solar-m', 'mmrtg'],
    instruments: [
      { id: 'mastcam', name: 'Stereo zoom cameras', analog: 'Mastcam-Z', desc: '3D colour panoramas to choose where to drive and what to study.', mass: 4, power: 17, costM: 25, data: 150, science: 14, outreach: true },
      { id: 'supercam', name: 'Laser rock zapper', analog: 'SuperCam', desc: 'Vaporises rock 7 m away and reads its chemistry from the flash.', mass: 11, power: 18, costM: 50, data: 80, science: 18 },
      { id: 'pixl', name: 'X-ray chemistry mapper', analog: 'PIXL', desc: 'Maps elements grain-by-grain - looks for textures life could leave.', mass: 7, power: 25, costM: 40, data: 40, science: 16 },
      { id: 'sherloc', name: 'Organics scanner', analog: 'SHERLOC', desc: 'UV laser that detects organic molecules, the building blocks of life.', mass: 5, power: 48, costM: 45, data: 40, science: 20 },
      { id: 'rimfax', name: 'Ground-penetrating radar', analog: 'RIMFAX', desc: 'Sees 10 m underground: buried layers, ice and old riverbeds.', mass: 3, power: 10, costM: 20, data: 20, science: 10 },
      { id: 'meda', name: 'Weather station', analog: 'MEDA', desc: 'Wind, dust, temperature and radiation for future human visitors.', mass: 6, power: 17, costM: 15, data: 10, science: 8 },
      { id: 'moxie', name: 'Oxygen-from-air experiment', analog: 'MOXIE', desc: 'Makes breathable oxygen from Martian CO₂. Hungry for power.', mass: 17, power: 300, costM: 50, data: 1, science: 12 },
      { id: 'sampler', name: 'Sample caching system', analog: 'Perseverance sampling system', desc: 'Drills and seals rock cores for a future return to Earth. Huge science, huge mass.', mass: 45, power: 40, costM: 250, data: 5, science: 35 },
      { id: 'heli', name: 'Scout helicopter', analog: 'Ingenuity', desc: 'First aircraft on another world. Scouts routes ahead of the rover.', mass: 2, power: 10, costM: 85, data: 30, science: 12, outreach: true },
    ],
    defaults: { powerId: 'solar-s', instruments: ['mastcam', 'supercam'], antennaId: 'hga15', txId: 'tx12', propellantKg: 70, landingId: 'airbags', rocketId: 'falcon9' },
    nasa: {
      name: 'Perseverance (Mars 2020)',
      facts: [
        ['Launch', '30 Jul 2020, Atlas V 541'],
        ['Landing', '18 Feb 2021, Jezero Crater'],
        ['Launch energy (C3)', '≈14.5 km²/s² (our engine: 14.4)'],
        ['Launch mass', '≈4,000 kg (rover 1,025 kg)'],
        ['Power', 'MMRTG, 110 W'],
        ['Landing system', 'Sky crane'],
        ['Cost', '≈$2.7 billion'],
      ],
      lesson: 'NASA picked an MMRTG because Opportunity proved solar rovers can die in global dust storms (2018).',
      url: 'https://science.nasa.gov/mission/mars-2020-perseverance/',
    },
    hints: {
      trajectory: 'Mars and Earth line up every 26 months. Dark blue islands on the plot are launch windows - outside them no rocket is strong enough. Fast trips hit Mars faster, which the heat shield may not survive.',
      spacecraft: 'Your landing system limits how heavy the rover can be. Airbags are cheap but only for small rovers. Solar is light but dust storms are real.',
      science: 'Every instrument adds science - and mass, power, cost and data. You need 100 science points.',
      comms: 'Mars rovers send most data through relay orbiters overhead (UHF). Make sure your instruments do not produce more data than you can send home.',
      launch: 'Pick a rocket that can lift your launch mass at your launch energy (C3). Cheaper rockets carry less.',
    },
  },
  {
    id: 'jupiter',
    name: "Giant's Heart",
    target: 'jupiter',
    type: 'orbiter',
    level: 'Intermediate',
    tagline: "Orbit Jupiter and map what's hiding beneath its clouds.",
    brief:
      "Jupiter is a giant ball of hydrogen wrapped in deadly radiation belts. Your orbiter must survive the radiation, make enough power 5 AU from the Sun, and dive close to the cloud tops again and again.",
    objective: 'Enter Jupiter orbit and collect at least 100 science points in a 2-year science phase.',
    budgetCapM: 1600,
    busMass: 1000,
    busCostM: 450,
    busPowerW: 220,
    isp: 317,
    tcmDv: 0.1,
    devBaseYears: 2.4,
    cruiseOpsM: 15,
    scienceOpsM: 45,
    primaryDays: 730,
    maxTofDays: 2400,
    scienceTarget: 100,
    grids: {
      direct: { kind: 'direct', target: 'jupiter', launchStartJD: START, launchEndJD: isoToJD('2034-12-31'), nx: 150, tofMinDays: 500, tofMaxDays: 2200, ny: 85 },
    },
    powerIds: ['solar-m', 'solar-l', 'gphs', 'gphs2'],
    instruments: [
      { id: 'mwr', name: 'Microwave radiometer', analog: 'Juno MWR', desc: 'Sees hundreds of km below the clouds - how much water is inside Jupiter?', mass: 42, power: 40, costM: 60, data: 60, science: 22 },
      { id: 'mag', name: 'Magnetometer', analog: 'Juno MAG', desc: "Maps Jupiter's magnetic field and its hidden dynamo.", mass: 7, power: 12, costM: 20, data: 30, science: 18 },
      { id: 'grav', name: 'Gravity science radio', analog: 'Juno Gravity Science', desc: 'Tiny Doppler shifts reveal whether Jupiter has a solid core. Needs a high-gain dish.', mass: 10, power: 25, costM: 25, data: 2, science: 20, needsHGA: true },
      { id: 'cam', name: 'Colour camera', analog: 'JunoCam', desc: 'Stunning close-ups for the public - and for storm science.', mass: 2, power: 6, costM: 10, data: 400, science: 10, outreach: true },
      { id: 'jiram', name: 'Infrared mapper', analog: 'JIRAM', desc: 'Heat maps of auroras and deep storms.', mass: 12, power: 17, costM: 30, data: 250, science: 15 },
      { id: 'uvs', name: 'Ultraviolet spectrograph', analog: 'Juno UVS', desc: 'Watches the giant auroras glow.', mass: 10, power: 10, costM: 25, data: 50, science: 12 },
      { id: 'particles', name: 'Particle detectors', analog: 'JADE + JEDI', desc: 'Samples the charged particles that power the auroras.', mass: 30, power: 30, costM: 45, data: 120, science: 16 },
      { id: 'waves', name: 'Radio & plasma waves', analog: 'Juno Waves', desc: 'Listens to the radio "sounds" of the magnetosphere.', mass: 8, power: 10, costM: 20, data: 40, science: 10 },
    ],
    defaults: { powerId: 'solar-l', instruments: ['mwr', 'mag', 'cam'], antennaId: 'hga21', txId: 'tx25', propellantKg: 700, orbitId: 'polar53', rocketId: 'falconheavy', shieldId: 'light' },
    nasa: {
      name: 'Juno',
      facts: [
        ['Launch', '5 Aug 2011, Atlas V 551'],
        ['Route', 'Earth flyby in Oct 2013 (ΔV-EGA trick)'],
        ['Arrival', '4 Jul 2016'],
        ['Launch mass', '3,625 kg'],
        ['Power', '3 solar wings, ~60 m², ≈500 W at Jupiter'],
        ['Radiation', '200 kg titanium vault'],
        ['Orbit', '53-day polar (planned 14-day; engine valve issue)'],
        ['Cost', '≈$1.1 billion'],
      ],
      lesson: 'A direct trip needs C3 ≈ 80. Juno launched with C3 ≈ 31 and swung past Earth two years later to gain speed - so a cheaper Atlas V could do the job.',
      url: 'https://science.nasa.gov/mission/juno/',
    },
    hints: {
      trajectory: 'Jupiter windows come every 13 months. Reaching Jupiter directly needs a lot of launch energy (C3 ≈ 80) - check which rockets can handle that.',
      spacecraft: 'At 5.2 AU sunlight is 27× weaker than at Earth. Jupiter\'s radiation fries unshielded electronics in a few orbits. The orbit you choose sets how big the arrival burn is.',
      science: 'More close passes = more science, but every pass soaks up radiation.',
      comms: 'Jupiter is ~5 AU from Earth. Data rate drops with distance squared - a bigger dish and stronger transmitter help.',
      launch: "Heavier spacecraft or bigger arrival burns may need a heavy-lift rocket. Watch your budget!",
    },
  },
  {
    id: 'pluto',
    name: 'Edge of Light',
    target: 'pluto',
    type: 'flyby',
    level: 'Advanced',
    tagline: 'Race to Pluto and reveal a world at the edge of the solar system.',
    brief:
      'Pluto is 40 times farther from the Sun than Earth. There is no time to slow down - you get one high-speed flyby, then must squeeze every bit of data home across 5 billion km.',
    objective: 'Fly past Pluto within 16 years of launch and return at least 100 science points.',
    budgetCapM: 1200,
    busMass: 280,
    busCostM: 260,
    busPowerW: 120,
    isp: 230,
    tcmDv: 0.15,
    devBaseYears: 1.6,
    cruiseOpsM: 8,
    scienceOpsM: 25,
    primaryDays: 730,
    maxTofDays: 16 * 365.25,
    scienceTarget: 100,
    grids: {
      direct: { kind: 'direct', target: 'pluto', launchStartJD: START, launchEndJD: isoToJD('2034-01-01'), nx: 110, tofMinDays: 5 * 365.25, tofMaxDays: 20 * 365.25, ny: 75 },
      jga: { kind: 'jga', target: 'pluto', launchStartJD: START, launchEndJD: isoToJD('2034-01-01'), nx: 110, tofMinDays: 5 * 365.25, tofMaxDays: 18 * 365.25, ny: 65 },
    },
    powerIds: ['solar-l', 'mmrtg', 'gphs'],
    instruments: [
      { id: 'lorri', name: 'Long-range telescope camera', analog: 'LORRI', desc: 'Sharp black-and-white images from far away - mountains, craters, glaciers.', mass: 9, power: 5, costM: 25, data: 12, science: 18, outreach: true },
      { id: 'ralph', name: 'Colour & infrared mapper', analog: 'Ralph', desc: 'Colour maps and the ices on the surface (nitrogen, methane, water).', mass: 11, power: 7, costM: 40, data: 18, science: 22 },
      { id: 'alice', name: 'UV spectrometer', analog: 'Alice', desc: "Tastes Pluto's thin atmosphere as starlight shines through it.", mass: 4.5, power: 4, costM: 25, data: 4, science: 15 },
      { id: 'rex', name: 'Radio science experiment', analog: 'REX', desc: "Uses the dish to measure Pluto's atmosphere and temperature. Needs a high-gain dish.", mass: 0.5, power: 2, costM: 8, data: 0.5, science: 12, needsHGA: true },
      { id: 'swap', name: 'Solar wind analyser', analog: 'SWAP', desc: 'How does Pluto interact with the solar wind?', mass: 3.3, power: 2.3, costM: 12, data: 1, science: 8 },
      { id: 'pepssi', name: 'Energetic particle sensor', analog: 'PEPSSI', desc: 'Detects atoms escaping from Pluto\'s atmosphere.', mass: 1.5, power: 2.5, costM: 12, data: 1, science: 8 },
      { id: 'sdc', name: 'Student dust counter', analog: 'Venetia Burney SDC', desc: 'Built by university students! Counts dust grains across the whole solar system.', mass: 1.9, power: 5, costM: 5, data: 0.2, science: 6, outreach: true },
    ],
    defaults: { powerId: 'gphs', instruments: ['lorri', 'ralph'], antennaId: 'hga21', txId: 'tx12', propellantKg: 60, rocketId: 'atlasv551s48', dsnDish: 70, dsnHours: 8 },
    nasa: {
      name: 'New Horizons',
      facts: [
        ['Launch', '19 Jan 2006, Atlas V 551 + Star 48B'],
        ['Launch energy (C3)', '157.7 km²/s² (our engine: 158.8)'],
        ['Jupiter flyby', '28 Feb 2007 at 32 Jupiter radii (our engine: 32.6)'],
        ['Pluto flyby', '14 Jul 2015 at 13.8 km/s (our engine: 13.79)'],
        ['Mass', '478 kg'],
        ['Power', 'GPHS-RTG, 245 W at launch, ≈200 W at Pluto'],
        ['Data', '≈50 Gbit took ~15 months to downlink at 1-2 kbit/s'],
        ['Cost', '≈$700 million'],
      ],
      lesson: 'The Jupiter gravity assist cut 3 years off the trip. Solar power was impossible: Pluto was 33 AU from the Sun in 2015, where sunlight is ~1,100× weaker than at Earth.',
      url: 'https://science.nasa.gov/mission/new-horizons/',
    },
    hints: {
      trajectory: 'Try both routes! A direct shot needs enormous launch energy. A Jupiter gravity assist steals speed from Jupiter - but only works when Jupiter is in the right place.',
      spacecraft: 'In the 2040s Pluto is ~40 AU from the Sun: solar panels there make ~1/1,600 of their Earth power. RTG output also decays every year of the long cruise.',
      science: 'Every gram counts: a lighter probe can be launched faster. Pick the instruments that give the most science per kg.',
      comms: "At 5 billion km your data trickles home at ~1 kbit/s. Without enough antenna, transmitter and Deep Space Network time, you'll never get your photos.",
      launch: 'Extreme launch energies need a kick stage. The lighter the probe, the faster you can throw it.',
    },
  },
];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
