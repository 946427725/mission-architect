export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
export const fmtKg = (v: number) => `${fmtInt(v)} kg`;
export const fmtW = (v: number) => (v >= 10 ? `${fmtInt(v)} W` : `${v.toFixed(1)} W`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;

let toastTimer = 0;
export function toast(msg: string, tone: 'info' | 'warn' | 'good' = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ''), 3200);
}

export const statusIcon = (s: 'ok' | 'warn' | 'fail') =>
  s === 'ok' ? '<span class="st ok">GO</span>' : s === 'warn' ? '<span class="st warn">CHECK</span>' : '<span class="st fail">NO-GO</span>';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Engineering revision letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function revLetter(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const tweens = new WeakMap<HTMLElement, number>();
/** Count a number up/down inside an element. */
export function tween(el: HTMLElement, from: number, to: number, fmt: (v: number) => string, dur = 600) {
  const id = (tweens.get(el) ?? 0) + 1;
  tweens.set(el, id);
  if (reduceMotion() || dur <= 0) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = () => {
    if (tweens.get(el) !== id) return;
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  step();
  setTimeout(() => {
    if (tweens.get(el) === id) el.textContent = fmt(to);
  }, dur + 80);
}

/** Full-screen 3-2-1 launch countdown, then calls done(). */
export function countdown(label: string, done: () => void) {
  const el = $('#countdown');
  const steps = ['3', '2', '1', 'LIFTOFF'];
  const fast = reduceMotion();
  let i = 0;
  el.className = 'show';
  const next = () => {
    if (i >= steps.length) {
      el.classList.add('out');
      setTimeout(() => {
        el.className = '';
        el.innerHTML = '';
      }, 700);
      done();
      return;
    }
    const s = steps[i++];
    const word = s.length > 1;
    el.innerHTML = `<div class="cd-ring"></div><div class="cd-num ${word ? 'word' : ''}">${s}</div><div class="cd-label">${word ? 'Ignition' : `T-minus ${s}`} · ${esc(label)}</div>`;
    setTimeout(next, fast ? 120 : word ? 950 : 820);
  };
  next();
}
