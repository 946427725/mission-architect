// Post-mission analysis: the lesson first, then what would have saved it,
// the log, the score, and the comparison with the real NASA mission.
import { MISSIONS } from '../data/missions';
import { rocketById } from '../data/rockets';
import { POWER } from '../data/parts';
import { WhatIf, whatIfs } from '../game/analysis';
import { fmtM, formatRate } from '../game/evaluate';
import { encodeDesign, loadLeaderboard, saveLeader } from '../game/persist';
import { ROLE_INFO, SimEvent } from '../game/simulate';
import { Tab, missionOf } from '../game/state';
import { BODIES } from '../physics/constants';
import { formatDuration, formatJD } from '../physics/time';
import type { App } from './app';
import { $, esc, fmtInt, fmtKg, fmtW, pct, statusIcon, toast } from './dom';

const STEP_LABEL: Record<Tab, string> = { trajectory: 'Route', spacecraft: 'Craft', science: 'Science', comms: 'Comms', launch: 'Launch' };

/** Which design step fixes an event, from its "fix" hint. */
function tabForFix(fix: string): Tab {
  if (/dish|antenna|data/i.test(fix)) return 'comms';
  if (/instrument/i.test(fix)) return 'science';
  return 'spacecraft';
}

let lastWhatIfs: WhatIf[] = [];
let whatIfKey = '';

function headline(app: App): { text: string; tab: Tab | null } {
  const d = app.design!;
  const ev = app.ev!;
  const sim = app.sim!;
  const m = missionOf(d);
  const worst = sim.events.find((e) => e.tone === 'critical' && e.fix) ?? null;
  if (sim.outcome === 'failure' && worst) return { text: `${worst.title}: ${worst.text}`, tab: tabForFix(worst.fix!) };
  if (sim.outcome !== 'success') {
    const pts = `You returned ${Math.round(sim.science)} of ${m.scienceTarget} science points.`;
    if (ev.data.fraction < 0.9) return { text: `${pts} Only ${pct(ev.data.fraction)} of your data reached Earth.`, tab: 'comms' };
    const bad = sim.events.find((e) => (e.tone === 'bad' || e.tone === 'critical') && e.fix);
    if (bad) return { text: `${pts} ${bad.title} cost you science.`, tab: tabForFix(bad.fix!) };
    if (ev.radiation && ev.radiation.maxOrbits < ev.radiation.plannedOrbits) return { text: `${pts} Radiation ended the mission after ${ev.radiation.maxOrbits.toFixed(0)} of ${ev.radiation.plannedOrbits.toFixed(0)} orbits.`, tab: 'spacecraft' };
    return { text: `${pts} Your ${d.instruments.length} instrument${d.instruments.length === 1 ? ' was' : 's were'} not enough to reach the goal.`, tab: 'science' };
  }
  const save = sim.events.find((e) => e.saved && e.tone === 'good');
  if (save) return { text: `${save.title}, and your ${save.saved!.toLowerCase()} saved the mission. You returned ${Math.round(sim.science)} science points.`, tab: null };
  return { text: `Clean mission: ${Math.round(sim.science)} science points returned with healthy margins.`, tab: null };
}

const firstSentence = (t: string) => t.split(/(?<=[.!])\s/)[0];

export function renderReport(app: App): string {
  const d = app.design!;
  const ev = app.ev!;
  const sim = app.sim!;
  const m = missionOf(d);
  const tr = d.transfer!;
  const rocket = rocketById(d.rocketId);
  const power = POWER.find((p) => p.id === d.powerId)!;
  const outcomeText = sim.outcome === 'success' ? 'Mission success' : sim.outcome === 'partial' ? 'Partial success' : 'Mission lost';
  const stamp = sim.outcome === 'success' ? 'APPROVED' : sim.outcome === 'partial' ? 'PARTIAL' : 'LOST';
  const stars = [0, 1, 2].map((i) => `<span class="star ${i < sim.score.stars ? 'on' : ''}">★</span>`).join('');
  const lb = loadLeaderboard().filter((e) => e.missionId === m.id).slice(0, 5);
  const idx = MISSIONS.findIndex((x) => x.id === m.id);
  const nextMission = MISSIONS[(idx + 1) % MISSIONS.length];
  const head = headline(app);

  // what-if analysis (cached per flight)
  const key = `${encodeDesign(d)}|${sim.seed}`;
  if (key !== whatIfKey) {
    lastWhatIfs = whatIfs(d, sim, app.team.enabled);
    whatIfKey = key;
  }

  const why: string[] = [];
  const line = (cls: string, title: string, body: string) => why.push(`<li class="${cls}"><b>${esc(title)}</b> - ${body}</li>`);
  for (const e of sim.events as SimEvent[]) {
    if (e.survived) line('warn', e.title, `${esc(e.text)} <i>Survived thanks to: ${esc(e.survived)}.</i>`);
    else if (e.tone === 'bad' || e.tone === 'critical') line('bad', e.title, `${esc(firstSentence(e.text))}${e.fix ? ` <i>Would have helped: ${esc(e.fix)}.</i>` : ''}`);
    else if (e.saved) line('good', e.title, `saved by your choice: <i>${esc(e.saved)}</i>.`);
  }
  for (const c of ev.checks.filter((c) => c.status === 'warn')) line('warn', c.label, c.detail);
  const goodIds = ['rad', 'power', 'entry', 'data', 'dv', 'rover'];
  for (const c of ev.checks.filter((c) => c.status === 'ok' && goodIds.includes(c.id)).sort((x, y) => goodIds.indexOf(x.id) - goodIds.indexOf(y.id)).slice(0, 2)) line('good', `Good call: ${c.label}`, c.detail);

  const myRows: [string, string][] = [
    ['Launch', `${formatJD(tr.launchJD)}, ${rocket.name}`],
    ['Route', tr.kind === 'jga' ? `Jupiter gravity assist (${formatJD(tr.flyby!.jd)})` : 'Direct'],
    ['Arrival', `${formatJD(tr.arriveJD)} (${formatDuration(tr.tofDays)})`],
    ['Launch energy C3', `${tr.c3.toFixed(1)} km²/s²`],
    ['Launch mass', fmtKg(ev.mass.launch)],
    ['Power', `${power.name}, ${fmtW(ev.power.generated)} at target`],
    ['Instruments', `${d.instruments.length}`],
    ['Data link', `${formatRate(ev.data.rateBps)} · ${pct(ev.data.fraction)} returned`],
    ['Cost', `$${fmtM(ev.cost.total)} of $${fmtM(ev.cost.cap)}`],
  ];

  const whatIfHTML = lastWhatIfs.length
    ? `<ol class="whatif">${lastWhatIfs
        .map((w, i) => `<li><div><b>${esc(w.label)}</b><span>${w.outcome !== sim.outcome ? `${sim.outcome === 'failure' ? 'lost' : sim.outcome} → <em class="${w.outcome}">${w.outcome}</em> · ` : ''}${Math.round(w.science)} science pts</span></div><strong>+${fmtInt(w.delta)}</strong><button class="btn small" data-act="apply-whatif" data-idx="${i}">Apply</button></li>`)
        .join('')}</ol><p class="note">Same launch, same luck: we re-flew your mission once for each possible single change.</p>`
    : `<p class="note">We re-flew your mission once for every possible single change. None scored higher: this design is already at its best for this launch and this luck.</p>`;

  return `<div class="report" id="report">
    <div class="report-head ${sim.outcome}">
      <div class="eyebrow">Post-mission report · ${esc(m.name)} · ${BODIES[m.target].name} · ${esc((m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0]).name)}</div>
      <h1>${outcomeText}</h1>
      <p class="headline">${esc(head.text)}</p>
      ${head.tab ? `<button class="btn fix-step" data-act="fix-step" data-tab="${head.tab}">Fix it on the ${STEP_LABEL[head.tab]} step →</button>` : ''}
      <div class="grade-row"><div class="stars">${stars}</div><div class="score"><b>${fmtInt(sim.score.total)}</b><span>points</span></div>
        <div class="sci-goal"><div class="sci-bar"><i style="width:${Math.min(100, (sim.scienceFraction / 1.5) * 100)}%"></i><span class="goal" style="left:${100 / 1.5}%"></span></div>
        <div class="sci-nums"><b>${Math.round(sim.science)}</b> / ${m.scienceTarget} science points</div></div></div>
      <div class="grade" aria-hidden="true">${stamp}</div>
    </div>

    <div class="report-grid">
      <section><h3>Why it turned out this way</h3><ul class="why">${why.join('') || '<li class="good">No surprises at all. Textbook systems engineering.</li>'}</ul></section>
      <section><h3>${sim.outcome === 'success' ? 'Could you score even higher?' : 'One change that would have helped most'}</h3>${whatIfHTML}</section>

      <section><h3>Mission log</h3><ol class="log">${sim.events.map((e) => `<li class="${e.tone}"><span>${formatJD(e.jd)}</span><b>${esc(e.title)}</b></li>`).join('')}</ol></section>
      <section><h3>Score breakdown</h3><div class="budget">${sim.score.items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v >= 0 ? '+' : ''}${fmtInt(v)}</b></div>`).join('')}<div class="total"><span>Total</span><b>${fmtInt(sim.score.total)}</b></div></div>
        ${app.team.enabled ? `<h3>Team role goals</h3>${sim.roleGoals.map((g) => `<div class="check ${g.met ? 'ok' : 'warn'}">${statusIcon(g.met ? 'ok' : 'warn')}<div><b style="color:${ROLE_INFO[g.role].color}">${ROLE_INFO[g.role].title}</b><p>${esc(g.goal)}</p></div></div>`).join('')}` : ''}
      </section>

      <section class="compare"><h3>You vs NASA: ${esc(m.nasa.name)}</h3>
        <div class="cmp-cols"><div><h4>Your mission</h4>${myRows.map(([k, v]) => `<div class="kvrow"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
        <div><h4>${esc(m.nasa.name)}</h4>${m.nasa.facts.map(([k, v]) => `<div class="kvrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>
        <p class="lesson"><b>Lesson from the real mission:</b> ${esc(m.nasa.lesson)} <a href="${m.nasa.url}" target="_blank" rel="noopener">Learn more at NASA ↗</a> · <button class="link-btn inline" data-act="validation">How we validated the physics</button></p>
      </section>

      <section><h3>Leaderboard: ${esc(m.name)}</h3>
        ${lb.length ? `<div class="lb">${lb.map((e, i) => `<div><span>${i + 1}. ${esc(e.name)}</span><span>${esc(e.difficulty)}</span><b>${e.score}</b></div>`).join('')}</div>` : '<p class="small-note">No scores yet on this device. Be the first!</p>'}
        ${d.difficulty === 'sandbox' ? '<p class="small-note">Sandbox scores are not saved.</p>' : `<div class="save-row"><input id="lb-name" maxlength="20" placeholder="${app.team.enabled ? 'Team name' : 'Your name'}" value="${esc(app.playersSummary())}"><button class="btn small" data-act="save-score">Save score</button></div>`}
      </section>
    </div>

    <div class="report-actions">
      <button class="btn" data-act="redesign">Improve the design</button>
      <button class="btn ghost" data-act="fly-again">Fly again (new luck)</button>
      <button class="btn ghost" data-act="nasa-design-report">Try the NASA-style design</button>
      <button class="btn ghost" data-act="share">Share design</button>
      <button class="btn ghost" data-act="next-mission">Next: ${esc(nextMission.name)} →</button>
    </div>
  </div>`;
}

let saved = false;

function backToDesign(app: App, tab?: Tab) {
  saved = false;
  app.view.setCloseupModel(null);
  app.view.setCraftAt(null);
  app.view.showTransfer(app.design!.transfer);
  app.view.setDate(app.design!.transfer!.launchJD);
  app.view.frameSystem(missionOf(app.design!).target === 'pluto' ? 44 : missionOf(app.design!).target === 'jupiter' ? 6.8 : 2.3);
  if (tab) app.tab = tab;
  app.screen = 'design';
  app.panelAnim = true;
  app.evaluateNow();
  app.render();
}

export function reportAction(app: App, act: string, el: HTMLElement) {
  if (app.screen !== 'report' && act !== 'close-event') return;
  switch (act) {
    case 'close-event':
      app.closeEvent();
      break;
    case 'redesign':
      backToDesign(app);
      break;
    case 'fix-step':
      backToDesign(app, el.dataset.tab as Tab);
      break;
    case 'apply-whatif': {
      const w = lastWhatIfs[Number(el.dataset.idx)];
      if (!w) return;
      app.design = { ...w.design };
      backToDesign(app, w.tab);
      toast(`Applied: ${w.label}. Check it, then launch again.`, 'good');
      break;
    }
    case 'fly-again':
      saved = false;
      app.view.setCloseupModel(null);
      app.tab = 'launch';
      app.launch();
      break;
    case 'save-score': {
      if (saved) {
        toast('Score already saved', 'info');
        return;
      }
      const name = ($('#lb-name') as HTMLInputElement).value.trim() || 'Anonymous';
      const sim = app.sim!;
      saveLeader({
        missionId: app.design!.missionId,
        name,
        score: sim.score.total,
        grade: sim.score.grade,
        outcome: sim.outcome,
        difficulty: app.design!.difficulty,
        date: new Date().toISOString(),
        code: encodeDesign(app.design!),
      });
      saved = true;
      toast('Score saved to the leaderboard', 'good');
      app.renderOverlay();
      break;
    }
    case 'next-mission': {
      saved = false;
      const idx = MISSIONS.findIndex((x) => x.id === app.design!.missionId);
      app.view.setCloseupModel(null);
      app.view.setCraftAt(null);
      app.view.showTransfer(null);
      app.select.missionId = MISSIONS[(idx + 1) % MISSIONS.length].id;
      app.go('select');
      break;
    }
  }
}
