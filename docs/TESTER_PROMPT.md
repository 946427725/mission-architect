# Prompt for testers (paste into Claude with Claude in Chrome)

Copy everything in the box below into Claude (claude.ai or the Claude desktop app) with the **Claude in Chrome** extension connected, on your own computer. It tests the public website and writes a bug report. Send the report back to the team.

---

```
You are a QA tester for "Mission Architect", a 3D browser game made for the NASA Space Apps Challenge 2026 (challenge: Space Mission Design Game). Test the PUBLIC website in my Chrome and write a precise bug report. Do not sign in anywhere, do not submit forms on other sites, and do not download anything.

Website: https://946427725.github.io/mission-architect/
(Repeatable demo link: https://946427725.github.io/mission-architect/?mission=mars&preset=nasa&seed=1)

Rules
- Use a NEW Chrome tab. Take a screenshot after every major step and look at it carefully.
- After each step, read the browser console (errors and warnings) and note any error with its text.
- Pointer lock (mouse look) may not work under automation. If it does not, use the alternatives listed below and note it, but do not count it as a bug.
- If something does not respond within 10 seconds, note it and move on.
- Note the computer facts at the start: OS, screen size, browser version, GPU (from chrome://gpu, "GL_RENDERER", if you can read it).

Test plan
1. Load: open the website. Time how long until the title screen appears. Check the title, that the 3D high bay renders (not black, not white), and that there are no console errors.
2. Training: on the title screen click "New? Training (4 min)". Follow the coach card at the top through all 7 steps (walk, pick a launch date, install the sky crane, read the gauges, launch, make a Mission Control call, read the report). Each step must advance by itself when done. Wait about 15 s on one step without doing it: a "Show me" button must appear and must do the step for you. Note the total time. At the end, "Play the full game" must open the mission select. Then return to the title screen.
2b. Settings: on the title screen open Settings: turn on "Colour-blind safe" (GO becomes blue, NO-GO orange) and "Reduced" motion (no camera shake at launch, no head bob), then turn both off.
2c. Mission select: click Play / Start. You should see 3 missions: Red Horizon (Mars), Giant's Heart (Jupiter), Edge of Light (Pluto), with a spinning real planet image. Check difficulty buttons (Easy / Normal / Hard / Sandbox) and the crew size buttons.
3. Fly NASA's design (Mars): choose Red Horizon, then "Fly NASA's design". You arrive in the 3D high bay in first person. Check: gauges at the top (Mass, Power, Δv, Budget, Data, Science), the task list on the left, the minimap, the Flight Director radio box.
4. Movement: press and hold W / A / S / D (and arrow keys). The view should move. Press V (third person) and V again (first person). Click a task in the task list: the engineer should walk to that station by itself and open its panel.
5. Every station: open each station panel from the task list or the gauges (Flight Dynamics, Rockets, Power, Avionics/Batteries/Pointing, Fuel, Landing Systems or Orbit Planning, Science Lab, Antennas & Radios, Ground & Budget, Launch Gate). In each panel check: the goal line (✓ / ! / ✕), the "Data" source chips (they must open NASA/ESA/JAXA pages in a new tab), and that cards are readable. Close with the × button and with Esc.
6. Pick up and install a part: at the Power station click the "MMRTG nuclear battery" card (or another part). The engineer carries it to the spacecraft and installs it. The gauges must change. At "Avionics, Batteries & Pointing" pick "Reaction wheels" and check it installs.
7. Launch window: open Flight Dynamics, then the launch-window chart (route console). Move the mouse over the blue islands of the chart: the trajectory on the right must change. Click "Auto-pick". Go back to the high bay.
8. Launch: go to the Launch Gate and press-and-hold the Launch button (or use the "Launch!" task). The door opens, then the launch pad countdown and liftoff. "Skip" must work.
9. Flight: watch the 3D flight. Check: ascent, fairing separation over Earth, cruise with Earth/Mars, and the captions at the bottom. Use the 1× / 2× / 4× speed buttons.
10. Mission Control decisions: during the flight a "MISSION CONTROL · YOUR CALL" window appears (Course correction, Choose the landing site, ...). Test: click an option; on the next decision press the number key 2; on another one wait 30 s without answering (the autopilot must decide). Each decision must show a result card on the right.
11. Mars landing: entry glow, parachute, sky crane lowering the rover on cables, touchdown, then the rover on the surface.
12. Report: check the result screen: verdict, score ring, "Why it turned out this way", "Your Mission Control calls", "You vs NASA" (and the ESA comparison box on Mars and Jupiter), mission log, score breakdown, leaderboard save. Buttons: Fly again, NASA's design, Share (copy link), Next mission, Improve the design (must return to a playable high bay).
13. Repeat a short version of steps 3, 8, 9, 10 and 12 for Giant's Heart (Jupiter: orbit insertion burn, orbit, "End of the primary mission" decision) and Edge of Light (Pluto: Jupiter flyby, "Hazard search" decision, closest approach).
14. Design my own: from mission select choose "Design my own" on Normal. Check the high bay starts with tasks not done, and that the Menu (top-left ☰) has "Engineer view": open it, change a few options on each tab (including Attitude control on the Spacecraft tab), then go back to the high bay.
15. Team mode: from mission select pick 4 players, start, press Tab to switch players, and check that Mission Control decisions name the player in charge.
16. Performance: on the high bay and during the flight, estimate smoothness (smooth / slightly choppy / very choppy). If chrome://gpu is readable, note whether hardware acceleration is on.
17. Window sizes: resize the window to about 1280×720 and to a narrow 400 px width; check that panels and captions still fit and nothing important is cut off.

Report format (write it at the end, in English)
- Summary: 3-5 lines. Overall: Works / Works with problems / Broken.
- Computer: OS, screen, browser version, GPU, smoothness.
- Bugs, sorted by severity (Blocker / Major / Minor / Cosmetic). For each: title, steps to reproduce, expected vs actual, screenshot description, console error text if any.
- Things that confused you as a first-time player (with the screen where it happened).
- Things that impressed you.
Keep it factual. Do not guess at causes in the code.
```
