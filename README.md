# Mission Architect

**Build a real spacecraft by hand. Physics decides if it flies.**

A 3D browser game for the NASA Space Apps Challenge 2026 *Space Mission Design Game* challenge. You play a clean-room engineer in a spacecraft assembly high bay. Walk to the racks, pick real hardware off the shelves (nuclear batteries, solar arrays, dishes, instruments), carry it to the spacecraft on the stand and install it; the overhead crane moves the big parts. Every part changes mass, power, Δv, budget, data and science, and the gauges show the trade-off before you commit. Pick a launch date at the Flight Dynamics desk (real Lambert trajectories from NASA/JPL planet positions), choose a rocket, pass the GO/NO-GO poll at the launch gate, watch the launch from the pad, fly the mission through events taken from real missions, and get a report that explains *why* it succeeded or failed and how it compares with Perseverance, Juno or New Horizons. Solo or a team of up to 4, each player an engineer with their own role and stations.

## Judge quick path (about 2 minutes)

1. **Play → Red Horizon → Fly NASA's design.** A Perseverance-style rover is on the stand and every station is GO.
2. Click **Launch!** on the task list: the engineer walks to the launch gate. **Press and hold Launch.** The door opens, the pad cinematic plays, then the 3D cruise and the Mars landing sequence.
3. On the report, read **"Why it turned out this way"** and **"One change that would have helped most"**.
4. **Improve the design** takes you back to the high bay. Click the **MMRTG** on the Power rack: the gauges preview the change; carry it to the blue ring and press **E**.
5. At the **Flight Dynamics** desk, **"Check the physics"** shows the real Perseverance launch on the launch-window chart, with real vs. computed numbers.

**Controls:** WASD / arrow keys to walk, Shift to run, drag to look, wheel to zoom, **click anything** to walk there, **E** to use, **Tab** to switch player (team mode), Esc to close. Touch: left stick + USE button.

Repeatable demo link (same events every time): `?mission=mars&preset=nasa&seed=1&speed=4`

## Play it

- **Windows app (best experience):** download `MissionArchitect-1.0.1-Windows-portable.exe` from Releases and run it (no install). It uses the dedicated GPU on dual-graphics laptops. Not code-signed: on *"Windows protected your PC"* click **More info → Run anyway**.
- **Website (instant, any computer):** the Vercel link. Graphics quality adapts automatically to the machine.
- If the .exe will not open on your computer, use the website: it is the same game.
- Tip for laptops in the browser: Windows Settings → System → Display → Graphics → set your browser to *High performance* to use the dedicated GPU.

## Run it

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # physics validation, balance and analysis tests (16)
npm run build         # static site in dist/
npm run build:single  # one self-contained file: single/index.html
npm run build:exe     # Windows portable app in desktop/dist-exe/ (run `npm install` in desktop/ first)
```

### Public deployment
- **Vercel (main host):** import the GitHub repository in Vercel. `vercel.json` already sets the build (`npm run build`, output `dist`).
- **GitHub Pages (backup):** Settings → Pages → Source: GitHub Actions, then Actions → "Deploy to GitHub Pages" → Run workflow.
- Every push runs the tests and a production build (`.github/workflows/ci.yml`).

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
| Team play up to 4, roles, negotiation | 4 engineers in the high bay, one per role, each with their own stations and conflicting personal goals; Tab hands the controls to the next player; sign-offs at the launch gate reset on any change; bonus when the whole team hits its goals |
| Clear objectives and feedback | A live task list with the next station highlighted in the 3D world and on the minimap; every station shows its goal with a live ✓/✗; failed checks point to the station that fixes them |
| Random events / unexpected constraints | Dust storms, safe modes, Juno's valve anomaly, radiation, relay failure, NASA HQ budget cuts |
| Difficulty levels / scenarios / sandbox | Easy, Normal, Hard, Sandbox × 3 missions × 3 objectives |
| Post-mission analysis and report | Lesson-first report, "fix it" button, re-flies the mission with every single change to find the one that helps most |
| Leaderboard, save, share, compare | Local leaderboard, share links, "Fly NASA's design" to compare with the real approach |
| Educational value | Flight Director radio calls explain every station and every failed check; gauges preview each part's cost before you install it; planetary-protection and clean-room details; history mode; Data & Validation screen; teacher guide (`docs/TEACHER_GUIDE.md`) |

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
src/hangar/    the high bay game: renderer + post-processing, clean-room environment, engineer
               character and controls, real-scale spacecraft/rocket models, stations, crane,
               HUD (tasks, gauges, Flight Director radio), launch pad cinematic
src/scene/     Three.js solar system, procedural planet textures, spacecraft models for flight close-ups
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

All sound is synthesized in the browser; all 3D models (high bay, engineer, spacecraft, rockets, launch pad) and all textures are generated in code. NASA Space Apps rules: no NASA logos or insignia are used. AI tools were used in building this project; disclose this on the submission form as the rules require.
