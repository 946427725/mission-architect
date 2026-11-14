// The spacecraft assembly high bay: an ISO 7 clean room with a HEPA filter
// wall, an overhead bridge crane, work platforms and a roll-up door to the pad.
import * as THREE from 'three';
import { M, at, box, cyl, mergeStatic, rbox, rod, shade, sph, torus, v3 } from './kit';
import { floorSet, hazardStripes, hepaSet, signTexture, tex, wallSet } from './tex';

export const ROOM = { x: 17, z: 13, h: 15 };
export const CRAFT_POS = new THREE.Vector3(0, 0, -1.5);
export const RING_R = 4.75;
export const INSTALL_SPOT = new THREE.Vector3(0, 0, CRAFT_POS.z + RING_R + 0.75);
export const SPAWN = new THREE.Vector3(0, 0, 8);

export type Collider = { kind: 'box'; x0: number; x1: number; z0: number; z1: number } | { kind: 'circle'; x: number; z: number; r: number };

export class Crane {
  readonly group = new THREE.Group();
  private bridge = new THREE.Group();
  private trolley = new THREE.Group();
  private cable: THREE.Mesh;
  private block = new THREE.Group();
  readonly hook = new THREE.Group(); // attach loads here
  x = 0;
  z = CRAFT_POS.z;
  y = 9.5; // hook height
  private railY = 12;

  constructor() {
    const m = M();
    // runway beams along z
    for (const s of [-1, 1]) {
      const rw = box(0.35, 0.7, ROOM.z * 2, m.craneYellow);
      rw.position.set(s * (ROOM.x - 0.5), this.railY, 0);
      this.group.add(rw);
      for (let z = -ROOM.z + 2; z < ROOM.z; z += 4) this.group.add(at(box(0.25, this.railY - 0.35, 0.25, m.paintGrey), s * (ROOM.x - 0.45), (this.railY - 0.35) / 2, z));
    }
    for (const s of [-0.35, 0.35]) {
      const gird = box(ROOM.x * 2 - 1, 0.9, 0.3, m.craneYellow);
      gird.position.set(0, this.railY + 0.55, s);
      this.bridge.add(gird);
    }
    for (const s of [-1, 1]) this.bridge.add(at(box(0.8, 0.6, 2.2, m.craneYellow), s * (ROOM.x - 0.5), this.railY + 0.6, 0));
    // warning sign on the girder
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 0.55),
      new THREE.MeshStandardMaterial({ map: signTexture([{ text: '40 TON · OVERHEAD CRANE', size: 64, color: '#1b1b1b' }], { w: 1024, h: 140, bg: '#f0b21c' }), roughness: 0.5 }),
    );
    sign.position.set(0, this.railY + 0.55, 0.51);
    this.bridge.add(sign);
    this.group.add(this.bridge);
    const tb = box(1.6, 1.0, 1.4, m.craneYellow);
    this.trolley.add(tb);
    this.trolley.add(at(cyl(0.35, 0.35, 1.3, m.darkMetal, 20), 0, -0.45, 0, Math.PI / 2, 0, 0));
    this.trolley.position.y = this.railY + 0.2;
    this.bridge.add(this.trolley);
    this.cable = cyl(0.025, 0.025, 1, m.steel, 6);
    this.group.add(this.cable);
    const blk = rbox(0.5, 0.65, 0.35, 0.05, m.craneYellow);
    this.block.add(blk);
    const h = torus(0.16, 0.045, m.steel, 8, 20, Math.PI * 1.4);
    h.position.y = -0.48;
    h.rotation.z = Math.PI * 0.8;
    this.block.add(h);
    this.block.add(at(cyl(0.05, 0.05, 0.2, m.steel, 10), 0, -0.3, 0));
    this.hook.position.y = -0.62;
    this.block.add(this.hook);
    this.group.add(this.block);
    shade(this.group, true, false);
    this.apply();
  }

  apply() {
    this.bridge.position.z = this.z;
    this.trolley.position.x = this.x;
    const topY = this.railY - 0.3;
    this.block.position.set(this.x, this.y, this.z);
    const len = Math.max(0.1, topY - this.y - 0.3);
    this.cable.scale.y = len;
    this.cable.position.set(this.x, this.y + 0.3 + len / 2, this.z);
  }
}

function slatTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c9ced3';
  x.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y += 32) {
    const g = x.createLinearGradient(0, y, 0, y + 32);
    g.addColorStop(0, '#dfe3e7');
    g.addColorStop(0.5, '#c4c9ce');
    g.addColorStop(1, '#9fa5ab');
    x.fillStyle = g;
    x.fillRect(0, y, 256, 32);
  }
  return tex(c, true);
}

export interface HighBay {
  group: THREE.Group;
  colliders: Collider[];
  crane: Crane;
  statusBoard: THREE.Mesh;
  door: THREE.Group;
  sun: THREE.DirectionalLight;
  emissives: THREE.Mesh[];
  pedestal: THREE.Group;
  installMarker: THREE.Mesh;
}

export function buildHighBay(quality: 'high' | 'low'): HighBay {
  const m = M();
  const g = new THREE.Group();
  const colliders: Collider[] = [];
  const W = ROOM.x * 2;
  const D = ROOM.z * 2;
  const H = ROOM.h;

  // ---- floor
  const fs = floorSet();
  for (const t of [fs.map, fs.normalMap, fs.roughnessMap]) t.repeat.set(W / 2.4, D / 2.4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normalMap, roughnessMap: fs.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  g.add(floor);

  // floor markings
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.55 });
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.1, mat: THREE.Material = paint) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = -Math.atan2(z1 - z0, x1 - x0);
    p.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    p.receiveShadow = true;
    g.add(p);
  };
  for (const s of [-1, 1]) line(s * 8, -11.5, s * 8, 11.5);
  line(-8, 11.5, 8, 11.5);
  line(-5.6, 12.6, -5.6, 11.6, 0.1);
  line(5.6, 12.6, 5.6, 11.6, 0.1);
  // hazard ring around the spacecraft stand
  const hz = hazardStripes();
  const ringMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.55 });
  const N = 64;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.PlaneGeometry((Math.PI * 2 * (RING_R + 0.15)) / N + 0.01, 0.3), ringMat);
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = a0 + Math.PI / 2;
    seg.position.set(CRAFT_POS.x + Math.cos(a0) * (RING_R + 0.15), 0.005, CRAFT_POS.z - Math.sin(a0) * (RING_R + 0.15));
    seg.receiveShadow = true;
    g.add(seg);
  }
  colliders.push({ kind: 'circle', x: CRAFT_POS.x, z: CRAFT_POS.z, r: RING_R + 0.2 });
  // stanchions with belts (gap at the front = install spot)
  const posts: THREE.Vector3[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.PI / 2 + (Math.PI * 2) / 28;
    posts.push(v3(CRAFT_POS.x + Math.cos(a) * RING_R, 0, CRAFT_POS.z + Math.sin(a) * RING_R));
  }
  const beltMat = new THREE.MeshStandardMaterial({ color: 0xb52020, roughness: 0.6 });
  posts.forEach((p, i) => {
    const post = new THREE.Group();
    post.add(at(cyl(0.17, 0.19, 0.04, m.darkMetal, 20), 0, 0.02, 0));
    post.add(at(cyl(0.03, 0.03, 0.95, m.chrome, 12), 0, 0.5, 0));
    post.add(at(cyl(0.045, 0.045, 0.1, m.darkMetal, 12), 0, 0.95, 0));
    post.position.copy(p);
    g.add(shade(post));
    const q = posts[(i + 1) % posts.length];
    if (i !== posts.length - 1) {
      const belt = box(p.distanceTo(q) - 0.08, 0.05, 0.005, beltMat);
      belt.position.set((p.x + q.x) / 2, 0.93, (p.z + q.z) / 2);
      belt.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
      g.add(belt);
    }
  });
  // install spot marker (glowing ring on the floor)
  const installMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 48),
    new THREE.MeshBasicMaterial({ color: 0x46c8ff, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  installMarker.rotation.x = -Math.PI / 2;
  installMarker.position.set(INSTALL_SPOT.x, 0.012, INSTALL_SPOT.z);
  g.add(installMarker);
  const stencil = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.5),
    new THREE.MeshStandardMaterial({ map: signTexture([{ text: 'INSTALL HERE', size: 80, color: '#e3e6ea' }], { w: 512, h: 120 }), transparent: true, roughness: 0.6 }),
  );
  stencil.rotation.x = -Math.PI / 2;
  stencil.position.set(INSTALL_SPOT.x, 0.006, INSTALL_SPOT.z + 0.95);
  g.add(stencil);

  // pedestal (rotation fixture)
  const pedestal = new THREE.Group();
  pedestal.add(at(cyl(2.3, 2.4, 0.22, m.paintGrey, 64), 0, 0.11, 0));
  pedestal.add(at(cyl(2.25, 2.25, 0.02, m.esd, 64), 0, 0.23, 0));
  pedestal.add(at(torus(2.3, 0.025, m.chrome, 8, 64), 0, 0.22, 0, Math.PI / 2));
  pedestal.position.copy(CRAFT_POS);
  shade(pedestal);
  g.add(pedestal);

  // ---- walls
  const ws = wallSet();
  const wallMat = (len: number, h: number) => {
    const mat = new THREE.MeshStandardMaterial({ map: ws.map.clone(), normalMap: ws.normalMap.clone(), roughnessMap: ws.roughnessMap.clone(), roughness: 1, metalness: 0.05 });
    for (const t of [mat.map!, mat.normalMap!, mat.roughnessMap!]) {
      t.repeat.set(len / 4.8, h / 2.4);
      t.needsUpdate = true;
    }
    return mat;
  };
  const wall = (len: number, h: number, x: number, y: number, z: number, ry: number) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMat(len, h));
    w.position.set(x, y, z);
    w.rotation.y = ry;
    w.receiveShadow = true;
    g.add(w);
    return w;
  };
  wall(D, H, -ROOM.x, H / 2, 0, Math.PI / 2); // left
  wall(D, H, ROOM.x, H / 2, 0, -Math.PI / 2); // right
  // front wall around the door opening
  const doorW = 11;
  const doorH = 11;
  const sideW = (W - doorW) / 2;
  wall(sideW, H, -ROOM.x + sideW / 2, H / 2, ROOM.z, Math.PI);
  wall(sideW, H, ROOM.x - sideW / 2, H / 2, ROOM.z, Math.PI);
  wall(doorW, H - doorH, 0, doorH + (H - doorH) / 2, ROOM.z, Math.PI);
  // HEPA filter wall (back)
  const hs = hepaSet();
  const hepaH = H - 0.6;
  for (const t of [hs.map, hs.normalMap, hs.roughnessMap, hs.emissiveMap]) t.repeat.set(W / 2.4, hepaH / 2.4);
  const hepa = new THREE.Mesh(
    new THREE.PlaneGeometry(W, hepaH),
    new THREE.MeshStandardMaterial({ map: hs.map, normalMap: hs.normalMap, roughnessMap: hs.roughnessMap, roughness: 1, metalness: 0.2, emissiveMap: hs.emissiveMap, emissive: 0xdde9ff, emissiveIntensity: 0.25 }),
  );
  hepa.position.set(0, 0.6 + hepaH / 2, -ROOM.z);
  hepa.receiveShadow = true;
  g.add(hepa);
  const ret = box(W, 0.6, 0.1, m.paintDark);
  ret.position.set(0, 0.3, -ROOM.z + 0.05);
  g.add(ret);
  for (let x = -ROOM.x + 0.6; x < ROOM.x; x += 1.2) g.add(at(box(0.04, 0.5, 0.12, m.paintGrey), x, 0.3, -ROOM.z + 0.08));

  // ceiling + trusses + light fixtures
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  g.add(ceil);
  const emissives: THREE.Mesh[] = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: quality === 'high' ? 5 : 3.5, roughness: 0.4 });
  for (let z = -10; z <= 10; z += 4) {
    g.add(at(box(W, 0.7, 0.3, m.paintGrey), 0, H - 0.6, z));
    for (let x = -13; x <= 13; x += 5.2) {
      const housing = box(0.7, 0.1, 2.6, m.paintDark);
      housing.position.set(x, H - 1.35, z + 2);
      g.add(housing);
      const lamp = box(0.6, 0.02, 2.5, lampMat);
      lamp.position.set(x, H - 1.41, z + 2);
      g.add(lamp);
      emissives.push(lamp);
      g.add(rod(v3(x, H - 1.3, z + 1.2), v3(x, H - 0.9, z + 1.2), 0.01, m.steel, 4));
      g.add(rod(v3(x, H - 1.3, z + 2.8), v3(x, H - 0.9, z + 2.8), 0.01, m.steel, 4));
    }
  }
  // cable trays along the side walls
  for (const s of [-1, 1]) {
    g.add(at(box(0.5, 0.08, D - 1, m.alu), s * (ROOM.x - 0.4), 3.4, 0));
    g.add(at(box(0.02, 0.1, D - 1, m.alu), s * (ROOM.x - 0.65), 3.47, 0));
  }

  // ---- roll-up door to the launch pad
  const door = new THREE.Group();
  const slat = slatTexture();
  slat.repeat.set(doorW / 2, doorH / 4);
  const doorPanel = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), new THREE.MeshStandardMaterial({ map: slat, metalness: 0.6, roughness: 0.4 }));
  doorPanel.rotation.y = Math.PI;
  doorPanel.position.y = doorH / 2;
  doorPanel.receiveShadow = true;
  door.add(doorPanel);
  door.position.z = ROOM.z - 0.05;
  g.add(door);
  // daylight behind the door (seen when it opens)
  const day = new THREE.Mesh(new THREE.PlaneGeometry(doorW + 1, doorH + 1), new THREE.MeshBasicMaterial({ color: 0xfff1d8, toneMapped: true }));
  day.position.set(0, doorH / 2, ROOM.z + 0.6);
  day.rotation.y = Math.PI;
  g.add(day);
  const hzv = hazardStripes().clone();
  hzv.repeat.set(1, 12);
  hzv.rotation = Math.PI / 2;
  hzv.needsUpdate = true;
  for (const s of [-1, 1]) {
    const col = box(0.5, doorH, 0.5, new THREE.MeshStandardMaterial({ map: hzv, roughness: 0.5 }));
    col.position.set(s * (doorW / 2 + 0.25), doorH / 2, ROOM.z - 0.25);
    g.add(col);
  }
  g.add(at(box(doorW + 1, 0.6, 0.6, m.paintDark), 0, doorH + 0.3, ROOM.z - 0.3));
  // status board above the door (texture drawn by the game)
  const statusBoard = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.25), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  statusBoard.position.set(0, doorH + 2.2, ROOM.z - 0.12);
  statusBoard.rotation.y = Math.PI;
  g.add(statusBoard);
  g.add(at(box(7.5, 2.5, 0.15, m.darkMetal), 0, doorH + 2.2, ROOM.z - 0.03));

  // ---- signage
  const bigSign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 1.6),
    new THREE.MeshStandardMaterial({ map: signTexture([{ text: 'SPACECRAFT ASSEMBLY HIGH BAY', size: 150, weight: 800, color: '#1c2a3a' }], { w: 2800, h: 320 }), transparent: true, roughness: 0.7 }),
  );
  bigSign.position.set(ROOM.x - 0.02, 10.4, -1);
  bigSign.rotation.y = -Math.PI / 2;
  g.add(bigSign);
  const iso = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.1),
    new THREE.MeshStandardMaterial({
      map: signTexture(
        [
          { text: 'ISO 7 CLEAN ROOM', size: 74, color: '#ffffff' },
          { text: 'Full gowning required · no food or drink', size: 34, weight: 500, color: '#d8e6f5' },
        ],
        { w: 780, h: 330, bg: '#1d4f91' },
      ),
      roughness: 0.5,
    }),
  );
  iso.position.set(-ROOM.x + 0.03, 2.4, 9);
  iso.rotation.y = Math.PI / 2;
  g.add(iso);
  const pp = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.2),
    new THREE.MeshStandardMaterial({
      map: signTexture(
        [
          { text: 'PLANETARY PROTECTION', size: 62, color: '#1b1b1b' },
          { text: 'Earth microbes must not reach Mars.', size: 34, weight: 500, color: '#333' },
          { text: 'Every part is cleaned and swabbed.', size: 34, weight: 500, color: '#333' },
        ],
        { w: 780, h: 360, bg: '#f2c230' },
      ),
      roughness: 0.5,
    }),
  );
  pp.position.set(ROOM.x - 0.03, 2.4, 9);
  pp.rotation.y = -Math.PI / 2;
  g.add(pp);

  // gallery windows on the left wall
  for (let i = 0; i < 6; i++) {
    const z = -9 + i * 2.6;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2), m.glass);
    pane.position.set(-ROOM.x + 0.04, 8, z);
    pane.rotation.y = Math.PI / 2;
    g.add(pane);
    g.add(at(box(0.1, 2.4, 0.12, m.alu), -ROOM.x + 0.06, 8, z + 1.25));
  }
  g.add(at(box(0.12, 0.12, 15.8, m.alu), -ROOM.x + 0.06, 9.15, -2.5));
  g.add(at(box(0.12, 0.12, 15.8, m.alu), -ROOM.x + 0.06, 6.85, -2.5));

  // ---- props (non-interactive)
  // work platform beside the spacecraft
  const plat = new THREE.Group();
  const deckH = 1.6;
  plat.add(at(box(2.6, 0.08, 1.6, m.alu), 0, deckH, 0));
  for (const [x, z] of [[-1.25, -0.75], [1.25, -0.75], [-1.25, 0.75], [1.25, 0.75]]) {
    plat.add(at(box(0.08, deckH, 0.08, m.alu), x, deckH / 2, z));
    plat.add(at(cyl(0.07, 0.07, 0.08, m.rubber, 12), x, 0.07, z, Math.PI / 2));
  }
  for (const z of [-0.78, 0.78]) {
    plat.add(at(box(2.6, 0.04, 0.04, m.craneYellow), 0, deckH + 1.05, z));
    plat.add(at(box(2.6, 0.04, 0.04, m.craneYellow), 0, deckH + 0.55, z));
    for (const x of [-1.25, 0, 1.25]) plat.add(at(box(0.04, 1.05, 0.04, m.craneYellow), x, deckH + 0.52, z));
  }
  for (let i = 0; i < 6; i++) plat.add(at(box(0.9, 0.05, 0.28, m.alu), 1.75 + i * 0.28, deckH - (i + 1) * (deckH / 6.5), 0));
  plat.add(rod(v3(1.4, deckH, 0.45), v3(3.3, 0, 0.45), 0.04, m.alu));
  plat.add(rod(v3(1.4, deckH, -0.45), v3(3.3, 0, -0.45), 0.04, m.alu));
  plat.add(rod(v3(1.4, deckH + 1.0, 0.45), v3(3.2, 1.0, 0.45), 0.025, m.craneYellow));
  plat.position.set(6.3, 0, -6.2);
  plat.rotation.y = -0.5;
  g.add(shade(plat));
  colliders.push({ kind: 'circle', x: 6.3, z: -6.2, r: 1.5 }, { kind: 'circle', x: 7.6, z: -6.9, r: 0.9 });

  // shipping containers
  const crateLabel = new THREE.MeshStandardMaterial({
    map: signTexture(
      [
        { text: 'FLIGHT HARDWARE', size: 70, color: '#1b1b1b' },
        { text: 'HANDLE WITH CARE · THIS SIDE UP', size: 34, weight: 500, color: '#333' },
      ],
      { w: 760, h: 220, bg: '#f4f4f0', border: '#1b1b1b' },
    ),
    roughness: 0.6,
  });
  for (const [x, z, w, h, d] of [[12.6, -10.8, 3.4, 2.2, 2.2], [12.9, -7.9, 2.6, 1.6, 2.0]] as const) {
    const cr = new THREE.Group();
    cr.add(rbox(w, h, d, 0.04, m.paintWhite));
    for (const s of [-1, 1]) cr.add(at(box(w + 0.04, 0.1, 0.1, m.paintGrey), 0, s * (h / 2 - 0.1), d / 2));
    cr.add(at(box(0.08, h, d + 0.04, m.paintGrey), w / 2 - 0.2, 0, 0));
    cr.add(at(box(0.08, h, d + 0.04, m.paintGrey), -w / 2 + 0.2, 0, 0));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.46), crateLabel);
    lab.position.set(0, 0, d / 2 + 0.01);
    cr.add(lab);
    cr.position.set(x, h / 2, z);
    cr.rotation.y = -Math.PI / 2;
    g.add(shade(cr));
    colliders.push({ kind: 'box', x0: x - d / 2 - 0.2, x1: x + d / 2 + 0.2, z0: z - w / 2 - 0.2, z1: z + w / 2 + 0.2 });
  }
  // nitrogen purge cylinders
  const gasMat = new THREE.MeshStandardMaterial({ color: 0x2f6d3f, roughness: 0.4, metalness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Group();
    c.add(at(cyl(0.12, 0.12, 1.45, gasMat, 20), 0, 0.73, 0));
    c.add(at(sph(0.12, gasMat), 0, 1.45, 0));
    c.add(at(cyl(0.03, 0.04, 0.15, m.chrome, 10), 0, 1.6, 0));
    c.position.set(-ROOM.x + 0.35, 0, -11.6 + i * 0.32);
    g.add(shade(c));
  }
  g.add(at(box(0.05, 0.05, 1.4, m.chrome), -ROOM.x + 0.25, 1.1, -11.1));
  colliders.push({ kind: 'box', x0: -ROOM.x, x1: -ROOM.x + 0.6, z0: -12, z1: -10.2 });
  // red tool cabinet
  const tc = new THREE.Group();
  tc.add(rbox(1.2, 1.0, 0.6, 0.03, m.red));
  for (let i = 0; i < 5; i++) tc.add(at(box(1.1, 0.012, 0.02, m.chrome), 0, -0.35 + i * 0.17, 0.31));
  for (const x of [-0.5, 0.5]) for (const z of [-0.22, 0.22]) tc.add(at(cyl(0.05, 0.05, 0.04, m.rubber, 12), x, -0.55, z, Math.PI / 2));
  tc.position.set(15.9, 0.6, -7.5);
  tc.rotation.y = -Math.PI / 2;
  g.add(shade(tc));
  colliders.push({ kind: 'box', x0: 15.4, x1: ROOM.x, z0: -8.2, z1: -6.8 });
  // airlock door (left wall, front)
  const al = new THREE.Group();
  al.add(at(box(0.1, 2.4, 2.0, m.steel), 0, 1.2, 0));
  al.add(at(box(0.12, 0.9, 0.5, m.glass), 0.02, 1.6, -0.45));
  al.add(at(box(0.12, 0.9, 0.5, m.glass), 0.02, 1.6, 0.45));
  al.add(at(box(0.12, 2.6, 0.08, m.paintDark), 0, 1.3, 1.04));
  al.add(at(box(0.12, 2.6, 0.08, m.paintDark), 0, 1.3, -1.04));
  const lamp = sph(0.06, new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x00ff66, emissiveIntensity: 3 }));
  lamp.position.set(0.1, 2.75, 0);
  al.add(lamp);
  al.position.set(-ROOM.x + 0.05, 0, 5.2);
  g.add(al);
  const alSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.32), new THREE.MeshStandardMaterial({ map: signTexture([{ text: 'GOWNING ROOM', size: 60, color: '#fff' }], { w: 520, h: 120, bg: '#24578a' }) }));
  alSign.position.set(-ROOM.x + 0.03, 3.0, 5.2);
  alSign.rotation.y = Math.PI / 2;
  g.add(alSign);

  // crane
  const crane = new Crane();
  g.add(crane.group);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x8d939a, quality === 'high' ? 0.55 : 0.9);
  g.add(hemi);
  const sun = new THREE.DirectionalLight(0xfffbf4, 2.4);
  sun.position.set(7, 22, 9);
  sun.target.position.set(0, 0, -1);
  sun.castShadow = true;
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -21;
  sc.right = 21;
  sc.top = 18;
  sc.bottom = -18;
  sc.near = 1;
  sc.far = 60;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 4;
  g.add(sun, sun.target);
  // tripod work lights aimed at the spacecraft
  for (const s of [-1, 1]) {
    const tri = new THREE.Group();
    const top = v3(0, 2.6, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      tri.add(rod(top, v3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55), 0.018, m.darkMetal, 6));
    }
    const head = new THREE.Group();
    head.add(rbox(0.5, 0.36, 0.14, 0.03, m.paintDark));
    const lens = box(0.44, 0.3, 0.01, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 6 }));
    lens.position.z = 0.075;
    head.add(lens);
    head.position.copy(top).add(v3(0, 0.15, 0));
    tri.add(head);
    const px = s * 5.6;
    const pz = CRAFT_POS.z + 3.6;
    tri.position.set(px, 0, pz);
    head.lookAt(new THREE.Vector3(CRAFT_POS.x, 1.6, CRAFT_POS.z).sub(tri.position).add(head.position));
    g.add(shade(tri));
    const spot = new THREE.SpotLight(0xfff1dc, 55, 22, 0.55, 0.6, 1.6);
    spot.position.set(px, 2.75, pz);
    spot.target.position.set(CRAFT_POS.x, 1.5, CRAFT_POS.z);
    if (quality === 'high' && s > 0 && new URLSearchParams(location.search).get('q') === 'ultra') {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0005;
    }
    g.add(spot, spot.target);
    colliders.push({ kind: 'circle', x: px, z: pz, r: 0.6 });
  }

  shade(al, true, true);
  const keep = new Set<THREE.Object3D>([crane.group, door, installMarker, statusBoard]);
  mergeStatic(g, (o) => keep.has(o) || (o as THREE.Light).isLight === true);
  return { group: g, colliders, crane, statusBoard, door, sun, emissives, pedestal, installMarker };
}
