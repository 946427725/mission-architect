// Where the numbers come from. Shown as "Data" chips on every station panel,
// in the report, and on the Data & Validation screen, so players (and judges)
// can follow each number back to NASA and partner-agency sources.

export interface Source {
  label: string;
  url: string;
}

const JPL_POS: Source = { label: 'NASA/JPL planet positions (E. M. Standish)', url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html' };
const FACTS: Source = { label: 'NASA Planetary Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/' };
const LSP: Source = { label: 'NASA Launch Services Program: rocket performance', url: 'https://elvperf.ksc.nasa.gov/' };
const RPS: Source = { label: 'NASA Radioisotope Power Systems (MMRTG 110 W)', url: 'https://science.nasa.gov/planetary-science/programs/radioisotope-power-systems/' };
const DSN: Source = { label: 'NASA Deep Space Network', url: 'https://www.nasa.gov/communicating-with-missions/dsn/' };
const M2020: Source = { label: 'NASA Mars 2020 Perseverance', url: 'https://science.nasa.gov/mission/mars-2020-perseverance/' };
const JUNO: Source = { label: 'NASA Juno', url: 'https://science.nasa.gov/mission/juno/' };
const NH: Source = { label: 'NASA New Horizons', url: 'https://science.nasa.gov/mission/new-horizons/' };
const ESA_A6: Source = { label: 'ESA Ariane 6', url: 'https://www.esa.int/Enabling_Support/Space_Transportation/Ariane' };
const JAXA_H3: Source = { label: 'JAXA H3', url: 'https://global.jaxa.jp/projects/rockets/h3/' };

const MISSION_PAGE: Record<string, Source> = { mars: M2020, jupiter: JUNO, pluto: NH };

/** Sources behind a high-bay station, for the mission being designed. */
export function stationSources(station: string, missionId: string): Source[] {
  const mission = MISSION_PAGE[missionId] ?? M2020;
  switch (station) {
    case 'flight':
      return [JPL_POS, mission];
    case 'rockets':
      return [LSP, ESA_A6, JAXA_H3];
    case 'power':
      return [RPS, FACTS];
    case 'systems':
      return missionId === 'jupiter' ? [JUNO, RPS] : [mission];
    case 'fuel':
      return [mission, FACTS];
    case 'landing':
      return [M2020, FACTS];
    case 'orbit':
      return [JUNO, FACTS];
    case 'science':
      return [mission];
    case 'comms':
    case 'ops':
      return [DSN, mission];
    default:
      return [mission, JPL_POS];
  }
}

/** Credits for the real planet images used in the 3D views. */
export const IMAGE_CREDITS: Record<string, Source> = {
  earth: { label: 'Earth: NASA Blue Marble (Reto Stöckli, NASA GSFC)', url: 'https://visibleearth.nasa.gov/view.php?id=57752' },
  mars: { label: 'Mars: NASA Viking color mosaic (USGS Astrogeology)', url: 'https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m' },
  jupiter: { label: 'Jupiter: NASA/JPL/Space Science Institute, Cassini (PIA07782)', url: 'https://photojournal.jpl.nasa.gov/catalog/PIA07782' },
  pluto: { label: 'Pluto: NASA/JHUAPL/SwRI, New Horizons global color map', url: 'https://science.nasa.gov/mission/new-horizons/' },
};
