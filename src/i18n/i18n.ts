// Language support (English source text, Uzbek translation).
//
// The game writes its UI in English. When Uzbek is on, a MutationObserver
// translates every new or changed text node, plus title/placeholder/aria-label
// attributes, from a dictionary (src/i18n/uz.json). Keys are English text with
// numbers replaced by {} and template holes by {*}; values keep the same
// placeholders ({} / {*} in order, or {0} {1} ... to reorder).
//
// Sentences with inline formatting (<b>, <kbd>, <a> ...) are translated as one
// unit, "Click <a>Launch</a> to go" (parts lettered a, b, c ... in order;
// a part without words is <a/>), so the Uzbek word order can differ.
// Canvas text and the radio typewriter call tr() directly.
import { onSettings, settings } from '../ui/settings';
import uzDict from './uz.json';

type Dict = Record<string, string>;
interface Pattern {
  re: RegExp;
  /** literal pieces between the {*} holes (they may contain {} numbers) */
  lits: string[];
  out: string;
}

let dict: Dict | null = null;
const exact = new Map<string, string>();
const exactLower = new Map<string, string>();
/** a number inside a key while matching patterns (one character, so a {*} hole cannot split it) */
const N = '\uE000';
let patterns: Pattern[] = [];
const cache = new Map<string, string | null>();
const NUM = /\d+(?:[.,]\d+)*/g;
const HAS_WORD = /[A-Za-z]{2}/;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'CANVAS', 'SVG', 'svg', 'NOSCRIPT']);
const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'SMALL', 'KBD', 'A', 'SPAN', 'SUP', 'SUB', 'BR', 'U', 'ABBR', 'MARK']);
const ATTRS = ['title', 'placeholder', 'aria-label'];
const collect = typeof location !== 'undefined' && new URLSearchParams(location.search).get('i18n') === 'collect';

/** English text -> lookup key: trimmed, single spaces, numbers as {}. */
export function keyOf(s: string): { key: string; nums: string[] } {
  const nums: string[] = [];
  const key = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(NUM, (x) => {
      nums.push(x);
      return '{}';
    });
  return { key, nums };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(d: Dict) {
  exact.clear();
  exactLower.clear();
  patterns = [];
  cache.clear();
  for (const [k0, v] of Object.entries(d)) {
    if (!v) continue;
    // keys are stored already normalised; normalise again in case a number slipped in
    const k = k0.includes('{*}') ? k0 : keyOf(k0).key;
    if (!k.includes('{*}')) {
      exact.set(k, v);
      if (!exactLower.has(k.toLowerCase())) exactLower.set(k.toLowerCase(), v);
      continue;
    }
    const lits = k.split('{*}');
    const re = new RegExp('^' + lits.map((l) => esc(l.replace(/\{\}/g, N))).join('(.+?)') + '$');
    patterns.push({ re, lits, out: v });
  }
  // longer (more specific) patterns first
  patterns.sort((a, b) => b.lits.join('').length - a.lits.join('').length);
}

/** Put values into {} / {*} (in order) or {0} {1} ... (by index). */
function fill(out: string, vals: string[]): string {
  let i = 0;
  return out.replace(/\{(\d*|\*)\}/g, (_m, g: string) => {
    if (g && g !== '*') return vals[Number(g)] ?? '';
    return vals[i++] ?? '';
  });
}

function lookup(text: string): string | null {
  const { key, nums } = keyOf(text);
  if (!key || !HAS_WORD.test(key)) return null;
  const v = exact.get(key);
  if (v !== undefined) return fill(v, nums);
  const keyN = key.replace(/\{\}/g, N);
  for (const p of patterns) {
    const m = p.re.exec(keyN);
    if (!m) continue;
    // walk literals and holes in order, handing out the numbers
    const vals: string[] = [];
    let n = 0;
    const take = (s: string) => s.replace(new RegExp(N, 'g'), () => nums[n++] ?? '');
    for (let i = 0; i < p.lits.length; i++) {
      const litNums = (p.lits[i].match(/\{\}/g) ?? []).length;
      for (let j = 0; j < litNums; j++) vals.push(nums[n++] ?? '');
      if (i < p.lits.length - 1) {
        const cap = take(m[i + 1]);
        vals.push(trInner(cap));
      }
    }
    return fill(p.out, vals);
  }
  return null;
}

/** Inserted text: also try it capitalised ("pick a launch date" -> "Pick a launch date"). */
function trInner(s: string): string {
  const t = tr(s);
  if (t !== s || !/^\s*[a-z]/.test(s)) return t;
  // inserted names are often lower-cased ("nuclear power (rtg)"): match without case
  const { key, nums } = keyOf(s);
  const v = exactLower.get(key.toLowerCase());
  if (v === undefined) return s;
  const out = fill(v, nums);
  const lead = /^\s*/.exec(s)![0];
  return lead + out[0].toLowerCase() + out.slice(1);
}

/** Translate one piece of English UI text (returns it unchanged if unknown or in English mode). */
export function tr(s: string): string {
  if (!dict || settings.lang === 'en' || !s) return s;
  const c = cache.get(s);
  if (c !== undefined) return c ?? s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const t = lookup(m[2]);
  const r = t === null ? null : m[1] + t + m[3];
  if (cache.size > 6000) cache.clear();
  cache.set(s, r);
  if (r === null && collect) miss.text.add(keyOf(s).key);
  return r ?? s;
}

// ------------------------------------------------------------------ DOM
const origText = new WeakMap<Text, string>();
const wrote = new WeakMap<Text, string>();
const origAttr = new WeakMap<Element, Record<string, string>>();
const wroteAttr = new WeakMap<Element, Record<string, string>>();
const unitOrig = new WeakMap<Element, Node[]>();
const unitWrote = new WeakMap<Element, string>();
const ours = new WeakSet<Node>();
const unitEls = new Set<WeakRef<Element>>();
const miss = { text: new Set<string>(), unit: new Set<string>() };
if (collect) (window as unknown as { __i18n: typeof miss }).__i18n = miss;

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.getAttribute('translate') === 'no') return true;
  }
  return false;
}

function doText(n: Text) {
  const v = n.data;
  if (wrote.get(n) === v) return;
  if (!HAS_WORD.test(v)) {
    origText.delete(n);
    return;
  }
  if (skipped(n.parentElement)) return;
  origText.set(n, v);
  if (collect && settings.lang === 'en') miss.text.add(keyOf(v).key);
  const t = tr(v);
  if (t !== v) {
    wrote.set(n, t);
    n.data = t;
  } else wrote.delete(n);
}

function doAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const w = wroteAttr.get(el);
    if (w && w[a] === v) continue;
    if (!HAS_WORD.test(v)) continue;
    const o = origAttr.get(el) ?? {};
    o[a] = v;
    origAttr.set(el, o);
    if (collect && settings.lang === 'en') miss.text.add(keyOf(v).key);
    const t = tr(v);
    if (t !== v) {
      const ww = w ?? {};
      ww[a] = t;
      wroteAttr.set(el, ww);
      el.setAttribute(a, t);
    }
  }
}

/** An element whose children are text plus simple inline tags: translate it as one sentence. */
const letter = (i: number) => String.fromCharCode(96 + i);
function unitKey(el: Element): { key: string; parts: Element[] } | null {
  let hasText = false;
  let wordy = false;
  const parts: Element[] = [];
  let s = '';
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      const t = (c as Text).data;
      if (HAS_WORD.test(t)) hasText = true;
      s += t;
    } else if (c.nodeType === 1) {
      const e = c as Element;
      if (!INLINE.has(e.tagName)) return null;
      if (e.tagName !== 'BR' && Array.from(e.childNodes).some((x) => x.nodeType === 1 && (x as Element).tagName !== 'BR')) return null;
      parts.push(e);
      if (parts.length > 26) return null;
      const L = letter(parts.length);
      const inner = e.textContent ?? '';
      if (HAS_WORD.test(inner)) {
        wordy = true;
        s += `<${L}>${inner}</${L}>`;
      } else s += `<${L}/>`;
    } else if (c.nodeType !== 8) return null;
  }
  // icons and symbols around plain text are left alone (text nodes translate one by one)
  if (!hasText || !wordy) return null;
  return { key: s, parts };
}

function doUnit(el: Element): boolean {
  if (settings.lang === 'en' && !collect) return false;
  if (unitWrote.get(el) === el.innerHTML) return true;
  const u = unitKey(el);
  if (!u) return false;
  if (collect && settings.lang === 'en') {
    miss.unit.add(keyOf(u.key).key);
    return false;
  }
  if (!dict) return false;
  const t = lookup(u.key);
  if (t === null) {
    if (collect) miss.unit.add(keyOf(u.key).key);
    return false;
  }
  // rebuild: text + clones of the inline parts with translated content
  unitOrig.set(el, Array.from(el.childNodes).map((c) => c.cloneNode(true)));
  unitEls.add(new WeakRef(el));
  const frag = document.createDocumentFragment();
  const re = /<([a-z])\/>|<([a-z])>([\s\S]*?)<\/\2>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const add = (n: Node) => {
    ours.add(n);
    frag.appendChild(n);
  };
  while ((m = re.exec(t))) {
    if (m.index > last) add(document.createTextNode(t.slice(last, m.index)));
    const idx = (m[1] ?? m[2]).charCodeAt(0) - 97;
    const src = u.parts[idx];
    if (src) {
      // a part without words (icon, symbol) is copied whole; a worded part gets the translated words
      const c = src.cloneNode(m[3] === undefined) as Element;
      if (m[3] !== undefined) c.appendChild(document.createTextNode(m[3]));
      c.querySelectorAll('*').forEach((x) => ours.add(x));
      ours.add(c);
      if (c.firstChild) ours.add(c.firstChild);
      add(c);
    }
    last = re.lastIndex;
  }
  if (last < t.length) add(document.createTextNode(t.slice(last)));
  el.replaceChildren(frag);
  unitWrote.set(el, el.innerHTML);
  return true;
}

function walk(root: Node) {
  if (root.nodeType === 3) {
    if (!ours.has(root)) doText(root as Text);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    const el = root as Element;
    if (ours.has(el)) return;
    if (SKIP_TAGS.has(el.tagName) || el.getAttribute('translate') === 'no') return;
    if (skipped(el.parentElement)) return;
    doAttrs(el);
    if (doUnit(el)) return;
  }
  for (const c of Array.from(root.childNodes)) walk(c);
}

let observer: MutationObserver | null = null;
function observe() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    if (settings.lang === 'en' && !collect) return;
    for (const r of records) {
      if (r.type === 'characterData') {
        const n = r.target as Text;
        if (!ours.has(n) || wrote.get(n) !== n.data) doText(n);
      } else if (r.type === 'attributes') doAttrs(r.target as Element);
      else {
        // a sentence element got new children: try it as one unit first
        const t = r.target as Element;
        if (t.nodeType === 1 && !ours.has(t) && !skipped(t) && doUnit(t)) continue;
        r.addedNodes.forEach((n) => {
          if (!ours.has(n)) walk(n);
        });
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Back to the English originals everywhere on the page. */
function revert() {
  for (const ref of unitEls) {
    const el = ref.deref();
    const o = el && unitOrig.get(el);
    if (el && o && el.isConnected) {
      el.replaceChildren(...o);
      unitWrote.delete(el);
    }
  }
  unitEls.clear();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      const o = origText.get(n as Text);
      if (o !== undefined && wrote.has(n as Text)) {
        wrote.delete(n as Text);
        (n as Text).data = o;
      }
    } else {
      const el = n as Element;
      const o = origAttr.get(el);
      if (o) for (const [a, v] of Object.entries(o)) el.setAttribute(a, v);
      wroteAttr.delete(el);
    }
  }
}

async function loadDict(): Promise<void> {
  if (dict) return;
  // bundled with the game (the one-file Windows build cannot load extra files)
  dict = uzDict as Dict;
  build(dict);
}

let current = 'en';
/** Call once before the UI is built. */
export async function initI18n() {
  if (settings.lang === 'uz') await loadDict();
  current = settings.lang;
  observe();
  if (settings.lang === 'uz' || collect) walk(document.body);
  onSettings(async (s) => {
    if (s.lang === current) return;
    current = s.lang;
    cache.clear();
    if (s.lang === 'uz') {
      await loadDict();
      walk(document.body);
    } else revert();
    for (const fn of langListeners) fn();
  });
}

const langListeners: (() => void)[] = [];
/** Re-render hooks for things drawn outside the DOM (canvas, cached HTML). */
export function onLang(fn: () => void) {
  langListeners.push(fn);
}

/** Tests: switch to Uzbek without a page. */
export async function prepareForTests() {
  await loadDict();
}

/** For tests and the collector: dictionary size. */
export function dictSize() {
  return exact.size + patterns.length;
}
