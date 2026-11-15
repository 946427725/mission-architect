// Merges translated parts into src/i18n/uz.json and checks every entry:
// same number of {} / {*} placeholders, same <n> tags, no stray ASCII
// apostrophes in o‘/g‘. Usage: node scripts/dev/i18n-merge.mjs part1.json part2.json ...
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'src/i18n/uz.json';
const merged = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const problems = [];
const count = (s, re) => (s.match(re) ?? []).length;
const tags = (s) => [...s.matchAll(/<([a-z0-9])\/?>/g)].map((m) => m[1]).sort().join(',');
for (const f of process.argv.slice(2)) {
  const part = JSON.parse(readFileSync(f, 'utf8'));
  for (const [k, v0] of Object.entries(part)) {
    if (typeof v0 !== 'string') continue;
    let v = v0.trim() === '' ? '' : v0;
    if (!v) continue;
    // normalise apostrophes in o‘ g‘ and the tutuq belgisi
    v = v.replace(/([oOgG])['ʻ`´]/g, '$1‘').replace(/([a-zA-Z])['ʼ](?=[a-zA-Z])/g, '$1’');
    const holes = count(k, /\{\*?\}/g);
    const numbered = [...v.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    const seq = count(v, /\{\*?\}/g);
    let ok = true;
    if (numbered.length) {
      if (seq) ok = false;
      if (new Set(numbered).size !== holes || Math.max(...numbered) !== holes - 1) ok = false;
    } else if (seq !== holes) ok = false;
    if (tags(k) !== tags(v)) ok = false;
    if (!ok) {
      problems.push({ k, v });
      continue;
    }
    merged[k] = v;
  }
}
writeFileSync(OUT, JSON.stringify(merged, null, 1) + '\n');
console.log('entries', Object.keys(merged).length, 'problems', problems.length);
if (problems.length) writeFileSync('i18n-problems.json', JSON.stringify(problems, null, 1));
