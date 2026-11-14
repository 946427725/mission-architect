// Packs the Vite build (dist/) into one self-contained HTML page:
// all CSS and JS inlined, only Google Fonts loaded from outside.
// Output: single/index.html (used for the hosted Claude artifact).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');

const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
const bodyInner = body
  .slice(body.indexOf('>') + 1)
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .trim();
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const out = `<title>Mission Architect</title>
<meta name="description" content="Design a real space mission - physics decides if it works. A NASA Space Apps Challenge 2026 game.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
${css}
</style>
<script>document.body && document.body.setAttribute('data-screen', 'title');</script>
${bodyInner}
<script type="module">
document.body.setAttribute('data-screen', 'title');
${safeJs}
</script>
`;
mkdirSync('single', { recursive: true });
writeFileSync(join('single', 'index.html'), out);
console.log(`single/index.html written: ${(out.length / 1024).toFixed(0)} KB`);
