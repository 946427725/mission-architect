export const GLOSSARY: Record<string, { term: string; text: string }> = {
  c3: { term: 'C3 (launch energy)', text: 'How much extra energy the rocket must give the spacecraft beyond what is needed to escape Earth, in km²/s². It equals the escape speed left over, squared. Higher C3 = the rocket can carry less mass.' },
  dv: { term: 'Δv (delta-v)', text: 'The total change in speed the spacecraft can make with its own engine. Like a fuel gauge measured in m/s. Set by the rocket equation: Δv = Isp × g₀ × ln(wet mass / dry mass).' },
  vinf: { term: 'v∞ (arrival speed)', text: 'How fast you approach the target planet before its gravity pulls you in. High v∞ means a harder braking burn - or a hotter atmospheric entry.' },
  porkchop: { term: 'Porkchop plot', text: 'A map of launch date vs. flight time, coloured by launch energy. Real NASA mission designers use it. The blobs look like pork chops - the centre is the cheapest time to go.' },
  rtg: { term: 'RTG', text: 'Radioisotope Thermoelectric Generator. Heat from decaying plutonium-238 is turned into electricity. Works in darkness and far from the Sun, but output slowly drops every year.' },
  hga: { term: 'High-gain antenna', text: 'A dish that focuses radio waves into a tight beam toward Earth. Data rate grows with the dish area, so doubling the diameter gives 4× the data.' },
  dsn: { term: 'Deep Space Network', text: "NASA's giant radio dishes in California, Spain and Australia. Bigger dishes (70 m) and more hours per day bring home more data - but cost more." },
  gravityassist: { term: 'Gravity assist', text: "Flying close to a planet to steal some of its orbital speed. Voyager, Cassini and New Horizons all used it to reach the outer solar system faster and cheaper." },
  window: { term: 'Launch window', text: 'Planets move, so the cheap paths only open when they line up. For Mars that happens every 26 months; for Jupiter every 13 months.' },
  isp: { term: 'Specific impulse (Isp)', text: 'Engine efficiency in seconds. Higher Isp = more Δv from the same propellant.' },
  krad: { term: 'krad (radiation dose)', text: 'Radiation energy absorbed by electronics. Ordinary space electronics fail after ~100 krad. Jupiter can deliver that in a few orbits.' },
  margin: { term: 'Margin', text: 'Spare capacity kept in reserve. Real missions always keep margins because things go wrong - and in this game, they will.' },
  au: { term: 'AU (astronomical unit)', text: 'The average Earth-Sun distance: 150 million km. Mars is ~1.5 AU from the Sun, Jupiter 5.2 AU, Pluto ~35-45 AU.' },
};

export const term = (key: string, label: string) => `<span class="term" data-term="${key}" tabindex="0">${label}</span>`;
