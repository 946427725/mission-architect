import { MISSIONS, MissionDef, missionById } from '../data/missions';
import { ANTENNAS, AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER, SHIELDS, TRANSMITTERS } from '../data/parts';
import { ROCKETS, payloadAt, rocketById } from '../data/rockets';
import { Check, Evaluation, PROJECT_START_JD, Status, autoPropellant, evaluate, fmtM, formatRate } from '../game/evaluate';
import { GLOSSARY, term } from '../game/glossary';
import { decodeDesign, encodeDesign, loadLeaderboard } from '../game/persist';
import { mulberry32 } from '../game/rng';
import { ROLE_INFO, SimResult, roleGoals } from '../game/simulate';
import { Design, Difficulty, RoleId, TABS, Tab, TeamState, defaultDesign, missionOf } from '../game/state';
import { BODIES, BodyId } from '../physics/constants';
import { PorkchopGrid, computeGrid, transferAt } from '../physics/porkchop';
import { formatDuration, formatJD, formatJDShort } from '../physics/time';
import { CraftPreview } from '../scene/preview';
import { SolarSystemView } from '../scene/solarSystem';
import { $, $$, countdown, esc, fmtInt, fmtKg, fmtW, revLetter, statusIcon, toast, tween } from './dom';
import { FlightPlayer } from './flight';
import { PorkchopView, legendGradient } from './porkchop';
import { renderReport, reportAction } from './report';

type Screen = 'title' | 'select' | 'design' | 'flight' | 'report';
type MeterSpec = { id: string; tab: Tab; label: string; value: number; fmt: (v: number) => string; unit: string; of: string; fill: number | null; st: Status };

const TAB_LABEL: Record<Tab, string> = {
  trajectory: 'Trajectory',
  spacecraft: 'Spacecraft',
  science: 'Science',
  comms: 'Comms & Budget',
  launch: 'Launch',
};
const TAB_ROLE: Record<Tab, RoleId> = { trajectory: 'flight', spacecraft: 'engineer', science: 'science', comms: 'ops', launch: 'flight' };
const ROLE_ORDER: RoleId[] = ['flight', 'engineer', 'science', 'ops'];
const PROP_MAX: Record<string, number> = { mars: 400, jupiter: 2600, pluto: 500 };
const FRAME_AU: Record<string, number> = { mars: 2.3, jupiter: 6.8, pluto: 44 };

export class App {
  readonly view: SolarSystemView;
  preview: CraftPreview | null = null;
  screen: Screen = 'title';
  design: Design | null = null;
  ev: Evaluation | null = null;
  sim: SimResult | null = null;
  tab: Tab = 'trajectory';
  team: TeamState = { enabled: false, players: ['Player 1'], signoffs: { flight: false, engineer: false, science: false, ops: false } };
  attempt = 0;
  private grids = new Map<string, PorkchopGrid>();
  private gridLoading = new Map<string, Promise<PorkchopGrid>>();
  private pork: PorkchopView | null = null;
  private porkHost: HTMLElement | null = null;
  private porkKey = '';
  private idleJD = PROJECT_START_JD;
  select = { missionId: 'mars', difficulty: 'normal' as Difficulty, team: false, players: ['', '', '', ''], count: 2 };
  flight: FlightPlayer | null = null;
  panelAnim = true;
  private overlayScreen: Screen | null = null;
  private rev = 0;
  private revShown = 0;
  private lastPick: string | null = null;
  private inkPrev: { left: number; width: number } | null = null;
  private meterVals = new Map<string, number>();
  private topKey = '';

  constructor() {
    this.view = new SolarSystemView($('#space'));
    this.view.setDate(this.idleJD);
    this.view.setHighlight(['earth']);
    this.view.frameSystem(7);
    this.bindGlobal();
    const idle = () => {
      if (this.screen === 'title' || this.screen === 'select') {
        this.idleJD += 0.8;
        this.view.setDate(this.idleJD);
      }
      requestAnimationFrame(idle);
    };
    idle();
    // shared design link?
    const m = location.hash.match(/#d[-=]([\w-]+)/);
    const shared = m ? decodeDesign(m[1]) : null;
    if (shared) {
      this.startDesign(shared, false);
      this.tab = 'launch';
      toast('Loaded a shared mission design', 'good');
      this.render();
    } else this.render();
  }

  // ------------------------------------------------------------------ flow
  go(screen: Screen) {
    this.screen = screen;
    this.render();
  }

  startDesign(d: Design, team: boolean, players: string[] = []) {
    this.design = d;
    this.team = {
      enabled: team,
      players: team ? players : ['Player 1'],
      signoffs: { flight: false, engineer: false, science: false, ops: false },
    };
    this.tab = 'trajectory';
    this.sim = null;
    this.attempt = 0;
    this.screen = 'design';
    this.panelAnim = true;
    this.rev = 0;
    this.revShown = 0;
    this.inkPrev = null;
    const m = missionOf(d);
    this.view.setHighlight(this.highlightBodies());
    this.view.frameSystem(FRAME_AU[m.id] ?? 6);
    this.view.setDate(d.transfer?.launchJD ?? PROJECT_START_JD);
    this.view.showTransfer(d.transfer);
    this.view.setCraftAt(null);
    this.view.setCloseupModel(null);
    this.ensureGrid();
    this.evaluateNow();
  }

  private highlightBodies(): BodyId[] {
    const d = this.design;
    if (!d) return ['earth'];
    const m = missionOf(d);
    return d.trajectoryKind === 'jga' ? ['earth', 'jupiter', m.target] : ['earth', m.target];
  }

  evaluateNow() {
    if (this.design) this.ev = evaluate(this.design);
  }

  /** Called after any design change. */
  changed(opts: { panel?: boolean; resetSignoffs?: boolean } = {}) {
    this.evaluateNow();
    this.rev++;
    if (opts.resetSignoffs !== false && this.team.enabled && Object.values(this.team.signoffs).some(Boolean)) {
      this.team.signoffs = { flight: false, engineer: false, science: false, ops: false };
      toast('Design changed - team sign-offs reset', 'warn');
    }
    this.renderTopbar();
    if (opts.panel !== false) this.renderPanel();
    this.preview?.update(this.design!);
    this.updatePorkOverlay();
  }

  // ------------------------------------------------------------------ grids
  private gridKey() {
    const d = this.design!;
    return `${d.missionId}:${d.trajectoryKind}`;
  }

  private ensureGrid() {
    const key = this.gridKey();
    if (this.grids.has(key) || this.gridLoading.has(key)) return;
    const m = missionOf(this.design!);
    const spec = m.grids[this.design!.trajectoryKind]!;
    const p = computeGrid(spec, (f) => {
      const bar = $('#grid-progress');
      if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    });
    this.gridLoading.set(key, p);
    p.then((g) => {
      this.grids.set(key, g);
      this.gridLoading.delete(key);
      if (this.screen === 'design' && this.gridKey() === key) this.renderPanel();
    });
  }

  private reachC3(): number {
    const d = this.design!;
    const ev = this.ev!;
    const r = rocketById(d.rocketId);
    let lo = 0;
    let hi = 260;
    if (payloadAt(r, 0) < ev.mass.launch) return -1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (payloadAt(r, mid) >= ev.mass.launch) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  private updatePorkOverlay() {
    if (!this.pork || !this.design || !this.ev) return;
    const d = this.design;
    this.pork.setOverlay({
      readyJD: this.ev.readyJD,
      maxTofDays: missionOf(d).maxTofDays,
      reachC3: this.reachC3(),
      selected: d.transfer ? { launchJD: d.transfer.launchJD, tofDays: d.transfer.tofDays } : null,
    });
  }

  private zoom: { key: string; center: number; grid: PorkchopGrid | null } | null = null;
  private zoomCache = new Map<string, PorkchopGrid>();

  private zoomHalfDays(): number {
    const d = this.design!;
    return d.missionId === 'mars' ? 80 : d.missionId === 'jupiter' ? 110 : d.trajectoryKind === 'jga' ? 320 : 360;
  }

  private isZoomed(): boolean {
    return !!this.zoom && this.zoom.key === this.gridKey();
  }

  private activeGrid(): PorkchopGrid | undefined {
    if (this.isZoomed()) return this.zoom!.grid ?? undefined;
    return this.grids.get(this.gridKey());
  }

  private async zoomTo(centerJD: number, thenBest = false) {
    const base = this.grids.get(this.gridKey());
    if (!base) return;
    const half = this.zoomHalfDays();
    const s = base.spec;
    const start = Math.max(s.launchStartJD, Math.min(centerJD - half, s.launchEndJD - 2 * half));
    const end = Math.min(s.launchEndJD, start + 2 * half);
    const ck = `${this.gridKey()}@${Math.round(start)}`;
    const key = this.gridKey();
    this.zoom = { key, center: centerJD, grid: this.zoomCache.get(ck) ?? null };
    if (!this.zoom.grid) {
      this.renderPanel();
      const g = await computeGrid({ ...s, launchStartJD: start, launchEndJD: end, nx: s.kind === 'jga' ? 70 : 100 }, (f) => {
        const bar = $('#grid-progress');
        if (bar) bar.style.width = `${Math.round(f * 100)}%`;
      });
      this.zoomCache.set(ck, g);
      if (this.zoom && this.zoom.key === key && this.zoom.center === centerJD) this.zoom.grid = g;
      else return;
    }
    this.renderPanel();
    if (thenBest && this.zoom?.grid) {
      const b = this.bestCellIn(this.zoom.grid);
      if (b) {
        this.pickCell(this.zoom.grid, b.ix, b.iy);
        toast('Picked the lowest-energy launch your spacecraft is ready for', 'good');
      }
    }
  }

  /** Lowest-energy cell the spacecraft is ready for (and that respects limits). */
  private bestCellIn(grid: PorkchopGrid): { ix: number; iy: number } | null {
    const m = missionOf(this.design!);
    const s = grid.spec;
    let best: { ix: number; iy: number; score: number } | null = null;
    const body = BODIES[m.target];
    for (let ix = 0; ix < s.nx; ix++) {
      const L = s.launchStartJD + ((s.launchEndJD - s.launchStartJD) * ix) / (s.nx - 1);
      if (L < this.ev!.readyJD) continue;
      for (let iy = 0; iy < s.ny; iy++) {
        const tof = s.tofMinDays + ((s.tofMaxDays - s.tofMinDays) * iy) / (s.ny - 1);
        if (tof > m.maxTofDays) continue;
        const c3 = grid.c3[iy * s.nx + ix];
        if (!isFinite(c3)) continue;
        if (m.type === 'lander' && s.kind === 'direct') {
          const vinf = grid.extra[iy * s.nx + ix];
          if (Math.sqrt(vinf * vinf + (2 * body.mu) / (body.radius + 125)) > 7.3) continue;
        }
        // cheaper is better, but waiting years for a slightly cheaper window is not
        // Score in "C3-equivalent" units: a flyby burn costs spacecraft propellant (~40 per km/s),
        // a long trip costs RTG power, operations money and risk (~3 per year), and
        // waiting years for a slightly cheaper window is not worth it (~1.5 per year).
        const score = c3 + 40 * grid.flybyDv[iy * s.nx + ix] + (tof / 365.25) * 3 + ((L - this.ev!.readyJD) / 365.25) * 1.5;
        if (!best || score < best.score) best = { ix, iy, score };
      }
    }
    return best;
  }

  /** Launch windows = local minima of the cheapest C3 per launch date. */
  private windows(grid: PorkchopGrid): { jd: number; c3: number }[] {
    const m = missionOf(this.design!);
    const s = grid.spec;
    const cols: { jd: number; c3: number }[] = [];
    for (let ix = 0; ix < s.nx; ix++) {
      let mn = Infinity;
      for (let iy = 0; iy < s.ny; iy++) {
        const tof = s.tofMinDays + ((s.tofMaxDays - s.tofMinDays) * iy) / (s.ny - 1);
        if (tof > m.maxTofDays) continue;
        const v = grid.c3[iy * s.nx + ix];
        if (isFinite(v) && v < mn) mn = v;
      }
      if (isFinite(mn)) cols.push({ jd: s.launchStartJD + ((s.launchEndJD - s.launchStartJD) * ix) / (s.nx - 1), c3: mn });
    }
    if (!cols.length) return [];
    const sep = m.id === 'mars' ? 300 : m.id === 'jupiter' ? 250 : 200;
    const limit = Math.min(...cols.map((c) => c.c3)) * 2.2 + 15;
    const picked: { jd: number; c3: number }[] = [];
    for (const c of [...cols].sort((a, b) => a.c3 - b.c3)) {
      if (c.c3 > limit) break;
      if (picked.every((p) => Math.abs(p.jd - c.jd) > sep)) picked.push(c);
      if (picked.length >= 6) break;
    }
    return picked.sort((a, b) => a.jd - b.jd);
  }

  private mountPorkchop() {
    const slot = $('#pork-slot');
    if (!slot) return;
    const grid = this.activeGrid();
    if (!grid) return;
    const key = `${this.gridKey()}@${grid.spec.launchStartJD}`;
    if (this.porkKey !== key || !this.porkHost) {
      this.porkHost = document.createElement('div');
      this.porkHost.className = 'porkchop';
      this.porkKey = key;
      this.pork = null;
    }
    slot.appendChild(this.porkHost);
    if (!this.pork) {
      const m = missionOf(this.design!);
      const zoomed = this.isZoomed();
      const sp = grid.spec;
      this.pork = new PorkchopView(
        this.porkHost,
        grid,
        { readyJD: this.ev!.readyJD, maxTofDays: m.maxTofDays, reachC3: this.reachC3(), selected: null },
        (ix, iy) => this.hoverCell(grid, ix, iy, zoomed),
        () => this.leaveCell(),
        (ix, iy) => (zoomed ? this.pickCell(grid, ix, iy) : this.zoomTo(sp.launchStartJD + ((sp.launchEndJD - sp.launchStartJD) * ix) / (sp.nx - 1))),
      );
    }
    this.updatePorkOverlay();
    const r = this.pork.range;
    const lg = $('#pork-legend-range');
    if (lg) lg.innerHTML = `<span>${r.min.toFixed(0)}</span><span>C3 km²/s²</span><span>${r.max.toFixed(0)}+</span>`;
  }

  private hoverTimer = 0;
  private hoverCell(grid: PorkchopGrid, ix: number, iy: number, zoomed: boolean) {
    const tr = transferAt(grid, ix, iy);
    const out = $('#pork-readout');
    if (out && tr) out.innerHTML = this.transferSummary(tr, true) + (zoomed ? '' : '<div class="zoom-hint">Click to zoom into this launch window</div>');
    clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(() => {
      if (!tr) return;
      this.view.setDate(tr.launchJD);
      this.view.showTransfer(tr, true);
    }, 30);
  }

  private idleReadout(): string {
    return `<em>${this.isZoomed() ? 'Hover to preview a trajectory. Click to choose it.' : 'Hover to preview. Click a coloured window (or a date chip above) to zoom in.'}</em>`;
  }

  private leaveCell() {
    clearTimeout(this.hoverTimer);
    const d = this.design;
    if (!d) return;
    this.view.setDate(d.transfer?.launchJD ?? this.ev?.readyJD ?? PROJECT_START_JD);
    this.view.showTransfer(d.transfer);
    const out = $('#pork-readout');
    if (out) out.innerHTML = d.transfer ? this.transferSummary(d.transfer, false) : this.idleReadout();
  }

  private pickCell(grid: PorkchopGrid, ix: number, iy: number) {
    const tr = transferAt(grid, ix, iy);
    if (!tr || !this.design) return;
    this.design.transfer = tr;
    this.view.setDate(tr.launchJD);
    this.view.showTransfer(tr);
    this.changed();
  }

  private pickBest() {
    const base = this.grids.get(this.gridKey());
    if (!base) return;
    if (this.isZoomed() && this.zoom!.grid) {
      const b = this.bestCellIn(this.zoom!.grid);
      if (b) {
        this.pickCell(this.zoom!.grid, b.ix, b.iy);
        toast('Picked the lowest-energy launch in this window', 'good');
        return;
      }
    }
    const b = this.bestCellIn(base);
    if (!b) {
      toast('No launch window after your spacecraft is ready. Simplify the design!', 'warn');
      return;
    }
    const s = base.spec;
    this.zoomTo(s.launchStartJD + ((s.launchEndJD - s.launchStartJD) * b.ix) / (s.nx - 1), true);
  }

  transferSummary(tr: NonNullable<Design['transfer']>, hover: boolean): string {
    const m = missionOf(this.design!);
    const rows: [string, string][] = [
      ['Launch', formatJD(tr.launchJD)],
      ['Arrive', `${formatJD(tr.arriveJD)} (${formatDuration(tr.tofDays)})`],
      [`Launch energy ${term('c3', 'C3')}`, `${tr.c3.toFixed(1)} km²/s²`],
      [`Arrival speed ${term('vinf', 'v∞')}`, `${tr.vinfArr.toFixed(2)} km/s`],
    ];
    if (tr.flyby) rows.push(['Jupiter flyby', `${formatJD(tr.flyby.jd)} · ${tr.flyby.rpRadii.toFixed(1)} R♃ · burn ${(tr.flyby.dv * 1000).toFixed(0)} m/s`]);
    if (m.type === 'lander') {
      const b = BODIES[m.target];
      const v = Math.sqrt(tr.vinfArr ** 2 + (2 * b.mu) / (b.radius + 125));
      rows.push(['Entry speed', `${v.toFixed(2)} km/s`]);
    }
    return `<div class="kv ${hover ? 'hover' : ''}">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ rendering
  render() {
    document.body.dataset.screen = this.screen;
    this.view.setViewInset(window.innerWidth <= 900 ? 0 : this.screen === 'design' ? 480 : this.screen === 'title' ? Math.round(window.innerWidth * 0.55) : 0);
    this.renderTopbar();
    this.renderPanel();
    this.renderOverlay();
    const card = $('#craft-card');
    const showCraft = this.screen === 'design' && (this.tab === 'spacecraft' || this.tab === 'science');
    card.classList.toggle('show', showCraft);
    if (showCraft) {
      if (!this.preview) this.preview = new CraftPreview($('#craft-view'));
      this.preview.setVisible(true);
      this.preview.update(this.design!);
      $('#craft-caption').textContent = missionOf(this.design!).type === 'lander' ? 'Your rover (drag to rotate)' : 'Your spacecraft (drag to rotate)';
    } else this.preview?.setVisible(false);
  }

  private worst(checks: Check[]): Status {
    if (checks.some((c) => c.status === 'fail')) return 'fail';
    if (checks.some((c) => c.status === 'warn')) return 'warn';
    return 'ok';
  }

  renderTopbar() {
    const bar = $('#topbar');
    if (this.screen !== 'design' || !this.ev || !this.design) {
      if (this.topKey !== 'plain') {
        bar.innerHTML = `<div class="brand" role="button" data-act="home" tabindex="0"><span class="logo-mark"></span><span class="brand-text">Mission Architect</span></div>`;
        this.topKey = 'plain';
      }
      return;
    }
    const ev = this.ev;
    const m = ev.mission;
    const c = (ids: string[]) => this.worst(ev.checks.filter((k) => ids.includes(k.id)));
    const cap = ev.mass.capacity;
    const specs: MeterSpec[] = [
      { id: 'mass', tab: 'launch', label: 'Mass', value: ev.mass.launch, fmt: fmtInt, unit: 'kg', of: cap !== null ? `/ ${fmtInt(cap)}` : 'no route', fill: cap ? ev.mass.launch / cap : null, st: c(['lv', 'rover']) },
      { id: 'power', tab: 'spacecraft', label: 'Power', value: ev.power.avgLoad, fmt: fmtInt, unit: 'W', of: `/ ${fmtInt(ev.power.generated)}`, fill: ev.power.avgLoad / Math.max(1, ev.power.generated), st: c(['power', 'battery']) },
      { id: 'dv', tab: 'spacecraft', label: 'Δv', value: ev.dv.required * 1000, fmt: fmtInt, unit: 'm/s', of: `/ ${fmtInt(ev.dv.available * 1000)}`, fill: ev.dv.required / Math.max(1e-6, ev.dv.available), st: c(['dv']) },
      { id: 'budget', tab: 'comms', label: 'Budget', value: ev.cost.total, fmt: (v) => '$' + fmtM(v), unit: '', of: `/ $${fmtM(ev.cost.cap)}`, fill: ev.cost.total / ev.cost.cap, st: c(['budget']) },
      { id: 'data', tab: 'comms', label: 'Data', value: ev.data.fraction * 100, fmt: fmtInt, unit: '%', of: 'returned', fill: ev.data.fraction, st: c(['data']) },
      { id: 'science', tab: 'science', label: 'Science', value: ev.science.potential, fmt: fmtInt, unit: 'pts', of: `/ ${m.scienceTarget}`, fill: ev.science.potential / m.scienceTarget, st: c(['sci', 'hga']) },
      { id: 'time', tab: 'trajectory', label: 'Cruise', value: ev.time.tofDays ?? 0, fmt: (v) => (ev.time.tofDays ? formatDuration(v) : 'No route'), unit: '', of: `ready ${formatJDShort(ev.readyJD)}`, fill: ev.time.tofDays ? ev.time.tofDays / m.maxTofDays : null, st: c(['traj', 'ready', 'tof', 'entry']) },
    ];
    const key = `design:${m.id}`;
    if (this.topKey !== key) {
      this.topKey = key;
      this.meterVals.clear();
      bar.innerHTML = `
        <div class="brand" role="button" data-act="home" tabindex="0"><span class="logo-mark"></span><span class="brand-text">Mission Architect</span>
          <span class="brand-sub"><b>${esc(m.name)}</b>${BODIES[m.target].name} ${m.type} · ${this.design.difficulty}</span></div>
        <div class="meters">${specs
          .map((s) => `<button class="meter" data-act="tab" data-tab="${s.tab}" data-meter="${s.id}"><span class="m-label"><span>${s.label}</span><span class="m-of"></span></span><span class="m-value"><span class="m-num">${s.fmt(0)}</span><small>${s.unit}</small></span><span class="m-bar"><i></i></span></button>`)
          .join('')}</div>`;
    }
    for (const s of specs) {
      const el = bar.querySelector(`[data-meter="${s.id}"]`) as HTMLElement | null;
      if (!el) continue;
      el.className = `meter ${s.st}`;
      el.title = `${s.label}: ${s.fmt(s.value)} ${s.unit} ${s.of}`;
      (el.querySelector('.m-of') as HTMLElement).textContent = s.of;
      (el.querySelector('.m-bar i') as HTMLElement).style.width = `${s.fill === null ? 0 : Math.min(100, Math.max(2, s.fill * 100))}%`;
      const num = el.querySelector('.m-num') as HTMLElement;
      const prev = this.meterVals.get(s.id);
      if (prev === undefined) tween(num, 0, s.value, s.fmt, 1000);
      else if (Math.abs(prev - s.value) > 1e-6) {
        tween(num, prev, s.value, s.fmt, 550);
        void el.offsetWidth;
        el.classList.add('bump');
      } else num.textContent = s.fmt(s.value);
      this.meterVals.set(s.id, s.value);
    }
  }

  private placeInk() {
    const ink = $('#panel .tab-ink');
    const act = $('#panel .tab.active');
    if (!ink || !act) return;
    const to = { left: act.offsetLeft, width: act.offsetWidth };
    const from = this.inkPrev ?? to;
    ink.style.left = `${from.left}px`;
    ink.style.width = `${from.width}px`;
    this.inkPrev = to;
    if (from.left === to.left && from.width === to.width) return;
    void ink.offsetWidth;
    ink.classList.add('moving');
    ink.style.left = `${to.left}px`;
    ink.style.width = `${to.width}px`;
  }

  renderPanel() {
    const panel = $('#panel');
    if (this.screen !== 'design' || !this.design || !this.ev) {
      panel.innerHTML = '';
      return;
    }
    const scroll = $('.panel-body', panel)?.scrollTop ?? 0;
    const ev = this.ev;
    const tabs = TABS.map((t, i) => {
      const st = this.worst(ev.checks.filter((c) => c.area === t));
      return `<button class="tab ${t === this.tab ? 'active' : ''}" data-act="tab" data-tab="${t}"><span class="num">${i + 1}</span>${TAB_LABEL[t]}<i class="dot ${st}"></i></button>`;
    }).join('');
    const role = TAB_ROLE[this.tab];
    const who = this.team.enabled
      ? `<div class="role-banner" style="--rc:${ROLE_INFO[role].color}"><span class="role-dot"></span><b>${esc(this.playerFor(role))}</b> · ${ROLE_INFO[role].title}<span class="role-owns">${ROLE_INFO[role].owns}</span></div>`
      : '';
    const hint = this.design.difficulty !== 'hard' ? `<div class="hint"><span class="hint-title">Flight Director</span>${ev.mission.hints[this.tab]}</div>` : '';
    let body = '';
    switch (this.tab) {
      case 'trajectory': body = this.tabTrajectory(); break;
      case 'spacecraft': body = this.tabSpacecraft(); break;
      case 'science': body = this.tabScience(); break;
      case 'comms': body = this.tabComms(); break;
      case 'launch': body = this.tabLaunch(); break;
    }
    const checks = ev.checks.filter((c) => c.area === this.tab);
    const idx = TABS.indexOf(this.tab);
    const enter = this.panelAnim;
    this.panelAnim = false;
    const revBump = this.rev !== this.revShown;
    this.revShown = this.rev;
    const mm = ev.mission;
    panel.innerHTML = `
      <nav class="tabs" role="tablist">${tabs}<i class="tab-ink"></i></nav>
      <div class="titleblock"><span>DWG <b>MA-${mm.id.toUpperCase()}-0${idx + 1}</b> · ${esc(mm.name)}</span><span>SHEET <b>${idx + 1}/5</b></span><span class="rev ${revBump && !enter ? 'bump' : ''}">REV <b>${revLetter(this.rev)}</b></span></div>
      <div class="panel-body ${enter ? 'enter' : ''}">
        ${who}${hint}
        ${body}
        ${checks.length ? `<section class="checks"><h3>Inspection</h3>${checks.map((c) => `<div class="check ${c.status}">${statusIcon(c.status)}<div><b>${c.label}</b><p>${c.detail}</p></div></div>`).join('')}</section>` : ''}
        <div class="nav-btns">
          ${idx > 0 ? `<button class="btn ghost" data-act="tab" data-tab="${TABS[idx - 1]}">← ${TAB_LABEL[TABS[idx - 1]]}</button>` : '<span></span>'}
          ${idx < TABS.length - 1 ? `<button class="btn" data-act="tab" data-tab="${TABS[idx + 1]}">${TAB_LABEL[TABS[idx + 1]]} →</button>` : ''}
        </div>
      </div>`;
    const pb = $('.panel-body', panel);
    if (pb) {
      pb.scrollTop = enter ? 0 : scroll;
      Array.from(pb.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(Math.min(i, 14))));
    }
    this.placeInk();
    if (this.lastPick) {
      const [k, v] = this.lastPick.split('=');
      const sel = k === 'instr' ? `[data-act="instr"][data-val="${v}"]` : `[data-key="${k}"][data-val="${v}"]`;
      panel.querySelector(sel)?.classList.add('just');
      this.lastPick = null;
    }
    if (this.tab === 'trajectory') this.mountPorkchop();
  }

  private playerFor(role: RoleId): string {
    const i = ROLE_ORDER.indexOf(role);
    const p = this.team.players;
    return p[i % p.length] || `Player ${(i % p.length) + 1}`;
  }

  // ---------------------------------------------------------------- tabs
  private tabTrajectory(): string {
    const d = this.design!;
    const m = missionOf(d);
    const base = this.grids.get(this.gridKey());
    if (!base) this.ensureGrid();
    const zoomed = this.isZoomed();
    const grid = this.activeGrid();
    const routes = m.grids.jga
      ? `<div class="seg" role="radiogroup" aria-label="Route">
          <button class="${d.trajectoryKind === 'direct' ? 'on' : ''}" data-act="route" data-val="direct">Direct</button>
          <button class="${d.trajectoryKind === 'jga' ? 'on' : ''}" data-act="route" data-val="jga">Via Jupiter ${term('gravityassist', 'gravity assist')}</button>
        </div>`
      : '';
    const wins = base ? this.windows(base) : [];
    const chips = base
      ? `<div class="windows"><span>${term('window', 'Launch windows')}:</span>${wins
          .map((w) => `<button class="chip ${zoomed && Math.abs(w.jd - this.zoom!.center) < this.zoomHalfDays() ? 'on' : ''} ${w.jd < this.ev!.readyJD ? 'early' : ''}" data-act="zoom" data-val="${w.jd}" title="${w.jd < this.ev!.readyJD ? 'Your spacecraft is not ready this early' : 'Zoom into this window'}">${formatJDShort(w.jd)}<small>C3 ${w.c3.toFixed(0)}</small></button>`)
          .join('')}${zoomed ? '<button class="chip back" data-act="unzoom">← All years</button>' : ''}</div>`
      : '';
    const ls = m.grids[d.trajectoryKind]!;
    return `
      <h2>Choose your launch window</h2>
      <p class="lead">This is a ${term('porkchop', 'porkchop plot')}, the same tool NASA uses. Each pixel is a real trajectory computed from planet positions. <b>Deep blue = cheap, red = expensive.</b> Inside the <b class="white">black outline</b> your current rocket can lift your current spacecraft.</p>
      ${routes}
      ${chips}
      ${grid
        ? `<div id="pork-slot"></div>
           <div class="legend"><div class="legend-bar" style="background:${legendGradient()}"></div><div class="legend-range" id="pork-legend-range"></div></div>
           <div class="readout" id="pork-readout">${d.transfer ? this.transferSummary(d.transfer, false) : this.idleReadout()}</div>
           <button class="btn small" data-act="best">Find cheapest launch I'm ready for</button>`
        : `<div class="loading">Solving ${fmtInt(ls.nx * ls.ny * (d.trajectoryKind === 'jga' ? 40 : 1))} Lambert problems with real planet positions...<div class="progress"><i id="grid-progress"></i></div></div>`}
    `;
  }

  private optCard(key: string, id: string, title: string, desc: string, stats: [string, string][], selected: boolean, extra = ''): string {
    return `<button class="opt ${selected ? 'sel' : ''}" data-act="set" data-key="${key}" data-val="${id}" aria-pressed="${selected}">
      <span class="opt-title">${title}${extra}</span>
      <span class="opt-desc">${desc}</span>
      <span class="opt-stats">${stats.map(([k, v]) => `<span><i>${k}</i>${v}</span>`).join('')}</span>
    </button>`;
  }

  private tabSpacecraft(): string {
    const d = this.design!;
    const m = missionOf(d);
    const ev = this.ev!;
    let html = '<h2>Design your spacecraft</h2>';
    if (m.type === 'lander') {
      html += `<h3>Landing system</h3><div class="opts">${LANDINGS.map((l) =>
        this.optCard('landingId', l.id, l.name, l.desc, [['Max rover', fmtKg(l.maxRover)], ['EDL mass', fmtKg(l.edlMass)], ['Cost', `$${l.costM}M`], ['Risk', `${(l.risk * 100).toFixed(0)}%`]], d.landingId === l.id),
      ).join('')}</div>`;
    }
    if (m.type === 'orbiter') {
      html += `<h3>Science orbit</h3><div class="opts">${JUPITER_ORBITS.map((o) => {
        const e = evaluate({ ...d, orbitId: o.id });
        return this.optCard('orbitId', o.id, o.name, o.desc, [['Insertion burn', d.transfer ? `${fmtInt(e.dv.insertion * 1000)} m/s` : '-'], ['Close passes', `${Math.round(e.radiation!.plannedOrbits)}`], ['Dose/orbit', `${o.dosePerOrbit} ${term('krad', 'krad')}`]], d.orbitId === o.id);
      }).join('')}</div>`;
    }
    const powers = POWER.filter((p) => m.powerIds.includes(p.id));
    html += `<h3>Power source</h3><div class="opts">${powers.map((p) => {
      const e = evaluate({ ...d, powerId: p.id });
      return this.optCard('powerId', p.id, p.kind === 'rtg' ? `${p.name} ${term('rtg', 'ⓘ')}` : p.name, p.desc, [[`At ${BODIES[m.target].name}`, fmtW(e.power.generated)], ['Mass', fmtKg(p.mass)], ['Cost', `$${p.costM}M`]], d.powerId === p.id);
    }).join('')}</div>`;
    html += `<h3>Battery</h3><div class="seg wrap">${[{ id: 'none', name: 'None', wh: 0 }, ...BATTERIES].map((b) => `<button class="${d.batteryId === b.id ? 'on' : ''}" data-act="set" data-key="batteryId" data-val="${b.id}">${b.name}</button>`).join('')}</div>
      <p class="small-note">Batteries cover power peaks${m.type === 'lander' ? ' and keep a solar rover warm at night' : ''}. Need ${fmtInt(ev.power.batteryNeedWh)} Wh, have ${fmtInt(ev.power.batteryWh)} Wh usable.</p>`;
    html += `<h3>Computer & redundancy</h3><div class="opts two">${AVIONICS.map((a) => this.optCard('avionicsId', a.id, a.name, a.desc, [['Mass', `+${a.mass} kg`], ['Cost', `+$${a.costM}M`]], d.avionicsId === a.id)).join('')}</div>`;
    if (m.type === 'orbiter') {
      html += `<h3>Radiation protection</h3><div class="opts">${SHIELDS.map((s) => {
        const e = evaluate({ ...d, shieldId: s.id });
        return this.optCard('shieldId', s.id, s.name, s.desc, [['Survives', `${e.radiation!.maxOrbits.toFixed(0)} orbits`], ['Mass', `+${s.mass} kg`], ['Cost', `+$${s.costM}M`]], d.shieldId === s.id);
      }).join('')}</div>`;
    }
    html += `<h3>Propellant ${term('dv', 'ⓘ')}</h3>
      <div class="slider-row">
        <input type="range" min="0" max="${PROP_MAX[m.id] ?? 1000}" step="5" value="${d.propellantKg}" data-key="propellantKg" aria-label="Propellant mass">
        <output data-live="prop">${fmtKg(d.propellantKg)}</output>
      </div>
      <p class="small-note" data-live="dvnote">Gives ${fmtInt(ev.dv.available * 1000)} m/s of ${fmtInt(ev.dv.required * 1000)} m/s needed. Engine ${term('isp', 'Isp')} ${m.isp} s.</p>
      <button class="btn small" data-act="autoprop">Auto-size for +15% margin</button>`;
    return html;
  }

  private tabScience(): string {
    const d = this.design!;
    const m = missionOf(d);
    const ev = this.ev!;
    const unit = m.type === 'flyby' ? 'Gbit total' : 'Mbit/day';
    const pctSci = Math.min(1.5, ev.science.potential / m.scienceTarget);
    return `<h2>Pick your science instruments</h2>
      <p class="lead">${esc(m.objective)}</p>
      <div class="sci-goal"><div class="sci-bar"><i style="width:${(pctSci / 1.5) * 100}%"></i><span class="goal" style="left:${(1 / 1.5) * 100}%"></span></div>
        <div class="sci-nums"><b>${Math.round(ev.science.potential)}</b> expected / ${m.scienceTarget} goal</div></div>
      <div class="opts">${m.instruments.map((i) => {
        const on = d.instruments.includes(i.id);
        return `<button class="opt instr ${on ? 'sel' : ''}" data-act="instr" data-val="${i.id}" aria-pressed="${on}">
          <span class="opt-title">${esc(i.name)} <em>like ${esc(i.analog)}</em>${i.outreach ? '<span class="tag">outreach</span>' : ''}${i.needsHGA ? '<span class="tag">needs dish</span>' : ''}</span>
          <span class="opt-desc">${esc(i.desc)}</span>
          <span class="opt-stats"><span><i>Science</i>+${i.science}</span><span><i>Mass</i>${i.mass} kg</span><span><i>Power</i>${i.power} W</span><span><i>Cost</i>$${i.costM}M</span><span><i>Data</i>${i.data} ${unit}</span></span>
        </button>`;
      }).join('')}</div>
      <details class="breakdown"><summary>Where your science comes from</summary>${ev.science.items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v.toFixed(1)}</b></div>`).join('')}</details>`;
  }

  private tabComms(): string {
    const d = this.design!;
    const m = missionOf(d);
    const ev = this.ev!;
    const dataBar = Math.min(1, ev.data.fraction);
    return `<h2>Communications & budget</h2>
      <p class="lead">Your spacecraft is ~${ev.data.earthDistAU.toFixed(1)} ${term('au', 'AU')} from Earth. Radio signals weaken with distance squared, so data rate = transmitter power × dish area ÷ distance².</p>
      <h3>Antenna ${term('hga', 'ⓘ')}</h3><div class="opts two">${ANTENNAS.map((a) => this.optCard('antennaId', a.id, a.name, a.desc, [['Mass', `${a.mass} kg`], ['Cost', `$${a.costM}M`]], d.antennaId === a.id)).join('')}</div>
      <h3>Transmitter</h3><div class="seg wrap">${TRANSMITTERS.map((t) => `<button class="${d.txId === t.id ? 'on' : ''}" data-act="set" data-key="txId" data-val="${t.id}">${t.name}<small>${t.dcW} W from power bus</small></button>`).join('')}</div>
      <h3>${term('dsn', 'Deep Space Network')} time</h3>
      <div class="seg"><button class="${d.dsnDish === 34 ? 'on' : ''}" data-act="dish" data-val="34">34 m dish</button><button class="${d.dsnDish === 70 ? 'on' : ''}" data-act="dish" data-val="70">70 m dish (4.2× data)</button></div>
      <div class="slider-row"><input type="range" min="1" max="24" step="1" value="${d.dsnHours}" data-key="dsnHours" aria-label="DSN hours per day"><output data-live="dsn">${d.dsnHours} h/day</output></div>
      <div class="data-box">
        <div class="kv"><div><span>Link rate</span><b data-live="rate">${formatRate(ev.data.rateBps)}</b></div>
        <div><span>${m.type === 'flyby' ? 'Data to send' : 'Data made per day'}</span><b>${ev.data.generated.toFixed(1)} ${ev.data.unit}</b></div>
        <div><span>${m.type === 'flyby' ? `Can send in ${Math.round(m.primaryDays / 30)} months` : 'Can send per day'}</span><b data-live="cap">${ev.data.capacity.toFixed(1)} ${ev.data.unit}${m.type === 'lander' ? ' (incl. relay orbiters)' : ''}</b></div></div>
        <div class="sci-bar data"><i style="width:${dataBar * 100}%"></i></div>
      </div>
      <h3>Budget</h3>
      <div class="budget">${ev.cost.items.map(([k, v]) => `<div><span>${esc(k)}</span><b>$${fmtM(v)}</b></div>`).join('')}
        <div class="total ${ev.cost.total > ev.cost.cap ? 'over' : ''}"><span>Total vs cap</span><b>$${fmtM(ev.cost.total)} / $${fmtM(ev.cost.cap)}</b></div></div>`;
  }

  private tabLaunch(): string {
    const d = this.design!;
    const ev = this.ev!;
    const tr = d.transfer;
    const rockets = ROCKETS.map((r) => {
      const cap = tr ? payloadAt(r, tr.c3) : null;
      const okLift = cap !== null && cap >= ev.mass.launch;
      const fill = cap ? Math.min(1, ev.mass.launch / Math.max(1, cap)) : 0;
      return `<button class="opt rocket ${d.rocketId === r.id ? 'sel' : ''} ${cap !== null && !okLift ? 'cant' : ''}" data-act="set" data-key="rocketId" data-val="${r.id}" aria-pressed="${d.rocketId === r.id}">
        <span class="opt-title">${r.name}<span class="price">$${fmtM(r.costM)}</span></span>
        <span class="opt-desc">${r.desc}</span>
        ${cap !== null ? `<span class="lift"><span class="lift-bar"><i style="width:${fill * 100}%" class="${okLift ? '' : 'over'}"></i></span><span>${okLift ? 'Can lift' : "Can't lift"}: ${fmtKg(cap)} at your C3</span></span>` : '<span class="lift muted">Pick a trajectory to see capacity</span>'}
        <span class="opt-stats"><span><i>Reliability</i>${(r.reliability * 100).toFixed(1)}%</span><span><i>Flew</i>${esc(r.flew)}</span></span>
      </button>`;
    }).join('');

    // GO / NO-GO poll
    const stations: [string, Tab][] = [['Flight Dynamics', 'trajectory'], ['Spacecraft', 'spacecraft'], ['Science', 'science'], ['Comms & Ground', 'comms'], ['Launch & Budget', 'launch']];
    const poll = stations.map(([name, area]) => {
      const st = this.worst(ev.checks.filter((c) => c.area === area));
      return `<button class="poll ${st}" data-act="tab" data-tab="${area}"><span>${name}</span><b>${st === 'fail' ? 'NO-GO' : 'GO'}</b></button>`;
    }).join('');

    let team = '';
    if (this.team.enabled) {
      const goals = roleGoals(ev);
      team = `<h3>Team sign-off</h3><p class="small-note">Every role must approve. Each role also has a personal goal worth bonus points - negotiate!</p>
        <div class="signoffs">${ROLE_ORDER.map((r) => {
          const g = goals.find((x) => x.role === r)!;
          return `<label class="signoff" style="--rc:${ROLE_INFO[r].color}"><input type="checkbox" data-act="sign" data-role="${r}" ${this.team.signoffs[r] ? 'checked' : ''}>
            <span><b>${esc(this.playerFor(r))}</b> · ${ROLE_INFO[r].title}<small class="${g.met ? 'met' : ''}">${g.met ? '✓' : '○'} Goal: ${g.goal}</small></span></label>`;
        }).join('')}</div>`;
    }
    const allSigned = !this.team.enabled || ROLE_ORDER.every((r) => this.team.signoffs[r]);
    const canLaunch = ev.launchable && allSigned;
    return `<h2>Choose a rocket & launch</h2>
      ${tr ? `<p class="lead">Your spacecraft weighs <b>${fmtKg(ev.mass.launch)}</b> and needs launch energy ${term('c3', 'C3')} = <b>${tr.c3.toFixed(1)} km²/s²</b>. The faster you must leave Earth, the less a rocket can carry.</p>` : '<p class="lead warn-text">Pick a trajectory first (tab 1).</p>'}
      <div class="opts">${rockets}</div>
      <h3>Mission control GO / NO-GO poll</h3>
      <div class="polls">${poll}</div>
      ${team}
      <div class="launch-row">
        <button class="btn launch" data-hold="launch" data-act="launch-hint" ${canLaunch ? '' : 'disabled'}><i class="hold-fill"></i><span>${ev.launchable ? (allSigned ? 'Launch' : 'Waiting for sign-offs') : 'No-go · fix red items'}${canLaunch ? '<small>Press and hold</small>' : ''}</span></button>
        <button class="btn ghost small" data-act="share">Copy share link</button>
      </div>`;
  }

  // ---------------------------------------------------------------- overlays
  renderOverlay() {
    const o = $('#overlay');
    if (this.screen === 'title') o.innerHTML = this.titleHTML();
    else if (this.screen === 'select') o.innerHTML = this.selectHTML();
    else if (this.screen === 'report' && this.sim) o.innerHTML = renderReport(this);
    else o.innerHTML = '';
    const changed = this.overlayScreen !== this.screen;
    this.overlayScreen = this.screen;
    o.className = (this.screen === 'design' || this.screen === 'flight' ? '' : 'show') + (changed ? ' enter' : '');
    if (changed && this.screen === 'report' && this.sim) {
      const total = this.sim.score.total;
      setTimeout(() => {
        const s = $('#report .score b');
        if (s) tween(s, 0, total, fmtInt, 1300);
      }, 450);
    }
  }

  private titleHTML(): string {
    const lb = loadLeaderboard().slice(0, 3);
    return `<div class="title-card">
      <div class="eyebrow">NASA Space Apps Challenge 2026 · Space Mission Design Game</div>
      <h1><span class="w"><span>Mission</span></span><span class="w"><span>Architect</span></span></h1>
      <p class="tagline">Design a real space mission. <b>Physics decides</b> if it works.</p>
      <ul class="features">
        <li><b>Real orbits</b>Trajectories solved from NASA/JPL planet positions. New Horizons' Jupiter flyby reproduced within 2%.</li>
        <li><b>Real trade-offs</b>Mass, power, Δv, budget, data, radiation and time pull against each other.</li>
        <li><b>Learn by failing</b>Every outcome is explained, then compared with the real NASA mission.</li>
      </ul>
      <div class="cta on-space">
        <button class="btn big" data-act="to-select">Start a mission</button>
        <button class="btn ghost" data-act="howto">How it works</button>
      </div>
      ${lb.length ? `<div class="mini-lb"><h4>Top missions on this device</h4>${lb.map((e) => `<div><span>${esc(e.name)}</span><span>${esc(missionById(e.missionId).name)}</span><b>${e.score}</b></div>`).join('')}</div>` : ''}
      <p class="credit">Built for NASA Space Apps 2026 · planet data: NASA/JPL Solar System Dynamics</p>
    </div>
    <div id="howto" class="modal hidden" role="dialog" aria-label="How it works">${this.howtoHTML()}</div>`;
  }

  private howtoHTML(): string {
    return `<div class="modal-card"><button class="close" data-act="howto-close" aria-label="Close">×</button>
      <h2>How it works</h2>
      <ol class="steps">
        <li><b>Trajectory.</b> Pick a launch date and trip length on a ${term('porkchop', 'porkchop plot')}. Planets must line up!</li>
        <li><b>Spacecraft.</b> Choose power, batteries, computer redundancy, shielding and propellant.</li>
        <li><b>Science.</b> Pick instruments. Each one adds science, plus mass, power, cost and data.</li>
        <li><b>Comms & budget.</b> Size your antenna and Deep Space Network time so the data gets home.</li>
        <li><b>Launch.</b> Pick a rocket strong enough for your mass and launch energy, pass the GO/NO-GO poll and fly. Random events will test your margins.</li>
      </ol>
      <h3>Team mode (up to 4 players)</h3>
      <p>Each player owns a role: Flight Dynamics, Spacecraft Engineer, Principal Investigator, or Ground & Budget Lead. Every role has a personal goal, every change resets the sign-offs, and the mission launches only when the whole team agrees.</p>
      <h3>The physics is real</h3>
      <ul class="sources">
        <li>Planet positions: JPL "Approximate Positions of the Planets" (Standish) Keplerian elements.</li>
        <li>Trajectories: Lambert's problem (universal variables), 2-body propagation, patched-conic gravity assists.</li>
        <li>Rocket equation, orbit insertion Δv, atmospheric entry speed, inverse-square solar power, RTG decay, radio link budget.</li>
        <li>Validated against Mars 2020 (C3 14.4 vs ~14.5 real) and New Horizons (C3 158.8 vs 157.7; Jupiter flyby 32.6 vs 32 Jupiter radii).</li>
      </ul></div>`;
  }

  private selectHTML(): string {
    const s = this.select;
    const cards = MISSIONS.map((m) => `
      <button class="mission-card ${s.missionId === m.id ? 'sel' : ''}" data-act="pick-mission" data-val="${m.id}">
        <span class="planet-ball ${m.target}"></span>
        <span class="lvl ${m.level.toLowerCase()}">${m.level}</span>
        <span class="mc-name">${esc(m.name)}</span>
        <span class="mc-target">${BODIES[m.target].name} · ${m.type}</span>
        <span class="mc-tag">${esc(m.tagline)}</span>
        <span class="mc-budget">Budget cap $${fmtM(m.budgetCapM)}</span>
      </button>`).join('');
    const m = missionById(s.missionId);
    return `<div class="select-card">
      <button class="close" data-act="to-title" aria-label="Back">←</button>
      <h2>Choose your mission</h2>
      <div class="mission-cards">${cards}</div>
      <div class="brief"><b>${esc(m.name)}:</b> ${esc(m.brief)}</div>
      <div class="select-row">
        <div><h4>Difficulty</h4><div class="seg">${(['easy', 'normal', 'hard'] as Difficulty[]).map((x) => `<button class="${s.difficulty === x ? 'on' : ''}" data-act="pick-diff" data-val="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
          <p class="small-note">${s.difficulty === 'easy' ? '+20% budget, gentler random events, hints on.' : s.difficulty === 'normal' ? 'Realistic. NASA HQ may change your budget mid-design.' : 'No hints, more failures, rockets can fail. ×1.25 score.'}</p></div>
        <div><h4>Players</h4><div class="seg"><button class="${!s.team ? 'on' : ''}" data-act="pick-mode" data-val="solo">Solo</button><button class="${s.team ? 'on' : ''}" data-act="pick-mode" data-val="team">Team (2-4)</button></div>
          ${s.team ? `<div class="players">
            <div class="seg small">${[2, 3, 4].map((n) => `<button class="${s.count === n ? 'on' : ''}" data-act="pick-count" data-val="${n}">${n} players</button>`).join('')}</div>
            ${Array.from({ length: s.count }, (_, i) => `<input class="pname" data-idx="${i}" placeholder="Player ${i + 1} name" value="${esc(s.players[i])}" maxlength="16">`).join('')}
            <p class="small-note">Roles: ${ROLE_ORDER.map((r, i) => `<b style="color:${ROLE_INFO[r].color}">${ROLE_INFO[r].title}</b> → P${(i % s.count) + 1}`).join(' · ')}</p></div>` : ''}
        </div>
      </div>
      <button class="btn big" data-act="begin">Begin mission design →</button>
    </div>`;
  }

  // ---------------------------------------------------------------- events
  private bindGlobal() {
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox') return; // handled in change
      this.action(t.dataset.act!, t);
    });
    document.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'sign') {
        this.team.signoffs[t.dataset.role as RoleId] = t.checked;
        this.renderPanel();
        return;
      }
      if (t.type === 'range' && t.dataset.key && this.design) this.changed();
    });
    document.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.classList.contains('pname')) {
        this.select.players[Number(t.dataset.idx)] = t.value;
        return;
      }
      if (t.type === 'range' && t.dataset.key && this.design) {
        const v = Number(t.value);
        (this.design as unknown as Record<string, number>)[t.dataset.key] = v;
        this.evaluateNow();
        this.renderTopbar();
        const ev = this.ev!;
        const prop = $('[data-live=prop]');
        if (prop) prop.textContent = fmtKg(this.design.propellantKg);
        const dvn = $('[data-live=dvnote]');
        if (dvn) dvn.innerHTML = `Gives ${fmtInt(ev.dv.available * 1000)} m/s of ${fmtInt(ev.dv.required * 1000)} m/s needed. Engine Isp ${ev.mission.isp} s.`;
        const dsn = $('[data-live=dsn]');
        if (dsn) dsn.textContent = `${this.design.dsnHours} h/day`;
        const cap = $('[data-live=cap]');
        if (cap) cap.textContent = `${ev.data.capacity.toFixed(1)} ${ev.data.unit}`;
      }
    });
    // glossary tooltips
    const tip = $('#tooltip');
    const show = (el: HTMLElement) => {
      const g = GLOSSARY[el.dataset.term!];
      if (!g) return;
      tip.innerHTML = `<b>${g.term}</b>${g.text}`;
      const r = el.getBoundingClientRect();
      tip.className = 'show';
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
      const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
      tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
    };
    const hide = () => (tip.className = '');
    document.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest('.term') as HTMLElement | null;
      if (el) show(el);
      else hide();
    });
    document.addEventListener('focusin', (e) => {
      const el = (e.target as HTMLElement).closest('.term') as HTMLElement | null;
      if (el) show(el);
    });
    // press-and-hold to launch
    let holdTimer = 0;
    const endHold = (b: HTMLElement | null) => {
      clearInterval(holdTimer);
      holdTimer = 0;
      if (b) {
        b.classList.remove('holding');
        b.style.setProperty('--p', '0');
      }
    };
    document.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('[data-hold=launch]') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      e.preventDefault();
      const t0 = performance.now();
      b.classList.add('holding');
      clearInterval(holdTimer);
      holdTimer = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / 1100);
        b.style.setProperty('--p', p.toFixed(3));
        if (p >= 1) {
          endHold(b);
          this.launch();
        }
      }, 16);
      const release = () => holdTimer && endHold(b);
      b.addEventListener('pointerleave', release, { once: true });
      document.addEventListener('pointerup', release, { once: true });
      document.addEventListener('pointercancel', release, { once: true });
    });
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[data-hold=launch]:not([disabled])')) {
        e.preventDefault();
        this.launch();
        return;
      }
      if (e.key === 'Escape') {
        hide();
        $('#howto')?.classList.add('hidden');
      }
    });
  }

  private action(act: string, el: HTMLElement) {
    const d = this.design;
    switch (act) {
      case 'home':
        {
          this.flight?.stop();
          this.go('title');
          this.view.setHighlight(['earth']);
          this.view.showTransfer(null);
          this.view.setCraftAt(null);
          this.view.setCloseupModel(null);
          this.view.frameSystem(7);
        }
        break;
      case 'to-select': this.go('select'); break;
      case 'to-title': this.go('title'); break;
      case 'howto': $('#howto')?.classList.remove('hidden'); break;
      case 'howto-close': $('#howto')?.classList.add('hidden'); break;
      case 'pick-mission': this.select.missionId = el.dataset.val!; this.renderOverlay(); break;
      case 'pick-diff': this.select.difficulty = el.dataset.val as Difficulty; this.renderOverlay(); break;
      case 'pick-mode': this.select.team = el.dataset.val === 'team'; this.renderOverlay(); break;
      case 'pick-count': this.select.count = Number(el.dataset.val); this.renderOverlay(); break;
      case 'begin': {
        const m = missionById(this.select.missionId);
        const players = Array.from({ length: this.select.count }, (_, i) => this.select.players[i]?.trim() || `Player ${i + 1}`);
        this.startDesign(defaultDesign(m, this.select.difficulty), this.select.team, players);
        this.render();
        break;
      }
      case 'tab':
        if (this.screen !== 'design') return;
        if (this.tab !== el.dataset.tab) this.panelAnim = true;
        this.tab = el.dataset.tab as Tab;
        if (this.tab === 'launch') this.maybeProgramEvent();
        this.render();
        $('.panel-body')?.scrollTo({ top: 0 });
        break;
      case 'route':
        if (!d) return;
        d.trajectoryKind = el.dataset.val as 'direct' | 'jga';
        d.transfer = null;
        this.view.showTransfer(null);
        this.view.setHighlight(this.highlightBodies());
        this.ensureGrid();
        this.changed();
        break;
      case 'best': this.pickBest(); break;
      case 'zoom': this.zoomTo(Number(el.dataset.val)); break;
      case 'unzoom': this.zoom = null; this.renderPanel(); break;
      case 'close-event': this.closeEvent(); break;
      case 'set':
        if (!d) return;
        (d as unknown as Record<string, string>)[el.dataset.key!] = el.dataset.val!;
        this.lastPick = `${el.dataset.key}=${el.dataset.val}`;
        this.changed();
        break;
      case 'dish':
        if (!d) return;
        d.dsnDish = Number(el.dataset.val) as 34 | 70;
        this.changed();
        break;
      case 'instr': {
        if (!d) return;
        const id = el.dataset.val!;
        d.instruments = d.instruments.includes(id) ? d.instruments.filter((x) => x !== id) : [...d.instruments, id];
        this.lastPick = `instr=${id}`;
        this.changed();
        break;
      }
      case 'autoprop':
        if (!d) return;
        d.propellantKg = Math.min(PROP_MAX[d.missionId] ?? 1000, autoPropellant(d));
        this.changed();
        toast(`Propellant set to ${fmtKg(d.propellantKg)}`, 'good');
        break;
      case 'share': {
        if (!d) return;
        const url = `${location.origin}${location.pathname}${location.search}#d-${encodeDesign(d)}`;
        navigator.clipboard?.writeText(url).then(
          () => toast('Share link copied - send it to your team or a rival team!', 'good'),
          () => toast('Could not copy automatically. Copy the page address after this: #d-...', 'warn'),
        );
        break;
      }
      case 'launch-hint':
        if (this.screen === 'design') toast('Press and hold the button to launch', 'info');
        break;
      default:
        this.flight?.action(act, el);
        reportAction(this, act, el);
    }
  }

  /** Start the launch: countdown over Earth, then the flight. */
  launch() {
    const d = this.design;
    if (!d || !d.transfer || !this.ev?.launchable) return;
    this.attempt++;
    this.flight?.stop();
    this.screen = 'flight';
    this.render();
    this.view.setCloseupModel(null);
    this.view.setDate(d.transfer.launchJD);
    this.view.showTransfer(d.transfer);
    this.view.setCraftAt(d.transfer.launchJD);
    this.view.followTarget('earth', 1.3);
    countdown(`${missionOf(d).name} · ${rocketById(d.rocketId).name} · ${formatJD(d.transfer.launchJD)}`, () => {
      if (this.screen !== 'flight') return;
      this.flight = new FlightPlayer(this);
      this.flight.start();
    });
  }

  private maybeProgramEvent() {
    const d = this.design!;
    if (d.programEvent || d.difficulty === 'easy') return;
    const rand = mulberry32(Date.now() & 0xffffffff);
    const p = d.difficulty === 'hard' ? 1 : 0.5;
    if (rand() > p) {
      d.programEvent = { id: 'none', title: '', text: '', budgetDeltaM: 0, costDeltaM: 0 };
      return;
    }
    const m = missionOf(d);
    const ev: NonNullable<Design['programEvent']> =
      rand() < 0.5
        ? { id: 'budgetCut', title: 'Budget cut from NASA HQ', text: `Congress trimmed the science budget. Your cap drops by $${Math.round(m.budgetCapM * 0.08)}M. Real missions face this all the time - margins save you.`, budgetDeltaM: -Math.round(m.budgetCapM * 0.08), costDeltaM: 0 }
        : { id: 'overrun', title: 'Instrument cost overrun', text: 'Your instrument team discovered a design flaw. Fixing it adds $60M. (Many real missions overrun - the James Webb Space Telescope famously did.)', budgetDeltaM: 0, costDeltaM: 60 };
    d.programEvent = ev;
    this.evaluateNow();
    setTimeout(() => {
      const o = $('#overlay');
      o.className = 'show';
      o.innerHTML = `<div class="modal-card event"><div class="eyebrow">Program update</div><h2>${ev.title}</h2><p>${ev.text}</p><button class="btn" data-act="close-event">Understood - re-plan</button></div>`;
    }, 50);
  }

  closeEvent() {
    $('#overlay').className = '';
    $('#overlay').innerHTML = '';
    this.renderTopbar();
    this.renderPanel();
  }

  playersSummary(): string {
    return this.team.enabled ? this.team.players.join(', ') : '';
  }

  /** Expose a few things to other modules. */
  missionDef(): MissionDef {
    return missionOf(this.design!);
  }
}

export const highlightTab = (tab: Tab) => $$(`.tab[data-tab=${tab}]`).forEach((t) => t.classList.add('pulse'));
