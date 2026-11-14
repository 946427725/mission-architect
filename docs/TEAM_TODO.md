# Team task list (priority order)

## Everyone (first 30 min)
- [ ] `npm install && npm run dev`, play all three missions on Normal. Write down anything confusing.
- [ ] Read the challenge page again and agree on what to improve.

## Software engineers
- [ ] **Deploy** to Vercel/Netlify/GitHub Pages (`npm run build` → `dist/`) and put the link in the submission.
- [ ] Fix anything the playtests found (balance numbers are in `src/data/*.ts` and `src/game/evaluate.ts`).
- [ ] Nice to have: online team mode (each player on their own laptop), e.g. a small WebSocket room or Firebase.
- [ ] Nice to have: sound effects (launch rumble, event pings) with WebAudio.
- [ ] Nice to have: a 4th mission. Add an entry to `src/data/missions.ts` (Europa? Earth-observation satellite with orbit-altitude choices?).

## Physics student
- [ ] Sanity-check every number in `src/data/` and the formulas in `src/game/evaluate.ts`.
- [ ] Run `npm test` and extend `tests/physics.test.ts` with another real mission (e.g. MAVEN, InSight, Juno's 2016 arrival).
- [ ] Be ready to explain the Lambert solver and porkchop plot to judges in 2 sentences.

## Motion designer / 3D
- [ ] Replace procedural models with nicer ones: export **.glb** from Blender (low-poly) or use NASA 3D Resources models, load them with Three.js `GLTFLoader` in `src/scene/craftModel.ts`.
- [ ] Logo + title card + motion graphics for the video.
- [ ] Optional: a launch cinematic (rocket rising from the pad) as a short video overlay.

## Video editor
- [ ] Follow `docs/VIDEO_SHOTLIST.md`.
- [ ] Record a 2-minute walkthrough too (useful for judges and the project page).

## Submission checklist
- [ ] Project name, summary (see `docs/PITCH.md`), demo video/slides link, project link (deployed URL + GitHub repo)
- [ ] List of NASA data used, plus references
- [ ] Disclose AI use as required by the rules
- [ ] No NASA logo anywhere
- [ ] Submit **early**, not in the last hour
