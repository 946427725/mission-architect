// Procedural planet textures drawn on a canvas - no downloads needed.
import * as THREE from 'three';
import { BodyId } from '../physics/constants';
import earthMap from '../assets/planets/earth.jpg';
import marsMap from '../assets/planets/mars.jpg';
import plutoMap from '../assets/planets/pluto.jpg';
import jupiterMap from '../assets/planets/jupiter.jpg';

/** Real NASA global maps (public domain), see src/data/sources.ts IMAGE_CREDITS. */
export const REAL_MAPS: Partial<Record<BodyId, string>> = { earth: earthMap, mars: marsMap, jupiter: jupiterMap, pluto: plutoMap };
const realCache = new Map<string, THREE.Texture>();
/** A texture from a real NASA map, or null when the game only has a procedural one. */
export function realPlanetTexture(id: BodyId): THREE.Texture | null {
  const url = REAL_MAPS[id];
  if (!url) return null;
  let t = realCache.get(id);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    realCache.set(id, t);
  }
  return t;
}


function hash(x: number, y: number, s: number) {
  let h = x * 374761393 + y * 668265263 + s * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Seamless (wraps horizontally) fractal noise on an equirectangular map. */
function fbm(u: number, v: number, s: number, oct = 5, freq = 4) {
  let sum = 0, amp = 0.5, f = freq;
  for (let i = 0; i < oct; i++) {
    // sample on a cylinder so the texture wraps around the sphere
    const ang = u * Math.PI * 2;
    const x = Math.cos(ang) * f * 0.5 + 10, z = Math.sin(ang) * f * 0.5 + 10;
    sum += amp * (noise(x + z * 0.7, v * f, s + i) * 0.5 + noise(z + x * 0.3, v * f + 3.3, s + i + 9) * 0.5);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function paint(w: number, h: number, fn: (u: number, v: number) => RGB): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / w, y / h);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function banded(stops: string[], turb: number, seed: number) {
  const cols = stops.map(hex);
  return (u: number, v: number): RGB => {
    const n = fbm(u, v, seed, 4, 6);
    const lat = v + (n - 0.5) * turb;
    const t = (Math.sin(lat * Math.PI * 14) * 0.5 + 0.5) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(t));
    const base = mix(cols[i], cols[i + 1], t - i);
    return mix(base, [255, 255, 255], (fbm(u * 2, v * 2, seed + 5, 3, 8) - 0.5) * 0.25);
  };
}

const generators: Record<BodyId | 'sun', (u: number, v: number) => RGB> = {
  sun: (u, v) => mix(hex('#ff8a1c'), hex('#fff1a8'), fbm(u, v, 1, 5, 10)),
  mercury: (u, v) => mix(hex('#5d5a58'), hex('#b9b3ab'), fbm(u, v, 2, 6, 8)),
  venus: banded(['#c9a15a', '#e8cf8e', '#d6b06a', '#f1deaa'], 0.25, 3),
  earth: (u, v) => {
    const n = fbm(u, v, 4, 6, 3);
    const lat = Math.abs(v - 0.5) * 2;
    // soft coastlines, deep and shallow ocean, deserts in the subtropics, tundra and ice toward the poles
    const land = smooth(0.505, 0.53, n);
    const ocean = mix(hex('#071d46'), hex('#1a5896'), smooth(0.3, 0.5, n));
    const band = Math.max(0, 1 - Math.abs(lat - 0.3) / 0.2);
    const desert = band * smooth(0.44, 0.6, fbm(u, v, 21, 4, 3));
    let ground = mix(hex('#2b5a2a'), hex('#5d7639'), smooth(0.52, 0.66, n));
    ground = mix(ground, hex('#c3a36b'), desert);
    ground = mix(ground, hex('#77735f'), smooth(0.6, 0.78, lat));
    let col = mix(ocean, ground, land);
    col = mix(col, [236, 242, 248], smooth(0.8, 0.9, lat + (n - 0.5) * 0.25));
    const cloud = fbm(u * 1.6, v, 40, 6, 6);
    col = mix(col, [250, 252, 255], 0.85 * smooth(0.53, 0.72, cloud));
    return col;
  },
  mars: (u, v) => {
    const lat = Math.abs(v - 0.5) * 2;
    if (lat > 0.9) return [235, 230, 225];
    const n = fbm(u, v, 5, 6, 4);
    return mix(hex('#6e2c16'), hex('#d9784a'), Math.min(1, n * 1.5 - 0.1));
  },
  jupiter: (u, v) => {
    const base = banded(['#7a5236', '#d9b38c', '#f2e4cf', '#b8835a', '#efe0c4', '#8f6444'], 0.12, 6)(u, v);
    // Great Red Spot
    const dx = (u - 0.62) / 0.06, dy = (v - 0.64) / 0.035;
    const d = dx * dx + dy * dy;
    return d < 1 ? mix(hex('#b5462c'), base, d * d) : base;
  },
  saturn: banded(['#c9ae78', '#e9d7a8', '#d8bf87', '#f2e6c2'], 0.06, 7),
  uranus: (u, v) => mix(hex('#8fd3db'), hex('#b8eef0'), fbm(u, v, 8, 3, 2) * 0.6 + Math.abs(v - 0.5) * 0.4),
  neptune: (u, v) => mix(hex('#2340a8'), hex('#5a85e8'), fbm(u, v, 9, 4, 4)),
  pluto: (u, v) => {
    const n = fbm(u, v, 10, 5, 5);
    let col = mix(hex('#8a6a4f'), hex('#d8c3a5'), n);
    // the "heart" (Tombaugh Regio)
    const dx = (u - 0.5) / 0.09, dy = (v - 0.52) / 0.12;
    const heart = Math.pow(Math.abs(dx), 1.6) + Math.pow(Math.max(0, dy + Math.abs(dx) * 0.6), 2);
    if (heart < 1) col = mix(hex('#f4ece2'), col, heart * 0.6);
    // dark equatorial band (Cthulhu Macula)
    const uu = u + (fbm(u, v, 31, 4, 8) - 0.5) * 0.1;
    const edge = Math.min(smooth(0.13, 0.2, uu), 1 - smooth(0.34, 0.41, uu));
    col = mix(col, hex('#3a1f14'), 0.75 * edge * (1 - smooth(0.04, 0.09, Math.abs(v - 0.55 - (uu - 0.27) * 0.25) - (n - 0.5) * 0.14)));
    return col;
  },
};

const texCache = new Map<string, THREE.Texture>();
export function planetTexture(id: BodyId | 'sun'): THREE.Texture {
  const hit = texCache.get(id);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(paint(256, 128, generators[id]));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(id, tex);
  return tex;
}

export function glowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,140,40,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 256; x++) {
    const t = x / 256;
    const a = (0.35 + 0.5 * noise(t * 40, 0, 77)) * (t > 0.55 && t < 0.6 ? 0.1 : 1);
    ctx.fillStyle = `rgba(222,205,160,${a})`;
    ctx.fillRect(x, 0, 1, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Gold multi-layer insulation foil look, for spacecraft buses. */
export function foilTexture(): THREE.Texture {
  const c = paint(128, 128, (u, v) => {
    const n = fbm(u, v, 21, 4, 6);
    return mix(hex('#8a5a12'), hex('#ffd36a'), n * 1.3 - 0.1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Blue photovoltaic cell grid. */
export function solarCellTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d1d4a';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1a3780' : '#16306f';
      ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Higher-resolution planet map for close-up cinematics (generated once, ~0.2 s). */
const hiCache = new Map<string, THREE.Texture>();
export function planetHiRes(id: BodyId, w = 1024): THREE.Texture {
  const real = realPlanetTexture(id);
  if (real) return real;
  const k = `${id}@${w}`;
  const hit = hiCache.get(k);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(paint(w, w / 2, generators[id]));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  hiCache.set(k, tex);
  return tex;
}
