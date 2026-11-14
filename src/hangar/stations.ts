// Work stations around the high bay. Each one is a physical place with real
// hardware on it: racks of power sources, a lab bench of instruments, antenna
// stands, a fuel cart, desks with live screens, and the launch gate.
import * as THREE from 'three';
import { ANTENNAS, BATTERIES, LANDINGS, POWER, SHIELDS, TRANSMITTERS } from '../data/parts';
import { MissionDef } from '../data/missions';
import { ROCKETS } from '../data/rockets';
import { RoleId, Tab } from '../game/state';
import { instrumentModel, landingModel, rtgModel, solarWing } from './craft';
import { Collider, ROOM } from './env';
import { M, at, box, cyl, dishModel, hose, mergeStatic, rbox, rod, shade, sph, v3 } from './kit';
import { buildRocket } from './rockets3d';
import { signTexture } from './tex';

export type StationId = 'power' | 'systems' | 'landing' | 'orbit' | 'fuel' | 'science' | 'comms' | 'ops' | 'flight' | 'rockets' | 'gate';

export interface StationDef {
  id: StationId;
  role: RoleId;
  name: string;
  tab: Tab;
  stand: [number, number];
  face: number; // heading while using the station
  label: [number, number, number]; // world position of the floating label
  missions?: string[];
  types?: MissionDef['type'][];
}

export const STATIONS: StationDef[] = [
  { id: 'flight', role: 'flight', name: 'Flight Dynamics', tab: 'trajectory', stand: [-9, 8.7], face: 0, label: [-9, 2.6, 10.2] },
  { id: 'rockets', role: 'flight', name: 'Rockets', tab: 'launch', stand: [-11.7, 8.1], face: Math.atan2(-1.9, 1.3), label: [-13.6, 3.4, 9.4] },
  { id: 'power', role: 'engineer', name: 'Power', tab: 'spacecraft', stand: [-14.1, -4.5], face: -Math.PI / 2, label: [-15.8, 3.6, -4.5] },
  { id: 'systems', role: 'engineer', name: 'Avionics & Batteries', tab: 'spacecraft', stand: [-14.1, 1.5], face: -Math.PI / 2, label: [-15.8, 3.6, 1.5] },
  { id: 'fuel', role: 'engineer', name: 'Fuel', tab: 'spacecraft', stand: [-4.25, -5.0], face: Math.atan2(-0.95, -0.9), label: [-5.2, 2.4, -6.0] },
  { id: 'landing', role: 'engineer', name: 'Landing Systems', tab: 'spacecraft', stand: [-10.2, -7.6], face: Math.PI, label: [-10.2, 4.4, -10.6], types: ['lander'] },
  { id: 'orbit', role: 'flight', name: 'Orbit Planning', tab: 'spacecraft', stand: [-9.5, -10.3], face: Math.PI, label: [-9.5, 5.2, -12.6], types: ['orbiter'] },
  { id: 'science', role: 'science', name: 'Science Lab', tab: 'science', stand: [14.0, -4.5], face: Math.PI / 2, label: [15.8, 3.6, -4.5] },
  { id: 'comms', role: 'ops', name: 'Antennas & Radios', tab: 'comms', stand: [13.2, 3.2], face: Math.PI / 2, label: [15.6, 4.2, 3.2] },
  { id: 'ops', role: 'ops', name: 'Ground & Budget', tab: 'comms', stand: [9.5, 8.7], face: 0, label: [9.5, 2.6, 10.2] },
  { id: 'gate', role: 'flight', name: 'Launch Gate', tab: 'launch', stand: [0, 10.4], face: 0, label: [0, 3.2, 12.2] },
];

export const stationById = (id: StationId) => STATIONS.find((s) => s.id === id)!;

export interface Slot {
  key: string; // e.g. "powerId:mmrtg", "instr:pixl"
  obj: THREE.Object3D;
  home: THREE.Vector3; // world position on the rack
  homeQuat: THREE.Quaternion;
  homeScale: number;
  parent: THREE.Object3D;
}

export interface LiveScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

export interface BuiltStation {
  def: StationDef;
  group: THREE.Group;
  colliders: Collider[];
  slots: Slot[];
  screen?: LiveScreen;
  ring: THREE.Mesh;
}

export function liveScreen(w: number, h: number): LiveScreen {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx, tex };
}

/** Screen mesh: emissive so it glows like a real monitor. */
export function screenMesh(s: LiveScreen, w: number, h: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: s.tex, emissiveIntensity: 1.15, roughness: 0.25, metalness: 0 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function placard(text: string, sub: string): THREE.Mesh {
  const t = signTexture(
    [
      { text, size: 46, color: '#121314' },
      { text: sub, size: 30, weight: 500, color: '#4b5560' },
    ],
    { w: 420, h: 150, bg: '#f6f6f2' },
  );
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  return m;
}

// ------------------------------------------------------------------ item models
export function itemModel(key: string): THREE.Group {
  const m = M();
  const [field, val] = key.split(':');
  const g = new THREE.Group();
  if (field === 'powerId') {
    const p = POWER.find((x) => x.id === val)!;
    if (p.kind === 'rtg') {
      const n = val === 'gphs2' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const r = rtgModel(val === 'gphs2' ? 'gphs' : val, m);
        r.rotation.x = Math.PI / 2;
        r.position.x = (i - (n - 1) / 2) * 0.5;
        g.add(r);
      }
      // radiation trefoil plate
      const tre = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshStandardMaterial({ map: signTexture([{ text: '☢', size: 110, color: '#111' }], { w: 160, h: 160, bg: '#f2c230' }) }));
      tre.position.set(0, 0.36, 0);
      tre.rotation.x = -Math.PI / 2;
      g.add(tre);
    } else {
      // stowed panel stack
      const dims = val === 'solar-l' ? [0.95, 0.42, 2.3] : val === 'solar-m' ? [0.9, 0.24, 1.3] : [0.8, 0.12, 0.9];
      const layers = Math.round(dims[1] / 0.04);
      for (let i = 0; i < layers; i++) {
        const w = solarWing(1, dims[2], dims[0], m);
        w.rotation.y = Math.PI / 2;
        w.position.set(0, i * 0.04 - dims[1] / 2 + 0.02, dims[2] / 2);
        g.add(w);
      }
      g.add(at(box(dims[0] + 0.06, dims[1] + 0.02, 0.05, m.alu), 0, 0, dims[2] / 2 + 0.03));
      g.add(at(box(dims[0] + 0.06, dims[1] + 0.02, 0.05, m.alu), 0, 0, -dims[2] / 2 - 0.03));
    }
  } else if (field === 'batteryId') {
    const b = BATTERIES.find((x) => x.id === val)!;
    const w = 0.18 + b.wh / 15000;
    g.add(rbox(w, 0.16, 0.22, 0.012, m.blueAnod));
    for (let i = 0; i < 3; i++) g.add(at(cyl(0.012, 0.012, 0.03, m.copper, 8), -w / 3 + (i * w) / 3, 0.09, 0.06));
    g.add(at(box(w * 0.6, 0.06, 0.005, new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 })), 0, 0, 0.112));
  } else if (field === 'avionicsId') {
    for (let i = 0; i < 2; i++) {
      const c = rbox(0.36, 0.13, 0.3, 0.01, m.goldAnod);
      c.position.y = i * 0.15;
      g.add(c);
      for (let k = 0; k < 4; k++) g.add(at(cyl(0.018, 0.018, 0.03, m.steel, 10), -0.12 + k * 0.08, i * 0.15, 0.16, Math.PI / 2));
    }
  } else if (field === 'shieldId') {
    const s = SHIELDS.find((x) => x.id === val)!;
    const sz = s.id === 'heavy' ? 1.0 : 0.8;
    g.add(rbox(sz, sz * 0.75, sz, 0.03, m.titanium));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(at(cyl(0.018, 0.018, 0.02, m.steel, 8), Math.cos(a) * sz * 0.4, sz * 0.38, Math.sin(a) * sz * 0.4));
    }
  } else if (field === 'antennaId') {
    const a = ANTENNAS.find((x) => x.id === val)!;
    if (a.id === 'lga') g.add(at(cyl(0.05, 0.13, 0.32, m.thermalWhite, 18), 0, 0.16, 0));
    else g.add(dishModel(a.diameter, m));
  } else if (field === 'txId') {
    const t = TRANSMITTERS.find((x) => x.id === val)!;
    const w = 0.16 + Math.log10(t.rfW) * 0.08;
    g.add(rbox(w, 0.12, 0.26, 0.01, m.goldAnod));
    for (let i = 0; i < 6; i++) g.add(at(box(0.008, 0.05, 0.24, m.alu), -w / 2 + 0.03 + (i * (w - 0.06)) / 5, 0.085, 0));
    g.add(at(cyl(0.02, 0.02, 0.06, m.copper, 10), w / 2 - 0.03, 0, 0.15, Math.PI / 2));
  } else if (field === 'landingId') {
    const l = LANDINGS.find((x) => x.id === val)!;
    const s = l.id === 'airbags' ? 0.55 : l.id === 'retro' ? 0.75 : 1;
    g.add(landingModel(l.id, s, m));
  } else if (field === 'instr') {
    g.add(instrumentModel(val, m));
  } else if (field === 'rocketId') {
    const r = buildRocket(val);
    r.scale.setScalar(1 / 45);
    g.add(r);
  }
  return shade(g);
}

// ------------------------------------------------------------------ furniture
function palletRack(len: number, levels: number[], depth = 1.1): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  const bays = Math.round(len / 1.8);
  const top = levels[levels.length - 1] + 0.9;
  for (let i = 0; i <= bays; i++) {
    const z = -len / 2 + (i * len) / bays;
    for (const x of [-depth / 2, depth / 2]) g.add(at(box(0.08, top, 0.08, m.rackBlue), x, top / 2, z));
    for (let y = 0.4; y < top; y += 0.6) g.add(rod(v3(-depth / 2, y, z), v3(depth / 2, y + 0.5, z), 0.012, m.rackBlue, 4));
  }
  for (const y of levels) {
    for (const x of [-depth / 2, depth / 2]) g.add(at(box(0.06, 0.12, len, m.rackOrange), x, y, 0));
    const deck = box(depth, 0.02, len, m.steel);
    deck.position.y = y + 0.07;
    g.add(deck);
    for (let z = -len / 2 + 0.3; z < len / 2; z += 0.6) g.add(at(box(depth, 0.03, 0.03, m.steel), 0, y + 0.04, z));
  }
  return g;
}

function desk(w: number, d: number, m = M()): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rbox(w, 0.05, d, 0.01, m.paintWhite), 0, 0.76, 0));
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(at(box(0.05, 0.74, d - 0.1, m.paintGrey), x, 0.37, 0));
  g.add(at(box(w - 0.2, 0.3, 0.02, m.paintGrey), 0, 0.55, -d / 2 + 0.06));
  return g;
}

function monitor(s: LiveScreen | null, w = 0.62, h = 0.38): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.add(at(rbox(w + 0.03, h + 0.03, 0.03, 0.008, m.paintDark), 0, 0, 0));
  if (s) {
    const sc = screenMesh(s, w, h);
    sc.position.z = 0.017;
    g.add(sc);
  } else g.add(at(box(w, h, 0.002, new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: 0x1d4f91, emissiveIntensity: 0.6, roughness: 0.2 })), 0, 0, 0.016));
  g.add(at(box(0.05, 0.22, 0.04, m.paintDark), 0, -h / 2 - 0.1, -0.02));
  g.add(at(box(0.24, 0.015, 0.16, m.paintDark), 0, -h / 2 - 0.21, -0.02));
  return g;
}

function chair(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.add(at(cyl(0.22, 0.22, 0.06, m.paintDark, 20), 0, 0.5, 0));
  g.add(at(cyl(0.025, 0.025, 0.42, m.chrome, 8), 0, 0.27, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(rod(v3(0, 0.07, 0), v3(Math.cos(a) * 0.28, 0.04, Math.sin(a) * 0.28), 0.015, m.paintDark, 5));
  }
  g.add(at(rbox(0.4, 0.42, 0.05, 0.02, m.paintDark), 0, 0.82, -0.2));
  return g;
}

function floorRing(def: StationDef, color: string): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(def.stand[0], 0.013, def.stand[1]);
  return ring;
}

export function buildStation(def: StationDef, mission: MissionDef, roleColor: string): BuiltStation {
  const m = M();
  const g = new THREE.Group();
  const colliders: Collider[] = [];
  const slots: Slot[] = [];
  let screen: LiveScreen | undefined;
  const addSlot = (key: string, obj: THREE.Object3D, parent: THREE.Object3D) => {
    parent.add(obj);
    slots.push({ key, obj, parent, home: new THREE.Vector3(), homeQuat: new THREE.Quaternion(), homeScale: obj.scale.x });
  };
  const label = (key: string, text: string, sub: string, parent: THREE.Object3D, pos: THREE.Vector3, ry: number) => {
    const p = placard(text, sub);
    p.position.copy(pos);
    p.rotation.y = ry;
    p.rotation.x = -0.35;
    p.userData.placard = key;
    parent.add(p);
  };

  switch (def.id) {
    case 'power': {
      const rack = palletRack(5.4, [0.15, 1.25, 2.35]);
      rack.position.set(-ROOM.x + 0.65, 0, -4.5);
      g.add(rack);
      const pw = POWER.filter((p) => mission.powerIds.includes(p.id));
      const rtgs = pw.filter((p) => p.kind === 'rtg');
      const sols = pw.filter((p) => p.kind === 'solar');
      rtgs.forEach((p, i) => {
        const it = itemModel('powerId:' + p.id);
        const z = -6.3 + i * 1.8;
        it.position.set(0, 0.55, z + 4.5);
        addSlot('powerId:' + p.id, it, rack);
        rack.add(at(box(0.5, 0.08, 0.4, m.paintDark), 0, 0.27, z + 4.5));
        label('powerId:' + p.id, p.name.split(' ')[0], `${p.watts} W`, rack, v3(0.6, 0.38, z + 4.5), Math.PI / 2);
      });
      sols.forEach((p, i) => {
        const it = itemModel('powerId:' + p.id);
        const z = sols.length === 3 ? -6.5 + i * 2.0 : -5.7 + i * 2.4;
        const lvl = p.id === 'solar-l' ? 2.35 : 1.25;
        it.position.set(0, lvl + 0.1 + (p.id === 'solar-l' ? 0.22 : p.id === 'solar-m' ? 0.13 : 0.07), (p.id === 'solar-l' ? -4.5 : z) + 4.5);
        addSlot('powerId:' + p.id, it, rack);
        label('powerId:' + p.id, p.id === 'solar-l' ? 'Giant solar wings' : p.id === 'solar-m' ? 'Medium solar' : 'Small solar', `${(p.watts / 1000).toFixed(1)} kW at Earth`, rack, v3(0.6, lvl + 0.02, (p.id === 'solar-l' ? -5.9 : z) + 4.5), Math.PI / 2);
      });
      colliders.push({ kind: 'box', x0: -ROOM.x, x1: -ROOM.x + 1.3, z0: -7.3, z1: -1.7 });
      break;
    }
    case 'systems': {
      const rack = palletRack(3.6, [0.15, 1.25, 2.35]);
      rack.position.set(-ROOM.x + 0.65, 0, 1.5);
      g.add(rack);
      BATTERIES.forEach((b, i) => {
        const it = itemModel('batteryId:' + b.id);
        const z = -1.1 + i * 1.1;
        it.position.set(0, 1.25 + 0.17, z);
        addSlot('batteryId:' + b.id, it, rack);
        label('batteryId:' + b.id, `${b.wh / 1000} kWh battery`, `${b.mass} kg`, rack, v3(0.6, 1.33, z), Math.PI / 2);
      });
      const av = itemModel('avionicsId:dual');
      av.position.set(0, 2.35 + 0.14, 0);
      addSlot('avionicsId:dual', av, rack);
      label('avionicsId:dual', 'Backup computer', '+30 kg · $40M', rack, v3(0.6, 2.43, 0), Math.PI / 2);
      if (mission.type === 'orbiter')
        SHIELDS.filter((s) => s.id !== 'none').forEach((s, i) => {
          const it = itemModel('shieldId:' + s.id);
          const z = -0.8 + i * 1.6;
          it.position.set(0, 0.15 + 0.08 + (s.id === 'heavy' ? 0.375 : 0.3), z);
          addSlot('shieldId:' + s.id, it, rack);
          label('shieldId:' + s.id, s.id === 'heavy' ? 'Heavy vault' : 'Light vault', `${s.mass} kg titanium`, rack, v3(0.6, 0.24, z), Math.PI / 2);
        });
      colliders.push({ kind: 'box', x0: -ROOM.x, x1: -ROOM.x + 1.3, z0: -0.4, z1: 3.4 });
      break;
    }
    case 'landing': {
      const xs = { airbags: -14.2, retro: -10.4, skycrane: -6.3 } as Record<string, number>;
      for (const l of LANDINGS) {
        const pallet = new THREE.Group();
        pallet.add(at(box(l.id === 'skycrane' ? 3.4 : 2.6, 0.14, 2.6, m.paintGrey), 0, 0.07, 0));
        pallet.position.set(xs[l.id], 0, -10.6);
        g.add(pallet);
        const it = itemModel('landingId:' + l.id);
        it.position.set(0, 0.14 + (l.id === 'skycrane' ? 1.0 : 0), 0);
        if (l.id === 'skycrane') pallet.add(at(box(0.3, 0.9, 0.3, m.paintGrey), 0, 0.6, 0));
        addSlot('landingId:' + l.id, it, pallet);
        label('landingId:' + l.id, l.id === 'skycrane' ? 'Sky crane' : l.id === 'retro' ? 'Retro-rocket lander' : 'Airbags', `lands up to ${l.maxRover} kg`, pallet, v3(0, 0.6, 1.45), 0);
        colliders.push({ kind: 'box', x0: xs[l.id] - 1.8, x1: xs[l.id] + 1.8, z0: -13, z1: -9.1 });
      }
      break;
    }
    case 'orbit': {
      screen = liveScreen(1600, 900);
      const sc = screenMesh(screen, 6.4, 3.6);
      sc.position.set(-9.5, 5.2, -ROOM.z + 0.12);
      g.add(sc);
      g.add(at(box(6.7, 3.9, 0.12, m.paintDark), -9.5, 5.2, -ROOM.z + 0.05));
      const dk = desk(2.4, 0.9);
      dk.position.set(-9.5, 0, -11.5);
      g.add(dk);
      for (const x of [-0.6, 0.6]) {
        const mo = monitor(null);
        mo.position.set(-9.5 + x, 1.13, -11.7);
        g.add(mo);
      }
      colliders.push({ kind: 'box', x0: -10.9, x1: -8.1, z0: -12.2, z1: -10.9 });
      break;
    }
    case 'fuel': {
      const cart = new THREE.Group();
      cart.add(at(rbox(1.5, 0.12, 0.9, 0.02, m.paintGrey), 0, 0.42, 0));
      for (const [x, z] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) cart.add(at(cyl(0.12, 0.12, 0.08, m.rubber, 16), x, 0.12, z, Math.PI / 2));
      const tank = new THREE.Group();
      tank.add(cyl(0.34, 0.34, 0.8, m.thermalWhite, 32));
      tank.add(at(sph(0.34, m.thermalWhite), 0, 0.4, 0));
      tank.add(at(sph(0.34, m.thermalWhite), 0, -0.4, 0));
      tank.rotation.z = Math.PI / 2;
      tank.position.set(0, 0.88, 0);
      cart.add(tank);
      const lab = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.2),
        new THREE.MeshStandardMaterial({ map: signTexture([{ text: 'HYDRAZINE · N2H4', size: 52, color: '#111' }], { w: 640, h: 200, bg: '#f2c230' }) }),
      );
      lab.position.set(0, 0.88, 0.345);
      cart.add(lab);
      for (const x of [-0.45, 0.45]) {
        cart.add(at(cyl(0.07, 0.07, 0.03, m.chrome, 24), x, 1.32, 0.22, Math.PI / 2));
        cart.add(at(cyl(0.06, 0.06, 0.005, new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.3 }), 24), x, 1.32, 0.237, Math.PI / 2));
      }
      cart.add(at(box(0.05, 0.6, 0.05, m.chrome), 0.7, 0.75, 0));
      cart.position.set(-5.3, 0, -6.0);
      cart.rotation.y = 0.8;
      g.add(shade(cart));
      // hose from the cart, over the stanchions, to the spacecraft
      g.add(shade(hose([v3(-4.8, 0.9, -5.4), v3(-4.2, 0.2, -4.9), v3(-3.6, 0.04, -4.2), v3(-2.6, 0.05, -3.4), v3(-1.6, 0.6, -2.6), v3(-1.0, 1.6, -2.0)], 0.035, m.rubber)));
      screen = liveScreen(512, 256);
      const gauge = screenMesh(screen, 0.5, 0.25);
      gauge.position.set(0, 1.3, -0.3);
      gauge.rotation.y = Math.PI;
      const gPost = new THREE.Group();
      gPost.add(gauge);
      gPost.add(at(box(0.54, 0.29, 0.03, m.paintDark), 0, 1.3, -0.28));
      gPost.add(at(box(0.04, 1.2, 0.04, m.paintDark), 0, 0.6, -0.26));
      gPost.position.set(-4.5, 0, -5.6);
      gPost.rotation.y = Math.PI - 0.75;
      g.add(gPost);
      colliders.push({ kind: 'circle', x: -5.3, z: -6.0, r: 1.0 });
      break;
    }
    case 'science': {
      const bench = new THREE.Group();
      bench.add(at(box(0.95, 0.06, 5.6, m.paintWhite), 0, 0.9, 0));
      bench.add(at(box(0.9, 0.012, 5.5, m.esd), 0, 0.937, 0));
      for (const z of [-2.7, 0, 2.7]) for (const x of [-0.4, 0.4]) bench.add(at(box(0.05, 0.88, 0.05, m.paintGrey), x, 0.44, z));
      bench.add(at(box(0.9, 0.04, 5.5, m.paintGrey), 0, 0.25, 0));
      bench.position.set(ROOM.x - 0.6, 0, -4.5);
      g.add(bench);
      const list = mission.instruments;
      const step = Math.min(0.62, 5.2 / list.length);
      list.forEach((inst, i) => {
        const z = -2.6 + step / 2 + i * step + (5.2 - step * list.length) / 2;
        const it = itemModel('instr:' + inst.id);
        const bb = new THREE.Box3().setFromObject(it);
        const sz = bb.getSize(new THREE.Vector3());
        const big = Math.max(sz.x, sz.z, sz.y);
        const fit = big > step * 0.95 ? (step * 0.95) / big : 1;
        it.scale.setScalar(fit);
        it.position.set(0.05, 0.945 - bb.min.y * fit, z);
        it.rotation.y = -Math.PI / 2;
        addSlot('instr:' + inst.id, it, bench);
        label('instr:' + inst.id, inst.name.length > 18 ? inst.name.slice(0, 17) + '…' : inst.name, `+${inst.science} pts · ${inst.mass} kg`, bench, v3(-0.38, 0.99, z), -Math.PI / 2);
      });
      screen = liveScreen(1280, 640);
      const sc = screenMesh(screen, 3.2, 1.6);
      sc.position.set(ROOM.x - 0.05, 2.45, -4.5);
      sc.rotation.y = -Math.PI / 2;
      g.add(sc);
      g.add(at(box(0.08, 1.75, 3.35, m.paintDark), ROOM.x - 0.02, 2.45, -4.5));
      colliders.push({ kind: 'box', x0: ROOM.x - 1.2, x1: ROOM.x, z0: -7.4, z1: -1.6 });
      break;
    }
    case 'comms': {
      const order = ['hga30', 'hga21', 'hga15'];
      const zs = [0.6, 3.3, 5.4];
      order.forEach((id, i) => {
        const a = ANTENNAS.find((x) => x.id === id)!;
        const stand = new THREE.Group();
        const h = 0.9 + a.diameter * 0.45;
        stand.add(at(cyl(0.05, 0.06, h, m.paintGrey, 12), 0, h / 2, 0));
        for (let k = 0; k < 3; k++) {
          const ang = (k / 3) * Math.PI * 2;
          stand.add(rod(v3(0, 0.35, 0), v3(Math.cos(ang) * 0.5, 0, Math.sin(ang) * 0.5), 0.02, m.paintGrey, 6));
        }
        stand.position.set(ROOM.x - 1.1, 0, zs[i]);
        g.add(stand);
        const holder = new THREE.Group();
        holder.position.set(0, h + 0.05, 0);
        holder.rotation.z = Math.PI / 2 - 0.35;
        stand.add(holder);
        const it = itemModel('antennaId:' + id);
        addSlot('antennaId:' + id, it, holder);
        label('antennaId:' + id, `${a.diameter.toFixed(1)} m dish`, `${a.mass} kg · $${a.costM}M`, stand, v3(-0.55, 0.95, 0), -Math.PI / 2);
      });
      // radio table: low-gain antenna + transmitters
      const table = desk(0.9, 1.6);
      table.rotation.y = -Math.PI / 2;
      table.position.set(ROOM.x - 0.9, 0, 7.2);
      g.add(table);
      const lga = itemModel('antennaId:lga');
      lga.position.set(0, 0.79, 0.6);
      addSlot('antennaId:lga', lga, table);
      label('antennaId:lga', 'Low-gain antenna', 'no dish', table, v3(0, 0.8, 0.85), Math.PI);
      TRANSMITTERS.forEach((t, i) => {
        const it = itemModel('txId:' + t.id);
        it.position.set(0.32 - i * 0.25 + 0.05, 0.85, -0.25);
        it.rotation.y = Math.PI / 2;
        it.scale.setScalar(0.8);
        addSlot('txId:' + t.id, it, table);
        label('txId:' + t.id, `${t.rfW} W radio`, `${t.dcW} W from power`, table, v3(0.32 - i * 0.25 + 0.05, 0.8, 0.05), Math.PI);
      });
      colliders.push({ kind: 'box', x0: ROOM.x - 2.0, x1: ROOM.x, z0: -1.0, z1: 6.4 }, { kind: 'box', x0: ROOM.x - 1.8, x1: ROOM.x, z0: 6.3, z1: 8.1 });
      break;
    }
    case 'ops':
    case 'flight': {
      const x = def.id === 'ops' ? 9.5 : -9;
      const dk = desk(2.6, 1.0);
      dk.position.set(x, 0, 10.4);
      dk.rotation.y = Math.PI;
      g.add(dk);
      for (const dx of [-0.75, 0, 0.75]) {
        const mo = monitor(null);
        mo.position.set(x + dx, 1.13, 10.65);
        mo.rotation.y = Math.PI + dx * -0.35;
        g.add(mo);
      }
      const ch = chair();
      ch.position.set(x + 0.3, 0, 9.4);
      ch.rotation.y = 0.3;
      g.add(ch);
      screen = liveScreen(1600, 900);
      const sc = screenMesh(screen, 5.6, 3.15);
      sc.position.set(x, 4.6, ROOM.z - 0.1);
      sc.rotation.y = Math.PI;
      g.add(sc);
      g.add(at(box(5.9, 3.45, 0.12, m.paintDark), x, 4.6, ROOM.z - 0.03));
      if (def.id === 'ops') {
        // desk models of a 34 m and a 70 m Deep Space Network antenna
        for (const [dx, dia] of [[-0.95, 0.24], [0.95, 0.42]] as const) {
          const dsn = new THREE.Group();
          dsn.add(at(cyl(0.06, 0.08, 0.12, m.paintWhite, 16), 0, 0.06, 0));
          const d = dishModel(dia, m);
          d.rotation.x = -0.7;
          d.position.y = 0.14 + dia * 0.2;
          dsn.add(d);
          dsn.position.set(x + dx, 0.79, 10.2);
          g.add(dsn);
        }
      }
      colliders.push({ kind: 'box', x0: x - 1.4, x1: x + 1.4, z0: 9.8, z1: 11.0 });
      break;
    }
    case 'rockets': {
      const tbl = new THREE.Group();
      tbl.add(at(cyl(1.35, 1.35, 0.08, m.paintDark, 48), 0, 0.82, 0));
      tbl.add(at(cyl(1.3, 1.1, 0.78, m.paintGrey, 48), 0, 0.39, 0));
      tbl.position.set(-13.6, 0, 9.4);
      g.add(tbl);
      ROCKETS.forEach((r, i) => {
        const a = -2.2 + (i / (ROCKETS.length - 1)) * 2.3;
        const base = new THREE.Group();
        base.add(at(cyl(0.12, 0.14, 0.04, m.chrome, 24), 0, 0.02, 0));
        base.position.set(Math.cos(a) * 0.9, 0.86, -Math.sin(a) * 0.9);
        tbl.add(base);
        const it = itemModel('rocketId:' + r.id);
        it.position.y = 0.04;
        addSlot('rocketId:' + r.id, it, base);
        const nm = r.id === 'atlasv551s48' ? 'Atlas V + Star 48' : r.id === 'falconheavy' ? 'Falcon Heavy' : r.name;
        label('rocketId:' + r.id, nm, `$${r.costM >= 1000 ? (r.costM / 1000).toFixed(1) + 'B' : r.costM + 'M'}`, base, v3(Math.cos(a) * 0.32, 0.06, -Math.sin(a) * 0.32), Math.atan2(Math.cos(a), -Math.sin(a)));
      });
      colliders.push({ kind: 'circle', x: -13.6, z: 9.4, r: 1.5 });
      break;
    }
    case 'gate':
      break;
  }
  for (const s of slots) mergeStatic(s.obj);
  const slotSet = new Set(slots.map((s) => s.obj));
  mergeStatic(g, (o) => slotSet.has(o));
  const ring = floorRing(def, roleColor);
  g.add(ring);
  return { def, group: g, colliders, slots, screen, ring };
}

/** After the station is in the scene, record each item's resting place. */
export function captureHomes(st: BuiltStation) {
  for (const s of st.slots) {
    s.obj.updateWorldMatrix(true, false);
    s.obj.getWorldPosition(s.home);
    s.obj.getWorldQuaternion(s.homeQuat);
  }
}
