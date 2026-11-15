# Team checklist (deadline: Sunday 15 Nov 2026, 11:59 PM local time)

## 1. Public link (blocking: judges need it)
- [ ] Create a **public** GitHub repo, push this folder (`git remote add origin …` then `git push -u origin main`).
- [ ] GitHub → Settings → Pages → Source: **GitHub Actions**. Wait for the green "Deploy to GitHub Pages" run.
- [ ] Open the URL in an incognito window and on a phone. Try `?mission=mars&preset=nasa&seed=1&speed=4`.

## 1b. Windows app (best version for judges)
- [ ] GitHub → Releases → open the saved draft *Mission Architect 1.0.3* → attach `desktop/dist-exe/MissionArchitect-1.0.3-Windows-portable.exe` → Publish.
- [ ] Download it on another Windows PC and run it once (More info → Run anyway).
- [ ] Put the "Two ways to play" text from `docs/PITCH.md` on the project page and a pitch slide.

## 2. Demo video (30 seconds or less, or it is not eligible)
- [ ] Follow `docs/VIDEO_SHOTLIST.md` (uses the repeatable demo link).
- [ ] English captions, human voice-over, no AI images, no NASA logos.

## 3. Project page
- [ ] Copy the summary and data sources from `docs/PITCH.md`.
- [ ] List every external resource under References (Three.js, Vite, Vitest, Google Fonts, NASA data pages).
- [ ] Fill in the AI-use disclosure.
- [ ] Link the teacher guide (`docs/TEACHER_GUIDE.md`) to show classroom impact.
- [ ] Submit early, then re-check the saved version.

## Physics student
- [ ] Run `npm test` (16 tests) and be ready to explain in two sentences: the Lambert solver, the launch-window chart, and the New Horizons validation.

## Optional polish (only if everything above is done)
- [ ] Play every mission on Normal and note anything confusing.
- [ ] Nicer 3D models: export `.glb` from Blender and load them in `src/scene/craftModel.ts`.
