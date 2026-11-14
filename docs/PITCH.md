# Submission text (edit before submitting)

**Deadline:** Sunday 15 Nov 2026, 11:59 PM local time. Only the last saved submission is reviewed. All links must be public.

## Project name
Mission Architect

## High-level summary (≈150 words)
Mission Architect is a 3D browser game in which students, solo or in teams of up to four, play engineers in a spacecraft assembly clean room and build a real interplanetary mission by hand. They pick hardware off the racks (nuclear batteries, solar arrays, dishes, 24 instruments modelled on real NASA instruments), carry it to the spacecraft and install it, while live gauges show how each part changes mass, power, Δv, budget, data and science. At the Flight Dynamics desk they choose a launch window on a porkchop plot where every pixel is a Lambert trajectory computed from NASA/JPL planet positions, then pick one of five real rockets and pass the GO/NO-GO poll. The launch plays out on the pad, the mission flies in 3D with events drawn from real incidents, and a report explains why it succeeded or failed, finds the single change that would have helped most, and compares it with Perseverance, Juno or New Horizons.

## Positioning (one sentence)
Mission Architect turns NASA/JPL planet data and validated orbital mechanics into a game where students make the real trade-offs of mission design, fail safely, and learn why by comparing their mission with Perseverance, Juno and New Horizons.

## Best-fit awards
Best Use of Science (main target), Most Inspirational, Art & Technology.

## What makes it different
1. **The physics is real and checked against history.** Given only the real dates, the engine reproduces New Horizons' launch energy (158.8 vs 157.7 km²/s²), its Jupiter flyby distance (32.6 vs 32 Jupiter radii) and its Pluto speed (13.79 vs 13.8 km/s), and Mars 2020's launch energy (14.4 vs ≈14.5). Players can see this in-game in History mode.
2. **Failure teaches.** No "wrong answer" screens. The game says *"At 32.9 AU sunlight is 0.09% of Earth's. You make 12 W but need 142 W on average - the spacecraft would freeze and shut down"* (giant solar wings on a New Horizons-style trip) and *"the solar panels could not keep the heaters on and the rover froze - the same way Opportunity died in 2018"*. Then it re-flies the mission with every possible single change and shows which one would have helped most.
3. **There is no single correct design.** Automated tests prove two different winning designs exist for every mission, and every science objective is reachable.
4. **Real collaboration.** Four roles with conflicting personal goals; any change resets everyone's sign-off.

## How we used NASA data
- NASA/JPL "Approximate Positions of the Planets" Keplerian elements (planet positions 1800-2050): https://ssd.jpl.nasa.gov/planets/approx_pos.html
- NASA Planetary Fact Sheets (gravity parameters, radii): https://nssdc.gsfc.nasa.gov/planetary/factsheet/
- NASA Launch Services Program launch-vehicle performance data (payload vs C3, rounded): https://elvperf.ksc.nasa.gov/
- NASA mission pages for Perseverance, Juno and New Horizons (validation, comparison cards, instrument analogues)

## Tools and references
TypeScript, Three.js, Vite, Vitest, Google Fonts (Archivo, IBM Plex Mono). All sounds synthesized in code; all 3D models and textures generated in code; no NASA logos. AI tools were used for coding assistance: state this in the AI-use field.

## Future work
Online multiplayer (each player on their own device), more missions (Europa lander, Earth-observation satellite), Venus/Earth gravity assists, teacher dashboard.
