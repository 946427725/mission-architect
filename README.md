# Mission Architect

**Design a real space mission. Physics decides if it works.**

A browser game for the NASA Space Apps Challenge 2026 *Space Mission Design Game* challenge. Students (solo or a team of up to 4) choose a science objective, then design a complete interplanetary mission: launch window, spacecraft, instruments, communications, budget and rocket. They fly it in 3D, survive events taken from real missions, and get a report explaining *why* it succeeded or failed, which single change would have helped most, and how it compares with the real NASA mission.

## Judge quick path (about 2 minutes)

1. **Start a mission → Red Horizon → Fly NASA's design** (loads a Perseverance-style rover on the Launch step).
2. **Press and hold Launch.** Watch the countdown, the 3D cruise, and the Mars landing sequence.
3. On the report, read **"Why it turned out this way"** and **"One change that would have helped most"**.
4. **Improve the design → Route step → "Check the physics"** shows the real Perseverance launch on the same chart, with real vs. computed numbers.

Repeatable demo link (same events every time): `?mission=mars&preset=nasa&seed=1&speed=4`

## Run it

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # physics validation, balance and analysis tests (16)
npm run build         # static site in dist/
npm run build:single  # one self-contained file: single/index.html
```

### Public deployment (GitHub Pages)
`.github/workflows/pages.yml` tests, builds and publishes the game on every push to `main`.
1. Create a **public** GitHub repository and push this folder to it.
2. On GitHub: **Settings → Pages → Source: GitHub Actions**.
3. The game appears at `https://<your-user>.github.io/<repo>/` a minute later.

URL options: `?mission=mars|jupiter|pluto`, `&difficulty=easy|normal|hard|sandbox`, `&preset=nasa`, `&seed=N` (repeatable random events), `&speed=1|2|4`. Share links (`#d-…`) encode a whole design.

## The three missions

| Mission | Target | Level | Objectives to choose from | Real NASA comparison |
|---|---|---|---|---|
| Red Horizon | Mars rover | Beginner | Ancient life · Prepare for astronauts · Lost water | Perseverance (Mars 2020) |
| Giant's Heart | Jupiter orbiter | Intermediate | Jupiter's interior · Auroras · Icy moons | Juno |
| Edge of Light | Pluto flyby (direct or Jupiter gravity assist) | Advanced | Surface · Atmosphere · Kuiper Belt | New Horizons |

## How the challenge requirements are covered

| Challenge asks for | Mission Architect |
|---|---|
| Define a mission objective, then requirements | Pick 1 of 3 science objectives per mission; instruments that serve it count more (★) |
| Spacecraft design; instruments with mass, power, cost, data, science | 24 instruments modelled on real NASA instruments; power, batteries, backup computer, radiation vault, fuel, landing system or orbit |
| Launch vehicle compatible with mass and orbit | 5 real rockets with payload-vs-launch-energy curves; the launch-window chart outlines what your rocket can reach |
| Orbit selection and characteristics | Real launch windows; 3 Jupiter science orbits (braking burn vs. close passes vs. radiation) |
| Resources: mass, power, budget, data, comms, time | Live dashboard with change chips (e.g. "+15 kg", "+$102M") on every decision |
| Team play up to 4, roles, negotiation | 4 roles with conflicting personal goals shown live, hand-off prompts, sign-offs reset on any change, bonus when the whole team hits its goals |
| Clear objectives and feedback | Every step shows its goal with a live ✓/✗; problems link to the step that fixes them |
| Random events / unexpected constraints | Dust storms, safe modes, Juno's valve anomaly, radiation, relay failure, NASA HQ budget cuts |
| Difficulty levels / scenarios / sandbox | Easy, Normal, Hard, Sandbox × 3 missions × 3 objectives |
| Post-mission analysis and report | Lesson-first report, "fix it" button, re-flies the mission with every single change to find the one that helps most |
| Leaderboard, save, share, compare | Local leaderboard, share links, "Fly NASA's design" to compare with the real approach |
| Educational value | Tips from the Flight Director, glossary tooltips, history mode, Data & Validation screen, teacher guide (`docs/TEACHER_GUIDE.md`) |

## The physics (all in `src/physics/`)

- **Planet positions:** NASA/JPL *Approximate Positions of the Planets* (E. M. Standish), Keplerian elements and rates, valid 1800-2050.
- **Trajectories:** Lambert's problem (universal variables) solved for every pixel of the launch-window ("porkchop") chart; universal-variable Kepler propagation for the 3D flight.
- **Gravity assist:** patched-conic powered flyby (turn angle → closest approach, burn at closest approach).
- **Spacecraft:** rocket equation, orbit-insertion burn, atmospheric entry speed, inverse-square solar power, RTG decay, radio link budget (∝ P·D²/d², calibrated to New Horizons), radiation dose per orbit.

### Validation (`npm test`, asserted exactly)

| Quantity | Real mission | Mission Architect |
|---|---|---|
| Mars 2020 launch C3 | ≈ 14.5 km²/s² | 14.4 |
| New Horizons launch C3 | 157.7 km²/s² | 158.8 |
| New Horizons closest approach to Jupiter | ≈ 32 Jupiter radii | 32.6 |
| New Horizons speed past Pluto | 13.8 km/s | 13.79 |
| Direct flight to Pluto (no Jupiter flyby) | not attempted by NASA | impossible: cheapest of 3,051 routes needs C3 278, no rocket can carry anything |

Balance tests also prove there is no single correct design: two different winning designs exist for each mission, and every science objective is reachable.

Rocket curves, costs and instrument values are rounded public numbers chosen to keep real-world trade-offs. They are not flight-qualified data.

## Code map

```
src/physics/   ephemeris, Kepler propagation, Lambert solver, launch-window grids
src/data/      missions + objectives, instruments, rockets, subsystem parts
src/game/      evaluate.ts (systems engineering model), simulate.ts (events + score),
               analysis.ts (what-if re-flights), history.ts (real missions), presets.ts (NASA-style designs)
src/scene/     Three.js solar system, procedural planet textures, procedural spacecraft/rover models
src/ui/        app shell, launch-window chart, flight player, report, synthesized sound
tests/         physics validation, game balance, analysis
```

Adding a mission = one entry in `src/data/missions.ts`.

## Credits and data sources

- NASA/JPL Solar System Dynamics: planet elements, physical constants
- NASA Planetary Fact Sheets (NSSDCA)
- NASA Launch Services Program launch vehicle performance data (rounded)
- NASA mission pages for Perseverance, Juno and New Horizons (comparison facts and instrument analogues)
- Three.js (MIT), Vite, Vitest; fonts: Archivo, IBM Plex Mono (Google Fonts, OFL)

All sound is synthesized in the browser; all 3D models and planet textures are generated in code. NASA Space Apps rules: no NASA logos or insignia are used. AI tools were used in building this project; disclose this on the submission form as the rules require.
