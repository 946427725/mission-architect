// Builds the list of English keys to translate from (1) every string literal
// in src/ (split at HTML tags, attribute texts included) and (2) the texts the
// harvester saw at run time. Usage:
//   node scripts/dev/i18n-keys.mjs <harvest.json|-> <out.json>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [harvestFile, outFile] = process.argv.slice(2);
const tmp = join(tmpdir(), 'ma-strings.json');
execFileSync(process.execPath, ['scripts/dev/strings.mjs', '0', '--json', tmp]);
const strings = JSON.parse(readFileSync(tmp, 'utf8'));

const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (s) => s.replace(/\s+/g, ' ').trim().replace(NUM, '{}');
const letters = (s) => s.replace(/\{\*?\}/g, '').replace(/[^A-Za-z]/g, '').length;
const codey = (t) =>
  /=>|^[a-z-]+\s*:\s*[^;]+;|\bvar\(|rgba?\(|#[0-9a-f]{3,6}\b|\bpx\b|https?:|\.(ts|js|json|jpg|png|svg)\b|^[.#[]|\bdata-|class=|^\w+\(|gl_|vec[234]/i.test(t) ||
  /^[a-z0-9_\-:./]+$/.test(t) || // ids and keys
  /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t) || // camelCase
  /^[A-Z0-9_]+$/.test(t) && t.length > 1 && !/[AEIOU]/.test(t); // constants without vowels
const junk = (t) => /^&\w+;$|sans-serif|monospace|gradient\(|^\((pointer|prefers|max-width|min-width)|^\{\*\}$|^[a-z]+\{\}$/.test(t);
const skipFile = (f) => /physics[\\/]|tex\.ts|kit\.ts|rng\.ts|persist\.ts/.test(f);

const keys = new Map(); // key -> source
const add = (raw, src) => {
  const k = norm(raw);
  if (!k || letters(k) < 2 || codey(k) || junk(k)) return;
  if (/^[{}*\s·,.:;()\-–—+/%$×]+$/.test(k.replace(/[A-Za-z]{1}\b/g, ''))) return;
  if (!keys.has(k)) keys.set(k, src);
};
for (const o of strings) {
  if (skipFile(o.f) || /void main|uniform |attribute vec/.test(o.s)) continue;
  // attribute texts
  for (const m of o.s.matchAll(/\b(?:title|aria-label|placeholder|data-tip-title|data-tip)="([^"]*)"/g)) add(m[1], o.f);
  for (const seg of o.s.split(/<[^>]*>/)) add(seg, o.f);
}
let staticCount = keys.size;
let h = { text: [], unit: [] };
if (harvestFile && harvestFile !== '-') h = JSON.parse(readFileSync(harvestFile, 'utf8'));
const units = new Set();
for (const t of h.text) add(t, 'runtime');
for (const u of h.unit) {
  const k = norm(u);
  if (letters(k) >= 2) units.add(k);
}
// a unit's pieces are also useful on their own (fallback when the sentence differs)
const out = { keys: [...keys.keys()], units: [...units].sort() };
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log('static', staticCount, 'total keys', out.keys.length, 'units', out.units.length);
