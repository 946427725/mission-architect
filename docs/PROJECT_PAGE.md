# Space Apps project page: ready-to-paste text

Team **Falcons** · Challenge: **Space Mission Design Game** · NASA Space Apps Challenge 2026.
Fill each field of the project page with the text under its heading. Everything must be in English (it is). Review the "Use of Super Intelligence" answer and change anything that does not match how your team worked.

---

## Project Name

Mission Architect

## High-Level Project Summary

Mission Architect is a free 3D game in which students, alone or as a team of four, design, manage and fly a real interplanetary mission. In first person, they walk around a spacecraft clean room, pick up real hardware (nuclear batteries, solar arrays, dishes, attitude control, 24 instruments modelled on NASA instruments) and install it. Live gauges show what each part does to mass, power, Δv, budget, data and science. They choose a launch window on a chart where every point is a trajectory computed from NASA JPL planet positions, then pick a rocket (including ESA's Ariane 64 and JAXA's H3).

They then fly the spacecraft they built in 3D, from liftoff to landing, making Mission Control decisions modelled on real ones (Juno's engine valve, New Horizons' hazard search). A report explains why the mission worked or failed and compares the design with NASA's real missions. The physics is validated against Mars 2020 and New Horizons. It runs in any browser.

## Link to Project Demo

(Upload `media/MissionArchitect-demo-30s.mp4` to YouTube as **Unlisted** or **Public**, check the link in a private window, then paste it here.)

## Link to Final Project

https://946427725.github.io/mission-architect/

(Source code and the Windows app: https://github.com/946427725/mission-architect, Windows app under Releases.)

## Detailed Project Description

**What it does.** Mission Architect turns the whole mission-design process from the challenge into a game you play with your hands.

**1. Choose a mission and a science objective.** There are three NASA-style missions: a Mars rover (beginner), a Jupiter orbiter (intermediate) and a Pluto flyby (advanced, with a Jupiter gravity assist). Each has three science objectives and four difficulty levels, including Sandbox.

**2. Build the spacecraft in a 3D clean room**, in first person or third person:
- power (solar or nuclear, both with real decay);
- batteries;
- backup computers;
- attitude control (spin, thrusters or reaction wheels, as on Juno, New Horizons and Kepler);
- radiation vault;
- antennas and radios;
- fuel;
- landing systems (airbags, retro rockets, sky crane) or a science orbit;
- 24 instruments.

Every part changes mass, power, Δv, cost, data and science, and the gauges preview the change before you install it. Big parts move on an overhead crane.

**3. Choose a launch window and a rocket.**
- The launch-window chart ("porkchop plot") is computed live by a Lambert solver from NASA/JPL planet positions; hovering over it shows the transfer orbit.
- The Pluto mission uses a patched-conic Jupiter gravity assist.
- Seven rockets have payload-versus-launch-energy curves: Falcon 9, Falcon Heavy, Atlas V, Atlas V + Star 48B, SLS, ESA Ariane 64 and JAXA H3. The game checks that the rocket can lift your spacecraft to your launch energy.

**4. Pass the GO/NO-GO poll and launch.** The team signs off at the launch gate, then the launch is shown on the pad.

**5. Fly the mission in 3D.** The flight runs from liftoff through fairing and spacecraft separation and the cruise to arrival:
- Mars: entry, parachute, sky crane, retro rockets or airbags, then touchdown;
- Jupiter: the orbit insertion burn;
- Pluto: the Charon and Pluto flyby.

Random events taken from real missions (dust storms, safe modes, radiation, relay failures, wheel failures) are resolved by the design choices that would have saved the real mission.

**6. Make Mission Control decisions.** The flight stops for real calls:
- a course correction;
- choosing the landing site (flat plain or Jezero-style river delta);
- hibernating through a dust storm;
- Juno's 2016 engine valve anomaly;
- New Horizons' hazard search;
- planetary protection at the end of the Jupiter mission.

Each call re-flies the mission with the same luck, so the player sees exactly what that decision changed.

**7. Learn from the report.** The report explains why the mission succeeded or failed, lists the player's Mission Control calls, and re-flies the mission once for every possible single change to find the change that would have helped most. It compares the design with Perseverance, Juno or New Horizons, and with ESA's Rosalind Franklin and JUICE. Players can save scores, share their design as a link, and fly NASA's own design.

**Team play.** Up to four players share one design. Each player has a role (Flight Dynamics, Spacecraft Systems, Principal Investigator, Ground & Budget), their own stations, a personal goal that pulls against the others, and their own Mission Control calls. Bonus points go to teams in which everyone meets their goal.

**How it works.**
- **Physics** (TypeScript):
  - NASA/JPL approximate planet ephemerides (E. M. Standish);
  - universal-variable Kepler propagation and a Lambert solver;
  - patched-conic gravity assists;
  - the rocket equation, orbit insertion Δv and atmospheric entry speed;
  - inverse-square solar power and RTG decay;
  - a radio link budget calibrated to New Horizons;
  - a radiation dose per orbit.
- **Validation:** 19 automated tests. Examples: Mars 2020 C3 is 14.4 in our engine against about 14.5 published; New Horizons' Jupiter flyby is 32.6 Jupiter radii against about 32, and its Pluto speed is 13.79 km/s against 13.8.
- **3D:** Three.js. Every model and texture is generated in code, apart from the real NASA planet maps. All sounds are synthesized in code.

**Benefits.**
- Players learn why trade-offs matter rather than memorising facts.
- There is no single perfect design.
- Every failure is explained, and the report points to the station that fixes it.
- It is free, needs no installation or account, and runs in any modern browser.
- A teacher guide is included.

**What we hope to achieve.** A classroom-ready game in which any student, anywhere, can feel what NASA and partner-agency mission engineers do: balance mass, power, money and risk, and live with the consequences.

**Tools.** TypeScript, Three.js, Vite, Vitest, Electron (Windows app), Google Fonts (Archivo, IBM Plex Mono), GitHub Pages.

## Use of Super Intelligence (SI)

(Review this answer and edit it to match how your team actually worked.)

Yes. We used Claude (Anthropic), an AI coding assistant, to help write and test the code: the game engine, the 3D scenes, the physics model and its tests, and the automated play-tests. We also used it to draft documentation.

The demo video's voice-over was generated with ElevenLabs (AI text-to-speech). The video says this on screen and in the file metadata.

No AI-generated images were used:
- every frame of the demo is captured in real time from the game;
- the 3D models and textures are generated by our own code;
- the planet images are real NASA maps;
- the music is synthesized by our own code.

The team chose the challenge, set the direction and requirements, made the design decisions, and tested the game.

## NASA Data

- **NASA/JPL "Approximate Positions of the Planets" (E. M. Standish):** Keplerian elements and rates used for every planet position and every launch-window trajectory. https://ssd.jpl.nasa.gov/planets/approx_pos.html
- **NASA Planetary Fact Sheet:** planet radii, gravitational parameters and distances. https://nssdc.gsfc.nasa.gov/planetary/factsheet/
- **NASA mission data used for comparison and validation:**
  - Mars 2020 Perseverance: launch and landing dates, C3, MMRTG, sky crane, entry speed;
  - Juno: launch, orbit, valve anomaly, radiation vault, power at Jupiter;
  - New Horizons: launch C3, Jupiter flyby distance, Pluto speed, data rate, hazard search.
- **NASA Launch Services Program:** launch vehicle performance (rounded). https://elvperf.ksc.nasa.gov/
- **NASA Radioisotope Power Systems:** MMRTG and GPHS-RTG output and decay.
- **NASA Deep Space Network:** dish sizes and link budget.
- **Real NASA planet maps** (public domain), used on the 3D planets:
  - Earth: NASA Blue Marble (Reto Stöckli, NASA GSFC), https://visibleearth.nasa.gov/view.php?id=57752
  - Mars: NASA Viking color mosaic (USGS Astrogeology)
  - Jupiter: NASA/JPL/Space Science Institute, Cassini, PIA07782
  - Pluto: NASA/JHUAPL/SwRI, New Horizons global color map

## Space Agency Partner Data and Other References

- **ESA:**
  - Ariane 6 (Ariane 64) performance used in the rocket list (rounded public figures), https://www.esa.int/Enabling_Support/Space_Transportation/Ariane
  - JUICE (Jupiter Icy Moons Explorer) facts for the Jupiter comparison, https://www.esa.int/Science_Exploration/Space_Science/Juice
  - Rosalind Franklin rover (ExoMars) facts for the Mars comparison, https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Exploration/ExoMars
- **JAXA:** H3 rocket performance used in the rocket list (rounded public figures), https://global.jaxa.jp/projects/rockets/h3/
- **Open-source software:** Three.js (MIT), Vite (MIT), Vitest (MIT), Electron (MIT), electron-builder (MIT).
- **Fonts:** Archivo and IBM Plex Mono (SIL Open Font License, Google Fonts).
- **Images:** NASA planet maps obtained through Wikimedia Commons (public domain; credits above).
- **AI tools:** Claude (Anthropic) for coding assistance; ElevenLabs for the demo voice-over.
- No copyrighted music, images or text were used. All sounds and music are synthesized in code.
