// Plays the simulated mission in 3D: launch, cruise, flyby, arrival, science.
import { encodeDesign } from '../game/persist';
import { hashString } from '../game/rng';
import { SimEvent, SimResult, simulate } from '../game/simulate';
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

  constructor(private app: App) {
    const d = app.design!;
    const seed = (hashString(encodeDesign(d)) ^ Math.imul(app.attempt, 2654435761)) >>> 0;
    this.sim = simulate(d, app.ev!, seed, app.team.enabled);
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
    this.renderHUD();
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  stop() {
    this.stopped = true;
    sound.droneStop();
    $('#hud').innerHTML = '';
    $('#hud').className = '';
  }

  action(act: string, el: HTMLElement) {
    if (act === 'speed') {
      this.speed = Number(el.dataset.val);
      document.querySelectorAll('#hud .speed button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.val === el.dataset.val));
    } else if (act === 'skip') {
      this.finish();
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
          <div><i>From Sun</i><b id="h-sun">-</b></div>
          <div><i>From Earth</i><b id="h-earth">-</b></div>
        </div>
        <div class="hud-phase" id="h-phase">Launch</div>
        <div class="hud-ctrl"><div class="speed" role="group" aria-label="Playback speed">
          <button class="on" data-act="speed" data-val="1">1×</button><button data-act="speed" data-val="2">2×</button><button data-act="speed" data-val="4">4×</button></div>
          <button class="btn small ghost" data-act="skip">Skip to results</button></div>
      </div>
      <div class="feed" id="h-feed" aria-live="polite"></div>`;
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
    set('h-sun', `${rSun.toFixed(2)} AU`);
    set('h-earth', `${rEarth.toFixed(2)} AU`);
    set('h-phase', this.jd < tr.arriveJD ? (tr.flyby && this.jd < tr.flyby.jd ? 'Cruise to Jupiter' : `Cruise to ${BODIES[missionOf(d).target].name}`) : 'Science operations');
  }

  private showEvent(ev: SimEvent) {
    const feed = $('#h-feed');
    if (!feed) return;
    const card = document.createElement('div');
    card.className = `ev ${ev.tone}`;
    card.innerHTML = `<div class="ev-date">${formatJD(ev.jd)}</div><b>${esc(ev.title)}</b><p>${esc(ev.text)}</p>${ev.saved ? `<span class="saved">Saved by: ${esc(ev.saved)}</span>` : ''}`;
    feed.prepend(card);
    if (ev.phase !== 'launch' && ev.phase !== 'end') {
      if (ev.tone === 'critical') sound.alarm();
      else if (ev.tone === 'bad') sound.bad();
      else if (ev.tone === 'good') sound.good();
      else sound.quindar();
    }
    while (feed.children.length > 4) feed.lastElementChild?.remove();

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
    if (now >= this.pauseUntil) {
      if (this.endAfterPause) {
        this.finish();
        return;
      }
      const cruiseSec = Math.min(22, Math.max(10, 8 + (tr.tofDays / 365.25) * 1.2));
      const rate = this.jd < tr.arriveJD ? tr.tofDays / cruiseSec : m.primaryDays / 8;
      let nj = this.jd + rate * dt;
      const ev = this.sim.events[this.next];
      if (ev && nj >= ev.jd) {
        nj = Math.max(this.jd, ev.jd);
        this.next++;
        this.showEvent(ev);
        const hold = ev.tone === 'critical' ? 3600 : ev.phase === 'end' ? 2200 : ev.tone === 'info' ? 1700 : 2400;
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

  private isTerminal(ev: SimEvent) {
    // a critical event that ends the mission is followed directly by the 'end' event
    const i = this.sim.events.indexOf(ev);
    return this.sim.events[i + 1]?.phase === 'end' && this.sim.outcome === 'failure';
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    this.app.screen = 'report';
    this.app.render();
  }
}
