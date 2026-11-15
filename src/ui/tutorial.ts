// Training mission: a guided 4-minute first flight to Mars. A coach card walks
// the player through the core loop (walk, launch date, install a part, read the
// gauges, launch, make a Mission Control call, read the report). Every step has
// a "Show me" button that does it for the player, so nobody gets stuck.
import * as THREE from 'three';
import { tutorialDesign } from '../game/presets';
import { applyKey } from '../hangar/hangar';
import type { App } from './app';

interface Step {
  id: string;
  title: string;
  body: (app: App) => string;
  done: (app: App, t: Tutorial) => boolean;
  /** does the step for the player */
  show?: (app: App) => void;
  showLabel?: string;
  /** a "Next" button instead of a condition */
  manual?: string;
}

const KEY = 'ma-trained';

export function wasTrained(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const inBay = (app: App) => (app.screen === 'design' ? ' First press <b>← Back to the high bay</b> (top left).' : '');

const STEPS: Step[] = [
  {
    id: 'walk',
    title: 'Look around and walk',
    body: () =>
      matchMedia('(pointer: coarse)').matches
        ? 'Drag to look around. Walk with the stick at the bottom left.'
        : 'Click the 3D view to look around with the mouse. Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. Press <kbd>Esc</kbd> to get the mouse back.',
    done: (app, t) => app.hangar.playerPos().distanceTo(t.startPos) > 2.2,
    show: () => undefined,
    showLabel: 'Skip',
  },
  {
    id: 'route',
    title: 'Pick a launch date',
    body: (app) =>
      app.screen === 'design'
        ? 'Click a <b>blue</b> area of the chart: each point is a real trajectory to Mars. Or press <b>Auto-pick</b>.'
        : 'Earth and Mars must line up before you can launch. Click <b>Pick a launch date</b> in the task list on the left: you walk to the Flight Dynamics desk. Then press <b>Auto-pick the cheapest launch</b>.',
    done: (app) => !!app.design?.transfer,
    show: (app) => void app.autoPick(),
  },
  {
    id: 'landing',
    title: 'Land the rover safely',
    body: (app) =>
      `The <b>Landing system</b> task is red: your rover is too heavy for airbags like Spirit's.${inBay(app)} Click <b>Landing system</b> in the task list, then click the <b>Sky crane</b> card. The overhead crane lifts it onto the rover. Perseverance landed this way.`,
    done: (app) => app.ev?.checks.find((c) => c.id === 'rover')?.status !== 'fail',
    show: (app) => {
      if (app.screen === 'design') app.backToHangar();
      if (app.design) app.applyDesign(applyKey(app.design, 'landingId:skycrane'), true);
    },
  },
  {
    id: 'gauges',
    title: 'Read the gauges',
    body: () =>
      'Every part changes the six gauges at the top: <b>mass, power, Δv</b> (fuel), <b>budget, data</b> and <b>science</b>. The sky crane added mass and cost. Green means GO: NASA engineers balance these same numbers.',
    done: () => false,
    manual: 'Got it',
  },
  {
    id: 'launch',
    title: 'Launch!',
    body: (app) =>
      app.ev?.launchable
        ? `Every task is green.${inBay(app)} Click <b>Launch!</b> in the task list to walk to the big door, then <b>press and hold</b> the Launch button.`
        : `One task is still red: click it in the task list and fix it first.${inBay(app)}`,
    done: (app) => app.hangar.mode === 'cinema' || app.screen === 'flight' || app.screen === 'report',
    show: (app) => {
      if (app.screen === 'design') app.backToHangar();
      app.launch();
    },
    showLabel: 'Launch for me',
  },
  {
    id: 'call',
    title: 'Make the call',
    body: () =>
      'Watch your rocket fly. Soon <b>Mission Control</b> stops the clock and asks you to decide. Click an option or press <kbd>1</kbd> – <kbd>3</kbd>. Each choice really changes the flight.',
    done: (app) => Object.keys(app.sim?.calls ?? {}).length > 0 || app.screen === 'report',
  },
  {
    id: 'report',
    title: 'Land and read the report',
    body: () => 'The flight goes on to touchdown. Then the report explains why your mission worked (or failed) and finds the one change that would help most.',
    done: (app) => app.screen === 'report',
  },
];

export class Tutorial {
  active = false;
  private i = 0;
  private stepT0 = 0;
  private timer = 0;
  private el: HTMLElement;
  private key = '';
  private finished = false;
  startPos = new THREE.Vector3();

  constructor(private app: App) {
    this.el = document.createElement('div');
    this.el.id = 'coach';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Training');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
  }

  private savedSelect: App['select'] | null = null;

  start() {
    this.active = true;
    this.finished = false;
    this.i = 0;
    this.savedSelect = { ...this.app.select, players: [...this.app.select.players] };
    this.app.select.missionId = 'mars';
    this.app.select.difficulty = 'easy';
    this.app.select.team = false;
    this.app.startDesign(tutorialDesign(), false);
    this.app.render();
    this.startPos = this.app.hangar.playerPos().clone();
    this.stepT0 = performance.now();
    this.key = '';
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 250);
    this.render();
  }

  stop() {
    // the mission select comes back as the player left it
    if (this.savedSelect) Object.assign(this.app.select, this.savedSelect);
    this.savedSelect = null;
    this.active = false;
    clearInterval(this.timer);
    this.el.classList.remove('show');
    this.el.innerHTML = '';
    this.key = '';
  }

  private complete() {
    this.finished = true;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    clearInterval(this.timer);
    this.render();
  }

  private advance() {
    this.i++;
    this.stepT0 = performance.now();
    if (this.i >= STEPS.length) this.complete();
    else this.render();
  }

  private tick() {
    if (!this.active || this.finished) return;
    // left the training (quit to the title or the mission select)
    if (this.app.screen === 'title' || this.app.screen === 'select') return this.stop();
    const s = STEPS[this.i];
    if (s.done(this.app, this)) {
      // skip later steps that are already done (e.g. the player launched early)
      this.advance();
      while (this.active && !this.finished && STEPS[this.i] && !STEPS[this.i].manual && STEPS[this.i].done(this.app, this)) this.advance();
      return;
    }
    this.render();
  }

  private render() {
    if (!this.active) return;
    const app = this.app;
    const inFlight = app.screen === 'flight' || app.hangar.mode === 'cinema';
    if (this.finished) {
      const html = `<div class="co-card done">
        <div class="co-top"><span class="co-k">Training complete</span></div>
        <h3>You built, launched and flew a Mars rover</h3>
        <p>Now design a mission of your own. Jupiter and Pluto are harder: radiation, sunlight 25 to 1,500 times weaker, and years of travel.</p>
        <div class="co-btns"><button class="co-b primary" data-act="tut-play">Play the full game</button><button class="co-b" data-act="tut-close">Stay on the report</button></div>
      </div>`;
      this.paint(html, 'done', false);
      return;
    }
    const s = STEPS[this.i];
    const waited = (performance.now() - this.stepT0) / 1000;
    const showBtn = s.show && waited > (s.id === 'walk' ? 10 : 15);
    const html = `<div class="co-card">
      <div class="co-top"><span class="co-k">Training · ${this.i + 1} / ${STEPS.length}</span><button class="co-skip" data-act="tut-skip">Skip training</button></div>
      <h3>${s.title}</h3>
      <p>${s.body(app)}</p>
      <div class="co-bar" aria-hidden="true"><i style="width:${((this.i + 0.5) / STEPS.length) * 100}%"></i></div>
      ${s.manual || showBtn ? `<div class="co-btns">${s.manual ? `<button class="co-b primary" data-act="tut-next">${s.manual}</button>` : ''}${showBtn ? `<button class="co-b" data-act="tut-show">${s.showLabel ?? 'Show me'}</button>` : ''}</div>` : ''}
    </div>`;
    this.paint(html, s.id, inFlight);
  }

  private paint(html: string, id: string, compact: boolean) {
    const key = html + compact + this.app.screen;
    if (key === this.key) return;
    this.key = key;
    this.el.innerHTML = html;
    this.el.dataset.step = id;
    this.el.dataset.screen = this.app.screen;
    this.el.classList.toggle('compact', compact);
    this.el.classList.add('show');
  }

  /** Coach-card buttons. Returns true when handled. */
  action(act: string): boolean {
    switch (act) {
      case 'tut-skip':
        this.stop();
        return true;
      case 'tut-next':
        this.advance();
        return true;
      case 'tut-show': {
        const s = STEPS[this.i];
        s?.show?.(this.app);
        if (s?.id === 'walk') this.advance();
        else this.tick();
        return true;
      }
      case 'tut-close':
        this.stop();
        return true;
      case 'tut-play':
        this.stop();
        this.app.quitToSelect();
        return true;
    }
    return false;
  }
}
