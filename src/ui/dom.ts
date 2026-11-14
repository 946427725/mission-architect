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
  s === 'ok' ? '<span class="st ok" aria-label="OK">✓</span>' : s === 'warn' ? '<span class="st warn" aria-label="Warning">!</span>' : '<span class="st fail" aria-label="Fail">✕</span>';
