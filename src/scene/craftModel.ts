// Procedural spacecraft & rover models that change with the player's design.
import * as THREE from 'three';
import { ANTENNAS, LANDINGS, POWER } from '../data/parts';
import { Design, missionOf } from '../game/state';
import { foilTexture, solarCellTexture } from './textures';

let foil: THREE.MeshStandardMaterial | null = null;
const mats = () => {
  if (!foil) foil = new THREE.MeshStandardMaterial({ map: foilTexture(), metalness: 0.85, roughness: 0.32, color: 0xffffff });
  const cells = solarCellTexture();
  return {
    foil,
    white: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.55, metalness: 0.1 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.45, metalness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6, metalness: 0.4 }),
    titanium: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.9 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.05, metalness: 1 }),
    solar: new THREE.MeshStandardMaterial({ map: cells, roughness: 0.25, metalness: 0.6, color: 0xffffff }),
    solarBack: new THREE.MeshStandardMaterial({ color: 0x3b3f48, roughness: 0.7 }),
    rtg: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.5, emissive: 0x220800, emissiveIntensity: 0.6 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.8 }),
  };
};

const box = (w: number, h: number, d: number, m: THREE.Material): THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]> =>
  new THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]>(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

function dish(diameter: number, m: ReturnType<typeof mats>): THREE.Group {
  const g = new THREE.Group();
  const r = diameter / 2;
  const f = diameter * 0.4;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * r;
    pts.push(new THREE.Vector2(x, (x * x) / (4 * f)));
  }
  const d = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, side: THREE.DoubleSide }));
  g.add(d);
  const feed = cyl(0.05, 0.08, f * 0.9, m.grey, 10);
  feed.position.y = f * 0.45;
  g.add(feed);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = cyl(0.01, 0.01, Math.hypot(r * 0.8, f), m.grey, 6);
    s.position.set(Math.cos(a) * r * 0.4, f * 0.5, Math.sin(a) * r * 0.4);
    s.lookAt(0, f, 0);
    s.rotateX(Math.PI / 2);
    g.add(s);
  }
  return g;
}

function rtg(m: ReturnType<typeof mats>, length = 1.1): THREE.Group {
  const g = new THREE.Group();
  const core = cyl(0.2, 0.2, length, m.rtg, 16);
  g.add(core);
  for (let i = 0; i < 8; i++) {
    const fin = box(0.02, length * 0.9, 0.22, m.rtg);
    const a = (i / 8) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27);
    fin.rotation.y = -a;
    g.add(fin);
  }
  return g;
}

function solarPanel(w: number, h: number, m: ReturnType<typeof mats>) {
  const g = new THREE.Group();
  const front = box(w, 0.04, h, m.solarBack);
  const tex = (m.solar.map as THREE.Texture).clone();
  tex.repeat.set(w * 2, h * 2);
  tex.needsUpdate = true;
  const solarMat = m.solar.clone();
  solarMat.map = tex;
  front.material = [m.solarBack, m.solarBack, solarMat, m.solarBack, m.solarBack, m.solarBack];
  g.add(front);
  return g;
}

function buildProbe(d: Design): THREE.Group {
  const m = mats();
  const mission = missionOf(d);
  const g = new THREE.Group();
  const jupiter = mission.target === 'jupiter';
  const busR = jupiter ? 1.0 : 0.75;
  const busH = jupiter ? 1.4 : 0.7;
  const bus = cyl(busR, busR, busH, m.foil, jupiter ? 6 : 3);
  g.add(bus);

  // radiation vault
  if (d.shieldId !== 'none') {
    const s = d.shieldId === 'heavy' ? 0.85 : 0.6;
    const v = box(s, s * 0.6, s, m.titanium);
    v.position.y = busH / 2 + s * 0.3;
    g.add(v);
  }

  // antenna
  const ant = ANTENNAS.find((a) => a.id === d.antennaId)!;
  if (ant.id === 'lga') {
    const c = cyl(0.04, 0.12, 0.3, m.white, 12);
    c.position.y = busH / 2 + 0.15;
    g.add(c);
  } else {
    const dd = dish(ant.diameter, m);
    dd.position.y = busH / 2 + (d.shieldId !== 'none' ? 0.6 : 0.05);
    g.add(dd);
  }

  // power
  const pw = POWER.find((p) => p.id === d.powerId)!;
  if (pw.kind === 'solar') {
    const wings = pw.id === 'solar-l' ? 3 : 2;
    const panels = pw.id === 'solar-l' ? 4 : pw.id === 'solar-m' ? 3 : 1;
    const pwid = pw.id === 'solar-l' ? 2.4 : 1.3;
    const plen = pw.id === 'solar-l' ? 2.1 : 1.2;
    for (let w = 0; w < wings; w++) {
      const wing = new THREE.Group();
      for (let p = 0; p < panels; p++) {
        const pan = solarPanel(plen, pwid, m);
        pan.position.x = busR + 0.15 + plen / 2 + p * (plen + 0.08);
        wing.add(pan);
      }
      const yoke = cyl(0.03, 0.03, 0.3, m.grey, 6);
      yoke.rotation.z = Math.PI / 2;
      yoke.position.x = busR + 0.05;
      wing.add(yoke);
      wing.rotation.y = (w / wings) * Math.PI * 2 + (wings === 2 ? 0 : Math.PI / 6);
      g.add(wing);
    }
  } else if (pw.kind === 'rtg') {
    const n = pw.id === 'gphs2' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const arm = new THREE.Group();
      const boom = cyl(0.03, 0.03, 1.2, m.grey, 6);
      boom.rotation.z = Math.PI / 2;
      boom.position.x = busR + 0.5;
      arm.add(boom);
      const r = rtg(m, pw.id === 'mmrtg' ? 0.7 : 1.1);
      r.rotation.z = Math.PI / 2;
      r.position.x = busR + 1.4;
      arm.add(r);
      arm.rotation.y = Math.PI * 0.9 + i * Math.PI * 0.6;
      g.add(arm);
    }
  }

  // instruments around the bus
  const ins = mission.instruments.filter((i) => d.instruments.includes(i.id));
  ins.forEach((inst, k) => {
    const a = (k / Math.max(1, ins.length)) * Math.PI * 2 + 0.4;
    const y = -busH / 2 + 0.25 + (k % 2) * 0.35;
    let obj: THREE.Object3D;
    if (inst.id === 'mag') {
      const grp = new THREE.Group();
      const boom = cyl(0.025, 0.025, 2.4, m.grey, 6);
      boom.rotation.z = Math.PI / 2;
      boom.position.x = 1.2;
      grp.add(boom);
      const head = box(0.25, 0.25, 0.25, m.white);
      head.position.x = 2.4;
      grp.add(head);
      grp.position.y = -busH / 2;
      grp.rotation.y = a;
      g.add(grp);
      return;
    }
    if (['cam', 'lorri', 'ralph', 'jiram'].includes(inst.id)) {
      obj = new THREE.Group();
      const body = cyl(0.13, 0.13, 0.45, m.dark, 16);
      body.rotation.x = Math.PI / 2;
      obj.add(body);
      const lens = cyl(0.1, 0.1, 0.02, m.lens, 16);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.23;
      obj.add(lens);
    } else if (inst.id === 'mwr') {
      obj = box(0.9, 0.6, 0.12, m.white);
    } else {
      obj = box(0.28, 0.22, 0.28, k % 2 ? m.white : m.dark);
    }
    obj.position.set(Math.cos(a) * (busR + 0.12), y, Math.sin(a) * (busR + 0.12));
    obj.lookAt(Math.cos(a) * 10, y, Math.sin(a) * 10);
    g.add(obj);
  });

  // engine nozzle
  const noz = cyl(0.08, 0.22, 0.35, m.grey, 16);
  noz.position.y = -busH / 2 - 0.17;
  g.add(noz);
  return g;
}

function buildRover(d: Design): THREE.Group {
  const m = mats();
  const mission = missionOf(d);
  const land = LANDINGS.find((l) => l.id === d.landingId) ?? LANDINGS[0];
  const s = land.id === 'airbags' ? 0.55 : land.id === 'retro' ? 0.75 : 1;
  const g = new THREE.Group();
  const ins = new Set(d.instruments);

  const body = box(2.0 * s, 0.6 * s, 1.4 * s, m.white);
  body.position.y = 0.9 * s;
  g.add(body);
  const deck = box(2.05 * s, 0.05 * s, 1.45 * s, m.foil);
  deck.position.y = 1.22 * s;
  g.add(deck);

  // wheels + rocker-bogie
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const w = cyl(0.26 * s, 0.26 * s, 0.38 * s, m.wheel, 20);
      w.rotation.x = Math.PI / 2;
      w.position.set((i - 1) * 0.9 * s, 0.26 * s, side * 0.95 * s);
      g.add(w);
      const hub = cyl(0.1 * s, 0.1 * s, 0.4 * s, m.dark, 10);
      hub.rotation.x = Math.PI / 2;
      hub.position.copy(w.position);
      g.add(hub);
    }
    const rocker = box(2.0 * s, 0.08 * s, 0.08 * s, m.grey);
    rocker.position.set(0, 0.62 * s, side * 0.95 * s);
    rocker.rotation.z = 0.08;
    g.add(rocker);
  }

  // mast + head
  const mastH = 1.3 * s;
  const mast = cyl(0.06 * s, 0.07 * s, mastH, m.white, 10);
  mast.position.set(0.75 * s, 1.25 * s + mastH / 2, 0.45 * s);
  g.add(mast);
  const head = box(0.25 * s, 0.25 * s, (ins.has('supercam') ? 0.6 : 0.45) * s, m.white);
  head.position.set(0.8 * s, 1.25 * s + mastH + 0.1 * s, 0.45 * s);
  g.add(head);
  if (ins.has('mastcam'))
    for (const z of [-0.12, 0.12]) {
      const eye = cyl(0.05 * s, 0.05 * s, 0.08 * s, m.lens, 12);
      eye.rotation.z = Math.PI / 2;
      eye.position.set(0.95 * s, 1.25 * s + mastH + 0.1 * s, 0.45 * s + z * s);
      g.add(eye);
    }
  if (ins.has('supercam')) {
    const lens = cyl(0.09 * s, 0.09 * s, 0.05 * s, m.lens, 16);
    lens.rotation.z = Math.PI / 2;
    lens.position.set(0.95 * s, 1.25 * s + mastH + 0.22 * s, 0.45 * s);
    g.add(lens);
  }

  // robotic arm
  if (ins.has('pixl') || ins.has('sherloc') || ins.has('sampler')) {
    const a1 = box(0.9 * s, 0.08 * s, 0.08 * s, m.white);
    a1.position.set(1.4 * s, 1.0 * s, -0.3 * s);
    a1.rotation.z = -0.5;
    g.add(a1);
    const a2 = box(0.7 * s, 0.07 * s, 0.07 * s, m.white);
    a2.position.set(1.85 * s, 0.6 * s, -0.3 * s);
    a2.rotation.z = 0.9;
    g.add(a2);
    const turret = box(0.3 * s, 0.3 * s, 0.3 * s, ins.has('sampler') ? m.foil : m.grey);
    turret.position.set(2.05 * s, 0.35 * s, -0.3 * s);
    g.add(turret);
  }
  if (ins.has('meda'))
    for (const z of [-0.3, 0.3]) {
      const arm = box(0.3 * s, 0.03 * s, 0.03 * s, m.grey);
      arm.position.set(0.75 * s, 1.25 * s + mastH * 0.6, 0.45 * s + z * s);
      g.add(arm);
    }

  // power
  const pw = POWER.find((p) => p.id === d.powerId)!;
  if (pw.kind === 'rtg') {
    const r = rtg(m, 0.75 * s);
    r.scale.setScalar(s);
    r.rotation.z = Math.PI / 2 + 0.6;
    r.position.set(-1.25 * s, 1.15 * s, 0);
    g.add(r);
  } else {
    const wings = pw.id === 'solar-m' ? 3 : 1;
    for (let i = 0; i < wings; i++) {
      const p = solarPanel(2.2 * s, 1.6 * s, m);
      p.position.set(0, 1.3 * s + i * 0.01, (i - (wings - 1) / 2) * 1.62 * s);
      g.add(p);
    }
  }

  // antenna (flat hexagonal HGA like Perseverance)
  if (d.antennaId !== 'lga') {
    const hga = cyl(0.3 * s, 0.3 * s, 0.05 * s, m.grey, 6);
    hga.rotation.x = 1.0;
    hga.position.set(-0.6 * s, 1.55 * s, -0.5 * s);
    g.add(hga);
  }
  const uhf = cyl(0.03 * s, 0.03 * s, 0.4 * s, m.white, 6);
  uhf.position.set(-0.8 * s, 1.45 * s, 0.55 * s);
  g.add(uhf);

  if (ins.has('heli')) {
    const heli = new THREE.Group();
    const hb = box(0.18, 0.14, 0.18, m.white);
    hb.position.y = 0.3;
    heli.add(hb);
    for (const y of [0.45, 0.52]) {
      const rotor = box(1.2, 0.01, 0.07, m.dark);
      rotor.position.y = y;
      rotor.rotation.y = y * 3;
      heli.add(rotor);
    }
    const mastH2 = cyl(0.015, 0.015, 0.3, m.grey, 6);
    mastH2.position.y = 0.45;
    heli.add(mastH2);
    for (let i = 0; i < 4; i++) {
      const leg = cyl(0.01, 0.01, 0.35, m.grey, 4);
      const a = (i / 4) * Math.PI * 2 + 0.78;
      leg.position.set(Math.cos(a) * 0.12, 0.13, Math.sin(a) * 0.12);
      leg.rotation.z = Math.cos(a) * 0.5;
      leg.rotation.x = -Math.sin(a) * 0.5;
      heli.add(leg);
    }
    heli.position.set(-2.2 * s, 0, 1.2);
    g.add(heli);
  }

  void mission;
  return g;
}

/** Build the 3D model for the current design, centred and scaled to ~`size` units. */
export function buildCraftModel(d: Design, size = 3): THREE.Group {
  const mission = missionOf(d);
  const inner = mission.type === 'lander' ? buildRover(d) : buildProbe(d);
  const bbox = new THREE.Box3().setFromObject(inner);
  const c = bbox.getCenter(new THREE.Vector3());
  const span = bbox.getSize(new THREE.Vector3()).length();
  inner.position.sub(c);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(size / Math.max(span, 0.001));
  return outer;
}
