// Player settings: language, colour-blind safe palette and reduced motion.
// Stored per device; applied as attributes on <html> so CSS can follow them.

export type Lang = 'en' | 'uz';

export interface Settings {
  lang: Lang;
  colorblind: boolean;
  reduceMotion: boolean;
}

const KEY = 'ma-settings';

function load(): Settings {
  const s: Settings = {
    lang: 'en',
    colorblind: false,
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch {
    /* private mode: defaults */
  }
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    const l = q.get('lang');
    if (l === 'en' || l === 'uz') s.lang = l;
    if (q.get('cb') === '1') s.colorblind = true;
    if (q.get('motion') === 'reduce') s.reduceMotion = true;
  }
  if (s.lang !== 'en' && s.lang !== 'uz') s.lang = 'en';
  return s;
}

export const settings: Settings = load();
const listeners: ((s: Settings) => void)[] = [];

export function onSettings(fn: (s: Settings) => void) {
  listeners.push(fn);
}

export function applySettings() {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.lang = settings.lang;
  r.dataset.cb = settings.colorblind ? '1' : '0';
  r.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  if (settings[k] === v) return;
  settings[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applySettings();
  for (const fn of listeners) fn(settings);
}

/** Status colours for canvas drawings (CSS uses the same values through variables). */
export function statusColor(st: 'ok' | 'warn' | 'fail'): string {
  if (settings.colorblind) return st === 'ok' ? '#3aa6ff' : st === 'warn' ? '#f7e15a' : '#ff8a00';
  return st === 'ok' ? '#58e08a' : st === 'warn' ? '#f2b43a' : '#ff5a52';
}

applySettings();
