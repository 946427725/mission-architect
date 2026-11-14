// Physical constants. Sources: NASA/JPL Solar System Dynamics (ssd.jpl.nasa.gov)
// and the NASA Planetary Fact Sheets (nssdc.gsfc.nasa.gov/planetary/factsheet).

export const MU_SUN = 1.32712440018e11; // km^3/s^2
export const AU = 149597870.7; // km
export const DAY = 86400; // s
export const YEAR_DAYS = 365.25;
export const G0 = 9.80665; // m/s^2, standard gravity (rocket equation)
export const SOLAR_CONSTANT = 1361; // W/m^2 at 1 AU

export type BodyId =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto';

export interface BodyInfo {
  id: BodyId;
  name: string;
  mu: number; // km^3/s^2
  radius: number; // km (equatorial)
  color: string;
}

export const BODIES: Record<BodyId, BodyInfo> = {
  mercury: { id: 'mercury', name: 'Mercury', mu: 22031.86, radius: 2440.5, color: '#9a9a9a' },
  venus: { id: 'venus', name: 'Venus', mu: 324858.59, radius: 6051.8, color: '#e3c27a' },
  earth: { id: 'earth', name: 'Earth', mu: 398600.4418, radius: 6378.1, color: '#4f8fe6' },
  mars: { id: 'mars', name: 'Mars', mu: 42828.37, radius: 3396.2, color: '#d0603a' },
  jupiter: { id: 'jupiter', name: 'Jupiter', mu: 126686534, radius: 71492, color: '#d8b48a' },
  saturn: { id: 'saturn', name: 'Saturn', mu: 37931187, radius: 60268, color: '#e6d39a' },
  uranus: { id: 'uranus', name: 'Uranus', mu: 5793939, radius: 25559, color: '#9fe3e8' },
  neptune: { id: 'neptune', name: 'Neptune', mu: 6836529, radius: 24764, color: '#4a6fe3' },
  pluto: { id: 'pluto', name: 'Pluto', mu: 869.6, radius: 1188.3, color: '#d9c3a5' },
};
