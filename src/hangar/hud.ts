// Game HUD for the high bay: resource gauges, task list, Flight Director radio,
// interaction prompt, station panel, floating station labels, minimap and the
// on-screen joystick for touch devices.
import { esc } from '../ui/dom';

export type St = 'ok' | 'warn' | 'fail';

export interface Gauge {
  id: string;
  label: string;
  icon: string;
  value: string;
  sub: string;
  fill: number | null;
  st: St;
  delta?: string;
  deltaGood?: boolean;
}

export interface Task {
  id: string;
  label: string;
  st: St;
  detail: string;
  station: string;
  color: string;
  current: boolean;
}

export interface Label {
  id: string;
  x: number;
  y: number;
  show: boolean;
  name: string;
  color: string;
  st: St | 'none';
  current: boolean;
  dist: number;
}

const ICON: Record<string, string> = {
  mass: '<path d="M6 20h12l-2-11H8z"/><circle cx="12" cy="6" r="2.4"/>',
  power: '<path d="M13 2 5 13.5h6L10 22l9-12h-6z"/>',
  dv: '<path d="M12 2c3 2.5 4.5 6 4.5 10L12 15.5 7.5 12C7.5 8 9 4.5 12 2z"/><path d="M9.5 17.5 12 22l2.5-4.5"/>',
  budget: '<circle cx="12" cy="12" r="9"/><path d="M14.8 8.6c-.6-1-1.7-1.5-2.9-1.5-1.7 0-3 .9-3 2.3 0 3.3 6.3 1.7 6.3 5 0 1.4-1.4 2.4-3.2 2.4-1.3 0-2.6-.6-3.2-1.6M12 5.5v13"/>',
  data: '<path d="M12 20v-7"/><circle cx="12" cy="11" r="1.6"/><path d="M8.3 7.3a5.2 5.2 0 0 0 0 7.4M15.7 7.3a5.2 5.2 0 0 1 0 7.4M5.4 4.4a9.3 9.3 0 0 0 0 13.2M18.6 4.4a9.3 9.3 0 0 1 0 13.2"/>',
  science: '<path d="M9.5 3h5M10.5 3v6.5L5 18.5A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.5L13.5 9.5V3"/><path d="M7.5 15.5h9"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

export class Hud {
  readonly root: HTMLElement;
  private gaugesEl: HTMLElement;
  private tasksEl: HTMLElement;
  private promptEl: HTMLElement;
  private radioEl: HTMLElement;
  private panelEl: HTMLElement;
  private labelsEl: HTMLElement;
  private tipEl: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private useBtn: HTMLElement;
  private joy: HTMLElement;
  private knob: HTMLElement;
  private hintEl: HTMLElement;
  private headEl: HTMLElement;
  private roleEl: HTMLElement;
  private sayQueue: { text: string; who: string; ms: number }[] = [];
  private sayTimer = 0;
  private typing = 0;
  private labelEls = new Map<string, HTMLElement>();
  private gaugeKey = '';
  private taskKey = '';
  joyVec = { x: 0, y: 0 };
  panelOpen = false;
  onUse: (() => void) | null = null;
  onUseHold: ((down: boolean) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'gamehud';
    this.root.innerHTML = `
      <div class="gh-labels"></div>
      <div class="gh-top">
        <div class="gh-head"></div>
        <div class="gh-gauges"></div>
      </div>
      <div class="gh-role"></div>
      <div class="gh-tasks"></div>
      <div class="gh-radio" aria-live="polite"></div>
      <div class="gh-prompt"></div>
      <div class="gh-hint"></div>
      <canvas class="gh-map" width="360" height="280" aria-hidden="true"></canvas>
      <aside class="gh-panel" aria-label="Station"></aside>
      <div class="gh-tip"></div>
      <div class="gh-joy"><i></i></div>
      <button class="gh-use" aria-label="Use"><span>USE</span></button>`;
    document.body.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.headEl = q('.gh-head');
    this.gaugesEl = q('.gh-gauges');
    this.tasksEl = q('.gh-tasks');
    this.promptEl = q('.gh-prompt');
    this.radioEl = q('.gh-radio');
    this.panelEl = q('.gh-panel');
    this.labelsEl = q('.gh-labels');
    this.tipEl = q('.gh-tip');
    this.mapCanvas = q('.gh-map') as HTMLCanvasElement;
    this.useBtn = q('.gh-use');
    this.joy = q('.gh-joy');
    this.knob = q('.gh-joy i');
    this.hintEl = q('.gh-hint');
    this.roleEl = q('.gh-role');
    this.bindTouch();
  }

  show(mode: 'off' | 'play' | 'cinema') {
    this.root.dataset.mode = mode;
  }

  setHeader(html: string) {
    if (this.headEl.innerHTML !== html) this.headEl.innerHTML = html;
  }

  setRole(html: string) {
    if (this.roleEl.innerHTML !== html) this.roleEl.innerHTML = html;
    this.roleEl.classList.toggle('show', !!html);
  }

  gauges(list: Gauge[]) {
    const key = list.map((g) => g.id).join();
    if (key !== this.gaugeKey) {
      this.gaugeKey = key;
      this.gaugesEl.innerHTML = list
        .map((g) => `<button class="gg" data-act="h-gauge" data-id="${g.id}"><span class="gg-ic">${svg(ICON[g.icon] ?? '')}</span><span class="gg-txt"><span class="gg-l">${g.label}</span><span class="gg-v"></span></span><span class="gg-bar"><i></i></span><span class="gg-d"></span></button>`)
        .join('');
    }
    for (const g of list) {
      const el = this.gaugesEl.querySelector(`[data-id="${g.id}"]`) as HTMLElement;
      el.className = `gg ${g.st}`;
      el.title = `${g.label}: ${g.value} · ${g.sub}`;
      (el.querySelector('.gg-v') as HTMLElement).innerHTML = `${g.value}<small>${esc(g.sub)}</small>`;
      (el.querySelector('.gg-bar i') as HTMLElement).style.width = `${g.fill === null ? 0 : Math.max(3, Math.min(100, g.fill * 100))}%`;
      const d = el.querySelector('.gg-d') as HTMLElement;
      d.textContent = g.delta ?? '';
      d.className = `gg-d ${g.delta ? 'on' : ''} ${g.deltaGood ? 'good' : 'bad'}`;
    }
  }

  /** Brief floating chip when a value actually changes. */
  flash(id: string, text: string, good: boolean) {
    const el = this.gaugesEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const c = document.createElement('span');
    c.className = `gg-chip ${good ? 'good' : 'bad'}`;
    c.textContent = text;
    el.appendChild(c);
    setTimeout(() => c.remove(), 1600);
    el.classList.remove('bump');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('bump');
  }

  tasks(list: Task[], title: string) {
    const key = JSON.stringify(list.map((t) => [t.id, t.st, t.current, t.detail])) + title;
    if (key === this.taskKey) return;
    this.taskKey = key;
    const done = list.filter((t) => t.st === 'ok').length;
    this.tasksEl.innerHTML = `<div class="gt-head"><b>${esc(title)}</b><span>${done}/${list.length}</span></div>
      <ol>${list
        .map(
          (t) => `<li class="${t.st} ${t.current ? 'cur' : ''}"><button data-act="h-goto" data-station="${t.station}" title="${esc(t.detail)}" style="--rc:${t.color}">
            <i class="tk">${t.st === 'ok' ? '✓' : t.st === 'warn' ? '!' : t.current ? '▸' : ''}</i><span>${esc(t.label)}</span>${t.current && t.st !== 'ok' ? `<em>${esc(t.detail)}</em>` : ''}</button></li>`,
        )
        .join('')}</ol>`;
  }

  prompt(text: string | null, key = 'E') {
    const html = text ? `<kbd>${key}</kbd><span>${esc(text)}</span>` : '';
    if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
    this.promptEl.classList.toggle('show', !!text);
    this.useBtn.classList.toggle('show', !!text);
    const sp = this.useBtn.querySelector('span')!;
    sp.textContent = text ? (text.length > 14 ? 'USE' : text.split(' ')[0].toUpperCase()) : 'USE';
  }

  hint(html: string | null) {
    this.hintEl.innerHTML = html ?? '';
    this.hintEl.classList.toggle('show', !!html);
  }

  /** Flight Director radio call. */
  say(text: string, who = 'FLIGHT', ms = 6500, urgent = false) {
    if (urgent) this.sayQueue = [];
    const last = this.sayQueue[this.sayQueue.length - 1];
    if (last && last.text === text) return;
    if (this.radioEl.dataset.text === text && this.radioEl.classList.contains('show')) return;
    this.sayQueue.push({ text, who, ms });
    if (urgent || !this.radioEl.classList.contains('show')) this.nextSay();
  }

  private nextSay() {
    clearTimeout(this.sayTimer);
    clearInterval(this.typing);
    const s = this.sayQueue.shift();
    if (!s) {
      this.radioEl.classList.remove('show');
      return;
    }
    this.radioEl.dataset.text = s.text;
    this.radioEl.innerHTML = `<div class="gr-av"><svg viewBox="0 0 40 40"><circle cx="20" cy="15" r="7"/><path d="M7 37c1.5-8 6.5-12 13-12s11.5 4 13 12"/><path class="hs" d="M11 15a9 9 0 0 1 18 0"/><rect class="hs" x="8.5" y="13" width="4" height="7" rx="1.5"/><rect class="hs" x="27.5" y="13" width="4" height="7" rx="1.5"/><path class="hs" d="M10.5 20c0 4 3 5.5 6 5.5"/></svg><i class="wave"><b></b><b></b><b></b><b></b></i></div>
      <div class="gr-body"><div class="gr-who">${esc(s.who)} <span>· loop 1</span></div><p></p></div>
      <button class="gr-x" data-act="h-radio-x" aria-label="Dismiss">×</button>`;
    this.radioEl.classList.add('show');
    const p = this.radioEl.querySelector('p')!;
    let i = 0;
    this.typing = window.setInterval(() => {
      i += 2;
      p.textContent = s.text.slice(0, i);
      if (i >= s.text.length) {
        clearInterval(this.typing);
        this.radioEl.classList.add('done');
      }
    }, 18);
    this.radioEl.classList.remove('done');
    this.sayTimer = window.setTimeout(() => this.nextSay(), s.ms + s.text.length * 12);
  }

  dismissRadio() {
    this.sayQueue = [];
    this.nextSay();
  }

  openPanel(html: string, color: string) {
    this.panelEl.style.setProperty('--rc', color);
    const scroll = (this.panelEl.querySelector('.gp-body') as HTMLElement | null)?.scrollTop ?? 0;
    const was = this.panelOpen;
    this.panelEl.innerHTML = html;
    this.panelEl.classList.add('show');
    if (!was) this.panelEl.classList.add('enter');
    else this.panelEl.classList.remove('enter');
    const b = this.panelEl.querySelector('.gp-body') as HTMLElement | null;
    if (b && was) b.scrollTop = scroll;
    this.panelOpen = true;
  }

  closePanel() {
    this.panelEl.classList.remove('show');
    this.panelOpen = false;
  }

  labels(list: Label[]) {
    for (const l of list) {
      let el = this.labelEls.get(l.id);
      if (!el) {
        el = document.createElement('button');
        el.className = 'gl';
        el.dataset.act = 'h-goto';
        el.dataset.station = l.id;
        this.labelsEl.appendChild(el);
        this.labelEls.set(l.id, el);
      }
      if (!l.show) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
      const near = l.dist < 7;
      const html = `<span class="gl-dot" style="--rc:${l.color}"></span><span class="gl-n">${esc(l.name)}</span>${l.st !== 'none' ? `<i class="gl-s ${l.st}">${l.st === 'ok' ? '✓' : l.st === 'warn' ? '!' : '✕'}</i>` : ''}`;
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
      }
      el.classList.toggle('cur', l.current);
      el.classList.toggle('far', !near && !l.current);
    }
  }

  tooltip(html: string | null, x = 0, y = 0) {
    if (!html) {
      this.tipEl.classList.remove('show');
      return;
    }
    if (this.tipEl.innerHTML !== html) this.tipEl.innerHTML = html;
    this.tipEl.classList.add('show');
    const w = this.tipEl.offsetWidth;
    this.tipEl.style.transform = `translate(${Math.min(window.innerWidth - w - 10, x + 16)}px, ${Math.max(10, y - 10)}px)`;
  }

  minimap(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const ctx = this.mapCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    draw(ctx, this.mapCanvas.width, this.mapCanvas.height);
  }

  private bindTouch() {
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const R = 46;
    this.joy.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = this.joy.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      this.joy.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx *= R / l;
        dy *= R / l;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joyVec = { x: dx / R, y: dy / R };
    };
    this.joy.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.knob.style.transform = '';
      this.joyVec = { x: 0, y: 0 };
    };
    this.joy.addEventListener('pointerup', end);
    this.joy.addEventListener('pointercancel', end);
    this.useBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onUseHold?.(true);
      this.onUse?.();
    });
    this.useBtn.addEventListener('pointerup', () => this.onUseHold?.(false));
    this.useBtn.addEventListener('pointerleave', () => this.onUseHold?.(false));
  }
}
