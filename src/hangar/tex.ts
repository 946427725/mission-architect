// Procedural PBR textures for the clean-room high bay. Everything is drawn in
// code (no image files): colour maps, roughness maps and normal maps derived
// from height fields.
import * as THREE from 'three';

const cache = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cv(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

export function tex(c: HTMLCanvasElement, srgb: boolean, rx = 1, ry = rx): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Grayscale height canvas -> tangent-space normal map canvas (wraps at edges). */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, ctx] = cv(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Tileable value noise canvas (grayscale), drawn by summing blurred random octaves. */
function noiseCanvas(size: number, seed: number, octaves = 4, base = 8): HTMLCanvasElement {
  const [c, ctx] = cv(size);
  const r = rng(seed);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let o = 0; o < octaves; o++) {
    const n = base * 2 ** o;
    const [s, sc] = cv(n);
    const img = sc.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = r() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sc.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.5 / (o + 1);
    ctx.imageSmoothingEnabled = true;
    // draw 3x3 so bilinear filtering wraps cleanly
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ctx.drawImage(s, dx * size, dy * size, size, size);
  }
  ctx.globalAlpha = 1;
  return c;
}

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** Light-grey anti-static vinyl floor tiles, 60 cm. One texture = 4 x 4 tiles. */
export function floorSet(): PBRSet {
  return once('floor', () => {
    const S = 1024;
    const T = S / 4;
    const r = rng(11);
    const [col, c] = cv(S);
    const [rough, rc] = cv(S);
    const [ht, hc] = cv(S);
    const n = noiseCanvas(S, 4, 5, 16);
    hc.fillStyle = '#fff';
    hc.fillRect(0, 0, S, S);
    for (let ty = 0; ty < 4; ty++)
      for (let tx = 0; tx < 4; tx++) {
        const k = 214 + Math.round((r() - 0.5) * 9);
        c.fillStyle = `rgb(${k},${k + 3},${k + 5})`;
        c.fillRect(tx * T, ty * T, T, T);
        const rr = 70 + Math.round((r() - 0.5) * 22);
        rc.fillStyle = `rgb(${rr},${rr},${rr})`;
        rc.fillRect(tx * T, ty * T, T, T);
      }
    // vinyl chips
    for (let i = 0; i < 9000; i++) {
      const x = r() * S;
      const y = r() * S;
      const k = r() < 0.5 ? 180 + r() * 30 : 232 + r() * 20;
      c.fillStyle = `rgba(${k},${k + 2},${k + 4},${0.35 + r() * 0.3})`;
      c.fillRect(x, y, 1 + r() * 2.2, 1 + r() * 1.6);
    }
    c.globalAlpha = 0.07;
    c.drawImage(n, 0, 0);
    c.globalAlpha = 1;
    // scuffs: slightly rougher, slightly darker
    for (let i = 0; i < 70; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      const L = 20 + r() * 120;
      rc.strokeStyle = `rgba(150,150,150,${0.15 + r() * 0.25})`;
      rc.lineWidth = 1 + r() * 4;
      rc.beginPath();
      rc.moveTo(x, y);
      rc.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      rc.stroke();
      c.strokeStyle = `rgba(120,124,128,${0.04 + r() * 0.05})`;
      c.lineWidth = 1 + r() * 3;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      c.stroke();
    }
    // seams
    for (let i = 0; i <= 4; i++) {
      const p = i * T;
      for (const ctx of [c]) {
        ctx.fillStyle = 'rgba(150,154,158,0.9)';
        ctx.fillRect(p - 1.5, 0, 3, S);
        ctx.fillRect(0, p - 1.5, S, 3);
      }
      rc.fillStyle = '#c8c8c8';
      rc.fillRect(p - 2, 0, 4, S);
      rc.fillRect(0, p - 2, S, 4);
      hc.fillStyle = '#000';
      hc.fillRect(p - 1.5, 0, 3, S);
      hc.fillRect(0, p - 1.5, S, 3);
    }
    hc.globalAlpha = 0.18;
    hc.drawImage(n, 0, 0);
    return { map: tex(col, true), roughnessMap: tex(rough, false), normalMap: tex(normalFromHeight(ht, 2.2), false) };
  });
}

/** White insulated wall panels, 1.2 m wide (texture = 4 panels x 1 tall). */
export function wallSet(): PBRSet {
  return once('wall', () => {
    const W = 1024;
    const H = 512;
    const r = rng(23);
    const [col, c] = cv(W, H);
    const [rough, rc] = cv(W, H);
    const [ht, hc] = cv(W, H);
    const n = noiseCanvas(512, 9, 4, 32);
    c.fillStyle = '#eceeef';
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.05;
    c.drawImage(n, 0, 0, W, H);
    c.globalAlpha = 1;
    rc.fillStyle = '#9a9a9a';
    rc.fillRect(0, 0, W, H);
    hc.fillStyle = '#a0a0a0';
    hc.fillRect(0, 0, W, H);
    hc.globalAlpha = 0.25;
    hc.drawImage(n, 0, 0, W, H);
    hc.globalAlpha = 1;
    const pw = W / 4;
    for (let i = 0; i < 4; i++) {
      const x = i * pw;
      // subtle stiffening ribs
      for (const f of [0.33, 0.66]) {
        const g = hc.createLinearGradient(x + pw * f - 6, 0, x + pw * f + 6, 0);
        g.addColorStop(0, 'rgba(160,160,160,0)');
        g.addColorStop(0.5, 'rgba(210,210,210,1)');
        g.addColorStop(1, 'rgba(160,160,160,0)');
        hc.fillStyle = g;
        hc.fillRect(x + pw * f - 6, 0, 12, H);
      }
      c.fillStyle = 'rgba(160,166,170,0.9)';
      c.fillRect(x, 0, 2, H);
      hc.fillStyle = '#000';
      hc.fillRect(x - 1, 0, 3, H);
      // a few smudges near the bottom
      for (let k = 0; k < 6; k++) {
        c.fillStyle = `rgba(150,150,140,${0.02 + r() * 0.03})`;
        c.beginPath();
        c.ellipse(x + r() * pw, H - r() * 60, 10 + r() * 30, 4 + r() * 10, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = 'rgba(160,166,170,0.9)';
    c.fillRect(0, 0, W, 2);
    hc.fillStyle = '#000';
    hc.fillRect(0, 0, W, 2);
    return { map: tex(col, true), roughnessMap: tex(rough, false), normalMap: tex(normalFromHeight(ht, 1.6), false) };
  });
}

/** HEPA filter wall: 1.2 m modules with perforated diffuser faces (texture = 2 x 2 modules). */
export function hepaSet(): PBRSet & { emissiveMap: THREE.Texture } {
  return once('hepa', () => {
    const S = 1024;
    const M = S / 2;
    const [col, c] = cv(S);
    const [rough, rc] = cv(S);
    const [ht, hc] = cv(S);
    const [em, ec] = cv(S);
    c.fillStyle = '#e9ecee';
    c.fillRect(0, 0, S, S);
    rc.fillStyle = '#b4b4b4';
    rc.fillRect(0, 0, S, S);
    hc.fillStyle = '#b0b0b0';
    hc.fillRect(0, 0, S, S);
    ec.fillStyle = '#000';
    ec.fillRect(0, 0, S, S);
    for (let my = 0; my < 2; my++)
      for (let mx = 0; mx < 2; mx++) {
        const x0 = mx * M;
        const y0 = my * M;
        const f = 22;
        // aluminium frame
        c.fillStyle = '#c3c8cc';
        c.fillRect(x0, y0, M, f);
        c.fillRect(x0, y0 + M - f, M, f);
        c.fillRect(x0, y0, f, M);
        c.fillRect(x0 + M - f, y0, f, M);
        rc.fillStyle = '#5a5a5a';
        rc.fillRect(x0, y0, M, f);
        rc.fillRect(x0, y0 + M - f, M, f);
        rc.fillRect(x0, y0, f, M);
        rc.fillRect(x0 + M - f, y0, f, M);
        hc.fillStyle = '#ffffff';
        hc.fillRect(x0 + 3, y0 + 3, M - 6, f - 6);
        hc.fillRect(x0 + 3, y0 + M - f + 3, M - 6, f - 6);
        hc.fillRect(x0 + 3, y0 + 3, f - 6, M - 6);
        hc.fillRect(x0 + M - f + 3, y0 + 3, f - 6, M - 6);
        hc.fillStyle = '#000';
        hc.fillRect(x0, y0, M, 3);
        hc.fillRect(x0, y0, 3, M);
        // perforations
        const step = 9;
        for (let y = y0 + f + 8; y < y0 + M - f - 4; y += step)
          for (let x = x0 + f + 8 + (((y - y0) / step) % 2) * (step / 2); x < x0 + M - f - 4; x += step) {
            c.fillStyle = '#b9bfc4';
            c.beginPath();
            c.arc(x, y, 2.2, 0, Math.PI * 2);
            c.fill();
            hc.fillStyle = '#404040';
            hc.beginPath();
            hc.arc(x, y, 2.4, 0, Math.PI * 2);
            hc.fill();
            ec.fillStyle = '#4a4f55';
            ec.beginPath();
            ec.arc(x, y, 1.6, 0, Math.PI * 2);
            ec.fill();
          }
      }
    return {
      map: tex(col, true),
      roughnessMap: tex(rough, false),
      normalMap: tex(normalFromHeight(ht, 2.5), false),
      emissiveMap: tex(em, true),
    };
  });
}

/** Fine woven fabric (Tyvek-like clean-room coverall). */
export function fabricNormal(): THREE.Texture {
  return once('fabric', () => {
    const S = 256;
    const r = rng(5);
    const [h, c] = cv(S);
    c.fillStyle = '#808080';
    c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 4)
      for (let x = 0; x < S; x += 4) {
        const v = ((x + y) / 4) % 2 ? 150 : 105;
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(x, y, 4, 2);
      }
    // soft wrinkles
    for (let i = 0; i < 30; i++) {
      c.strokeStyle = `rgba(${r() < 0.5 ? '60,60,60' : '200,200,200'},${0.12 + r() * 0.12})`;
      c.lineWidth = 6 + r() * 14;
      c.beginPath();
      const x = r() * S;
      const y = r() * S;
      c.moveTo(x, y);
      c.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120, x + (r() - 0.5) * 200, y + (r() - 0.5) * 200);
      c.stroke();
    }
    return tex(normalFromHeight(h, 1.4), false, 6, 6);
  });
}

/** Crinkled multi-layer insulation (MLI) blanket: colour + normal + roughness. */
export function mliSet(kind: 'gold' | 'silver' | 'black'): PBRSet {
  return once('mli-' + kind, () => {
    const S = 512;
    const r = rng(kind === 'gold' ? 31 : kind === 'silver' ? 37 : 41);
    const [h, hc] = cv(S);
    hc.fillStyle = '#808080';
    hc.fillRect(0, 0, S, S);
    // crinkles: many short creases in random directions, drawn wrapped
    for (let i = 0; i < 900; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      const L = 8 + r() * 46;
      const v = r() < 0.5 ? 40 + r() * 50 : 170 + r() * 70;
      hc.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
      hc.lineWidth = 1 + r() * 3.5;
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S]) {
          hc.beginPath();
          hc.moveTo(x + ox, y + oy);
          hc.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L);
          hc.stroke();
        }
    }
    hc.filter = 'blur(1.2px)';
    hc.drawImage(h, 0, 0);
    hc.filter = 'none';
    // pillow quilting stitches every 128 px
    hc.fillStyle = 'rgba(30,30,30,0.9)';
    for (let y = 64; y < S; y += 128) for (let x = 64; x < S; x += 128) hc.fillRect(x - 2, y - 2, 4, 4);
    const hd = hc.getImageData(0, 0, S, S).data;
    const [col, c] = cv(S);
    const [rough, rc] = cv(S);
    const img = c.createImageData(S, S);
    const rimg = rc.createImageData(S, S);
    const base: [number, number, number][] =
      kind === 'gold' ? [[150, 98, 22], [255, 206, 92]] : kind === 'silver' ? [[150, 154, 160], [235, 238, 242]] : [[18, 18, 20], [58, 58, 62]];
    for (let i = 0; i < S * S; i++) {
      const v = hd[i * 4] / 255;
      const t = Math.min(1, Math.max(0, 0.35 + (v - 0.5) * 1.6 + (r() - 0.5) * 0.08));
      img.data[i * 4] = base[0][0] + (base[1][0] - base[0][0]) * t;
      img.data[i * 4 + 1] = base[0][1] + (base[1][1] - base[0][1]) * t;
      img.data[i * 4 + 2] = base[0][2] + (base[1][2] - base[0][2]) * t;
      img.data[i * 4 + 3] = 255;
      const rv = (kind === 'black' ? 0.55 : 0.22) + Math.abs(v - 0.5) * 0.35;
      rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rv * 255;
      rimg.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    rc.putImageData(rimg, 0, 0);
    return { map: tex(col, true), roughnessMap: tex(rough, false), normalMap: tex(normalFromHeight(h, 3.2), false) };
  });
}

/** Photovoltaic cells: dark blue-black cells with silver busbars and white gaps. */
export function solarCells(): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  return once('cells', () => {
    const S = 512;
    const cell = 64;
    const r = rng(77);
    const [col, c] = cv(S);
    const [rough, rc] = cv(S);
    c.fillStyle = '#c9ccd2';
    c.fillRect(0, 0, S, S);
    rc.fillStyle = '#909090';
    rc.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += cell)
      for (let x = 0; x < S; x += cell) {
        const k = r() * 6;
        const g = c.createLinearGradient(x, y, x + cell, y + cell);
        g.addColorStop(0, `rgb(${16 + k},${26 + k},${58 + k})`);
        g.addColorStop(1, `rgb(${10 + k},${18 + k},${44 + k})`);
        c.fillStyle = g;
        c.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        rc.fillStyle = '#262626';
        rc.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        c.fillStyle = 'rgba(190,196,205,0.85)';
        for (let i = 1; i < 4; i++) c.fillRect(x + 2, y + (cell * i) / 4, cell - 4, 1);
        c.fillRect(x + cell / 2 - 1, y + 2, 2, cell - 4);
      }
    return { map: tex(col, true), roughnessMap: tex(rough, false) };
  });
}

/** Yellow/black hazard stripes. */
export function hazardStripes(): THREE.Texture {
  return once('hazard', () => {
    const [c, x] = cv(256, 64);
    x.fillStyle = '#f2c230';
    x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#1b1b1b';
    for (let i = -2; i < 10; i++) {
      x.beginPath();
      x.moveTo(i * 32, 64);
      x.lineTo(i * 32 + 16, 64);
      x.lineTo(i * 32 + 16 + 64, 0);
      x.lineTo(i * 32 + 64, 0);
      x.fill();
    }
    return tex(c, true);
  });
}

/** Brushed-metal roughness streaks. */
export function brushed(): THREE.Texture {
  return once('brushed', () => {
    const S = 256;
    const r = rng(3);
    const [c, x] = cv(S);
    x.fillStyle = '#6a6a6a';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) {
      const v = 70 + r() * 90;
      x.fillStyle = `rgba(${v},${v},${v},0.35)`;
      x.fillRect(0, r() * S, S, 0.6 + r());
    }
    return tex(c, false);
  });
}

/** Signage / labels drawn as canvas text. */
export function signTexture(lines: { text: string; size: number; weight?: number; color?: string; font?: string }[], opts: { w: number; h: number; bg?: string; border?: string; align?: CanvasTextAlign; pad?: number }): THREE.CanvasTexture {
  const [c, x] = cv(opts.w, opts.h);
  if (opts.bg) {
    x.fillStyle = opts.bg;
    x.fillRect(0, 0, opts.w, opts.h);
  }
  if (opts.border) {
    x.strokeStyle = opts.border;
    x.lineWidth = 6;
    x.strokeRect(3, 3, opts.w - 6, opts.h - 6);
  }
  const pad = opts.pad ?? 24;
  const total = lines.reduce((s, l) => s + l.size * 1.2, 0);
  let y = (opts.h - total) / 2;
  x.textAlign = opts.align ?? 'center';
  x.textBaseline = 'top';
  for (const l of lines) {
    x.font = `${l.weight ?? 700} ${l.size}px ${l.font ?? '"Archivo", "Helvetica Neue", Arial, sans-serif'}`;
    x.fillStyle = l.color ?? '#111';
    const tx = x.textAlign === 'left' ? pad : x.textAlign === 'right' ? opts.w - pad : opts.w / 2;
    x.fillText(l.text, tx, y + l.size * 0.08);
    y += l.size * 1.2;
  }
  const t = tex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft round puff for smoke and steam particles. */
export function puffTexture(): THREE.Texture {
  return once('puff', () => {
    const S = 128;
    const r = rng(8);
    const [c, x] = cv(S);
    for (let i = 0; i < 26; i++) {
      const px = S / 2 + (r() - 0.5) * S * 0.36;
      const py = S / 2 + (r() - 0.5) * S * 0.36;
      const rad = S * (0.16 + r() * 0.2);
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
    }
    const t = tex(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Radial glow for light fixtures and flares. */
export function glow(inner: string, outer: string): THREE.Texture {
  return once('glow' + inner + outer, () => {
    const [c, x] = cv(128);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = tex(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Coastal scrub and sand around the launch complex. */
export function groundTexture(): THREE.Texture {
  return once('ground', () => {
    const S = 512;
    const r = rng(55);
    const n = noiseCanvas(S, 21, 5, 4);
    const [c, x] = cv(S);
    x.fillStyle = '#7b7651';
    x.fillRect(0, 0, S, S);
    x.globalAlpha = 0.55;
    x.drawImage(n, 0, 0);
    x.globalAlpha = 1;
    for (let i = 0; i < 160; i++) {
      const g = r() < 0.6;
      x.fillStyle = g ? `rgba(${70 + r() * 30},${88 + r() * 30},${48 + r() * 20},${0.25 + r() * 0.35})` : `rgba(${190 + r() * 30},${170 + r() * 25},${120 + r() * 20},${0.2 + r() * 0.3})`;
      x.beginPath();
      x.ellipse(r() * S, r() * S, 8 + r() * 40, 5 + r() * 26, r() * 3, 0, Math.PI * 2);
      x.fill();
    }
    return tex(c, true);
  });
}

/** Painted concrete / launch-pad ground. */
export function concreteSet(): PBRSet {
  return once('concrete', () => {
    const S = 512;
    const r = rng(91);
    const n = noiseCanvas(S, 12, 5, 8);
    const [col, c] = cv(S);
    c.fillStyle = '#9b9a95';
    c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.35;
    c.drawImage(n, 0, 0);
    c.globalAlpha = 1;
    for (let i = 0; i < 3000; i++) {
      const k = 110 + r() * 80;
      c.fillStyle = `rgba(${k},${k},${k - 4},0.25)`;
      c.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
    for (let i = 0; i < 25; i++) {
      c.fillStyle = `rgba(40,38,34,${0.03 + r() * 0.06})`;
      c.beginPath();
      c.ellipse(r() * S, r() * S, 20 + r() * 80, 10 + r() * 50, r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(60,60,58,0.6)';
    c.fillRect(0, 0, S, 2);
    c.fillRect(0, 0, 2, S);
    const [rough, rc] = cv(S);
    rc.fillStyle = '#dcdcdc';
    rc.fillRect(0, 0, S, S);
    rc.globalAlpha = 0.3;
    rc.drawImage(n, 0, 0);
    const [h, hc] = cv(S);
    hc.drawImage(n, 0, 0);
    hc.fillStyle = '#000';
    hc.fillRect(0, 0, S, 2);
    hc.fillRect(0, 0, 2, S);
    return { map: tex(col, true), roughnessMap: tex(rough, false), normalMap: tex(normalFromHeight(h, 2), false) };
  });
}
