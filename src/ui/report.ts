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

const STEP_LABEL: Record<Tab, string> = { trajectory: 'Flight Dynamics desk', spacecraft: 'power rack', science: 'Science Lab', comms: 'antenna stands', launch: 'rocket table' };

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

  const ACC: Record<string, string> = { mars: '#ff7b47', jupiter: '#f2b56b', pluto: '#9cc3ff' };
  const OUT: Record<string, string> = { success: '#4fe08c', partial: '#ffc23d', failure: '#ff5c5c' };
  const frac = Math.min(1.5, sim.scienceFraction) / 1.5;
  const R = 52;
  const C = 2 * Math.PI * R;
  const icon = (t: string) => (t === 'good' ? '✓' : t === 'warn' ? '!' : '✕');
  const whyItems = why.length ? why.join('') : '<li class="good"><b>No surprises at all</b> - textbook systems engineering.</li>';
  const maxItem = Math.max(1, ...sim.score.items.map(([, v]) => Math.abs(v)));
  const objName = (m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0]).name;
  return `<div class="report rp ${sim.outcome}" id="report" style="--mc:${ACC[m.id] ?? '#4cc9ff'};--oc:${OUT[sim.outcome]}">
    <header class="rp-top">
      <div class="rp-crumb"><span>Post-mission report</span><b>${esc(m.name)}</b><em>${BODIES[m.target].name} · ${esc(objName)} · ${esc(d.difficulty)}</em></div>
      <button class="rp-x" data-act="redesign" aria-label="Back to the high bay">Back to the high bay</button>
    </header>

    <section class="rp-hero">
      <div class="rp-verdict">
        <div class="rp-badge"><i></i>${outcomeText}</div>
        <h1>${sim.outcome === 'success' ? 'Mission accomplished' : sim.outcome === 'partial' ? 'Partly there' : 'Signal lost'}</h1>
        <p class="headline">${esc(head.text)}</p>
        ${head.tab ? `<button class="rp-fix" data-act="fix-step" data-tab="${head.tab}"><span>Fix it at the ${STEP_LABEL[head.tab]}</span><i>→</i></button>` : ''}
        <div class="grade" aria-hidden="true">${stamp}</div>
      </div>
      <div class="rp-score">
        <div class="stars">${stars}</div>
        <div class="rp-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${R}" class="bg"/><circle cx="60" cy="60" r="${R}" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}"/><circle cx="60" cy="60" r="${R}" class="goal" style="stroke-dasharray:2 ${C};stroke-dashoffset:${-C / 1.5}"/></svg>
          <div class="rp-ring-t"><b>${Math.round(sim.science)}</b><span>of ${m.scienceTarget} science</span></div>
        </div>
        <div class="score"><b>${fmtInt(sim.score.total)}</b><span>points</span></div>
        <div class="rp-grade"><span>Grade</span><b>${esc(sim.score.grade)}</b></div>
      </div>
    </section>

    <div class="rp-grid">
      <section class="rp-card rp-why"><h3>Why it turned out this way</h3><ul class="why">${whyItems.replace(/<li class="(good|warn|bad)">/g, (_x, t) => `<li class="${t}"><i class="rp-ic">${icon(t)}</i><div>`).replace(/<\/li>/g, '</div></li>')}</ul></section>
      <section class="rp-card rp-whatif"><h3>${sim.outcome === 'success' ? 'Could you score even higher?' : 'One change that would have helped most'}</h3>${whatIfHTML}</section>

      <section class="rp-card rp-compare"><h3>You vs NASA</h3>
        <div class="rp-cmp">
          <div class="rp-col you"><h4><i></i>Your mission</h4>${myRows.map(([k, v]) => `<div class="kvrow"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
          <div class="rp-col nasa"><h4><i></i>${esc(m.nasa.name)}</h4>${m.nasa.facts.map(([k, v]) => `<div class="kvrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        </div>
        <p class="lesson"><b>Lesson from the real mission:</b> ${esc(m.nasa.lesson)} <a href="${m.nasa.url}" target="_blank" rel="noopener">Learn more at NASA ↗</a> · <button class="link-btn inline" data-act="validation">How we validated the physics</button></p>
      </section>

      <section class="rp-card rp-log"><h3>Mission log</h3><ol class="log">${sim.events.map((e) => `<li class="${e.tone}"><span>${formatJD(e.jd)}</span><b>${esc(e.title)}</b></li>`).join('')}</ol></section>

      <section class="rp-card rp-points"><h3>Score breakdown</h3><div class="budget">${sim.score.items.map(([k, v]) => `<div class="${v < 0 ? 'neg' : ''}"><span>${esc(k)}</span><i style="--w:${(Math.abs(v) / maxItem) * 100}%"></i><b>${v >= 0 ? '+' : ''}${fmtInt(v)}</b></div>`).join('')}<div class="total"><span>Total</span><b>${fmtInt(sim.score.total)}</b></div></div>
        ${app.team.enabled ? `<h3 class="sub">Team role goals</h3>${sim.roleGoals.map((g) => `<div class="check ${g.met ? 'ok' : 'warn'}">${statusIcon(g.met ? 'ok' : 'warn')}<div><b style="color:${ROLE_INFO[g.role].color}">${ROLE_INFO[g.role].title}</b><p>${esc(g.goal)}</p></div></div>`).join('')}` : ''}
      </section>

      <section class="rp-card rp-lb"><h3>Leaderboard · ${esc(m.name)}</h3>
        ${lb.length ? `<div class="lb">${lb.map((e, i) => `<div><span><i>${i + 1}</i>${esc(e.name)}</span><span>${esc(e.difficulty)}</span><b>${e.score}</b></div>`).join('')}</div>` : '<p class="small-note">No scores yet on this device. Be the first!</p>'}
        ${d.difficulty === 'sandbox' ? '<p class="small-note">Sandbox scores are not saved.</p>' : `<div class="save-row"><input id="lb-name" maxlength="20" placeholder="${app.team.enabled ? 'Team name' : 'Your name'}" value="${esc(app.playersSummary())}"><button class="btn small" data-act="save-score">Save score</button></div>`}
      </section>
    </div>

    <div class="report-actions rp-actions">
      <button class="rp-primary" data-act="redesign"><span>Improve the design</span><small>back to the high bay</small></button>
      <button class="rp-btn" data-act="fly-again">Fly again<small>new luck</small></button>
      <button class="rp-btn" data-act="nasa-design-report">NASA's design<small>compare</small></button>
      <button class="rp-btn" data-act="share">Share<small>copy link</small></button>
      <button class="rp-btn next" data-act="next-mission">Next mission<small>${esc(nextMission.name)} →</small></button>
    </div>
  </div>`;
}

let saved = false;

function backToDesign(app: App, tab?: Tab) {
  saved = false;
  if (tab) app.tab = tab;
  app.view.showTransfer(app.design!.transfer);
  app.backToHangar(tab);
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
