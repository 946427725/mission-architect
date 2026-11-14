// Real-input play-test driver over the Chrome DevTools Protocol.
// Usage: node play.mjs <port> <steps.json>
// Steps: {"key":"w","ms":1500} hold a key, {"press":"e"}, {"click":[x,y]},
// {"drag":[x1,y1,x2,y2]}, {"wait":ms}, {"shot":"name.jpg"}, {"eval":"js"}, {"nav":"url"}
import { readFileSync, writeFileSync } from 'node:fs';
const [port, file] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(file, 'utf8'));
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
const KEYS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE', tab: 'Tab', escape: 'Escape', shift: 'ShiftLeft', ' ': 'Space' };
const keyEv = (type, k) => {
  const name = k.length === 1 ? k : k[0].toUpperCase() + k.slice(1);
  const vk = { w: 87, a: 65, s: 83, d: 68, e: 69, tab: 9, escape: 27, shift: 16, ' ': 32 }[k] ?? 0;
  return call('Input.dispatchKeyEvent', { type, key: k === 'escape' ? 'Escape' : k === 'tab' ? 'Tab' : k === 'shift' ? 'Shift' : name === ' ' ? ' ' : k, code: KEYS[k], windowsVirtualKeyCode: vk, text: type === 'keyDown' && k.length === 1 ? k : undefined });
};
const mouse = (type, x, y, buttons = 1) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse' });
for (const s of steps) {
  if (s.key) {
    await keyEv('keyDown', s.key);
    await sleep(s.ms ?? 300);
    await keyEv('keyUp', s.key);
  } else if (s.press) {
    await keyEv('keyDown', s.press);
    await sleep(s.hold ?? 60);
    await keyEv('keyUp', s.press);
  } else if (s.click) {
    const [x, y] = s.click;
    await mouse('mouseMoved', x, y, 0);
    await sleep(40);
    await mouse('mousePressed', x, y);
    await sleep(s.hold ?? 60);
    await mouse('mouseReleased', x, y, 0);
  } else if (s.clickSel) {
    const r = await call('Runtime.evaluate', { expression: `(()=>{const e=document.querySelector(${JSON.stringify(s.clickSel)}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];})()`, returnByValue: true });
    const p = r.result?.value;
    if (!p) {
      console.log('clickSel: not found', s.clickSel);
      continue;
    }
    await mouse('mouseMoved', p[0], p[1], 0);
    await sleep(40);
    await mouse('mousePressed', p[0], p[1]);
    await sleep(s.hold ?? 60);
    await mouse('mouseReleased', p[0], p[1], 0);
    console.log('clicked', s.clickSel, p.map(Math.round).join(','));
  } else if (s.drag) {
    const [x1, y1, x2, y2] = s.drag;
    await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= 12; i++) {
      await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12);
      await sleep(16);
    }
    await mouse('mouseReleased', x2, y2, 0);
  } else if (s.move) {
    await mouse('mouseMoved', s.move[0], s.move[1], 0);
  } else if (s.wait) await sleep(s.wait);
  else if (s.eval) {
    const r = await call('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true });
    console.log('eval:', JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description ?? r));
  } else if (s.shot) {
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    writeFileSync(s.shot, Buffer.from(shot.data, 'base64'));
    console.log('shot:', s.shot);
  } else if (s.nav) {
    await call('Page.navigate', { url: s.nav });
    await sleep(4000);
  }
}
sock.close();
process.exit(0);
