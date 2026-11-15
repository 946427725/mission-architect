// Lists the human-readable strings in src/ (for translation and text review).
// Usage: node scripts/dev/strings.mjs [minLength] [--json out.json]
// Template literals keep their ${...} holes as {*}; HTML tags are split out.
import { parseSync } from 'rolldown/experimental';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const min = Number(process.argv[2] || 0);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.includes('i18n')) files.push(p);
  }
};
walk(join(root, 'src'));
const out = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const r = parseSync(f, src, { lang: 'ts' });
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' && n.source) return;
    if (n.type === 'Literal' && typeof n.value === 'string') out.push({ f: relative(root, f), s: n.value });
    if (n.type === 'TemplateLiteral') out.push({ f: relative(root, f), s: n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('{*}') });
    for (const k in n) if (k !== 'parent') visit(n[k]);
  };
  visit(r.program);
}
const txt = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  console.log('wrote', out.length, 'strings to', jsonOut);
} else {
  const long = out.filter((o) => txt(o.s).length >= min && /[a-z] [a-z]/i.test(txt(o.s)));
  long.sort((a, b) => txt(b.s).length - txt(a.s).length);
  for (const o of long) console.log(txt(o.s).length, o.f, '|', txt(o.s).slice(0, 420));
}
