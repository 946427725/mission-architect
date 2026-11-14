# Mission Architect

**Design a real space mission. Physics decides if it works.**

A browser game for the NASA Space Apps Challenge 2026 *Space Mission Design Game* challenge. Players (solo or a team of up to 4) design a complete interplanetary mission: launch window, spacecraft, instruments, communications, budget and rocket. Then they fly it in 3D, survive random events, and get a post-mission report explaining *why* it succeeded or failed, compared with the real NASA mission.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics validation + balance tests
npm run build      # static site in dist/ (deploy anywhere: Vercel, Netlify, GitHub Pages)
npm run build:single  # one self-contained file: single/index.html
```

**Live version:** https://claude.ai/artifact/S6cNjbgRuS74XyF7oGuxqG (private until shared from its Share menu).
For judges, a fully public host is safest: on a laptop where you're logged in, run `npx vercel deploy dist --prod`, or drag `dist/` onto app.netlify.com/drop.

## The three missions

| Mission | Target | Level | Real NASA comparison |
|---|---|---|---|
| Red Horizon | Mars rover | Beginner | Perseverance (Mars 2020) |
| Giant's Heart | Jupiter orbiter | Intermediate | Juno |
| Edge of Light | Pluto flyby (direct or Jupiter gravity assist) | Advanced | New Horizons |

## How the challenge requirements are covered

| Challenge asks for | Mission Architect |
|---|---|
| Mission objective → requirements | Each mission has a brief, a science goal and hard limits |
| Spacecraft design, instruments with mass/power/cost/data/science | 24 instruments modelled on real NASA instruments, power, batteries, avionics, radiation vault, propellant, landing system / orbit |
| Launch vehicle compatible with mass and orbit | 5 real rockets with payload-vs-C3 curves; white "rocket reach" outline on the porkchop plot |
| Orbit selection & characteristics | Real launch windows (porkchop plot), Jupiter science orbits (insertion Δv vs. close passes vs. radiation) |
| Resources: mass, power, budget, data, comms, time | Live 7-gauge dashboard: Mass, Power, Δv, Budget, Data, Science, Time |
| Team play up to 4, roles, negotiation | Team mode: 4 roles, personal role goals, sign-off required, sign-offs reset on any change |
| Random events / unexpected constraints | Dust storms, safe modes, engine valve anomaly (Juno), radiation, relay failure, budget cuts & cost overruns from NASA HQ |
| Difficulty levels | Easy / Normal / Hard |
| Post-mission analysis, mission report | "Why it turned out this way", event log, score breakdown, printable report |
| Leaderboard, save/share/compare designs | Local leaderboard, share links that encode the whole design |
| Educational value, simple explanations | Flight Director hints, glossary tooltips, every check explains the physics with numbers |

## The physics (all in `src/physics/`)

- **Planet positions:** NASA/JPL *Approximate Positions of the Planets* (E. M. Standish), Keplerian elements + rates, valid 1800-2050.
- **Trajectories:** Lambert's problem (universal variables, Curtis Alg. 5.2) solved for every pixel of the porkchop plot; universal-variable Kepler propagation for drawing and animation.
- **Gravity assist:** patched-conic powered flyby (turn angle → periapsis, Oberth-effect burn at periapsis).
- **Spacecraft:** rocket equation, orbit-insertion Δv, atmospheric entry speed, inverse-square solar power, RTG decay, radio link budget (∝ P·D²/d², calibrated to New Horizons), radiation dose per orbit.

### Validation (`npm test`)

| Quantity | Real mission | Mission Architect |
|---|---|---|
| Mars 2020 launch C3 | ≈ 14.5 km²/s² | 14.4 |
| New Horizons launch C3 | 157.7 km²/s² | 158.8 |
| New Horizons Jupiter flyby distance | 32 Jupiter radii | 32.6 |
| New Horizons arrival speed at Pluto | 13.8 km/s | 13.79 |

Rocket curves, costs and instrument values are rounded public numbers, chosen to keep real-world trade-offs. They are not flight-qualified data.

## Code map

```
src/physics/   ephemeris, Kepler propagation, Lambert solver, porkchop grids
src/data/      missions, instruments, rockets, subsystem parts
src/game/      evaluate.ts (systems engineering model), simulate.ts (events + score), persistence
src/scene/     Three.js solar system, procedural planet textures, procedural spacecraft/rover models
src/ui/        app shell, porkchop plot, flight player, report
tests/         physics validation and game balance
```

Adding a mission = one entry in `src/data/missions.ts`.

## Credits & data sources

- NASA/JPL Solar System Dynamics: planet elements, physical constants
- NASA Planetary Fact Sheets
- NASA mission pages for Perseverance, Juno and New Horizons (comparison facts)
- Three.js (MIT)

NASA Space Apps rules: do not use the NASA logo or insignia. AI assistance was used in building this project; disclose it on the submission form as the rules require.
