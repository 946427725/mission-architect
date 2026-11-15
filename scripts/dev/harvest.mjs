// Plays through every screen in "collect" mode and saves all UI text the
// game showed (for the translation dictionary). Needs the dev server and a
// test window with CDP: node scripts/dev/harvest.mjs <port> <out.json>
import { writeFileSync } from 'node:fs';
const [port, outFile] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.type === 'page');
const sock = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    sock.send(JSON.stringify({ id: i, method, params }));
  });
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
};
await new Promise((r) => (sock.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (js, label = '') => {
  const r = await call('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, timeout: 600000 });
  const v = r.result?.value ?? r.exceptionDetails?.exception?.description;
  if (label) console.log(label, typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 200));
  return v;
};
const base = `http://localhost:5173/?i18n=collect${process.argv[4] ? '&lang=' + process.argv[4] : ''}`;
await call('Page.navigate', { url: base });
await sleep(5000);
await ev(`localStorage.removeItem('ma-settings'); 1`);
await call('Page.navigate', { url: base });
await sleep(6000);

// in-page helpers
const H = `
const A = window.missionArchitect;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => { const e = document.querySelector(sel); if (e) e.click(); return !!e; };
const until = async (f, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(200); } return false; };
`;

// ---- title, modals, settings
await ev(`(async()=>{${H}
  click('[data-act=howto]'); await sleep(400); click('[data-act=howto-close]');
  click('[data-act=validation]'); await sleep(600); click('[data-act=modal-close]');
  click('[data-act=settings]'); await sleep(400); click('[data-act=modal-close]');
  return 'title ok'; })()`, 'title');

// ---- mission select: every mission, objective, difficulty, crew
await ev(`(async()=>{${H}
  click('[data-act=to-select]'); await sleep(800);
  for (const m of ['mars','jupiter','pluto']) {
    click('[data-act=pick-mission][data-val='+m+']'); await sleep(500);
    for (const o of [...document.querySelectorAll('[data-act=pick-objective]')].map(e=>e.dataset.val)) { click('[data-act=pick-objective][data-val='+o+']'); await sleep(150); }
    for (const d of ['easy','normal','hard','sandbox']) { click('[data-act=pick-diff][data-val='+d+']'); await sleep(150); }
    for (const n of [2,3,4]) { click('[data-act=pick-crew][data-val="'+n+'"]'); await sleep(150); }
    click('[data-act=pick-mode][data-val=solo]'); await sleep(150);
  }
  click('[data-act=pick-diff][data-val=normal]');
  return 'select ok'; })()`, 'select');

// ---- each mission: hangar stations, route console, engineer view, menu
for (const m of ['mars', 'jupiter', 'pluto']) {
  await ev(`(async()=>{${H}
    A.select.missionId='${m}'; A.select.difficulty='normal'; A.select.team=false; A.go('select'); await sleep(500);
    click('[data-act=begin]'); await sleep(5000);
    const H2 = A.hangar;
    for (const st of H2.stations.map(s=>s.def.id)) { H2.openStation(st); await sleep(700); }
    H2.openStation('science'); await sleep(400);
    const card = document.querySelector('.gh-panel [data-act=h-pick]'); if (card) { card.click(); await sleep(300); }
    H2.openStation('power'); await sleep(500); H2.closePanel();
    A.openMenu(); await sleep(400); click('[data-act=modal-close]');
    A.openRoute(); await sleep(4000); await A.autoPick(); await sleep(1500);
    A.renderPanel(); await sleep(300);
    const z = document.querySelector('[data-act=zoom]'); if (z) { z.click(); await sleep(600); click('[data-act=unzoom]'); }
    click('[data-act=history-on]'); await sleep(1500); click('[data-act=history-off]'); await sleep(500);
    A.openPro(); await sleep(800);
    for (const t of ['trajectory','spacecraft','science','comms','launch']) { A.tab=t; A.render(); await sleep(500); click('[data-act=help]'); await sleep(200); click('[data-act=help]'); }
    click('[data-act=autoprop]'); await sleep(300);
    A.backToHangar(); await sleep(1500);
    for (const st of H2.stations.map(s=>s.def.id)) { H2.openStation(st); await sleep(400); }
    H2.closePanel();
    return '${m} hangar ok'; })()`, m + ' hangar');
}

// ---- flights: NASA designs and the rough starter designs (successes and failures)
const fly = (setup, label) =>
  ev(`(async()=>{${H}
    ${setup}
    await sleep(1500);
    if (!A.ev.launchable) return 'not launchable: ' + A.ev.checks.filter(c=>c.status==='fail').map(c=>c.id).join(',');
    A.demoSpeed = 4;
    A.launch();
    let k = 0;
    const t0 = Date.now();
    while (A.screen !== 'report' && Date.now() - t0 < 420000) {
      const opts = document.querySelectorAll('.mc-call [data-act=mc-pick]');
      if (opts.length) { opts[(k++) % opts.length].click(); await sleep(600); }
      const sk = document.querySelector('[data-act=pad-skip]'); if (sk && Math.random() < 0.02) sk.click();
      await sleep(400);
    }
    await sleep(2500);
    for (const b of document.querySelectorAll('.rp [data-act]')) { const a = b.dataset.act; if (/compare|tab|more|detail|log/.test(a)) { b.click(); await sleep(300); } }
    window.scrollTo(0, 99999);
    return A.screen + ' ' + (A.sim && A.sim.outcome); })()`, label);

for (const m of ['mars', 'jupiter', 'pluto']) {
  await fly(`A.loadNasaDesign('${m}','normal');`, 'nasa ' + m);
  await fly(`A.select.missionId='${m}'; A.select.difficulty='hard'; A.go('select'); await sleep(400); click('[data-act=begin]'); await sleep(4000); await A.autoPick(); await sleep(800); A.autoFuel(); A.design.rocketId = 'sls'; A.applyDesign({...A.design});`, 'rough ' + m);
}
// a design that is launchable but weak (more failures)
await fly(`A.loadNasaDesign('mars','hard'); A.design.powerId='solar-s'; A.design.batteryId='bat-s'; A.design.landingId='retro'; A.design.instruments=['mastcam','supercam']; A.applyDesign({...A.design});`, 'weak mars');
await fly(`A.loadNasaDesign('jupiter','hard'); A.design.shieldId='none'; A.design.antennaId='hga15'; A.applyDesign({...A.design});`, 'weak jupiter');
await fly(`A.loadNasaDesign('pluto','hard'); A.design.adcsId='spin'; A.design.antennaId='hga15'; A.applyDesign({...A.design});`, 'weak pluto');

// ---- team mode
await ev(`(async()=>{${H}
  A.select.missionId='jupiter'; A.select.team=true; A.select.count=4; A.select.players=['Ana','Bek','Cho','Dil']; A.go('select'); await sleep(400);
  click('[data-act=begin]'); await sleep(5000);
  for (let i=0;i<4;i++){ A.hangar.switchTo(i); await sleep(500); }
  for (const st of A.hangar.stations.map(s=>s.def.id)) { A.hangar.openStation(st); await sleep(400); }
  A.hangar.openStation('gate'); await sleep(500);
  A.select.team=false;
  return 'team ok'; })()`, 'team');

// ---- training mission, every coach card
await ev(`(async()=>{${H}
  A.go('title'); await sleep(500); click('[data-act=tutorial]'); await sleep(4000);
  const step = () => document.querySelector('#coach')?.dataset.step;
  const t0 = Date.now();
  while (Date.now() - t0 < 400000) {
    if (document.querySelector('[data-act=tut-play]')) break;
    if (click('[data-act=tut-next]') || click('[data-act=tut-show]')) { await sleep(800); continue; }
    const opts = document.querySelectorAll('.mc-call [data-act=mc-pick]');
    if (opts.length) opts[0].click();
    A.demoSpeed = 4;
    await sleep(1000);
  }
  return 'tutorial ' + step(); })()`, 'tutorial');

const data = await ev(`JSON.stringify({ text: [...window.__i18n.text], unit: [...window.__i18n.unit] })`);
writeFileSync(outFile, data);
const j = JSON.parse(data);
console.log('saved', j.text.length, 'texts', j.unit.length, 'units');
sock.close();
process.exit(0);
