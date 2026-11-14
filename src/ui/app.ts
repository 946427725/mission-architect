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
import { $, $$, countdown, esc, fmtInt, fmtKg, toast, tween } from './dom';
import { FlightPlayer } from './flight';
import { PorkchopView, legendGradient } from './porkchop';
import { renderReport, reportAction } from './report';
import { sound } from './sound';
import { NASA_PRESET_NAME, nasaPreset } from '../game/presets';
import { HISTORY } from '../game/history';
import { directTransfer as directTr, jgaTransfer as jgaTr } from '../physics/porkchop';
import { Hangar } from '../hangar/hangar';

type Screen = 'title' | 'select' | 'hangar' | 'design' | 'flight' | 'report';
type MeterSpec = { id: string; tab: Tab; label: string; value: number; fmt: (v: number) => string; unit: string; of: string; fill: number | null; st: Status };

const TAB_ROLE: Record<Tab, RoleId> = { trajectory: 'flight', spacecraft: 'engineer', science: 'science', comms: 'ops', launch: 'flight' };
const ROLE_ORDER: RoleId[] = ['flight', 'engineer', 'science', 'ops'];
const PROP_MAX: Record<string, number> = { mars: 400, jupiter: 2600, pluto: 500 };
const FRAME_AU: Record<string, number> = { mars: 2.3, jupiter: 6.8, pluto: 44 };

const SVG = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const STEP_ICON: Record<Tab, string> = {
  trajectory: SVG('<ellipse cx="12" cy="12" rx="9.5" ry="5" transform="rotate(-25 12 12)"/><circle cx="12" cy="12" r="2.2"/><circle cx="19.6" cy="8.2" r="1.3"/>'),
  spacecraft: SVG('<rect x="9" y="9" width="6" height="6"/><path d="M3 9.5h6M3 14.5h6M15 9.5h6M15 14.5h6M3 9.5v5M21 9.5v5M12 9V5.5M10 5.5h4"/>'),
  science: SVG('<path d="M9.5 3h5M10.5 3v6.5L5 18.5A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.5L13.5 9.5V3"/><path d="M7.5 15.5h9"/>'),
  comms: SVG('<path d="M12 21v-8"/><circle cx="12" cy="11" r="1.8"/><path d="M8.2 7.2a5.4 5.4 0 0 0 0 7.6M15.8 7.2a5.4 5.4 0 0 1 0 7.6M5.3 4.3a9.5 9.5 0 0 0 0 13.4M18.7 4.3a9.5 9.5 0 0 1 0 13.4"/>'),
  launch: SVG('<path d="M12 2.5c2.8 2.6 4 6.4 4 10.5l-4 3-4-3c0-4.1 1.2-7.9 4-10.5z"/><circle cx="12" cy="9.5" r="1.5"/><path d="M8 13l-3 3.5h3.3M16 13l3 3.5h-3.3M10.3 19l1.7 2.5 1.7-2.5"/>'),
};
const STEP_NAME: Record<Tab, string> = { trajectory: 'Route', spacecraft: 'Craft', science: 'Science', comms: 'Comms', launch: 'Launch' };
const STEP_HEAD: Record<Tab, (d: Design, ev: Evaluation) => { title: string; sub: string }> = {
  trajectory: () => ({ title: 'Launch window', sub: 'Click a blue area of the chart to pick when to launch, or press Auto-pick.' }),
  spacecraft: (d, ev) => ({
    title: 'Spacecraft',
    sub: missionOf(d).type === 'lander'
      ? `Turn every row green: a lander that carries your ${fmtInt(ev.mass.rover ?? 0)} kg rover, enough power and fuel.`
      : missionOf(d).type === 'orbiter'
        ? 'Survive Jupiter: enough power 5 AU from the Sun, a vault against radiation, fuel for the braking burn.'
        : 'Travel light: power that works 40 AU from the Sun, and fuel for course corrections.',
  }),
  science: (d) => {
    const m = missionOf(d);
    const o = m.objectives.find((x) => x.id === d.objectiveId) ?? m.objectives[0];
    return { title: 'Instruments', sub: `Reach ${m.scienceTarget}+ points for "${o.name}". Instruments marked ★ count extra for this goal.` };
  },
  comms: (d) => ({ title: 'Data & budget', sub: missionOf(d).type === 'lander' ? 'Relay orbiters carry most rover data; a dish is your backup. Stay under the red budget line.' : 'Get your science data home and stay under the red budget line.' }),
  launch: () => ({ title: 'Launch', sub: 'Pick a rocket with a green bar, then press and hold Launch.' }),
};
const TILE_NAME: Record<string, [string, string]> = {
  airbags: ['Airbags', 'like Spirit'], retro: ['Retro rockets', 'like Phoenix'], skycrane: ['Sky crane', 'like Perseverance'],
  'solar-s': ['Small solar', '4 m² panels'], 'solar-m': ['Medium solar', '10 m² panels'], 'solar-l': ['Giant solar', '60 m² wings'],
  mmrtg: ['MMRTG', 'nuclear'], gphs: ['GPHS-RTG', 'nuclear'], gphs2: ['2× GPHS-RTG', 'nuclear'],
  polar53: ['53-day polar', 'few close passes'], polar14: ['14-day polar', 'many close passes'], tour: ['Moon tour', 'Io · Europa · Ganymede'],
};
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');
/** First clause of a check's explanation, short enough for one line. */
const shortIssue = (detail: string) => {
  const t = stripTags(detail).split(/(?<=[.!])\s| - /)[0];
  return t.length > 92 ? t.slice(0, 90) + '…' : t;
};

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
  select = { missionId: 'mars', difficulty: 'normal' as Difficulty, team: false, players: ['', '', '', ''], count: 2, objectiveId: '' };
  flight: FlightPlayer | null = null;
  panelAnim = true;
  private overlayScreen: Screen | null = null;
  private rev = 0;
  private lastPick: string | null = null;
  private inkPrev: { left: number; width: number } | null = null;
  private meterVals = new Map<string, number>();
  private topKey = '';
  private showHelp = false;
  /** ?seed=N makes flights repeatable (for demos and the video). */
  demoSeed: number | null = null;
  demoSpeed = 1;
  private history = false;
  private historyGrids = new Map<string, PorkchopGrid>();
  readonly hangar: Hangar;
  /** 'route' = the launch-window console opened from the high bay; 'pro' = the full engineer panel. */
  routeMode: 'route' | 'pro' | null = null;

  constructor() {
    this.view = new SolarSystemView($('#space'));
    this.hangar = new Hangar($('#hangar'), this);
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
    // URL options: ?mission=mars|jupiter|pluto &difficulty=easy|normal|hard|sandbox &preset=nasa &seed=N &speed=1|2|4
    const q = new URLSearchParams(location.search);
    const qm = q.get('mission');
    const qd = q.get('difficulty') as Difficulty | null;
    if (qd && ['easy', 'normal', 'hard', 'sandbox'].includes(qd)) this.select.difficulty = qd;
    if (q.has('seed') && isFinite(Number(q.get('seed')))) this.demoSeed = Math.floor(Number(q.get('seed')));
    if ([1, 2, 4].includes(Number(q.get('speed')))) this.demoSpeed = Number(q.get('speed'));
    // shared design link?
    const m = location.hash.match(/#d[-=]([\w-]+)/);
    const shared = m ? decodeDesign(m[1]) : null;
    if (shared) {
      this.startDesign(shared, false);
      this.tab = 'launch';
      toast('Loaded a shared mission design', 'good');
      this.render();
    } else if (qm && MISSIONS.some((x) => x.id === qm)) {
      this.select.missionId = qm;
      if (q.get('preset') === 'nasa') this.loadNasaDesign(qm, this.select.difficulty);
      else {
        this.screen = 'select';
        this.render();
      }
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
    this.screen = 'hangar';
    this.routeMode = null;
    this.panelAnim = true;
    this.showHelp = d.difficulty !== 'hard';
    this.rev = 0;
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
    this.hangar.enter(true);
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
    const wasGo = this.ev?.launchable;
    this.evaluateNow();
    if (wasGo === true && this.ev && !this.ev.launchable) setTimeout(() => sound.warn(), 90);
    else if (wasGo === false && this.ev?.launchable) setTimeout(() => sound.go(), 90);
    this.rev++;
    if (opts.resetSignoffs !== false && this.team.enabled && Object.values(this.team.signoffs).some(Boolean)) {
      this.team.signoffs = { flight: false, engineer: false, science: false, ops: false };
      toast('Design changed - team sign-offs reset', 'warn');
    }
    this.renderTopbar();
    if (opts.panel !== false) this.renderPanel();
    this.preview?.update(this.design!);
    this.updatePorkOverlay();
    this.hangar.onDesignChanged(opts.panel !== false);
  }

  // ------------------------------------------------------------------ high bay API
  /** Replace the design (from the high bay). `light` skips sound/sign-off side effects for continuous edits. */
  applyDesign(d: Design, fromHangar = false, light = false) {
    this.design = d;
    if (light) {
      this.evaluateNow();
      this.hangar.onDesignChanged(false);
      return;
    }
    if (fromHangar) this.changed({ panel: false });
    else this.changed();
  }

  /** Open the launch-window chart (solar system view) from the Flight Dynamics desk. */
  openRoute(history = false) {
    if (!this.design) return;
    this.routeMode = 'route';
    this.tab = 'trajectory';
    this.panelAnim = true;
    this.screen = 'design';
    this.history = false;
    this.view.setHighlight(this.highlightBodies());
    this.view.frameSystem(FRAME_AU[missionOf(this.design).id] ?? 6);
    this.view.setDate(this.design.transfer?.launchJD ?? this.ev?.readyJD ?? PROJECT_START_JD);
    this.view.showTransfer(this.design.transfer);
    this.ensureGrid();
    this.render();
    if (history) this.setHistory(true);
  }

  /** The full engineer panel (every setting on one sheet), for experts. */
  openPro() {
    if (!this.design) return;
    this.routeMode = 'pro';
    this.panelAnim = true;
    this.screen = 'design';
    this.view.setHighlight(this.highlightBodies());
    this.view.frameSystem(FRAME_AU[missionOf(this.design).id] ?? 6);
    this.view.setDate(this.design.transfer?.launchJD ?? this.ev?.readyJD ?? PROJECT_START_JD);
    this.view.showTransfer(this.design.transfer);
    this.ensureGrid();
    this.render();
  }

  /** Back to the high bay (optionally pointing the player at the station for a step). */
  backToHangar(tab?: Tab) {
    if (!this.design) return;
    this.routeMode = null;
    this.history = false;
    this.screen = 'hangar';
    this.view.setCloseupModel(null);
    this.view.setCraftAt(null);
    this.evaluateNow();
    this.render();
    this.hangar.enter(false);
    if (tab) {
      const st = ({ trajectory: 'flight', spacecraft: 'power', science: 'science', comms: 'comms', launch: 'rockets' } as const)[tab];
      this.hangar.goTo(st);
    }
  }

  async autoPick() {
    if (!this.design) return;
    const key = this.gridKey();
    if (!this.grids.has(key)) {
      this.ensureGrid();
      toast('Computing launch windows…', 'info');
      await this.gridLoading.get(key);
    }
    this.pickBest();
  }

  setRouteKind(kind: 'direct' | 'jga') {
    const d = this.design;
    if (!d || d.trajectoryKind === kind) return;
    d.trajectoryKind = kind;
    d.transfer = null;
    this.view.showTransfer(null);
    this.view.setHighlight(this.highlightBodies());
    this.ensureGrid();
    this.changed();
  }

  autoFuel() {
    const d = this.design;
    if (!d) return;
    d.propellantKg = Math.min(PROP_MAX[d.missionId] ?? 1000, autoPropellant(d));
    this.changed();
    toast(`Propellant set to ${fmtKg(d.propellantKg)}`, 'good');
    sound.go();
  }

  openMenu() {
    const on = !sound.muted;
    this.openModal(`<div class="modal-card menu-card"><button class="close" data-act="modal-close" aria-label="Close">×</button>
      <div class="eyebrow">Paused</div><h2>${esc(this.design ? missionOf(this.design).name : 'Mission Architect')}</h2>
      <div class="menu-list">
        <button class="btn" data-act="modal-close">Resume</button>
        <button class="btn ghost" data-act="menu-pro">Engineer view (all settings on one sheet)</button>
        <button class="btn ghost" data-act="howto-menu">How it works</button>
        <button class="btn ghost" data-act="validation">Data &amp; validation</button>
        <button class="btn ghost" data-act="sound">${on ? 'Sound: on' : 'Sound: off'}</button>
        <button class="btn ghost" data-act="home">Quit to title</button>
      </div></div>`);
  }

  /** After the pad cinematic: straight into the flight (no second countdown). */
  startFlightFromPad() {
    const d = this.design;
    if (!d || !d.transfer) return;
    this.screen = 'flight';
    this.render();
    this.view.setCloseupModel(null);
    this.view.setDate(d.transfer.launchJD);
    this.view.showTransfer(d.transfer);
    this.view.setCraftAt(d.transfer.launchJD);
    this.view.followTarget('earth', 1.3);
    this.flight = new FlightPlayer(this);
    this.flight.start();
  }

  /** A design for the title/select backdrop. */
  previewDesign(missionId: string): Design {
    return nasaPreset(missionId, 'normal');
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
      rocketName: rocketById(d.rocketId).name,
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
        { readyJD: this.ev!.readyJD, maxTofDays: m.maxTofDays, reachC3: this.reachC3(), rocketName: rocketById(this.design!.rocketId).name, selected: null },
        (ix, iy) => this.hoverCell(grid, ix, iy, zoomed),
        () => this.leaveCell(),
        (ix, iy) => (zoomed ? this.pickCell(grid, ix, iy) : this.zoomTo(sp.launchStartJD + ((sp.launchEndJD - sp.launchStartJD) * ix) / (sp.nx - 1), true)),
      );
    }
    this.updatePorkOverlay();
    const r = this.pork.range;
    const lg = $('#pork-legend-range');
    if (lg) lg.innerHTML = `<span>◀ cheap (C3 ${r.min.toFixed(0)})</span><span>launch energy</span><span>costly (${r.max.toFixed(0)}+) ▶</span>`;
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
    return `<div class="rsub">Hover the chart to preview a route. ${this.isZoomed() ? 'Click to choose it.' : 'Click a coloured area to zoom in.'}</div>`;
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
    let sub = `Arrives ${formatJD(tr.arriveJD)} at ${tr.vinfArr.toFixed(1)} km/s`;
    if (m.type === 'lander') {
      const b = BODIES[m.target];
      sub += ` · hits the air at ${Math.sqrt(tr.vinfArr ** 2 + (2 * b.mu) / (b.radius + 125)).toFixed(1)} km/s`;
    }
    if (tr.flyby) sub += ` · Jupiter flyby ${formatJDShort(tr.flyby.jd)}`;
    return `<div class="rstats ${hover ? 'hover' : ''}"><div><i>Launch</i><b>${formatJD(tr.launchJD)}</b></div><div><i>Trip</i><b>${formatDuration(tr.tofDays)}</b></div><div><i>${term('c3', 'Energy')}</i><b>${tr.c3.toFixed(1)}</b></div></div><div class="rsub">${sub}</div>`;
  }

  // ------------------------------------------------------------------ rendering
  render() {
    document.body.dataset.screen = this.screen;
    document.body.dataset.route = this.routeMode ?? '';
    const bay = this.screen === 'title' || this.screen === 'select' || this.screen === 'hangar';
    this.view.setRunning(!bay);
    if (this.screen === 'title' || this.screen === 'select') this.hangar.preview(this.previewDesign(this.select.missionId));
    else if (this.screen !== 'hangar' && this.hangar.mode !== 'cinema') this.hangar.setMode('off');
    this.view.setViewInset(window.innerWidth <= 900 ? 0 : this.screen === 'design' ? 440 : this.screen === 'title' ? Math.round(window.innerWidth * 0.55) : 0);
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
        bar.innerHTML = `<div class="brand" role="button" data-act="home" tabindex="0"><span class="logo-mark"></span><span class="brand-text">Mission Architect</span></div>${this.soundButton()}`;
        this.topKey = 'plain';
      }
      return;
    }
    const ev = this.ev;
    const m = ev.mission;
    const c = (ids: string[]) => this.worst(ev.checks.filter((k) => ids.includes(k.id)));
    const cap = ev.mass.capacity;
    const specs: MeterSpec[] = [
      { id: 'mass', tab: 'launch', label: 'Mass', value: ev.mass.launch, fmt: fmtInt, unit: 'kg', of: cap !== null ? `max ${fmtInt(cap)}` : 'no route yet', fill: cap ? ev.mass.launch / cap : null, st: c(['lv', 'rover']) },
      { id: 'power', tab: 'spacecraft', label: 'Power', value: ev.power.avgLoad, fmt: fmtInt, unit: 'W', of: `have ${fmtInt(ev.power.generated)}`, fill: ev.power.avgLoad / Math.max(1, ev.power.generated), st: c(['power', 'battery']) },
      { id: 'dv', tab: 'spacecraft', label: 'Δv', value: ev.dv.required * 1000, fmt: fmtInt, unit: 'm/s', of: `have ${fmtInt(ev.dv.available * 1000)}`, fill: ev.dv.required / Math.max(1e-6, ev.dv.available), st: c(['dv']) },
      { id: 'budget', tab: 'comms', label: 'Budget', value: ev.cost.total, fmt: (v) => '$' + fmtM(v), unit: '', of: `cap $${fmtM(ev.cost.cap)}`, fill: ev.cost.total / ev.cost.cap, st: c(['budget']) },
      { id: 'data', tab: 'comms', label: 'Data', value: ev.data.fraction * 100, fmt: fmtInt, unit: '%', of: 'gets home', fill: ev.data.fraction, st: c(['data']) },
      { id: 'science', tab: 'science', label: 'Science', value: ev.science.potential, fmt: fmtInt, unit: 'pts', of: `goal ${m.scienceTarget}`, fill: ev.science.potential / m.scienceTarget, st: c(['sci', 'hga']) },
      { id: 'time', tab: 'trajectory', label: 'Trip', value: ev.time.tofDays ?? 0, fmt: (v) => (ev.time.tofDays ? formatDuration(v) : 'No route'), unit: '', of: '', fill: ev.time.tofDays ? ev.time.tofDays / m.maxTofDays : null, st: c(['traj', 'ready', 'tof', 'entry']) },
    ];
    const key = `design:${m.id}:${this.design.objectiveId}`;
    if (this.topKey !== key) {
      this.topKey = key;
      this.meterVals.clear();
      bar.innerHTML = `
        <div class="brand" role="button" data-act="home" tabindex="0"><span class="logo-mark"></span><span class="brand-text">Mission Architect</span>
          <span class="brand-sub"><b>${esc(m.name)}</b>${esc((m.objectives.find((o) => o.id === this.design!.objectiveId) ?? m.objectives[0]).name)} · ${this.design.difficulty}</span></div>
        <div class="meters">${specs
          .map((s) => `<button class="meter" data-act="tab" data-tab="${s.tab}" data-meter="${s.id}"><span class="m-label"><span><i class="m-flag"></i>${s.label}</span><span class="m-of"></span></span><span class="m-value"><span class="m-num">${s.fmt(0)}</span><small>${s.unit}</small></span><span class="m-bar"><i></i></span></button>`)
          .join('')}</div>${this.soundButton()}`;
    }
    for (const s of specs) {
      const el = bar.querySelector(`[data-meter="${s.id}"]`) as HTMLElement | null;
      if (!el) continue;
      el.className = `meter ${s.st}`;
      el.title = `${s.label}: ${s.fmt(s.value)} ${s.unit} ${s.of}`;
      (el.querySelector('.m-of') as HTMLElement).textContent = s.of;
      (el.querySelector('.m-bar i') as HTMLElement).style.width = `${s.fill === null ? 0 : Math.min(100, Math.max(2, s.fill * 100))}%`;
      (el.querySelector('.m-flag') as HTMLElement).textContent = s.st === 'fail' ? '✕ ' : s.st === 'warn' ? '! ' : '';
      const num = el.querySelector('.m-num') as HTMLElement;
      const prev = this.meterVals.get(s.id);
      if (prev !== undefined && s.id !== 'time' && Math.abs(s.value - prev) >= (s.id === 'data' ? 1 : 0.5)) {
        const diff = s.value - prev;
        const goodWhenUp = s.id === 'science' || s.id === 'data';
        const chip = document.createElement('span');
        chip.className = `delta ${diff > 0 === goodWhenUp ? 'good' : 'bad'}`;
        chip.textContent = `${diff > 0 ? '+' : '−'}${s.fmt(Math.abs(diff))}${s.unit && s.unit !== '%' ? ' ' + s.unit : s.unit}`;
        el.appendChild(chip);
        setTimeout(() => chip.remove(), 1400);
      }
      if (prev === undefined) tween(num, 0, s.value, s.fmt, 1000);
      else if (Math.abs(prev - s.value) > 1e-6) {
        tween(num, prev, s.value, s.fmt, 550);
        void el.offsetWidth;
        el.classList.add('bump');
      } else num.textContent = s.fmt(s.value);
      this.meterVals.set(s.id, s.value);
    }
  }

  private soundButton(): string {
    const on = !sound.muted;
    return `<button class="sound-toggle" data-act="sound" aria-pressed="${on}" title="Turn sound ${on ? 'off' : 'on'}"><span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="sound-label">${on ? 'Sound on' : 'Sound off'}</span></button>`;
  }

  private clickSound(act: string) {
    if (act === 'sound' || act === 'launch-hint' || act === 'home') return;
    if (act === 'tab' || act === 'begin' || act === 'to-select' || act === 'redesign' || act === 'next-mission' || act === 'howto') sound.sheet();
    else if (['set', 'instr', 'route', 'dish', 'zoom', 'unzoom', 'best', 'pick-mission', 'pick-diff', 'pick-mode', 'pick-count', 'autoprop', 'speed'].includes(act)) sound.select();
    else sound.click();
  }

  private placeInk() {
    const ink = $('#panel .rail-ink');
    const act = $('#panel .step.active');
    const rail = $('#panel .rail');
    if (!ink || !act || !rail) return;
    const vertical = getComputedStyle(rail).flexDirection !== 'row';
    const to = vertical ? { left: act.offsetTop, width: act.offsetHeight } : { left: act.offsetLeft, width: act.offsetWidth };
    const set = (p: { left: number; width: number }) => {
      if (vertical) {
        ink.style.top = `${p.left}px`;
        ink.style.height = `${p.width}px`;
        ink.style.left = '0px';
        ink.style.width = '3px';
      } else {
        ink.style.left = `${p.left}px`;
        ink.style.width = `${p.width}px`;
        ink.style.top = 'auto';
        ink.style.height = '3px';
      }
    };
    const from = this.inkPrev ?? to;
    set(from);
    this.inkPrev = to;
    if (from.left === to.left && from.width === to.width) return;
    void ink.offsetWidth;
    ink.classList.add('moving');
    set(to);
  }

  renderPanel() {
    const panel = $('#panel');
    if (this.screen !== 'design' || !this.design || !this.ev) {
      panel.innerHTML = '';
      return;
    }
    const scroll = $('.sheet-body', panel)?.scrollTop ?? 0;
    const ev = this.ev;
    const d = this.design;
    const idx = TABS.indexOf(this.tab);
    const rail = TABS.map((t) => {
      const st = this.worst(ev.checks.filter((c) => c.area === t));
      return `<button class="step ${t === this.tab ? 'active' : ''} ${st}" data-act="tab" data-tab="${t}" aria-current="${t === this.tab ? 'step' : 'false'}">${STEP_ICON[t]}<span>${STEP_NAME[t]}</span><i class="dot"></i></button>`;
    }).join('');
    const role = TAB_ROLE[this.tab];
    const myGoal = this.team.enabled ? roleGoals(ev).find((g) => g.role === role)! : null;
    const who = this.team.enabled && myGoal
      ? `<div class="role-banner" style="--rc:${ROLE_INFO[role].color}"><span class="role-dot"></span><b>${esc(this.playerFor(role))}</b><span class="role-owns">${ROLE_INFO[role].title}</span><span class="role-goal ${myGoal.met ? 'met' : ''}">${myGoal.met ? '✓' : '○'} Your goal: ${myGoal.goal}</span></div>`
      : '';
    let body = '';
    switch (this.tab) {
      case 'trajectory': body = this.tabTrajectory(); break;
      case 'spacecraft': body = this.tabSpacecraft(); break;
      case 'science': body = this.tabScience(); break;
      case 'comms': body = this.tabComms(); break;
      case 'launch': body = this.tabLaunch(); break;
    }
    const checks = ev.checks.filter((c) => c.area === this.tab);
    const issues = checks.filter((c) => c.status !== 'ok');
    const okCount = checks.length - issues.length;
    const enter = this.panelAnim;
    this.panelAnim = false;
    const head = STEP_HEAD[this.tab](d, ev);
    const stepState = this.worst(checks);
    const otherFails = ev.checks.filter((c) => c.area !== this.tab && c.status === 'fail');
    const issueBtn = (c: Check, other: boolean) =>
      `<button class="issue ${c.status} ${other ? 'other' : ''}" ${other ? `data-act="tab" data-tab="${c.area}"` : ''} data-tip="${esc(stripTags(c.detail))}" data-tip-title="${esc(c.label)}"><b>${c.status === 'fail' ? 'NO-GO' : 'CHECK'}</b><span>${other ? `${STEP_NAME[c.area]}: ` : ''}${esc(shortIssue(c.detail))}</span>${other ? '<i>Go →</i>' : ''}</button>` +
      (c.id === 'ready' && c.status === 'fail' ? `<button class="fix-btn" data-act="next-window">Move launch to the next window I'm ready for →</button>` : '');
    panel.classList.toggle('route-only', this.routeMode === 'route');
    const back = this.routeMode ? `<button class="back-bay" data-act="to-bay">← Back to the high bay</button>` : '';
    panel.innerHTML = `
      ${back}<nav class="rail" aria-label="Design steps">${rail}<i class="rail-ink"></i></nav>
      <div class="sheet">
        <header class="sheet-head ${enter ? 'enter' : ''}">
          <div class="sheet-kicker">Step ${idx + 1} of 5</div>
          <h2>${head.title}</h2>
          <p class="goal-line ${stepState}"><b>${stepState === 'ok' ? '✓' : stepState === 'warn' ? '!' : '✕'}</b><span>${head.sub}</span></p>
          ${this.design.difficulty !== 'hard' ? `<button class="help ${this.showHelp ? 'on' : ''}" data-act="help" aria-expanded="${this.showHelp}" title="Tip from the Flight Director">?</button>` : ''}
          ${this.showHelp && this.design.difficulty !== 'hard' ? `<div class="help-box">${ev.mission.hints[this.tab]}</div>` : ''}
        </header>
        <div class="sheet-body ${enter ? 'enter' : ''}">${who}${body}</div>
        <footer class="sheet-foot">
          <div class="issues">${issues.map((c) => issueBtn(c, false)).join('')}${otherFails.map((c) => issueBtn(c, true)).join('')}${okCount ? `<div class="all-ok"><b>✓</b> ${okCount} check${okCount === 1 ? '' : 's'} OK on this step</div>` : ''}</div>
          <div class="nav-btns">
            ${idx > 0 ? `<button class="btn ghost small" data-act="tab" data-tab="${TABS[idx - 1]}">← Back</button>` : '<span></span>'}
            ${idx < TABS.length - 1 ? `<button class="btn small" data-act="tab" data-tab="${TABS[idx + 1]}">Next: ${STEP_NAME[TABS[idx + 1]]} →</button>` : ''}
          </div>
        </footer>
      </div>`;
    const sb = $('.sheet-body', panel);
    if (sb) {
      sb.scrollTop = enter ? 0 : scroll;
      Array.from(sb.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(Math.min(i, 12))));
    }
    this.placeInk();
    if (this.lastPick) {
      const [k, v] = this.lastPick.split('=');
      const sel = k === 'instr' ? `[data-act="instr"][data-val="${v}"]` : `[data-key="${k}"][data-val="${v}"]`;
      panel.querySelector(sel)?.classList.add('just');
      this.lastPick = null;
    }
    if (this.tab === 'trajectory') {
      if (this.history) this.mountHistory();
      else this.mountPorkchop();
    }
  }

  private playerFor(role: RoleId): string {
    const i = ROLE_ORDER.indexOf(role);
    const p = this.team.players;
    return p[i % p.length] || `Player ${(i % p.length) + 1}`;
  }

  // ---------------------------------------------------------------- steps
  private tile(o: { key: string; id: string; name: string; sub?: string; big: string; unit?: string; small?: string; tip: string; selected: boolean; act?: string; bad?: boolean; badge?: string }): string {
    const act = o.act ?? 'set';
    return `<button class="tile ${o.selected ? 'sel' : ''} ${o.bad ? 'bad' : ''}" data-act="${act}" ${act === 'set' ? `data-key="${o.key}"` : ''} data-val="${o.id}" aria-pressed="${o.selected}" data-tip="${esc(o.tip)}" data-tip-title="${esc(o.name)}">
      <span class="t-name">${esc(o.name)}</span>
      ${o.sub ? `<span class="t-sub">${esc(o.sub)}</span>` : ''}
      <span class="t-big">${o.big}${o.unit ? `<small>${o.unit}</small>` : ''}</span>
      ${o.small ? `<span class="t-small">${o.small}</span>` : ''}
      ${o.badge ? `<span class="t-badge">${o.badge}</span>` : ''}
    </button>`;
  }

  private seg(key: string, items: { id: string; label: string; small?: string }[], current: string, act = 'set'): string {
    return `<div class="seg wrap">${items
      .map((it) => `<button class="${current === it.id ? 'on' : ''}" data-act="${act}" ${act === 'set' ? `data-key="${key}"` : ''} data-val="${it.id}">${it.label}${it.small ? `<small>${it.small}</small>` : ''}</button>`)
      .join('')}</div>`;
  }

  private tabTrajectory(): string {
    const d = this.design!;
    const m = missionOf(d);
    const base = this.grids.get(this.gridKey());
    if (!base) this.ensureGrid();
    const zoomed = this.isZoomed();
    const grid = this.activeGrid();
    const routes = m.grids.jga
      ? `<div class="field"><label>Route</label>${this.seg('', [{ id: 'direct', label: 'Direct' }, { id: 'jga', label: 'Jupiter flyby' }], d.trajectoryKind, 'route')}</div>`
      : '';
    const wins = base ? this.windows(base) : [];
    const chips = base
      ? `<div class="field"><label>${term('window', 'Windows')}</label><div class="windows">${wins
          .map((w) => `<button class="chip ${zoomed && Math.abs(w.jd - this.zoom!.center) < this.zoomHalfDays() ? 'on' : ''} ${w.jd < this.ev!.readyJD ? 'early' : ''}" data-act="zoom" data-val="${w.jd}" data-tip="${w.jd < this.ev!.readyJD ? 'Your spacecraft is not built yet at this date.' : `Cheapest launch energy here: C3 ${w.c3.toFixed(0)} km²/s². Click to zoom in.`}">${formatJDShort(w.jd)}</button>`)
          .join('')}${zoomed ? '<button class="chip back" data-act="unzoom">All years</button>' : ''}</div></div>`
      : '';
    const ls = m.grids[d.trajectoryKind]!;
    const hist = HISTORY[m.id];
    if (this.history && hist) return this.historyHTML();
    const histBtn = hist
      ? `<button class="btn ghost small wide hist-btn" data-act="history-on">⟲ Check the physics: see the real ${hist.mission} launch</button>`
      : `<p class="note">Juno reached Jupiter with an Earth flyby two years after launch (ΔV-EGA), a trick this game does not model, so it has no history view.</p>`;
    return `
      ${routes}
      ${chips}
      ${grid
        ? `<div class="chart-box"><div id="pork-slot"></div>
             <div class="legend"><div class="legend-bar" style="background:${legendGradient()}"></div><div class="legend-range" id="pork-legend-range"></div></div></div>
           <div class="readout" id="pork-readout">${d.transfer ? this.transferSummary(d.transfer, false) : this.idleReadout()}</div>
           <button class="btn small wide" data-act="best">Auto-pick the cheapest launch</button>
           ${histBtn}`
        : `<div class="loading">Computing ${fmtInt(ls.nx * ls.ny * (d.trajectoryKind === 'jga' ? 40 : 1))} real trajectories…<div class="progress"><i id="grid-progress"></i></div></div>`}
    `;
  }

  private historyHTML(): string {
    const m = missionOf(this.design!);
    const hist = HISTORY[m.id]!;
    const tr = hist.transfer();
    const grid = this.historyGrids.get(m.id);
    if (!grid) this.loadHistoryGrid();
    return `<div class="hist-head"><span class="hist-tag">History mode</span><b>${esc(hist.mission)}</b><button class="chip back" data-act="history-off">Back to my mission</button></div>
      ${grid
        ? `<div class="chart-box"><div id="hist-slot"></div>
             <div class="legend"><div class="legend-bar" style="background:${legendGradient()}"></div><div class="legend-range"><span>◀ cheap</span><span>launch energy</span><span>costly ▶</span></div></div></div>`
        : `<div class="loading">Computing the real ${esc(hist.mission)} launch window…<div class="progress"><i id="grid-progress"></i></div></div>`}
      ${tr ? `<table class="cmp-table"><thead><tr><th></th><th>Real mission</th><th>Our engine</th></tr></thead><tbody>${hist.rows(tr).map(([k, a, b]) => `<tr><td>${k}</td><td>${a}</td><td><b>${b}</b></td></tr>`).join('')}</tbody></table>` : ''}
      <p class="note">${hist.note}</p>
      <button class="link-btn" data-act="validation">All data sources and validation tests →</button>`;
  }

  private async loadHistoryGrid() {
    const m = missionOf(this.design!);
    const hist = HISTORY[m.id];
    if (!hist || this.historyGrids.has(m.id)) return;
    const g = await computeGrid(hist.spec, (f) => {
      const bar = $('#grid-progress');
      if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    });
    this.historyGrids.set(m.id, g);
    if (this.history && this.tab === 'trajectory') this.renderPanel();
  }

  private mountHistory() {
    const slot = $('#hist-slot');
    const m = missionOf(this.design!);
    const hist = HISTORY[m.id];
    const grid = this.historyGrids.get(m.id);
    if (!slot || !hist || !grid) return;
    const tr = hist.transfer();
    const host = document.createElement('div');
    host.className = 'porkchop';
    slot.appendChild(host);
    new PorkchopView(
      host,
      grid,
      { readyJD: -Infinity, maxTofDays: Infinity, reachC3: -1, selected: tr ? { launchJD: tr.launchJD, tofDays: tr.tofDays } : null, selectedLabel: 'REAL' },
      (ix, iy) => {
        const t = transferAt(grid, ix, iy);
        if (!t) return;
        this.view.setDate(t.launchJD);
        this.view.showTransfer(t, true);
      },
      () => {
        if (!tr) return;
        this.view.setDate(tr.launchJD);
        this.view.showTransfer(tr);
      },
      () => undefined,
    );
  }

  private setHistory(on: boolean) {
    this.history = on;
    const m = missionOf(this.design!);
    const hist = HISTORY[m.id];
    if (on && hist) {
      const tr = hist.transfer();
      if (tr) {
        this.view.setHighlight(tr.flyby ? ['earth', 'jupiter', m.target] : ['earth', m.target]);
        this.view.setDate(tr.launchJD);
        this.view.showTransfer(tr);
      }
    } else {
      this.view.setHighlight(this.highlightBodies());
      this.view.setDate(this.design!.transfer?.launchJD ?? this.ev!.readyJD);
      this.view.showTransfer(this.design!.transfer);
    }
    this.renderPanel();
  }

  /** "Data & Validation": every source, every validation number, every simplification. */
  showValidation() {
    const m20 = directTr('mars', 2459060.5, 203);
    const nh = jgaTr('pluto', 2453754.5, 405, 3058);
    const rows: [string, string, string][] = [
      ['Mars 2020 launch energy C3', '≈14.5 km²/s²', m20 ? `${m20.c3.toFixed(1)} km²/s²` : '-'],
      ['New Horizons launch energy C3', '157.7 km²/s²', nh ? `${nh.c3.toFixed(1)} km²/s²` : '-'],
      ['New Horizons closest approach to Jupiter', '≈32 Jupiter radii', nh?.flyby ? `${nh.flyby.rpRadii.toFixed(1)} Jupiter radii` : '-'],
      ['New Horizons speed past Pluto', '13.8 km/s', nh ? `${nh.vinfArr.toFixed(2)} km/s` : '-'],
    ];
    const src: [string, string, string][] = [
      ['Planet positions', 'NASA/JPL Solar System Dynamics: Approximate Positions of the Planets (Keplerian elements, 1800-2050)', 'https://ssd.jpl.nasa.gov/planets/approx_pos.html'],
      ['Planet masses and radii', 'NASA Planetary Fact Sheets (NSSDCA)', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/'],
      ['Rocket performance', 'NASA Launch Services Program, Launch Vehicle Performance Website (payload vs C3)', 'https://elvperf.ksc.nasa.gov/'],
      ['Mars 2020 / Perseverance', 'NASA mission page (dates, mass, power, instruments)', 'https://science.nasa.gov/mission/mars-2020-perseverance/'],
      ['Juno', 'NASA mission page (solar arrays, radiation vault, orbit)', 'https://science.nasa.gov/mission/juno/'],
      ['New Horizons', 'NASA mission page (trajectory, RTG, instruments, data downlink)', 'https://science.nasa.gov/mission/new-horizons/'],
      ['Nuclear power (MMRTG, GPHS-RTG)', 'NASA Radioisotope Power Systems program', 'https://science.nasa.gov/planetary-science/programs/radioisotope-power-systems/'],
      ['Deep Space Network', 'NASA DSN (34 m and 70 m antennas)', 'https://www.jpl.nasa.gov/missions/dsn'],
    ];
    this.openModal(`<div class="modal-card wide"><button class="close" data-act="modal-close" aria-label="Close">×</button>
      <div class="eyebrow">Data &amp; validation</div><h2>How we know the physics is right</h2>
      <p>The engine is given only launch and arrival dates. It computes the rest from planet positions, and the results match the real missions:</p>
      <table class="cmp-table"><thead><tr><th></th><th>Real mission</th><th>Our engine</th></tr></thead><tbody>${rows.map(([k, a, b]) => `<tr><td>${k}</td><td>${a}</td><td><b>${b}</b></td></tr>`).join('')}</tbody></table>
      <p class="note">These numbers are recomputed live in your browser right now, and checked by the automated tests in <code>tests/physics.test.ts</code>.</p>
      <h3>Models</h3>
      <ul class="sources"><li>Lambert's problem (universal variables) for every trajectory on the launch-window chart</li><li>Two-body orbit propagation; patched-conic powered gravity assist at Jupiter</li><li>Rocket equation, orbit-insertion burn, atmospheric entry speed</li><li>Solar power falls with distance squared; RTG output decays every year</li><li>Radio link budget calibrated to New Horizons' downlink from Pluto</li></ul>
      <h3>NASA data sources</h3>
      <ul class="sources">${src.map(([k, t, u]) => `<li><b>${k}:</b> ${t}. <a href="${u}" target="_blank" rel="noopener">${u.replace('https://', '')}</a></li>`).join('')}</ul>
      <h3>Simplifications</h3>
      <p class="note">Rocket curves, costs, instrument masses and powers are rounded public values chosen to keep the real trade-offs. Juno's Earth flyby, multi-revolution transfers and atmospheric drag are not modelled. This is a teaching game, not flight software.</p>
    </div>`);
  }

  openModal(html: string) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    sound.sheet();
  }

  private tabSpacecraft(): string {
    const d = this.design!;
    const m = missionOf(d);
    const ev = this.ev!;
    const planet = BODIES[m.target].name;
    let html = '';
    if (m.type === 'lander') {
      html += `<div class="group"><label>Landing system · max rover mass (yours: ${fmtInt(ev.mass.rover ?? 0)} kg)</label><div class="tiles three">${LANDINGS.map((l) =>
        this.tile({ key: 'landingId', id: l.id, name: TILE_NAME[l.id][0], sub: TILE_NAME[l.id][1], big: fmtInt(l.maxRover), unit: 'kg', small: `$${l.costM}M`, tip: `${l.desc} Landing risk ${(l.risk * 100).toFixed(0)}%. Your rover: ${fmtInt(ev.mass.rover ?? 0)} kg.`, selected: d.landingId === l.id, bad: ev.mass.rover !== undefined && ev.mass.rover > l.maxRover }),
      ).join('')}</div></div>`;
    }
    if (m.type === 'orbiter') {
      html += `<div class="group"><label>Science orbit · braking burn to get in</label><div class="tiles three">${JUPITER_ORBITS.map((o) => {
        const e = evaluate({ ...d, orbitId: o.id });
        return this.tile({ key: 'orbitId', id: o.id, name: TILE_NAME[o.id][0], sub: TILE_NAME[o.id][1], big: d.transfer ? fmtInt(e.dv.insertion * 1000) : '–', unit: 'm/s', small: `${Math.round(e.radiation!.plannedOrbits)} passes`, tip: o.desc, selected: d.orbitId === o.id });
      }).join('')}</div></div>`;
    }
    const powers = POWER.filter((p) => m.powerIds.includes(p.id));
    html += `<div class="group"><label>Power at ${planet} (you need ${fmtInt(ev.power.avgLoad)} W)</label><div class="tiles ${powers.length === 3 ? 'three' : 'two'}">${powers.map((p) => {
      const e = evaluate({ ...d, powerId: p.id });
      return this.tile({ key: 'powerId', id: p.id, name: TILE_NAME[p.id][0], sub: TILE_NAME[p.id][1], big: fmtInt(e.power.generated), unit: 'W', small: `${p.mass} kg · $${p.costM}M`, tip: `${p.desc} You need about ${fmtInt(ev.power.avgLoad)} W.`, selected: d.powerId === p.id, bad: e.power.margin < 0 });
    }).join('')}</div></div>`;
    html += `<div class="field"><label>Battery</label>${this.seg('batteryId', [{ id: 'none', label: 'None' }, ...BATTERIES.map((b) => ({ id: b.id, label: `${b.wh / 1000} kWh` }))], d.batteryId)}</div>`;
    html += `<div class="field"><label data-tip="A second computer, radio and pointing wheels. Saves the mission when something breaks.">Backup computer</label>${this.seg('avionicsId', AVIONICS.map((a) => ({ id: a.id, label: a.redundant ? 'Yes' : 'No', small: a.redundant ? `+${a.mass} kg · $${a.costM}M` : '' })), d.avionicsId)}</div>`;
    if (m.type === 'orbiter') {
      html += `<div class="field"><label data-tip="Jupiter's radiation destroys electronics. A titanium vault protects them.">Radiation vault</label>${this.seg('shieldId', SHIELDS.map((s) => {
        const e = evaluate({ ...d, shieldId: s.id });
        return { id: s.id, label: s.id === 'none' ? 'None' : s.id === 'light' ? 'Light' : 'Heavy', small: `${Math.round(Math.min(999, e.radiation!.maxOrbits))} orbits` };
      }), d.shieldId)}</div>`;
    }
    html += `<div class="group"><label>Fuel ${term('dv', 'Δv')}</label>
      <div class="slider-row">
        <input type="range" min="0" max="${PROP_MAX[m.id] ?? 1000}" step="5" value="${d.propellantKg}" data-key="propellantKg" aria-label="Propellant mass">
        <output data-live="prop">${fmtKg(d.propellantKg)}</output>
        <button class="btn ghost small" data-act="autoprop" data-tip="Adds exactly enough fuel for the trip plus 15% spare.">Auto</button>
      </div>
      <div class="mini-meter ${ev.dv.available >= ev.dv.required ? '' : 'bad'}"><i style="width:${Math.min(100, (ev.dv.available / Math.max(1e-6, ev.dv.required)) * 66)}%"></i><span class="goal"></span></div>
      <p class="note" data-live="dvnote">${fmtInt(ev.dv.available * 1000)} of ${fmtInt(ev.dv.required * 1000)} m/s needed</p></div>`;
    return html;
  }

  private tabScience(): string {
    const d = this.design!;
    const m = missionOf(d);
    const ev = this.ev!;
    const unit = m.type === 'flyby' ? 'Gbit' : 'Mbit/day';
    const obj = m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0];
    const pctSci = Math.min(1.5, ev.science.potential / m.scienceTarget);
    return `<div class="big-meter ${ev.science.potential >= m.scienceTarget ? 'ok' : ''}">
        <div class="bm-num"><b>${Math.round(ev.science.potential)}</b><span>/ ${m.scienceTarget} science points</span></div>
        <div class="sci-bar"><i style="width:${(pctSci / 1.5) * 100}%"></i><span class="goal" style="left:${(1 / 1.5) * 100}%"></span></div>
      </div>
      <div class="group"><label>Science objective</label><div class="windows obj-chips">${m.objectives.map((o) => `<button class="chip ${o.id === obj.id ? 'on' : ''}" data-act="set" data-key="objectiveId" data-val="${o.id}" data-tip="${esc(o.desc)}" data-tip-title="${esc(o.name)}">${esc(o.name)}</button>`).join('')}</div></div>
      <div class="group"><label>Instruments · points for this objective</label><div class="tiles two">${m.instruments.map((i) => {
        const on = d.instruments.includes(i.id);
        const w = obj.weights[i.id] ?? 1;
        const key = w >= 1.3 ? '★ key for your goal' : w <= 0.6 ? 'minor for your goal' : '';
        return this.tile({ key: 'instr', id: i.id, act: 'instr', name: `${w >= 1.3 ? '★ ' : ''}${i.name}`, sub: `like ${i.analog}`, big: `+${Math.round(i.science * w)}`, small: `${i.mass} kg · ${i.power} W · $${i.costM}M`, tip: `${i.desc} Sends ${i.data} ${unit} of data.${w !== 1 ? ` Counts ${w}× for "${obj.name}".` : ''}`, selected: on, badge: key || (i.needsHGA ? 'needs dish' : i.outreach ? 'outreach +3' : '') });
      }).join('')}</div></div>`;
  }

  private tabComms(): string {
    const d = this.design!;
    const ev = this.ev!;
    const total = ev.cost.total;
    const scale = Math.max(total, ev.cost.cap);
    const segs = ev.cost.items
      .filter(([, v]) => v > 0.5)
      .map(([k, v], i) => `<i class="s${i % 4} ${k.startsWith('Launch') ? 'launch' : ''}" style="width:${(v / scale) * 100}%" data-tip="$${fmtM(v)}" data-tip-title="${esc(k)}"></i>`)
      .join('');
    return `<div class="big-meter ${ev.data.fraction >= 0.95 ? 'ok' : ''}">
        <div class="bm-num"><b data-live="datafrac">${Math.round(ev.data.fraction * 100)}%</b><span>of science data gets home · <em data-live="rate">${formatRate(ev.data.rateBps)}</em></span></div>
        <div class="sci-bar data"><i style="width:${Math.min(1, ev.data.fraction) * 100}%"></i></div>
      </div>
      <div class="group"><label>${term('hga', 'Antenna')} · data that gets home</label><div class="tiles two">${ANTENNAS.map((a) => {
        const e = evaluate({ ...d, antennaId: a.id });
        return this.tile({ key: 'antennaId', id: a.id, name: a.id === 'lga' ? 'Low-gain' : `${a.diameter.toFixed(1)} m dish`, big: `${Math.round(e.data.fraction * 100)}%`, small: `${a.mass} kg · $${a.costM}M`, tip: a.desc, selected: d.antennaId === a.id, bad: e.data.fraction < 0.6 });
      }).join('')}</div></div>
      <div class="field"><label>Transmitter</label>${this.seg('txId', TRANSMITTERS.map((t) => ({ id: t.id, label: `${t.rfW} W` })), d.txId)}</div>
      <div class="field"><label>${term('dsn', 'Ground dish')}</label>${this.seg('', [{ id: '34', label: '34 m' }, { id: '70', label: '70 m' }], String(d.dsnDish), 'dish')}</div>
      <div class="field"><label>Hours / day</label><div class="slider-row"><input type="range" min="1" max="24" step="1" value="${d.dsnHours}" data-key="dsnHours" aria-label="Deep Space Network hours per day"><output data-live="dsn">${d.dsnHours} h</output></div></div>
      <div class="group"><label>Budget</label>
        <div class="stack ${total > ev.cost.cap ? 'over' : ''}">${segs}<span class="cap" style="left:${(ev.cost.cap / scale) * 100}%"></span></div>
        <p class="note"><b>$${fmtM(total)}</b> of $${fmtM(ev.cost.cap)} cap · hover the bar for details</p>
      </div>`;
  }

  private tabLaunch(): string {
    const d = this.design!;
    const ev = this.ev!;
    const tr = d.transfer;
    const rockets = ROCKETS.map((r) => {
      const cap = tr ? payloadAt(r, tr.c3) : null;
      const ok = cap !== null && cap >= ev.mass.launch;
      const fill = cap ? Math.min(1, ev.mass.launch / Math.max(1, cap)) : 0;
      return `<button class="rtile ${d.rocketId === r.id ? 'sel' : ''} ${cap !== null && !ok ? 'cant' : ''}" data-act="set" data-key="rocketId" data-val="${r.id}" aria-pressed="${d.rocketId === r.id}" data-tip="${esc(r.desc + ' Flew: ' + r.flew + '.')}" data-tip-title="${esc(r.name)}">
        <span class="r-name">${esc(r.id === "atlasv551s48" ? "Atlas V + Star 48" : r.id === "falconheavy" ? "Falcon Heavy" : r.name)}</span>
        <span class="r-lift"><span class="lift-bar"><i style="width:${fill * 100}%" class="${ok ? '' : 'over'}"></i></span><span>${cap === null ? '–' : `${fmtInt(cap)} kg`}</span></span>
        <span class="r-price">$${fmtM(r.costM)}</span>
      </button>`;
    }).join('');
    const stations: [string, Tab][] = [['Route', 'trajectory'], ['Craft', 'spacecraft'], ['Science', 'science'], ['Comms', 'comms'], ['Launch', 'launch']];
    const poll = stations.map(([name, area]) => {
      const st = this.worst(ev.checks.filter((c) => c.area === area));
      return `<button class="poll ${st}" data-act="tab" data-tab="${area}"><span>${name}</span><b>${st === 'fail' ? 'NO-GO' : st === 'warn' ? 'CHECK' : 'GO'}</b></button>`;
    }).join('');
    let team = '';
    if (this.team.enabled) {
      const goals = roleGoals(ev);
      team = `<div class="group"><label>Team sign-off</label><div class="signoffs">${ROLE_ORDER.map((r) => {
        const g = goals.find((x) => x.role === r)!;
        return `<label class="signoff" style="--rc:${ROLE_INFO[r].color}"><input type="checkbox" data-act="sign" data-role="${r}" ${this.team.signoffs[r] ? 'checked' : ''}>
          <span><b>${esc(this.playerFor(r))}</b><small class="${g.met ? 'met' : ''}">${g.met ? '✓' : '○'} ${g.goal}</small></span></label>`;
      }).join('')}</div></div>`;
    }
    const allSigned = !this.team.enabled || ROLE_ORDER.every((r) => this.team.signoffs[r]);
    const canLaunch = ev.launchable && allSigned;
    const m = ev.mission;
    const warnNote = ev.science.potential < m.scienceTarget
      ? `Science ${Math.round(ev.science.potential)}/${m.scienceTarget}: expect partial success · hold to launch anyway`
      : ev.checks.some((c) => c.status === 'warn') ? 'Some checks are tight · hold to launch anyway' : 'Press and hold';
    return `<div class="group"><label>Rocket · capacity at your ${term('c3', 'C3')}</label><div class="rtiles">${rockets}</div></div>
      <div class="group"><label>Mission control poll</label><div class="polls">${poll}</div></div>
      ${team}
      <div class="launch-row">
        <button class="btn launch" data-hold="launch" data-act="launch-hint" ${canLaunch ? '' : 'disabled'}><i class="hold-fill"></i><span>${ev.launchable ? (allSigned ? 'Launch' : 'Waiting for sign-offs') : 'No-go'}<small>${canLaunch ? warnNote : 'Fix the red items first'}</small></span></button>
      </div>
`;
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
      const sim = this.sim;
      setTimeout(() => sound.fanfare(sim.outcome), 350);
      setTimeout(() => sound.stamp(), 1100);
      for (let i = 0; i < sim.score.stars; i++) setTimeout(() => sound.star(i), 1300 + i * 150);
    }
  }

  private titleHTML(): string {
    const lb = loadLeaderboard().slice(0, 3);
    return `<div class="title-card">
      <div class="eyebrow">NASA Space Apps Challenge 2026 · Space Mission Design Game</div>
      <h1><span class="w"><span>Mission</span></span><span class="w"><span>Architect</span></span></h1>
      <p class="tagline">Build a real spacecraft by hand. <b>Physics decides</b> if it flies.</p>
      <div class="play-hint"><span>Real NASA/JPL orbits</span><span>1–4 players</span><span>Mars · Jupiter · Pluto</span></div>
      <div class="cta on-space">
        <button class="btn big" data-act="to-select">Play</button>
        <button class="btn ghost" data-act="howto">How it works</button>
        <button class="btn ghost" data-act="validation">Data &amp; validation</button>
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
      <div class="objectives"><h4>Choose your science objective</h4><div class="obj-tiles">${m.objectives.map((o, i) => {
        const sel = (s.objectiveId || m.objectives[0].id) === o.id;
        return `<button class="obj ${sel ? 'sel' : ''}" data-act="pick-objective" data-val="${o.id}" aria-pressed="${sel}"><span class="obj-n">0${i + 1}</span><b>${esc(o.name)}</b><span>${esc(o.desc)}</span></button>`;
      }).join('')}</div></div>
      <div class="select-row">
        <div><h4>Difficulty</h4><div class="seg">${(['easy', 'normal', 'hard', 'sandbox'] as Difficulty[]).map((x) => `<button class="${s.difficulty === x ? 'on' : ''}" data-act="pick-diff" data-val="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
          <p class="small-note">${{ easy: '+20% budget, gentle random events, tips open.', normal: 'Realistic. Expect surprises, like a budget cut.', hard: 'Rockets can fail, more breakdowns, no tips. Score ×1.25.', sandbox: 'Huge budget, no random events. Just experiment (score ×0.5).' }[s.difficulty]}</p></div>
        <div><h4>Players</h4><div class="seg"><button class="${!s.team ? 'on' : ''}" data-act="pick-mode" data-val="solo">Solo</button><button class="${s.team ? 'on' : ''}" data-act="pick-mode" data-val="team">Team (2-4)</button></div>
          ${s.team ? `<div class="players">
            <div class="seg small">${[2, 3, 4].map((n) => `<button class="${s.count === n ? 'on' : ''}" data-act="pick-count" data-val="${n}">${n} players</button>`).join('')}</div>
            ${Array.from({ length: s.count }, (_, i) => `<input class="pname" data-idx="${i}" placeholder="Player ${i + 1} name" value="${esc(s.players[i])}" maxlength="16">`).join('')}
            <p class="small-note">Roles: ${ROLE_ORDER.map((r, i) => `<b style="color:${ROLE_INFO[r].color}">${ROLE_INFO[r].title}</b> → P${(i % s.count) + 1}`).join(' · ')}</p></div>` : ''}
        </div>
      </div>
      <div class="select-actions">
        <button class="btn ghost big" data-act="nasa-design" data-tip="Load a design modelled on the real NASA mission and go straight to launch.">Fly NASA's design</button>
        <button class="btn big" data-act="begin">Design my own →</button>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- events
  private bindGlobal() {
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox') return; // handled in change
      sound.unlock();
      this.clickSound(t.dataset.act!);
      this.action(t.dataset.act!, t);
    });
    document.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'sign') {
        this.team.signoffs[t.dataset.role as RoleId] = t.checked;
        this.renderPanel();
        this.hangar.onDesignChanged(false);
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
        if (dvn) dvn.textContent = `${fmtInt(ev.dv.available * 1000)} of ${fmtInt(ev.dv.required * 1000)} m/s needed`;
        const mm = $('.mini-meter');
        if (mm) {
          mm.classList.toggle('bad', ev.dv.available < ev.dv.required);
          ($('i', mm) as HTMLElement).style.width = `${Math.min(100, (ev.dv.available / Math.max(1e-6, ev.dv.required)) * 66)}%`;
        }
        const df = $('[data-live=datafrac]');
        if (df) df.textContent = `${Math.round(ev.data.fraction * 100)}%`;
        const rate = $('[data-live=rate]');
        if (rate) rate.textContent = formatRate(ev.data.rateBps);
        const dsn = $('[data-live=dsn]');
        if (dsn) dsn.textContent = `${this.design.dsnHours} h`;
        const cap = $('[data-live=cap]');
        if (cap) cap.textContent = `${ev.data.capacity.toFixed(1)} ${ev.data.unit}`;
      }
    });
    // glossary tooltips
    const tip = $('#tooltip');
    const show = (el: HTMLElement) => {
      const g = el.dataset.term ? GLOSSARY[el.dataset.term] : el.dataset.tip ? { term: el.dataset.tipTitle ?? '', text: el.dataset.tip } : null;
      if (!g) return;
      tip.innerHTML = `${g.term ? `<b>${esc(g.term)}</b>` : ''}${esc(g.text)}`;
      const r = el.getBoundingClientRect();
      tip.className = 'show';
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
      const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
      tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
    };
    const hide = () => (tip.className = '');
    document.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest('.term, [data-tip]') as HTMLElement | null;
      if (el) show(el);
      else hide();
    });
    document.addEventListener('focusin', (e) => {
      const el = (e.target as HTMLElement).closest('.term, [data-tip]') as HTMLElement | null;
      if (el) show(el);
    });
    // press-and-hold to launch
    let holdTimer = 0;
    const endHold = (b: HTMLElement | null) => {
      clearInterval(holdTimer);
      holdTimer = 0;
      sound.holdStop();
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
      sound.unlock();
      sound.holdStart();
      clearInterval(holdTimer);
      holdTimer = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / 1100);
        b.style.setProperty('--p', p.toFixed(3));
        sound.holdUpdate(p);
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
        $('#modal-root').innerHTML = '';
      }
    });
  }

  private action(act: string, el: HTMLElement) {
    const d = this.design;
    switch (act) {
      case 'home':
        {
          this.flight?.stop();
          $('#modal-root').innerHTML = '';
          this.routeMode = null;
          this.go('title');
          this.view.setHighlight(['earth']);
          this.view.showTransfer(null);
          this.view.setCraftAt(null);
          this.view.setCloseupModel(null);
          this.view.frameSystem(7);
        }
        break;
      case 'to-select': this.go('select'); break;
      case 'to-bay': this.backToHangar(); break;
      case 'menu-pro': $('#modal-root').innerHTML = ''; this.openPro(); break;
      case 'howto-menu': $('#modal-root').innerHTML = `<div class="modal" role="dialog">${this.howtoHTML().replace('howto-close', 'modal-close')}</div>`; break;
      case 'to-title': this.go('title'); break;
      case 'howto': $('#howto')?.classList.remove('hidden'); break;
      case 'howto-close': $('#howto')?.classList.add('hidden'); break;
      case 'pick-mission': this.select.missionId = el.dataset.val!; this.select.objectiveId = ''; this.renderOverlay(); this.hangar.preview(this.previewDesign(this.select.missionId)); break;
      case 'pick-objective': this.select.objectiveId = el.dataset.val!; this.renderOverlay(); break;
      case 'pick-diff': this.select.difficulty = el.dataset.val as Difficulty; this.renderOverlay(); break;
      case 'pick-mode': this.select.team = el.dataset.val === 'team'; this.renderOverlay(); break;
      case 'pick-count': this.select.count = Number(el.dataset.val); this.renderOverlay(); break;
      case 'nasa-design':
        this.loadNasaDesign(this.select.missionId, this.select.difficulty);
        break;
      case 'nasa-design-report':
        if (this.design) {
          this.view.setCloseupModel(null);
          this.loadNasaDesign(this.design.missionId, this.design.difficulty);
        }
        break;
      case 'begin': {
        const m = missionById(this.select.missionId);
        const players = Array.from({ length: this.select.count }, (_, i) => this.select.players[i]?.trim() || `Player ${i + 1}`);
        const nd = defaultDesign(m, this.select.difficulty);
        if (this.select.objectiveId) nd.objectiveId = this.select.objectiveId;
        this.startDesign(nd, this.select.team, players);
        this.render();
        break;
      }
      case 'tab':
        if (this.screen !== 'design') return;
        if (this.tab !== el.dataset.tab) this.panelAnim = true;
        if (this.team.enabled && this.playerFor(TAB_ROLE[this.tab]) !== this.playerFor(TAB_ROLE[el.dataset.tab as Tab]))
          toast(`Hand the device to ${this.playerFor(TAB_ROLE[el.dataset.tab as Tab])} · ${ROLE_INFO[TAB_ROLE[el.dataset.tab as Tab]].title}`, 'info');
        this.tab = el.dataset.tab as Tab;
        if (this.tab === 'comms') this.maybeProgramEvent();
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
      case 'zoom': this.zoomTo(Number(el.dataset.val), true); break;
      case 'next-window': this.pickBest(); break;
      case 'history-on': this.setHistory(true); break;
      case 'history-off': this.setHistory(false); break;
      case 'validation': this.showValidation(); break;
      case 'modal-close': $('#modal-root').innerHTML = ''; break;
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
      case 'sound': {
        sound.setMuted(!sound.muted);
        document.querySelectorAll('.sound-toggle').forEach((b) => {
          b.setAttribute('aria-pressed', String(!sound.muted));
          b.setAttribute('title', `Turn sound ${sound.muted ? 'on' : 'off'}`);
          const l = b.querySelector('.sound-label');
          if (l) l.textContent = sound.muted ? 'Sound off' : 'Sound on';
        });
        if (!sound.muted) sound.select();
        document.querySelectorAll('.menu-list [data-act="sound"]').forEach((b) => (b.textContent = sound.muted ? 'Sound: off' : 'Sound: on'));
        if (this.screen === 'hangar' && this.hangar.mode === 'play') {
          if (sound.muted) sound.ambienceStop();
          else sound.ambienceStart();
        }
        break;
      }
      case 'help':
        this.showHelp = !this.showHelp;
        this.renderPanel();
        break;
      case 'launch-hint':
        if (this.screen === 'design') toast('Press and hold the button to launch', 'info');
        break;
      default:
        if (this.hangar.action(act, el)) return;
        this.flight?.action(act, el);
        reportAction(this, act, el);
    }
  }

  /** Start the launch: countdown over Earth, then the flight. */
  launch() {
    const d = this.design;
    if (!d || !d.transfer || !this.ev?.launchable) return;
    if (this.screen === 'hangar') {
      this.attempt++;
      this.flight?.stop();
      this.hangar.launchSequence(() => this.startFlightFromPad());
      return;
    }
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

  /** Load the NASA-style reference design and jump to the Launch step. */
  loadNasaDesign(missionId: string, difficulty: Difficulty) {
    const d = nasaPreset(missionId, difficulty);
    this.startDesign(d, false);
    this.tab = 'launch';
    this.render();
    this.hangar.hud.say(`${NASA_PRESET_NAME[missionId]} is on the stand and every station is GO. Walk to the launch gate at the big door (or click it on the task list) and hold Launch. Or change anything first.`, 'FLIGHT DIRECTOR', 9000, true);
  }

  maybeProgramEvent() {
    const d = this.design!;
    if (d.programEvent || d.difficulty === 'easy' || d.difficulty === 'sandbox') return;
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
      sound.bad();
      o.innerHTML = `<div class="modal-card event"><div class="eyebrow">Program update</div><h2>${ev.title}</h2><p>${ev.text}</p><button class="btn" data-act="close-event">Understood - re-plan</button></div>`;
    }, 50);
  }

  closeEvent() {
    $('#overlay').className = '';
    $('#overlay').innerHTML = '';
    this.renderTopbar();
    this.renderPanel();
    this.hangar.onDesignChanged(false);
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
