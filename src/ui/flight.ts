// Plays the simulated mission in 3D: launch, cruise, flyby, arrival, science.
import { encodeDesign } from '../game/persist';
import { hashString } from '../game/rng';
import { CallId, CallPoint, Calls, ROLE_INFO, SimEvent, SimResult, simulate } from '../game/simulate';
import { missionOf } from '../game/state';
import { AU, BODIES } from '../physics/constants';
import { planetState } from '../physics/ephemeris';
import { formatJD } from '../physics/time';
import { norm, sub } from '../physics/vec';
import { buildCraftModel } from '../scene/craftModel';
import { UNITS_PER_AU } from '../scene/solarSystem';
import type { App } from './app';
import { $, esc } from './dom';
import { sound } from './sound';
import { LANDINGS, POWER } from '../data/parts';
import type { SpaceCinema } from '../hangar/space';

const FRAME_AU: Record<string, number> = { mars: 2.3, jupiter: 6.8, pluto: 44 };

export class FlightPlayer {
  private sim: SimResult;
  private jd: number;
  private last = 0;
  private speed = 1;
  private pauseUntil = 0;
  private next = 0;
  private stopped = false;
  private finished = false;
  private arrived = false;
  private endAfterPause = false;
  /** the real-looking 3D flight (launch to landing) */
  private cin: SpaceCinema | null = null;
  // Mission Control decisions
  private seed: number;
  private calls: Calls = {};
  private autopilot: CallId[] = [];
  private callOpen: { ev: SimEvent; call: CallPoint; t0: number } | null = null;
  private callKeys = (e: KeyboardEvent) => {
    if (!this.callOpen) return;
    const n = Number(e.key);
    if (n >= 1 && n <= this.callOpen.call.options.length) {
      e.preventDefault();
      e.stopPropagation();
      this.choose(this.callOpen.call.options[n - 1].id, false);
    }
  };
  private static CALL_SECONDS = 30;

  constructor(private app: App) {
    const d = app.design!;
    const seed = app.demoSeed !== null ? (app.demoSeed + app.attempt - 1) >>> 0 : (hashString(encodeDesign(d)) ^ Math.imul(app.attempt, 2654435761)) >>> 0;
    this.speed = app.demoSpeed;
    this.seed = seed;
    this.sim = simulate(d, app.ev!, seed, app.team.enabled, this.calls);
    app.sim = this.sim;
    this.jd = d.transfer!.launchJD;
  }

  start() {
    const d = this.app.design!;
    const v = this.app.view;
    v.setCloseupModel(null);
    v.setDate(this.jd);
    v.showTransfer(d.transfer);
    v.setCraftAt(this.jd);
    v.followTarget('earth', 1.3);
    sound.droneStart();
    this.cin = this.app.hangar.startSpace(d, this.sim);
    if (this.cin) this.cin.speed = this.speed;
    this.renderHUD();
    this.last = performance.now();
    window.addEventListener('keydown', this.callKeys, true);
    requestAnimationFrame((t) => this.tick(t));
  }

  stop() {
    this.stopped = true;
    this.callOpen = null;
    window.removeEventListener('keydown', this.callKeys, true);
    sound.droneStop();
    this.cin?.stop();
    this.app.hangar.endSpace();
    const cd = $('#countdown');
    if (cd.classList.contains('edl')) {
      cd.className = '';
      cd.innerHTML = '';
    }
    $('#hud').innerHTML = '';
    $('#hud').className = '';
  }

  action(act: string, el: HTMLElement) {
    if (act === 'speed') {
      this.speed = Number(el.dataset.val);
      if (this.cin) this.cin.speed = this.speed;
      document.querySelectorAll('#hud .speed button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.val === el.dataset.val));
    } else if (act === 'skip') {
      this.finish();
    } else if (act === 'mc-pick' && this.callOpen && el.dataset.val) {
      this.choose(el.dataset.val, false);
    }
  }

  private renderHUD() {
    const m = missionOf(this.app.design!);
    const hud = $('#hud');
    hud.className = 'show';
    hud.innerHTML = `
      <div class="hud-main">
        <div class="hud-title">${esc(m.name)} <span>LIVE</span></div>
        <div class="hud-grid">
          <div><i>Date</i><b id="h-date">-</b></div>
          <div><i>Mission time</i><b id="h-met">-</b></div>
          <div><i>Distance from Sun</i><b id="h-sun">-</b></div>
          <div><i>Radio delay to Earth</i><b id="h-earth">-</b></div>
          <div><i>Power now</i><b id="h-power">-</b></div>
          <div><i>Science returned</i><b id="h-sci">0</b></div>
        </div>
        <div class="hud-phase" id="h-phase">Launch</div>
        <div class="hud-ctrl"><div class="speed" role="group" aria-label="Playback speed">
          ${[1, 2, 4].map((s) => `<button class="${this.speed === s ? 'on' : ''}" data-act="speed" data-val="${s}">${s}×</button>`).join('')}</div>
          <button class="btn small ghost" data-act="skip">Skip to results</button></div>
      </div>
      <div class="feed" id="h-feed" aria-live="polite"></div>
      <div class="flash" id="h-flash"></div>
      ${this.journeyHTML()}`;
  }

  /** Bottom progress bar: launch -> (flyby) -> arrival -> end of science phase, with event pins. */
  private journeyHTML(): string {
    const d = this.app.design!;
    const tr = d.transfer!;
    const m = missionOf(d);
    const L = tr.launchJD;
    const end = tr.arriveJD + m.primaryDays;
    const pos = (jd: number) => Math.min(100, Math.max(0, ((jd - L) / (end - L)) * 100));
    const pins = this.sim.events
      .filter((e) => e.phase !== 'launch' && e.phase !== 'end' && e.title !== 'Trajectory correction 1')
      .map((e, i) => `<i class="j-pin ${e.tone}" data-pin="${i}" style="left:${pos(e.jd)}%" title="${esc(e.title)}"></i>`)
      .join('');
    const target = BODIES[m.target].name;
    return `<div class="journey" aria-hidden="true">
      <span class="j-end">Earth</span>
      <div class="j-track">
        <i class="j-fill" id="j-fill"></i>
        ${tr.flyby ? `<span class="j-mark" style="left:${pos(tr.flyby.jd)}%">Jupiter</span>` : ''}
        <span class="j-mark arrive" style="left:${pos(tr.arriveJD)}%">${target}</span>
        ${pins}
        <b class="j-craft" id="j-craft"></b>
      </div>
      <span class="j-end">${m.type === 'flyby' ? 'Data home' : 'Science done'}</span>
    </div>`;
  }

  private updateHUD() {
    const d = this.app.design!;
    const tr = d.transfer!;
    const set = (id: string, v: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    const p = this.app.view.craftPosition();
    const rSun = p.length() / UNITS_PER_AU;
    const e = planetState('earth', this.jd).r;
    const pe = [p.x / UNITS_PER_AU * AU, -p.z / UNITS_PER_AU * AU, p.y / UNITS_PER_AU * AU] as [number, number, number];
    const rEarth = norm(sub(pe, e)) / AU;
    set('h-date', formatJD(this.jd));
    const met = this.jd - tr.launchJD;
    set('h-met', met < 365 ? `Day ${Math.floor(met)}` : `Year ${(met / 365.25).toFixed(1)}`);
    const mkm = (au: number) => (au * AU) / 1e6;
    set('h-sun', `${mkm(rSun) >= 1000 ? (mkm(rSun) / 1000).toFixed(2) + ' billion' : Math.round(mkm(rSun)) + ' million'} km`);
    const delayMin = (rEarth * AU) / 299792.458 / 60;
    set('h-earth', delayMin < 1 ? `${Math.max(0, Math.round(delayMin * 60))} s` : delayMin < 120 ? `${delayMin.toFixed(1)} min` : `${(delayMin / 60).toFixed(1)} hours`);
    const pw = POWER.find((x) => x.id === d.powerId)!;
    const yrs = Math.max(0, (this.jd - tr.launchJD) / 365.25);
    let watts = pw.kind === 'solar' ? (pw.watts / Math.max(0.3, rSun * rSun)) * Math.pow(1 - pw.decayPerYear, yrs) : pw.watts * Math.pow(1 - pw.decayPerYear, yrs);
    if (pw.kind === 'solar' && missionOf(d).type === 'lander' && this.jd >= tr.arriveJD) watts *= 0.25;
    set('h-power', `${Math.round(watts)} W`);
    const m = missionOf(d);
    const sciFrac = this.jd <= tr.arriveJD ? 0 : Math.min(1, (this.jd - tr.arriveJD) / m.primaryDays);
    set('h-sci', `${Math.round(this.sim.science * sciFrac)} / ${m.scienceTarget}`);
    const end = tr.arriveJD + m.primaryDays;
    const prog = Math.min(100, Math.max(0, ((this.jd - tr.launchJD) / (end - tr.launchJD)) * 100));
    const fill = document.getElementById('j-fill');
    if (fill) fill.style.width = `${prog}%`;
    const craft = document.getElementById('j-craft');
    if (craft) craft.style.left = `${prog}%`;
    if (this.cin) {
      const cruiseFrac = Math.min(1, Math.max(0, (this.jd - tr.launchJD) / Math.max(1, tr.arriveJD - tr.launchJD)));
      this.cin.setProgress(this.jd, cruiseFrac, { day: met, earthKm: rEarth * AU, delay: delayMin < 1 ? `${Math.max(1, Math.round(delayMin * 60))} s` : delayMin < 120 ? `${delayMin.toFixed(1)} min` : `${(delayMin / 60).toFixed(1)} hours`, sciFrac, power: watts });
    }
    set('h-phase', this.jd < tr.arriveJD ? (tr.flyby && this.jd < tr.flyby.jd ? 'Cruise to Jupiter' : `Cruise to ${BODIES[missionOf(d).target].name}`) : 'Science operations');
  }

  private showEvent(ev: SimEvent) {
    const feed = $('#h-feed');
    if (!feed) return;
    const card = document.createElement('div');
    const c = ev.call;
    card.className = `ev ${c ? c.tone : ev.tone}${c ? ' call' : ''}`;
    card.innerHTML = c
      ? `<div class="ev-date">${formatJD(ev.jd)} · Mission Control</div><b>${esc(ev.title)}: ${esc(c.options.find((o) => o.id === c.chosen)?.label ?? '')}</b><p>${esc(c.result)}</p><span class="saved">${this.autopilot.includes(c.id) ? 'Autopilot decided (time ran out)' : c.decided ? `Your call · ${esc(ROLE_INFO[c.role].title)}` : 'Flight rules decided'}</span>`
      : `<div class="ev-date">${formatJD(ev.jd)}</div><b>${esc(ev.title)}</b><p>${esc(ev.text)}</p>${ev.saved ? `<span class="saved">Saved by: ${esc(ev.saved)}</span>` : ''}`;
    feed.prepend(card);
    const pinIdx = this.sim.events.filter((e) => e.phase !== 'launch' && e.phase !== 'end' && e.title !== 'Trajectory correction 1').indexOf(ev);
    if (pinIdx >= 0) document.querySelector(`.j-pin[data-pin="${pinIdx}"]`)?.classList.add('hit');
    if (ev.tone === 'critical') {
      const fl = document.getElementById('h-flash');
      if (fl) {
        fl.classList.remove('on');
        void fl.offsetWidth;
        fl.classList.add('on');
      }
    }
    if (ev.phase !== 'launch' && ev.phase !== 'end') {
      const tone = c ? c.tone : ev.tone;
      if (tone === 'critical') sound.alarm();
      else if (tone === 'bad') sound.bad();
      else if (tone === 'good') sound.good();
      else sound.quindar();
    }
    while (feed.children.length > 4) feed.lastElementChild?.remove();
    this.cin?.onEvent(ev);

    const v = this.app.view;
    const m = missionOf(this.app.design!);
    if (ev.phase === 'launch' && ev.tone !== 'critical') {
      setTimeout(() => !this.stopped && v.frameSystem(FRAME_AU[m.id] ?? 6), 2200 / this.speed);
    } else if (ev.phase === 'flyby') {
      v.followTarget('jupiter', 3);
      setTimeout(() => !this.stopped && v.frameSystem(FRAME_AU[m.id] ?? 6), 2600 / this.speed);
    } else if (ev.phase === 'arrival' && !this.arrived) {
      this.arrived = true;
      v.followTarget(m.target, m.target === 'jupiter' ? 3.2 : 1.4);
      if (m.type !== 'lander') v.setCloseupModel(buildCraftModel(this.app.design!, m.target === 'jupiter' ? 0.35 : 0.14), m.target);
    }
  }

  private tick(now: number) {
    if (this.stopped || this.finished) return;
    const dt = Math.min(0.1, (now - this.last) / 1000) * this.speed;
    this.last = now;
    const d = this.app.design!;
    const m = missionOf(d);
    const tr = d.transfer!;
    if (this.cin) this.cin.speed = this.speed;
    if (this.callOpen) {
      const left = FlightPlayer.CALL_SECONDS - (now - this.callOpen.t0) / 1000;
      const tl = document.getElementById('mc-left');
      if (tl) tl.textContent = `${Math.max(0, Math.ceil(left))} s`;
      if (left <= 0) this.choose(this.callOpen.call.auto, true);
      this.updateHUD();
      requestAnimationFrame((t) => this.tick(t));
      return;
    }
    if (this.cin?.blocking()) {
      this.pauseUntil = Math.max(this.pauseUntil, now + 200);
      this.updateHUD();
      requestAnimationFrame((t) => this.tick(t));
      return;
    }
    if (now >= this.pauseUntil) {
      if (this.endAfterPause) {
        this.finish();
        return;
      }
      const cruiseSec = Math.min(22, Math.max(10, 8 + (tr.tofDays / 365.25) * 1.2));
      const rate = this.jd < tr.arriveJD ? tr.tofDays / cruiseSec : m.primaryDays / 8;
      let nj = this.jd + rate * dt;
      const ev = this.sim.events[this.next];
      if (ev && nj >= ev.jd && ev.call && this.calls[ev.call.id] === undefined) {
        // Mission Control: stop the clock and ask the player
        this.jd = Math.max(this.jd, ev.jd);
        this.openCall(ev);
        this.updateHUD();
        requestAnimationFrame((t) => this.tick(t));
        return;
      }
      if (ev && nj >= ev.jd) {
        nj = Math.max(this.jd, ev.jd);
        this.next++;
        this.showEvent(ev);
        // hold long enough to read the card (~4 words per second)
        const words = ev.text.split(/\s+/).length;
        let hold = ev.phase === 'end' ? 2200 : Math.min(5500, Math.max(ev.tone === 'info' ? 1800 : 2400, words * 230)) + (ev.tone === 'critical' ? 800 : 0);
        if (ev.title === 'Seven minutes of terror' && m.type === 'lander' && this.cin) {
          hold = 400;
        } else if (ev.title === 'Seven minutes of terror' && m.type === 'lander') {
          const nextEv = this.sim.events[this.next];
          hold = this.edl(nextEv && nextEv.tone === 'critical' ? 'Signal lost' : 'Touchdown') * this.speed + 400;
        }
        this.pauseUntil = now + hold / this.speed;
        if (ev.phase === 'end' || ev.tone === 'critical') this.endAfterPause = ev.phase === 'end' || this.isTerminal(ev);
      }
      this.jd = nj;
    }
    this.app.view.setDate(this.jd);
    this.app.view.setCraftAt(Math.min(this.jd, tr.arriveJD));
    this.updateHUD();
    requestAnimationFrame((t) => this.tick(t));
  }

  // ---------------------------------------------------------------- Mission Control
  private openCall(ev: SimEvent) {
    const call = ev.call!;
    this.callOpen = { ev, call, t0: performance.now() };
    const role = ROLE_INFO[call.role];
    const who = this.app.team.enabled ? `${esc(this.app.playerForRole(call.role))} · ${esc(role.title)}` : esc(role.title);
    const box = document.createElement('div');
    box.className = 'mc-call';
    box.id = 'mc-call';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Mission Control decision: ${call.title}`);
    box.style.setProperty('--rc', role.color);
    box.innerHTML = `
      <div class="mc-head"><span class="mc-kicker"><i></i>Mission Control · your call</span><span class="mc-role">${who}</span></div>
      <h3>${esc(call.title)}</h3>
      <p class="mc-prompt">${esc(call.prompt)}</p>
      <div class="mc-opts">${call.options
        .map((o, i) => `<button class="mc-opt" data-act="mc-pick" data-val="${o.id}"><b>${i + 1}</b><span>${esc(o.label)}</span><small>${esc(o.detail)}</small></button>`)
        .join('')}</div>
      <div class="mc-foot"><span class="mc-timer"><i style="animation-duration:${FlightPlayer.CALL_SECONDS}s"></i></span><span>If nobody answers, the autopilot plays it safe in <b id="mc-left">${FlightPlayer.CALL_SECONDS} s</b> · keys 1-${call.options.length}</span></div>`;
    $('#hud').appendChild(box);
    sound.quindar();
    setTimeout(() => box.classList.add('in'), 20);
  }

  private choose(optId: string, auto: boolean) {
    const open = this.callOpen;
    if (!open) return;
    const id = open.call.id;
    this.calls[id] = optId;
    if (auto) this.autopilot.push(id);
    this.callOpen = null;
    document.getElementById('mc-call')?.remove();
    sound.click();
    // re-fly the mission with this decision: the same luck, a new future
    const d = this.app.design!;
    this.sim = simulate(d, this.app.ev!, this.seed, this.app.team.enabled, this.calls);
    this.sim.autopilot = [...this.autopilot];
    this.app.sim = this.sim;
    this.cin?.updateSim(this.sim);
    const idx = this.sim.events.findIndex((e) => e.call?.id === id);
    this.next = Math.max(0, idx);
    const j = document.querySelector('#hud .journey');
    if (j) {
      j.outerHTML = this.journeyHTML();
      const pins = this.sim.events.filter((e) => e.phase !== 'launch' && e.phase !== 'end' && e.title !== 'Trajectory correction 1');
      pins.forEach((e, i) => {
        if (e.jd < this.jd) document.querySelector(`.j-pin[data-pin="${i}"]`)?.classList.add('hit');
      });
    }
    this.last = performance.now();
  }

  /** Mars entry, descent and landing in four beats. Returns its duration in ms. */
  private edl(final: string): number {
    const el = $('#countdown');
    const d = this.app.design!;
    const landing = LANDINGS.find((l) => l.id === d.landingId)!;
    const system = landing.id === 'airbags' ? 'Airbags' : landing.id === 'retro' ? 'Retro rockets' : 'Sky crane';
    const beats = [`Entry ${this.app.ev!.entrySpeed!.toFixed(1)} km/s`, 'Parachute', system, final];
    const step = 1000 / this.speed;
    el.className = 'show edl';
    beats.forEach((b, i) =>
      setTimeout(() => {
        if (this.stopped) return;
        el.innerHTML = `<div class="cd-ring"></div><div class="cd-num word ${i === 3 ? (final === 'Touchdown' ? 'final' : 'lost') : ''}">${esc(b)}</div><div class="cd-label">Seven minutes of terror · ${i + 1} / 4</div>`;
        if (i < 3) sound.countBeep(3);
        else if (final === 'Touchdown') sound.go();
        else sound.alarm();
      }, i * step),
    );
    setTimeout(() => {
      if (!el.classList.contains('edl')) return;
      el.classList.add('out');
      setTimeout(() => {
        el.className = '';
        el.innerHTML = '';
      }, 600);
    }, 4 * step + 250 / this.speed);
    return 4 * step + 250 / this.speed;
  }

  private isTerminal(ev: SimEvent) {
    // a critical event that ends the mission is followed directly by the 'end' event
    const i = this.sim.events.indexOf(ev);
    return this.sim.events[i + 1]?.phase === 'end' && this.sim.outcome === 'failure';
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.autopilot.length) this.sim.autopilot = [...this.autopilot];
    this.stop();
    this.app.screen = 'report';
    this.app.render();
  }
}
