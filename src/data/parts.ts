// Spacecraft subsystems. Values are rounded from public NASA mission data and
// are meant to preserve real-world trade-offs, not to be flight-qualified.

export interface PowerOption {
  id: string;
  name: string;
  kind: 'solar' | 'rtg' | 'none';
  watts: number; // solar: at 1 AU; RTG: at launch
  decayPerYear: number; // fractional output loss per year
  mass: number;
  costM: number;
  devYears: number;
  desc: string;
}

export const POWER: PowerOption[] = [
  { id: 'solar-s', name: 'Small solar array (4 m²)', kind: 'solar', watts: 1200, decayPerYear: 0.01, mass: 30, costM: 8, devYears: 0, desc: 'Light and cheap. Sunlight weakens with distance squared - at Mars you get 43%, at Jupiter just 3.7%.' },
  { id: 'solar-m', name: 'Medium solar array (10 m²)', kind: 'solar', watts: 3000, decayPerYear: 0.01, mass: 70, costM: 18, devYears: 0, desc: 'A typical Mars orbiter array.' },
  { id: 'solar-l', name: 'Giant solar wings (60 m², Juno-class)', kind: 'solar', watts: 14000, decayPerYear: 0.012, mass: 340, costM: 45, devYears: 0.3, desc: 'Three 9-metre wings. Juno proved solar can work at Jupiter - but only just (~500 W).' },
  { id: 'mmrtg', name: 'MMRTG nuclear battery', kind: 'rtg', watts: 110, decayPerYear: 0.025, mass: 45, costM: 110, devYears: 0.5, desc: 'Plutonium-238 heat → electricity, day and night, dust or no dust. Powers Curiosity and Perseverance.' },
  { id: 'gphs', name: 'GPHS-RTG nuclear battery', kind: 'rtg', watts: 245, decayPerYear: 0.02, mass: 56, costM: 150, devYears: 0.6, desc: 'The RTG that powered New Horizons, Cassini and Galileo. Works at any distance from the Sun.' },
  { id: 'gphs2', name: '2× GPHS-RTG', kind: 'rtg', watts: 490, decayPerYear: 0.02, mass: 112, costM: 300, devYears: 0.8, desc: 'Double the plutonium. Very expensive - NASA only has a small plutonium-238 supply.' },
];

export interface BatteryOption { id: string; name: string; wh: number; mass: number; costM: number; }
export const BATTERIES: BatteryOption[] = [
  { id: 'bat-s', name: 'Small Li-ion (1 kWh)', wh: 1000, mass: 8, costM: 1 },
  { id: 'bat-m', name: 'Medium Li-ion (2.5 kWh)', wh: 2500, mass: 20, costM: 3 },
  { id: 'bat-l', name: 'Large Li-ion (6 kWh)', wh: 6000, mass: 45, costM: 6 },
];

export interface AntennaOption { id: string; name: string; diameter: number; mass: number; costM: number; desc: string; }
export const ANTENNAS: AntennaOption[] = [
  { id: 'lga', name: 'Low-gain antenna only', diameter: 0.25, mass: 2, costM: 1, desc: 'Works in any direction, but data trickles back.' },
  { id: 'hga15', name: 'High-gain dish 1.5 m', diameter: 1.5, mass: 12, costM: 6, desc: 'Must be pointed at Earth. ~36× more data than a 0.25 m antenna.' },
  { id: 'hga21', name: 'High-gain dish 2.1 m (New Horizons)', diameter: 2.1, mass: 20, costM: 9, desc: 'Data rate grows with dish area: 2× bigger dish → 4× more data.' },
  { id: 'hga30', name: 'High-gain dish 3.0 m (MRO)', diameter: 3.0, mass: 35, costM: 15, desc: 'Big and heavy, but a data firehose.' },
];

export interface TransmitterOption { id: string; name: string; rfW: number; dcW: number; mass: number; costM: number; }
export const TRANSMITTERS: TransmitterOption[] = [
  { id: 'tx5', name: '5 W radio', rfW: 5, dcW: 14, mass: 2, costM: 2 },
  { id: 'tx12', name: '12 W TWTA (New Horizons)', rfW: 12, dcW: 30, mass: 3, costM: 4 },
  { id: 'tx25', name: '25 W TWTA (Juno)', rfW: 25, dcW: 60, mass: 4, costM: 6 },
  { id: 'tx100', name: '100 W TWTA (MRO)', rfW: 100, dcW: 220, mass: 9, costM: 12 },
];

export interface AvionicsOption { id: string; name: string; redundant: boolean; mass: number; costM: number; devYears: number; desc: string; }
export const AVIONICS: AvionicsOption[] = [
  { id: 'single', name: 'Single-string computer', redundant: false, mass: 0, costM: 0, devYears: 0, desc: 'One of everything. If a part fails, there is no backup.' },
  { id: 'dual', name: 'Dual-string (fully redundant)', redundant: true, mass: 30, costM: 40, devYears: 0.2, desc: 'Backup computer, reaction wheels and radios. NASA flagship standard.' },
];

export interface ShieldOption { id: string; name: string; factor: number; mass: number; costM: number; desc: string; }
export const SHIELDS: ShieldOption[] = [
  { id: 'none', name: 'No radiation vault', factor: 1, mass: 0, costM: 0, desc: 'Electronics exposed to the full radiation environment.' },
  { id: 'light', name: 'Light titanium vault (100 kg)', factor: 0.25, mass: 100, costM: 30, desc: 'Cuts radiation dose to 25%.' },
  { id: 'heavy', name: 'Heavy titanium vault (200 kg, Juno)', factor: 0.08, mass: 200, costM: 50, desc: "Juno's 1 cm-thick titanium box. Cuts dose to ~8%." },
];

export interface LandingOption {
  id: string;
  name: string;
  chassis: number; // rover structure + mobility (kg)
  maxRover: number; // max rover mass (kg) this system can land
  edlMass: number; // aeroshell + heat shield + descent system (kg)
  costM: number;
  devYears: number;
  risk: number; // landing failure probability
  desc: string;
}
export const LANDINGS: LandingOption[] = [
  { id: 'airbags', name: 'Airbag bounce (Spirit & Opportunity)', chassis: 120, maxRover: 230, edlMass: 650, costM: 250, devYears: 0, risk: 0.04, desc: 'Cheap and tough, but only for small rovers (under ~230 kg).' },
  { id: 'retro', name: 'Rocket-powered platform (Phoenix style)', chassis: 220, maxRover: 450, edlMass: 1150, costM: 420, devYears: 0.3, risk: 0.06, desc: 'Lands a medium rover on throttled engines.' },
  { id: 'skycrane', name: 'Sky crane (Curiosity & Perseverance)', chassis: 560, maxRover: 1150, edlMass: 2400, costM: 700, devYears: 0.6, risk: 0.03, desc: 'A rocket backpack lowers the rover on cables. Lands up to ~1 tonne precisely.' },
];

export interface OrbitOption {
  id: string;
  name: string;
  periodDays: number;
  rpRadii: number; // periapsis in planet radii
  dosePerOrbit: number; // krad behind no shielding
  moonBonus: number; // extra science points
  desc: string;
}
export const JUPITER_ORBITS: OrbitOption[] = [
  { id: 'polar53', name: 'Wide polar orbit (53 days)', periodDays: 53.5, rpRadii: 1.06, dosePerOrbit: 15, moonBonus: 0, desc: 'Cheap to enter, dives under the radiation belts at closest approach. Few close passes.' },
  { id: 'polar14', name: 'Tight polar orbit (14 days)', periodDays: 14, rpRadii: 1.06, dosePerOrbit: 15, moonBonus: 0, desc: "Juno's original plan: 4× more close passes, but needs a bigger engine burn." },
  { id: 'tour', name: 'Equatorial moon tour (Galileo style)', periodDays: 40, rpRadii: 6, dosePerOrbit: 40, moonBonus: 25, desc: 'Flies past Io, Europa and Ganymede - but straight through the harshest radiation.' },
];

export const RADIATION_TOLERANCE_KRAD = 100;
