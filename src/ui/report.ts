// Post-mission analysis: outcome, score, why it happened, and NASA comparison.
import { MISSIONS } from '../data/missions';
import { rocketById } from '../data/rockets';
import { POWER } from '../data/parts';
import { fmtM, formatRate } from '../game/evaluate';
import { encodeDesign, loadLeaderboard, saveLeader } from '../game/persist';
import { ROLE_INFO } from '../game/simulate';
import { missionOf } from '../game/state';
import { BODIES } from '../physics/constants';
import { formatDuration, formatJD } from '../physics/time';
import type { App } from './app';
import { $, esc, fmtInt, fmtKg, fmtW, pct, statusIcon, toast } from './dom';

export function renderReport(app: App): string {
  const d = app.design!;
  const ev = app.ev!;
  const sim = app.sim!;
  const m = missionOf(d);
  const tr = d.transfer!;
  const rocket = rocketById(d.rocketId);
  const power = POWER.find((p) => p.id === d.powerId)!;
  const outcomeText = sim.outcome === 'success' ? 'MISSION SUCCESS' : sim.outcome === 'partial' ? 'PARTIAL SUCCESS' : 'MISSION LOST';
  const stars = [0, 1, 2].map((i) => `<span class="star ${i < sim.score.stars ? 'on' : ''}">★</span>`).join('');
  const limits = ev.checks.filter((c) => c.status === 'warn');
  const saves = sim.events.filter((e) => e.saved);
  const losses = sim.events.filter((e) => e.tone === 'bad' || e.tone === 'critical');
  const lb = loadLeaderboard().filter((e) => e.missionId === m.id).slice(0, 5);
  const idx = MISSIONS.findIndex((x) => x.id === m.id);
  const nextMission = MISSIONS[(idx + 1) % MISSIONS.length];

  const why: string[] = [];
  for (const e of losses) why.push(`<li class="bad"><b>${esc(e.title)}</b> - ${esc(e.text)}</li>`);
  for (const e of saves) why.push(`<li class="good"><b>${esc(e.title)}</b> - saved by your choice: <i>${esc(e.saved!)}</i>.</li>`);
  for (const c of limits) why.push(`<li class="warn"><b>${esc(c.label)}</b> - ${c.detail}</li>`);
  const goodIds = ['rad', 'power', 'entry', 'data', 'dv', 'rover'];
  const goods = ev.checks.filter((c) => c.status === 'ok' && goodIds.includes(c.id)).sort((x, y) => goodIds.indexOf(x.id) - goodIds.indexOf(y.id)).slice(0, 3);
  for (const c of goods) why.push(`<li class="good"><b>Good call: ${esc(c.label)}</b> - ${c.detail}</li>`);
  if (!why.length) why.push('<li class="good">A clean mission: no failures and healthy margins everywhere. Textbook systems engineering.</li>');

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

  return `<div class="report" id="report">
    <div class="report-head ${sim.outcome}">
      <div class="eyebrow">Post-mission report · ${esc(m.name)} · ${BODIES[m.target].name}</div>
      <h1>${outcomeText}</h1>
      <div class="grade-row"><div class="grade">${sim.score.grade}</div><div class="stars">${stars}</div><div class="score"><b>${fmtInt(sim.score.total)}</b><span>points</span></div></div>
      <div class="sci-goal"><div class="sci-bar"><i style="width:${Math.min(100, (sim.scienceFraction / 1.5) * 100)}%"></i><span class="goal" style="left:${100 / 1.5}%"></span></div>
        <div class="sci-nums"><b>${Math.round(sim.science)}</b> science points returned / ${m.scienceTarget} goal</div></div>
    </div>

    <div class="report-grid">
      <section><h3>Why it turned out this way</h3><ul class="why">${why.join('')}</ul></section>

      <section><h3>Mission log</h3><ol class="log">${sim.events.map((e) => `<li class="${e.tone}"><span>${formatJD(e.jd)}</span><b>${esc(e.title)}</b></li>`).join('')}</ol></section>

      <section><h3>Score breakdown</h3><div class="budget">${sim.score.items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v >= 0 ? '+' : ''}${fmtInt(v)}</b></div>`).join('')}<div class="total"><span>Total</span><b>${fmtInt(sim.score.total)}</b></div></div>
        ${app.team.enabled ? `<h3>Team role goals</h3>${sim.roleGoals.map((g) => `<div class="check ${g.met ? 'ok' : 'warn'}">${statusIcon(g.met ? 'ok' : 'warn')}<div><b style="color:${ROLE_INFO[g.role].color}">${ROLE_INFO[g.role].title}</b><p>${esc(g.goal)}</p></div></div>`).join('')}` : ''}
      </section>

      <section class="compare"><h3>You vs NASA: ${esc(m.nasa.name)}</h3>
        <div class="cmp-cols"><div><h4>Your mission</h4>${myRows.map(([k, v]) => `<div class="kvrow"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
        <div><h4>${esc(m.nasa.name)}</h4>${m.nasa.facts.map(([k, v]) => `<div class="kvrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>
        <p class="lesson"><b>Lesson from the real mission:</b> ${esc(m.nasa.lesson)} <a href="${m.nasa.url}" target="_blank" rel="noopener">Learn more at NASA ↗</a></p>
      </section>

      <section><h3>Leaderboard: ${esc(m.name)}</h3>
        ${lb.length ? `<div class="lb">${lb.map((e, i) => `<div><span>${i + 1}. ${esc(e.name)}</span><span>${esc(e.difficulty)}</span><b>${e.score}</b></div>`).join('')}</div>` : '<p class="small-note">No scores yet on this device. Be the first!</p>'}
        <div class="save-row"><input id="lb-name" maxlength="20" placeholder="${app.team.enabled ? 'Team name' : 'Your name'}" value="${esc(app.playersSummary())}"><button class="btn small" data-act="save-score">Save score</button></div>
      </section>
    </div>

    <div class="report-actions">
      <button class="btn" data-act="redesign">Improve the design</button>
      <button class="btn ghost" data-act="fly-again">Fly again (new luck)</button>
      <button class="btn ghost" data-act="share">Share design</button>
      <button class="btn ghost" data-act="next-mission">Next: ${esc(nextMission.name)} →</button>
    </div>
  </div>`;
}

let saved = false;
export function reportAction(app: App, act: string, _el: HTMLElement) {
  if (app.screen !== 'report' && act !== 'close-event') return;
  switch (act) {
    case 'close-event':
      app.closeEvent();
      break;
    case 'redesign':
      saved = false;
      app.view.setCloseupModel(null);
      app.view.setCraftAt(null);
      app.view.showTransfer(app.design!.transfer);
      app.view.setDate(app.design!.transfer!.launchJD);
      app.view.frameSystem(missionOf(app.design!).target === 'pluto' ? 44 : missionOf(app.design!).target === 'jupiter' ? 6.8 : 2.3);
      app.screen = 'design';
      app.render();
      break;
    case 'fly-again':
      saved = false;
      app.view.setCloseupModel(null);
      app.screen = 'design';
      app.tab = 'launch';
      app.render();
      ($('[data-act=launch]') as HTMLButtonElement | null)?.click();
      break;
    case 'print':
      window.print();
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
