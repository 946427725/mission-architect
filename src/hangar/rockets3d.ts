// Procedural launch vehicles at real scale (metres). Used as 1:45 desk models
// in the high bay and full size on the launch pad. No logos or branding.
import * as THREE from 'three';
import { M, at, box, cyl, shade } from './kit';

let foamMat: THREE.MeshStandardMaterial | null = null;
let bronzeMat: THREE.MeshStandardMaterial | null = null;
const foam = () => (foamMat ??= new THREE.MeshStandardMaterial({ color: 0xd9732c, roughness: 0.88, metalness: 0 }));
const bronze = () => (bronzeMat ??= new THREE.MeshStandardMaterial({ color: 0xb87a43, roughness: 0.7, metalness: 0.15 }));

function ogive(r: number, h: number, m: THREE.Material, seg = 40): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector2(r * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.06 * t), t * h));
  }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, seg), m);
}

function engines(n: number, r: number, bell: number, m = M()): THREE.Group {
  const g = new THREE.Group();
  const place = (x: number, z: number) => {
    const e = cyl(bell * 0.35, bell, bell * 2.2, m.darkMetal, 20, true);
    e.position.set(x, -bell * 1.1, z);
    g.add(e);
  };
  if (n === 1) place(0, 0);
  else if (n === 2) {
    place(-r * 0.3, 0);
    place(r * 0.3, 0);
  } else if (n === 9) {
    place(0, 0);
    for (let i = 0; i < 8; i++) place(Math.cos((i / 8) * Math.PI * 2) * r * 0.66, Math.sin((i / 8) * Math.PI * 2) * r * 0.66);
  } else for (let i = 0; i < n; i++) place(Math.cos((i / n) * Math.PI * 2) * r * 0.5, Math.sin((i / n) * Math.PI * 2) * r * 0.5);
  return g;
}

function falconCore(withLegs: boolean, nose: boolean): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  const r = 1.83;
  g.add(at(cyl(r, r, 41, m.paintWhite, 40), 0, 20.5, 0));
  g.add(at(cyl(r * 1.02, r * 1.02, 1.2, m.paintDark, 40), 0, 0.6, 0));
  g.add(engines(9, r, 0.45));
  // grid fins
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = box(1.2, 1.5, 0.12, m.darkMetal);
    fin.position.set(Math.cos(a) * (r + 0.6), 39.5, Math.sin(a) * (r + 0.6));
    fin.rotation.y = -a + Math.PI / 2;
    g.add(fin);
  }
  if (withLegs)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const leg = box(0.7, 9, 0.35, m.carbon);
      leg.position.set(Math.cos(a) * (r + 0.15), 5, Math.sin(a) * (r + 0.15));
      leg.rotation.y = -a + Math.PI / 2;
      g.add(leg);
    }
  if (nose) g.add(at(ogive(r, 6, m.paintWhite), 0, 41, 0));
  return g;
}

/** Real-scale rocket, bottom at y = 0. */
export function buildRocket(id: string): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  switch (id) {
    case 'falcon9':
    case 'falconheavy': {
      const heavy = id === 'falconheavy';
      g.add(falconCore(true, false));
      if (heavy)
        for (const s of [-1, 1]) {
          const side = falconCore(true, true);
          side.position.x = s * 3.85;
          g.add(side);
          for (const y of [8, 36]) g.add(at(box(1.9, 0.5, 0.6, m.paintDark), s * 1.92, y, 0));
        }
      g.add(at(cyl(1.83, 1.83, 4.5, m.paintDark, 40), 0, 43.25, 0)); // interstage
      g.add(at(cyl(1.83, 1.83, 11, m.paintWhite, 40), 0, 51, 0));
      g.add(at(cyl(2.6, 1.83, 1.4, m.paintWhite, 40), 0, 57.2, 0));
      g.add(at(cyl(2.6, 2.6, 6, m.paintWhite, 48), 0, 60.9, 0));
      g.add(at(ogive(2.6, 7.5, m.paintWhite), 0, 63.9, 0));
      g.add(at(cyl(2.62, 2.62, 0.12, m.paintGrey, 48, true), 0, 63.85, 0));
      break;
    }
    case 'atlasv551':
    case 'atlasv551s48': {
      const r = 1.9;
      g.add(at(cyl(r, r, 32.5, bronze(), 40), 0, 16.25 + 1.5, 0));
      g.add(at(cyl(r * 1.05, r, 1.5, m.paintDark, 40), 0, 0.75, 0));
      g.add(engines(2, r, 0.6));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const srb = new THREE.Group();
        srb.add(at(cyl(0.8, 0.8, 17, m.paintWhite, 28), 0, 9, 0));
        srb.add(at(ogive(0.8, 2.8, m.paintWhite, 28), 0, 17.5, 0));
        srb.add(at(cyl(0.45, 0.7, 1.4, m.darkMetal, 20, true), 0, 0.2, 0));
        srb.position.set(Math.cos(a) * (r + 0.85), 0.2, Math.sin(a) * (r + 0.85));
        srb.rotation.z = Math.cos(a) * 0.02;
        g.add(srb);
      }
      g.add(at(cyl(2.7, r, 2.2, m.paintWhite, 48), 0, 35.1, 0));
      g.add(at(cyl(2.7, 2.7, 17, m.paintWhite, 48), 0, 44.7, 0));
      g.add(at(ogive(2.7, 9, m.paintWhite), 0, 53.2, 0));
      for (const y of [37, 46, 53]) g.add(at(cyl(2.72, 2.72, 0.1, m.paintGrey, 48, true), 0, y, 0));
      break;
    }
    case 'ariane64': {
      // ESA Ariane 64: 5.4 m core with a Vulcain engine, four P120C solid boosters, long fairing
      const r = 2.7;
      g.add(at(cyl(r, r, 30, m.paintWhite, 48), 0, 15 + 1.2, 0));
      g.add(at(cyl(r * 1.02, r, 1.2, m.paintDark, 48), 0, 0.6, 0));
      g.add(engines(1, r, 1.0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const b = new THREE.Group();
        b.add(at(cyl(1.7, 1.7, 13.5, m.paintWhite, 32), 0, 6.75 + 1, 0));
        b.add(at(ogive(1.7, 3.6, m.paintWhite, 32), 0, 14.5, 0));
        b.add(at(cyl(0.9, 1.4, 1.6, m.darkMetal, 20, true), 0, 0.4, 0));
        b.add(at(cyl(1.72, 1.72, 0.5, m.paintDark, 32, true), 0, 9, 0));
        b.position.set(Math.cos(a) * (r + 1.75), 0, Math.sin(a) * (r + 1.75));
        g.add(b);
      }
      g.add(at(cyl(r, r, 2.2, m.paintDark, 48), 0, 32.3, 0)); // interstage
      g.add(at(cyl(r, r, 9.5, m.paintWhite, 48), 0, 38.2, 0)); // upper stage
      g.add(at(cyl(r, r, 12, m.paintWhite, 48), 0, 49, 0)); // fairing
      g.add(at(ogive(r, 8, m.paintWhite), 0, 55, 0));
      for (const y of [33.4, 43]) g.add(at(cyl(r * 1.01, r * 1.01, 0.12, m.paintGrey, 48, true), 0, y, 0));
      break;
    }
    case 'h3': {
      // JAXA H3-24: 5.2 m core with two LE-9 engines, four SRB-3 boosters
      const r = 2.6;
      g.add(at(cyl(r, r, 37, m.paintWhite, 48), 0, 18.5 + 1.2, 0));
      g.add(at(cyl(r * 1.02, r, 1.2, m.paintDark, 48), 0, 0.6, 0));
      g.add(engines(2, r, 0.8));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const b = new THREE.Group();
        b.add(at(cyl(1.25, 1.25, 14.5, m.paintWhite, 28), 0, 7.25 + 1, 0));
        b.add(at(ogive(1.25, 3.2, m.paintWhite, 28), 0, 15.2, 0));
        b.add(at(cyl(0.7, 1.05, 1.4, m.darkMetal, 20, true), 0, 0.4, 0));
        b.position.set(Math.cos(a) * (r + 1.3), 0, Math.sin(a) * (r + 1.3));
        g.add(b);
      }
      g.add(at(cyl(r, r, 1.6, m.paintDark, 48), 0, 39.5, 0));
      g.add(at(cyl(2.0, r, 1.2, m.paintWhite, 48), 0, 40.9, 0));
      g.add(at(cyl(2.0, 2.0, 9, m.paintWhite, 40), 0, 46, 0));
      g.add(at(cyl(r, 2.0, 1.6, m.paintWhite, 48), 0, 51.3, 0));
      g.add(at(cyl(r, r, 6, m.paintWhite, 48), 0, 55.1, 0));
      g.add(at(ogive(r, 7, m.paintWhite), 0, 58.1, 0));
      break;
    }
    case 'sls': {
      const r = 4.2;
      g.add(at(cyl(r, r, 65, foam(), 56), 0, 32.5 + 1, 0));
      g.add(at(cyl(r * 1.02, r * 1.02, 2, m.paintDark, 56), 0, 1, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const e = cyl(0.5, 1.15, 3, m.darkMetal, 24, true);
        e.position.set(Math.cos(a) * 1.9, -1.2, Math.sin(a) * 1.9);
        g.add(e);
      }
      for (const s of [-1, 1]) {
        const b = new THREE.Group();
        b.add(at(cyl(1.85, 1.85, 47, m.paintWhite, 36), 0, 24, 0));
        for (const y of [10, 22, 34]) b.add(at(cyl(1.88, 1.88, 0.4, m.paintDark, 36, true), 0, y, 0));
        b.add(at(ogive(1.85, 7, m.paintWhite, 36), 0, 47.5, 0));
        b.add(at(cyl(1.2, 1.7, 2.6, m.darkMetal, 24, true), 0, -0.3, 0));
        b.position.x = s * (r + 1.9);
        g.add(b);
      }
      g.add(at(cyl(2.6, r, 5, m.paintWhite, 48), 0, 68.5, 0));
      g.add(at(cyl(2.6, 2.6, 12, m.paintWhite, 48), 0, 77, 0));
      g.add(at(ogive(2.6, 9, m.paintWhite), 0, 83, 0));
      break;
    }
  }
  shade(g);
  // drop to y = 0
  const bb = new THREE.Box3().setFromObject(g);
  g.position.y -= bb.min.y;
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.userData.height = bb.max.y - bb.min.y;
  return wrap;
}
