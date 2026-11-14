# Submission text (draft, edit before submitting)

## Project name
Mission Architect

## High-level summary (≈ 150 words)
Mission Architect is a browser game where students design a complete space mission, and real physics decides whether it works. Players choose a launch window on a real porkchop plot (every pixel is a trajectory solved from NASA/JPL planet positions), then design the spacecraft: power source, batteries, redundancy, radiation shielding, propellant, science instruments, antenna and Deep Space Network time. Every choice changes mass, power, Δv, budget, data, science and time, shown live on a mission dashboard. A rocket must be strong enough for the mass and launch energy. Then the mission flies in 3D with random events (dust storms, safe modes, engine anomalies) that test the player's margins. A post-mission report explains exactly why the mission succeeded or failed and compares it with the real Perseverance, Juno or New Horizons. Team mode gives up to four players conflicting roles who must negotiate and all sign off before launch.

## What makes it different
1. **The physics is real and validated.** Our engine reproduces New Horizons' launch energy (158.8 vs 157.7), its Jupiter flyby distance (32.6 vs 32 Jupiter radii) and its Pluto arrival speed (13.79 vs 13.8 km/s).
2. **Failure teaches.** No "wrong answer" screens: the game says *"At 39.5 AU your solar panels make 0.8 W"*, *"your rover froze in a dust storm, the same way Opportunity died in 2018"*.
3. **There is no single correct design.** Solar vs RTG, airbags vs sky crane, direct vs gravity assist, cheap rocket vs margin all work in different combinations.
4. **Real collaboration.** Four roles with conflicting personal goals; any change resets everyone's sign-off.

## How we used NASA data
- JPL "Approximate Positions of the Planets" Keplerian elements (planet positions 1800-2050)
- NASA Planetary Fact Sheets (gravity parameters, radii)
- NASA mission data for Perseverance, Juno and New Horizons (instrument analogs, comparison cards, validation)
- NASA Launch Services Program style payload-vs-C3 performance curves

## Tools
TypeScript, Three.js, Vite, Vitest. Runs in any modern browser, no install, no server.

## Future work
Online multiplayer (each player on their own device), more missions (Europa lander, Earth observation satellite with orbit-altitude trade-offs, asteroid sample return), Venus/Earth gravity assists, teacher dashboard.
