// Real-scale (metres) procedural spacecraft for the high bay. The model is
// rebuilt from the player's design, and every installable part is tagged with
// userData.part so the install animation can fly a part into its real spot.
import * as THREE from 'three';
import { ANTENNAS, POWER } from '../data/parts';
import { Design, missionOf } from '../game/state';

const mission0 = (d: Design) => missionOf(d).defaults.adcsId ?? 'spin';
import { M, Mats, at, box, cyl, dishModel, mergeStatic, rbox, rod, shade, sph, torus, v3 } from './kit';

type G = THREE.Group;
const grp = (part?: string, ...kids: THREE.Object3D[]): G => {
  const g = new THREE.Group();
  if (part) g.userData.part = part;
  kids.forEach((k) => g.add(k));
  return g;
};

// ---------------------------------------------------------------- parts
export function wheel(r: number, w: number, m: Mats): G {
  const g = new THREE.Group();
  const tire = cyl(r, r, w, m.alu, 40, true);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  for (const s of [-1, 1]) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 40), m.darkMetal);
    disc.rotation.y = (s * Math.PI) / 2;
    disc.position.x = s * w * 0.32;
    g.add(disc);
    // curved titanium flexure spokes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = box(0.01, r * 0.8, r * 0.07, m.titanium);
      sp.position.set(s * w * 0.34, Math.sin(a) * r * 0.45, Math.cos(a) * r * 0.45);
      sp.rotation.x = -a + 0.35;
      g.add(sp);
    }
  }
  const hub = cyl(r * 0.22, r * 0.22, w * 0.75, m.titanium, 20);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  // chevron grousers
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const gr = box(w * 0.5, r * 0.06, r * 0.04, m.alu);
      gr.position.set(s * w * 0.24, Math.sin(a) * (r + r * 0.02), Math.cos(a) * (r + r * 0.02));
      gr.rotation.x = -a;
      gr.rotation.y = s * 0.35;
      g.add(gr);
    }
  }
  return g;
}

export function rtgModel(kind: string, m: Mats): G {
  // MMRTG: 0.64 m wide x 0.66 m long; GPHS-RTG: 0.42 m x 1.14 m
  const mm = kind === 'mmrtg';
  const L = mm ? 0.66 : 1.14;
  const core = mm ? 0.17 : 0.15;
  const fin = mm ? 0.32 : 0.21;
  const g = new THREE.Group();
  g.add(cyl(core, core, L, m.rtg, 28));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const f = box(0.012, L * 0.94, fin - core + 0.02, m.rtg);
    f.position.set(Math.cos(a) * (core + (fin - core) / 2), 0, Math.sin(a) * (core + (fin - core) / 2));
    f.rotation.y = -a;
    g.add(f);
  }
  for (const s of [-1, 1]) {
    const cap = cyl(core * 1.15, core * 1.15, 0.04, m.darkMetal, 28);
    cap.position.y = (s * L) / 2;
    g.add(cap);
    const fl = torus(core * 1.1, 0.012, m.steel, 6, 28);
    fl.rotation.x = Math.PI / 2;
    fl.position.y = (s * L) / 2;
    g.add(fl);
  }
  return g;
}

const solarMats = new Map<string, THREE.MeshPhysicalMaterial>();
function solarMat(pl: number, pw: number, m: Mats) {
  const key = `${pl.toFixed(2)}x${pw.toFixed(2)}`;
  let mat = solarMats.get(key);
  if (!mat) {
    mat = m.solar.clone();
    mat.map = mat.map!.clone();
    mat.map.repeat.set(pl * 1.6, pw * 1.6);
    mat.map.needsUpdate = true;
    solarMats.set(key, mat);
  }
  return mat;
}

export function solarWing(panels: number, pl: number, pw: number, m: Mats): G {
  const g = new THREE.Group();
  for (let p = 0; p < panels; p++) {
    const pan = new THREE.Group();
    const back = box(pl, 0.035, pw, m.solarBack);
    pan.add(back);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(pl * 0.97, pw * 0.97), solarMat(pl, pw, m));
    front.rotation.x = -Math.PI / 2;
    front.position.y = 0.019;
    pan.add(front);
    const frame = box(pl, 0.05, 0.03, m.alu);
    frame.position.z = pw / 2;
    pan.add(frame);
    const frame2 = frame.clone();
    frame2.position.z = -pw / 2;
    pan.add(frame2);
    pan.position.x = pl / 2 + p * (pl + 0.06);
    g.add(pan);
    if (p > 0) {
      const hinge = cyl(0.02, 0.02, pw * 0.8, m.steel, 8);
      hinge.rotation.x = Math.PI / 2;
      hinge.position.x = p * (pl + 0.06) - 0.03;
      g.add(hinge);
    }
  }
  return g;
}

function hexDish(r: number, m: Mats): G {
  const g = new THREE.Group();
  const plate = cyl(r, r, 0.045, m.thermalWhite, 6);
  g.add(plate);
  const rim = cyl(r * 1.02, r * 1.02, 0.02, m.paintGrey, 6, true);
  g.add(rim);
  const back = cyl(r * 0.3, r * 0.35, 0.08, m.darkMetal, 16);
  back.position.y = -0.06;
  g.add(back);
  return g;
}

function camHead(m: Mats, len = 0.3, r = 0.07): G {
  const g = new THREE.Group();
  const body = rbox(r * 2.2, r * 2.2, len, 0.015, m.thermalWhite);
  g.add(body);
  const hood = cyl(r * 0.9, r * 0.75, len * 0.35, m.kapton, 24, true);
  hood.rotation.x = Math.PI / 2;
  hood.position.z = len / 2 + len * 0.15;
  g.add(hood);
  const lens = sph(r * 0.7, m.lens);
  lens.scale.z = 0.4;
  lens.position.z = len / 2 + 0.005;
  g.add(lens);
  return g;
}

function sensorBox(w: number, h: number, d: number, m: Mats, finish: 'white' | 'gold' | 'black' = 'white'): G {
  const mat = finish === 'gold' ? m.mliGold : finish === 'black' ? m.kapton : m.thermalWhite;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, 0.012, mat));
  const ap = cyl(Math.min(w, h) * 0.22, Math.min(w, h) * 0.22, 0.02, m.lens, 20);
  ap.rotation.x = Math.PI / 2;
  ap.position.z = d / 2 + 0.006;
  g.add(ap);
  return g;
}

export function helicopter(m: Mats): G {
  const g = new THREE.Group();
  const body = rbox(0.14, 0.14, 0.14, 0.02, m.thermalWhite);
  body.position.y = 0.18;
  g.add(body);
  const sol = box(0.42, 0.01, 0.22, m.solar);
  sol.position.y = 0.62;
  g.add(sol);
  g.add(at(cyl(0.012, 0.012, 0.45, m.darkMetal, 8), 0, 0.42, 0));
  for (const [y, rot] of [[0.47, 0.3], [0.55, 1.7]] as const) {
    const blade = box(1.2, 0.008, 0.07, m.carbon);
    blade.position.y = y;
    blade.rotation.y = rot;
    g.add(blade);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(rod(v3(Math.cos(a) * 0.06, 0.13, Math.sin(a) * 0.06), v3(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22), 0.006, m.carbon, 5));
  }
  return g;
}

/** Physical model of a single instrument (used on the bench and on the craft). */
export function instrumentModel(id: string, m: Mats = M()): G {
  switch (id) {
    case 'mastcam': {
      const g = new THREE.Group();
      for (const x of [-0.12, 0.12]) g.add(at(camHead(m, 0.26, 0.05), x, 0, 0));
      g.add(box(0.36, 0.04, 0.1, m.darkMetal));
      return g;
    }
    case 'supercam': {
      const g = camHead(m, 0.38, 0.09);
      return g;
    }
    case 'cam':
    case 'lorri': {
      const len = id === 'lorri' ? 0.62 : 0.2;
      const g = new THREE.Group();
      const tube = cyl(id === 'lorri' ? 0.11 : 0.05, id === 'lorri' ? 0.11 : 0.05, len, id === 'lorri' ? m.mliSilver : m.thermalWhite, 28);
      tube.rotation.x = Math.PI / 2;
      g.add(tube);
      const shade1 = cyl(id === 'lorri' ? 0.12 : 0.055, id === 'lorri' ? 0.12 : 0.055, 0.03, m.kapton, 28, true);
      shade1.rotation.x = Math.PI / 2;
      shade1.position.z = len / 2;
      g.add(shade1);
      g.add(at(sph(id === 'lorri' ? 0.08 : 0.035, m.lens), 0, 0, len / 2 - 0.01));
      return g;
    }
    case 'ralph':
    case 'jiram':
      return sensorBox(0.32, 0.22, 0.38, m, 'black');
    case 'alice':
    case 'uvs':
      return sensorBox(0.22, 0.16, 0.42, m, 'gold');
    case 'pixl':
    case 'sherloc':
      return sensorBox(0.2, 0.16, 0.22, m, id === 'pixl' ? 'gold' : 'white');
    case 'sampler': {
      const g = new THREE.Group();
      const drill = cyl(0.06, 0.06, 0.3, m.steel, 20);
      g.add(drill);
      const bit = cyl(0.015, 0.03, 0.22, m.chrome, 12);
      bit.position.y = -0.25;
      g.add(bit);
      const carousel = cyl(0.2, 0.2, 0.06, m.alu, 32);
      carousel.position.set(0, 0.2, -0.15);
      g.add(carousel);
      return g;
    }
    case 'rimfax':
      return grp(undefined, rbox(0.4, 0.06, 0.18, 0.01, m.thermalWhite));
    case 'meda': {
      const g = new THREE.Group();
      g.add(cyl(0.012, 0.012, 0.3, m.steel, 8));
      for (const s of [-1, 1]) {
        const arm = box(0.22, 0.015, 0.015, m.steel);
        arm.position.set(s * 0.11, 0.1, 0);
        g.add(arm);
        g.add(at(box(0.04, 0.03, 0.03, m.thermalWhite), s * 0.22, 0.1, 0));
      }
      return g;
    }
    case 'moxie': {
      const g = new THREE.Group();
      g.add(rbox(0.24, 0.24, 0.31, 0.015, m.goldAnod));
      for (let i = 0; i < 5; i++) g.add(at(box(0.25, 0.006, 0.02, m.darkMetal), 0, -0.1 + i * 0.05, 0.16));
      return g;
    }
    case 'heli':
      return helicopter(m);
    case 'mwr': {
      const g = new THREE.Group();
      const p = box(0.9, 0.9, 0.06, m.thermalWhite);
      g.add(p);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) g.add(at(box(0.16, 0.16, 0.01, m.copper), -0.3 + i * 0.2, -0.3 + j * 0.2, 0.035));
      return g;
    }
    case 'mag': {
      const g = new THREE.Group();
      const cube = rbox(0.22, 0.22, 0.22, 0.02, m.thermalWhite);
      g.add(cube);
      for (const s of [-1, 1]) g.add(at(box(0.14, 0.08, 0.05, m.kapton), s * 0.08, 0.16, 0));
      return g;
    }
    case 'grav':
    case 'rex': {
      const g = new THREE.Group();
      g.add(rbox(0.26, 0.12, 0.2, 0.01, m.goldAnod));
      for (let i = 0; i < 3; i++) g.add(at(cyl(0.012, 0.012, 0.04, m.steel, 8), -0.08 + i * 0.08, 0.08, 0.06));
      return g;
    }
    case 'particles':
    case 'pepssi':
    case 'swap': {
      const g = new THREE.Group();
      g.add(rbox(0.22, 0.18, 0.2, 0.012, id === 'swap' ? m.mliGold : m.thermalWhite));
      const dome = sph(0.08, m.darkMetal, 20, 12);
      dome.scale.y = 0.6;
      dome.position.y = 0.09;
      g.add(dome);
      if (id === 'swap') {
        const half = cyl(0.12, 0.12, 0.05, m.alu, 24, false);
        half.rotation.x = Math.PI / 2;
        half.position.z = 0.12;
        g.add(half);
      }
      return g;
    }
    case 'waves': {
      const g = new THREE.Group();
      g.add(rbox(0.16, 0.1, 0.16, 0.01, m.thermalWhite));
      for (const s of [-1, 1]) g.add(rod(v3(0, 0, 0), v3(s * 1.4, -0.6, 0.1), 0.006, m.steel, 5));
      return g;
    }
    case 'sdc':
      return grp(undefined, box(0.46, 0.3, 0.02, m.kapton), at(box(0.42, 0.26, 0.005, m.goldAnod), 0, 0, 0.012));
    default:
      return sensorBox(0.2, 0.16, 0.2, m);
  }
}

/** Attitude control hardware: reaction wheels, thruster pods, star trackers, sun sensors. */
export function adcsModel(id: string, m: Mats = M()): G {
  const g = new THREE.Group();
  const tracker = (): G => {
    const t = new THREE.Group();
    t.add(rbox(0.11, 0.1, 0.11, 0.01, m.darkMetal));
    const baffle = cyl(0.045, 0.065, 0.15, m.mliBlack, 16, true);
    baffle.position.set(0, 0.1, 0.02);
    baffle.rotation.x = -0.35;
    t.add(baffle);
    return t;
  };
  const nozzles = (r: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const n = cyl(0.014, 0.034, 0.07, m.darkMetal, 12, true);
      n.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      n.rotation.set(Math.sin(a) * (Math.PI / 2), 0, -Math.cos(a) * (Math.PI / 2));
      g.add(n);
    }
  };
  if (id === 'wheels') {
    g.add(rbox(0.38, 0.12, 0.38, 0.015, m.goldAnod));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const w = cyl(0.085, 0.085, 0.05, m.steel, 28);
      w.position.set(Math.cos(a) * 0.1, 0.12, Math.sin(a) * 0.1);
      w.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
      g.add(w);
      g.add(at(cyl(0.02, 0.02, 0.055, m.darkMetal, 10), Math.cos(a) * 0.1, 0.12, Math.sin(a) * 0.1));
    }
    g.add(at(tracker(), 0.27, 0.0, 0.08));
  } else if (id === 'thrusters') {
    g.add(rbox(0.24, 0.1, 0.24, 0.01, m.alu));
    nozzles(0.13, 0);
    g.add(at(cyl(0.05, 0.05, 0.12, m.titanium, 16), 0, 0.1, 0));
    g.add(at(tracker(), 0.2, 0.0, -0.1));
    g.add(at(tracker(), 0.2, 0.0, 0.1));
  } else {
    g.add(rbox(0.22, 0.08, 0.22, 0.01, m.alu));
    nozzles(0.12, 0);
    g.add(at(cyl(0.035, 0.035, 0.03, m.goldAnod, 14), 0, 0.055, 0)); // sun sensor
    g.add(at(torus(0.07, 0.008, m.steel), 0, 0.045, 0, Math.PI / 2, 0, 0)); // spin-axis marker ring
  }
  return g;
}

/** Landing systems (used in the landing bay and integrated with the rover). */
export function landingModel(id: string, s: number, m: Mats = M(), integrated = false): G {
  const g = new THREE.Group();
  if (id === 'airbags' && integrated) {
    // stowed: three lander petals under the rover with the deflated bags folded on them
    const base = cyl(1.75 * s * 1.8, 1.75 * s * 1.8, 0.08, m.darkMetal, 3);
    base.position.y = 0.05;
    g.add(base);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      const petal = cyl(0.9 * s * 1.8, 0.9 * s * 1.8, 0.06, m.mliGold, 3);
      petal.position.set(Math.cos(a) * 1.5 * s * 1.8, 0.05, Math.sin(a) * 1.5 * s * 1.8);
      petal.rotation.y = -a + Math.PI / 2;
      g.add(petal);
      for (let i = 0; i < 2; i++) {
        const bag = sph(0.34 * s * 1.6, m.airbag, 18, 12);
        bag.scale.set(1.3, 0.45, 0.9);
        bag.position.set(Math.cos(a) * (1.25 + i * 0.6) * s * 1.8, 0.14, Math.sin(a) * (1.25 + i * 0.6) * s * 1.8);
        g.add(bag);
      }
    }
  } else if (id === 'airbags') {
    // tetrahedral lander base with clusters of airbag lobes
    const base = cyl(1.0 * s * 1.8, 1.0 * s * 1.8, 0.08, m.darkMetal, 3);
    base.position.y = 0.05;
    g.add(base);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      for (let i = 0; i < 6; i++) {
        const lobe = sph(0.42 * s * 1.6, m.airbag, 20, 14);
        const ox = Math.cos(a) * 1.9 * s + Math.cos(a + Math.PI / 2) * ((i % 3) - 1) * 0.6 * s;
        const oz = Math.sin(a) * 1.9 * s + Math.sin(a + Math.PI / 2) * ((i % 3) - 1) * 0.6 * s;
        lobe.position.set(ox, 0.55 * s + Math.floor(i / 3) * 0.62 * s, oz);
        g.add(lobe);
      }
    }
  } else if (id === 'retro') {
    const deck = cyl(1.45 * s, 1.45 * s, 0.14, m.mliGold, 6);
    deck.position.y = 0.75 * s;
    g.add(deck);
    g.add(at(cyl(1.47 * s, 1.47 * s, 0.03, m.alu, 6, true), 0, 0.82 * s, 0));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const top = v3(Math.cos(a) * 1.25 * s, 0.75 * s, Math.sin(a) * 1.25 * s);
      const foot = v3(Math.cos(a) * 1.8 * s, 0.06, Math.sin(a) * 1.8 * s);
      g.add(rod(top, foot, 0.05 * s, m.alu, 10));
      g.add(rod(top.clone().add(v3(0, -0.3 * s, 0)), foot.clone().lerp(top, 0.4), 0.03 * s, m.steel, 8));
      g.add(at(cyl(0.22 * s, 0.25 * s, 0.06, m.alu, 20), foot.x, 0.04, foot.z));
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const n = cyl(0.04 * s, 0.09 * s, 0.22 * s, m.darkMetal, 14, true);
      n.position.set(Math.cos(a) * 1.1 * s, 0.58 * s, Math.sin(a) * 1.1 * s);
      g.add(n);
    }
    for (let i = 0; i < 2; i++) g.add(at(sph(0.32 * s, m.titanium), (i ? 0.5 : -0.5) * s, 0.45 * s, 0));
  } else {
    // sky crane descent stage
    const ring = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = box(1.25, 0.32, 0.36, m.mliGold);
      b.position.set(Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45);
      b.rotation.y = -a + Math.PI / 2;
      ring.add(b);
    }
    g.add(ring);
    for (const [x, z] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) g.add(at(sph(0.42, m.titanium), x, 0.12, z));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const pod = new THREE.Group();
      const n = cyl(0.07, 0.17, 0.4, m.darkMetal, 18, true);
      n.position.y = -0.3;
      pod.add(n);
      pod.add(at(cyl(0.08, 0.08, 0.2, m.steel, 14), 0, -0.05, 0));
      pod.position.set(Math.cos(a) * 1.95, -0.05, Math.sin(a) * 1.95);
      pod.rotation.z = Math.cos(a) * 0.35;
      pod.rotation.x = -Math.sin(a) * 0.35;
      g.add(pod);
    }
    g.add(at(cyl(0.2, 0.2, 0.25, m.thermalWhite, 16), 0, 0.3, 0));
  }
  return g;
}

// ---------------------------------------------------------------- rover
function buildRover(d: Design, m: Mats): { model: G; scale: number } {
  const land = d.landingId ?? 'skycrane';
  const s = land === 'airbags' ? 0.55 : land === 'retro' ? 0.75 : 1;
  const ins = new Set(d.instruments);
  const root = new THREE.Group();
  const r = new THREE.Group();
  root.add(r);

  // warm electronics box
  const body = rbox(1.3, 0.55, 1.95, 0.06, m.thermalWhite);
  body.position.y = 1.02;
  r.add(body);
  const deck = box(1.32, 0.03, 1.97, m.mliBlack);
  deck.position.y = 1.31;
  r.add(deck);
  for (const z of [-0.6, 0, 0.6]) r.add(at(box(0.02, 0.5, 0.02, m.paintGrey), 0.66, 1.02, z));
  // hazcams front + rear
  for (const z of [1, -1])
    for (const x of [-0.18, 0.18]) r.add(at(box(0.07, 0.07, 0.06, m.kapton), x, 0.82, z * 0.99));

  // mobility: wheels + rocker-bogie
  const wr = 0.2625;
  const wz = [0.98, 0.05, -0.92];
  for (const sx of [-1, 1]) {
    const x = sx * 1.12;
    wz.forEach((z, i) => {
      const w = wheel(wr, 0.4, m);
      w.position.set(x, wr, z);
      r.add(w);
      if (i !== 1) r.add(at(cyl(0.06, 0.06, 0.26, m.titanium, 14), x, wr + 0.33, z));
    });
    const piv = v3(sx * 0.82, 0.98, -0.12);
    const bog = v3(sx * 1.08, 0.66, 0.52);
    r.add(rod(piv, v3(x, wr + 0.46, wz[2]), 0.045, m.titanium, 10));
    r.add(rod(v3(x, wr + 0.46, wz[2]), v3(x, wr + 0.1, wz[2]), 0.035, m.titanium, 10));
    r.add(rod(piv, bog, 0.045, m.titanium, 10));
    r.add(rod(bog, v3(x, wr + 0.46, wz[0]), 0.04, m.titanium, 10));
    r.add(rod(v3(x, wr + 0.46, wz[0]), v3(x, wr + 0.1, wz[0]), 0.035, m.titanium, 10));
    r.add(rod(bog, v3(x, wr + 0.1, wz[1]), 0.04, m.titanium, 10));
    r.add(at(cyl(0.09, 0.09, 0.08, m.titanium, 16), piv.x, piv.y, piv.z, 0, 0, Math.PI / 2));
  }
  r.add(rod(v3(-0.82, 1.42, -0.5), v3(0.82, 1.42, -0.5), 0.03, m.titanium, 10));

  // power
  const pw = POWER.find((p) => p.id === d.powerId)!;
  if (pw.kind === 'rtg') {
    const pg = grp('power');
    const rt = rtgModel(pw.id, m);
    rt.rotation.x = Math.PI / 2 - 0.55;
    pg.add(rt);
    for (const sx of [-1, 1]) {
      const hx = box(0.5, 0.02, 0.8, m.thermalWhite);
      hx.position.set(sx * 0.42, 0.05, 0);
      hx.rotation.z = sx * 0.55;
      hx.rotation.x = 0.55;
      pg.add(hx);
    }
    pg.position.set(0, 1.35, -1.18);
    r.add(pg);
  } else {
    const pg = grp('power');
    const big = pw.id === 'solar-m';
    const main = solarWing(1, 1.95, 1.3, m);
    main.position.set(-0.97, 0.12, 0);
    main.rotation.y = 0;
    pg.add(main);
    if (big)
      for (const sx of [-1, 1]) {
        const wing = solarWing(1, 0.85, 1.6, m);
        wing.rotation.y = sx > 0 ? 0 : Math.PI;
        wing.position.set(sx * 0.98, 0.12, 0);
        pg.add(wing);
      }
    pg.position.set(0, 1.33, 0);
    r.add(pg);
  }

  // remote sensing mast
  const mastH = 0.75;
  r.add(at(cyl(0.05, 0.06, mastH, m.thermalWhite, 16), 0.45, 1.33 + mastH / 2, 0.78));
  const headY = 1.33 + mastH + 0.1;
  r.add(at(rbox(0.38, 0.17, 0.22, 0.02, m.thermalWhite), 0.45, headY, 0.8));
  r.add(at(box(0.12, 0.05, 0.05, m.kapton), 0.45, headY - 0.04, 0.92));
  if (ins.has('mastcam')) r.add(at(grp('instr:mastcam', instrumentModel('mastcam', m)), 0.45, headY - 0.02, 0.9));
  if (ins.has('supercam')) r.add(at(grp('instr:supercam', instrumentModel('supercam', m)), 0.45, headY + 0.13, 0.82));
  if (ins.has('meda')) r.add(at(grp('instr:meda', instrumentModel('meda', m)), 0.45, 1.6, 0.78));

  // high-gain (hexagonal paddle) / low-gain
  const ant = ANTENNAS.find((a) => a.id === d.antennaId)!;
  const ag = grp('antenna');
  if (ant.id !== 'lga') {
    const hg = hexDish(0.18 + ant.diameter * 0.08, m);
    hg.rotation.x = -0.9;
    hg.position.y = 0.25;
    ag.add(hg);
    ag.add(at(cyl(0.04, 0.05, 0.22, m.darkMetal, 12), 0, 0.1, 0));
  } else {
    ag.add(at(cyl(0.03, 0.07, 0.18, m.thermalWhite, 14), 0, 0.09, 0));
  }
  ag.position.set(-0.45, 1.32, -0.42);
  r.add(ag);
  r.add(at(cyl(0.025, 0.025, 0.36, m.thermalWhite, 10), -0.25, 1.5, -0.72));
  r.add(at(grp('tx', rbox(0.18, 0.1, 0.24, 0.01, m.goldAnod)), -0.1, 1.38, -0.35));

  // robotic arm with turret
  const armIns = ['pixl', 'sherloc', 'sampler'].filter((x) => ins.has(x));
  if (armIns.length) {
    const sh = v3(0.42, 1.0, 1.0);
    const el = v3(-0.42, 0.92, 1.12);
    const wr2 = v3(0.18, 0.78, 1.22);
    r.add(rod(sh, el, 0.045, m.thermalWhite, 12));
    r.add(rod(el, wr2, 0.04, m.thermalWhite, 12));
    r.add(at(sph(0.07, m.titanium), sh.x, sh.y, sh.z));
    r.add(at(sph(0.06, m.titanium), el.x, el.y, el.z));
    const turret = new THREE.Group();
    turret.position.copy(wr2).add(v3(0.08, -0.08, 0.1));
    turret.add(sph(0.08, m.titanium));
    armIns.forEach((id, i) => {
      const a = (i / armIns.length) * Math.PI * 2;
      const part = grp('instr:' + id, instrumentModel(id, m));
      part.scale.setScalar(0.75);
      part.position.set(Math.cos(a) * 0.13, -0.05, Math.sin(a) * 0.13);
      turret.add(part);
    });
    r.add(turret);
  }
  if (ins.has('moxie')) r.add(at(grp('instr:moxie', instrumentModel('moxie', m)), -0.5, 1.05, 0.92));
  if (ins.has('rimfax')) r.add(at(grp('instr:rimfax', instrumentModel('rimfax', m)), 0, 0.72, -0.99));
  if (ins.has('heli')) r.add(at(grp('instr:heli', helicopter(m)), 0, 0.12, 0.05, 0, 0.6, 0));

  // backup computer + battery shown as gold boxes on the deck
  if (d.avionicsId === 'dual') r.add(at(grp('avionics', rbox(0.3, 0.12, 0.26, 0.01, m.goldAnod)), 0.25, 1.39, -0.25));
  if (d.batteryId !== 'none') r.add(at(grp('battery', rbox(d.batteryId === 'bat-l' ? 0.36 : 0.24, 0.12, 0.2, 0.01, m.blueAnod)), -0.5, 1.39, 0.4));
  const adcsPart = at(grp('adcs', adcsModel(d.adcsId ?? mission0(d), m)), 0.42, 1.37, 0.55);
  adcsPart.scale.setScalar(0.7);
  r.add(adcsPart);

  r.scale.setScalar(s);
  // landing system under the rover
  const lg = grp('landing');
  if (land === 'skycrane') {
    const ds = landingModel('skycrane', 1, m);
    ds.position.y = 3.35;
    lg.add(ds);
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [0, 0.7]]) lg.add(rod(v3(x, 1.45, z), v3(x * 1.1, 3.2, z * 1.1), 0.006, m.steel, 4));
  } else {
    const lm = landingModel(land, s, m, true);
    lg.add(lm);
    r.position.y = land === 'retro' ? 0.82 * s - wr * s + 0.02 : 0.13;
  }
  root.add(lg);
  return { model: root, scale: s };
}

// ---------------------------------------------------------------- orbiter / flyby probe
function buildProbe(d: Design, m: Mats): G {
  const mission = missionOf(d);
  const jup = mission.target === 'jupiter';
  const g = new THREE.Group();
  const busR = jup ? 1.55 : 1.15;
  const busH = jup ? 1.5 : 0.7;
  const sides = jup ? 6 : 3;
  const base = 0.5; // bus bottom above origin (engine below)
  const bus = cyl(busR, busR, busH, m.mliGold, sides);
  bus.position.y = base + busH / 2;
  if (!jup) bus.rotation.y = Math.PI / 6;
  g.add(bus);
  const top = cyl(busR * 1.01, busR * 1.01, 0.04, m.mliBlack, sides);
  top.position.y = base + busH;
  top.rotation.y = bus.rotation.y;
  g.add(top);
  const bot = top.clone();
  bot.position.y = base;
  g.add(bot);
  // thermal louvres on one face
  const lv = new THREE.Group();
  for (let i = 0; i < 9; i++) lv.add(at(box(0.6, 0.03, 0.02, m.chrome), 0, -0.24 + i * 0.06, 0));
  lv.position.set(0, base + busH / 2, busR * Math.cos(Math.PI / sides) + 0.02);
  g.add(lv);
  // main engine + thrusters
  g.add(at(cyl(0.16, 0.32, 0.45, m.darkMetal, 24, true), 0, base - 0.24, 0));
  g.add(at(cyl(0.1, 0.12, 0.12, m.steel, 18), 0, base - 0.04, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const t = new THREE.Group();
    t.add(box(0.14, 0.14, 0.14, m.paintGrey));
    for (const dy of [-1, 1]) t.add(at(cyl(0.015, 0.03, 0.06, m.darkMetal, 10, true), 0, dy * 0.09, 0, dy > 0 ? Math.PI : 0));
    t.position.set(Math.cos(a) * busR * 0.92, base + (i % 2 ? busH : 0), Math.sin(a) * busR * 0.92);
    g.add(t);
  }
  // star trackers
  for (const s of [-1, 1]) {
    const st = cyl(0.05, 0.08, 0.2, m.kapton, 16);
    st.position.set(s * busR * 0.45, base + busH + 0.12, -busR * 0.45);
    st.rotation.x = -0.4;
    g.add(st);
  }

  let deckY = base + busH;
  // radiation vault on the top deck
  if (d.shieldId !== 'none') {
    const sz = d.shieldId === 'heavy' ? 1.0 : 0.8;
    const vg = grp('shield');
    vg.add(rbox(sz, sz * 0.75, sz, 0.03, m.titanium));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      vg.add(at(box(sz * 1.02, 0.03, 0.03, m.steel), 0, -sz * 0.36 + i * 0.001, 0, 0, a, 0));
    }
    vg.position.y = deckY + (sz * 0.75) / 2;
    g.add(vg);
    deckY += sz * 0.75;
  }
  // high-gain antenna
  const ant = ANTENNAS.find((a) => a.id === d.antennaId)!;
  const ag = grp('antenna');
  if (ant.id === 'lga') {
    ag.add(at(cyl(0.05, 0.13, 0.32, m.thermalWhite, 18), 0, 0.16, 0));
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ag.add(rod(v3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35), v3(Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2), 0.02, m.titanium, 6));
    }
    ag.add(at(dishModel(ant.diameter, m), 0, 0.32, 0));
  }
  ag.position.y = deckY;
  g.add(ag);
  g.add(at(grp('tx', rbox(0.22, 0.14, 0.3, 0.01, m.goldAnod)), busR * 0.5, base + busH + 0.08, busR * 0.25));
  if (d.avionicsId === 'dual') g.add(at(grp('avionics', rbox(0.34, 0.14, 0.3, 0.01, m.goldAnod)), -busR * 0.5, base + busH + 0.09, busR * 0.25));
  if (d.batteryId !== 'none') g.add(at(grp('battery', rbox(d.batteryId === 'bat-l' ? 0.42 : 0.28, 0.14, 0.24, 0.01, m.blueAnod)), -busR * 0.1, base + busH + 0.09, -busR * 0.55));
  g.add(at(grp('adcs', adcsModel(d.adcsId ?? mission0(d), m)), busR * 0.5, base + busH + 0.08, -busR * 0.42));

  // power
  const pw = POWER.find((p) => p.id === d.powerId)!;
  const pg = grp('power');
  let magTip: THREE.Vector3 | null = null;
  if (pw.kind === 'solar') {
    const cfg = pw.id === 'solar-l' ? { wings: 3, panels: 4, pl: 2.2, pw: 2.6 } : pw.id === 'solar-m' ? { wings: 3, panels: 2, pl: 1.5, pw: 1.4 } : { wings: 2, panels: 1, pl: 1.4, pw: 1.3 };
    for (let w = 0; w < cfg.wings; w++) {
      const a = (w / cfg.wings) * Math.PI * 2 + Math.PI / 2;
      const wing = solarWing(cfg.panels, cfg.pl, cfg.pw, m);
      const yoke = new THREE.Group();
      yoke.add(rod(v3(0, 0, 0), v3(0.35, 0, 0), 0.035, m.steel, 8));
      wing.position.x = 0.35;
      yoke.add(wing);
      yoke.position.set(Math.cos(a) * busR * 0.9, base + busH * 0.85, -Math.sin(a) * busR * 0.9);
      yoke.rotation.y = a;
      pg.add(yoke);
      if (w === 0) magTip = v3(Math.cos(a) * (busR + 0.35 + cfg.panels * (cfg.pl + 0.06) + 0.4), base + busH * 0.85, -Math.sin(a) * (busR + 0.35 + cfg.panels * (cfg.pl + 0.06) + 0.4));
    }
  } else if (pw.kind === 'rtg') {
    const n = pw.id === 'gphs2' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 1.15 + i * 0.75;
      const arm = new THREE.Group();
      arm.add(rod(v3(busR * 0.8, 0, 0), v3(busR + 0.9, 0, 0), 0.04, m.titanium, 8));
      arm.add(rod(v3(busR * 0.8, 0.25, 0), v3(busR + 0.6, 0, 0), 0.025, m.titanium, 8));
      const rt = rtgModel(pw.id, m);
      rt.rotation.z = Math.PI / 2;
      rt.position.x = busR + 0.9 + (pw.id === 'mmrtg' ? 0.33 : 0.57);
      arm.add(rt);
      arm.position.y = base + busH * 0.5;
      arm.rotation.y = a;
      pg.add(arm);
    }
  }
  g.add(pg);

  // instruments: each has a fixed, realistic spot
  const ins = mission.instruments.filter((i) => d.instruments.includes(i.id));
  const face = (k: number, y: number, out = 0.06) => {
    const a = ((k + 0.5) / sides) * Math.PI * 2 + (jup ? 0 : Math.PI / 6);
    const rr = busR * Math.cos(Math.PI / sides) + out;
    return { p: v3(Math.sin(a) * rr, y, Math.cos(a) * rr), ry: a };
  };
  const slots: Record<string, { p: THREE.Vector3; ry: number; rx?: number }> = {
    mwr: face(1, base + busH * 0.5, 0.04),
    cam: face(2, base + busH * 0.75),
    jiram: face(3, base + 0.25),
    uvs: face(4, base + 0.3),
    particles: face(5, base + busH * 0.7),
    waves: { p: v3(0, base - 0.1, busR * 0.6), ry: 0 },
    grav: { p: v3(-busR * 0.2, base + busH + 0.08, busR * 0.55), ry: 0 },
    lorri: face(0, base + busH * 0.5, 0.14),
    ralph: face(1, base + busH * 0.55, 0.2),
    alice: face(1, base + busH * 0.25, 0.22),
    rex: { p: v3(0.25, deckY + 0.08, 0.25), ry: 0 },
    swap: face(2, base + busH * 0.6, 0.12),
    pepssi: face(2, base + busH * 0.25, 0.12),
    sdc: { p: v3(0, base - 0.02, -busR * 0.3), ry: 0, rx: Math.PI / 2 },
  };
  ins.forEach((inst) => {
    const part = grp('instr:' + inst.id, instrumentModel(inst.id, m));
    if (inst.id === 'mag') {
      if (magTip && pw.id === 'solar-l') part.position.copy(magTip);
      else {
        const a = 0.6;
        const tip = v3(Math.cos(a) * (busR + 2.4), base + busH * 0.3, -Math.sin(a) * (busR + 2.4));
        g.add(rod(v3(Math.cos(a) * busR * 0.9, base + busH * 0.3, -Math.sin(a) * busR * 0.9), tip, 0.025, m.steel, 6));
        part.position.copy(tip);
      }
      g.add(part);
      return;
    }
    const sl = slots[inst.id] ?? face(0, base + busH * 0.5);
    part.position.copy(sl.p);
    part.rotation.y = sl.ry;
    if (sl.rx) part.rotation.x = sl.rx;
    g.add(part);
  });
  return g;
}

export interface CraftBuild {
  model: G;
  /** bottom of the model sits at y = 0 */
  height: number;
  radius: number;
}

export function buildRealCraft(d: Design): CraftBuild {
  const m = M();
  const mission = missionOf(d);
  const model = mission.type === 'lander' ? buildRover(d, m).model : buildProbe(d, m);
  shade(model);
  const parts: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o.userData.part) parts.push(o);
  });
  for (const p of parts) mergeStatic(p);
  mergeStatic(model, (o) => !!o.userData.part);
  const bb = new THREE.Box3().setFromObject(model);
  const size = bb.getSize(new THREE.Vector3());
  model.position.y -= bb.min.y;
  return { model, height: size.y, radius: Math.max(size.x, size.z) / 2 };
}

/** World-space centre of the tagged part (or null if the design has none). */
export function partCenter(model: THREE.Object3D, part: string): THREE.Vector3 | null {
  let found: THREE.Object3D | null = null;
  model.traverse((o) => {
    if (!found && o.userData.part === part) found = o;
  });
  if (!found) return null;
  model.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(found).getCenter(new THREE.Vector3());
}

export function setPartVisible(model: THREE.Object3D, part: string, v: boolean) {
  model.traverse((o) => {
    if (o.userData.part === part) o.visible = v;
  });
}
