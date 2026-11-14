// Shared PBR materials and small geometry helpers for the high bay.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { brushed, fabricNormal, mliSet, solarCells } from './tex';

type Mat = THREE.Material;

let _m: ReturnType<typeof makeMats> | null = null;
export const M = () => (_m ??= makeMats());

function makeMats() {
  const br = brushed();
  const gold = mliSet('gold');
  const silver = mliSet('silver');
  const black = mliSet('black');
  const cells = solarCells();
  const fab = fabricNormal();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const phy = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  return {
    suit: phy({ color: 0xeef1f4, roughness: 0.86, sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), normalMap: fab, normalScale: new THREE.Vector2(0.45, 0.45) }),
    suitSeam: std({ color: 0xd9dde1, roughness: 0.85 }),
    nitrile: phy({ color: 0x5a4ec4, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    skin: std({ color: 0xc69476, roughness: 0.55 }),
    goggle: phy({ color: 0x101a24, roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02 }),
    goggleFrame: std({ color: 0x2b3440, roughness: 0.5 }),
    mask: std({ color: 0xc4dcee, roughness: 0.92, normalMap: fab, normalScale: new THREE.Vector2(0.6, 0.6) }),
    sole: std({ color: 0x24447a, roughness: 0.8 }),
    paintWhite: std({ color: 0xf1f2f0, roughness: 0.42 }),
    paintGrey: std({ color: 0x8d949b, roughness: 0.5, metalness: 0.2 }),
    paintDark: std({ color: 0x33383e, roughness: 0.55, metalness: 0.25 }),
    rackBlue: std({ color: 0x24578a, roughness: 0.45, metalness: 0.25 }),
    rackOrange: std({ color: 0xe0661a, roughness: 0.42, metalness: 0.2 }),
    craneYellow: std({ color: 0xf0b21c, roughness: 0.4, metalness: 0.25 }),
    red: std({ color: 0xc8261e, roughness: 0.45, metalness: 0.1 }),
    steel: std({ color: 0x9aa1a8, metalness: 0.92, roughness: 0.38, roughnessMap: br }),
    alu: std({ color: 0xd8dce0, metalness: 0.95, roughness: 0.3, roughnessMap: br }),
    chrome: std({ color: 0xe8ecef, metalness: 1, roughness: 0.08 }),
    darkMetal: std({ color: 0x2a2d31, metalness: 0.65, roughness: 0.42 }),
    rubber: std({ color: 0x151515, roughness: 0.92 }),
    glass: phy({ color: 0x0a1016, roughness: 0.02, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    clearGlass: phy({ color: 0xffffff, roughness: 0.03, transmission: 0.9, thickness: 0.02, transparent: true, opacity: 0.35, metalness: 0 }),
    esd: std({ color: 0x46575f, roughness: 0.92 }),
    mliGold: std({ map: gold.map, normalMap: gold.normalMap, roughnessMap: gold.roughnessMap, metalness: 0.78, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) }),
    mliSilver: std({ map: silver.map, normalMap: silver.normalMap, roughnessMap: silver.roughnessMap, metalness: 0.95, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }),
    mliBlack: std({ map: black.map, normalMap: black.normalMap, roughnessMap: black.roughnessMap, metalness: 0.3, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }),
    thermalWhite: std({ color: 0xf5f5f0, roughness: 0.5 }),
    kapton: std({ color: 0x0d0d0f, roughness: 0.38, metalness: 0.2 }),
    titanium: std({ color: 0xaab0b8, metalness: 0.95, roughness: 0.34, roughnessMap: br }),
    solar: phy({ map: cells.map, roughnessMap: cells.roughnessMap, metalness: 0.35, roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.04 }),
    solarBack: std({ color: 0x3a3f47, roughness: 0.7, metalness: 0.3 }),
    rtg: std({ color: 0x1d1e21, metalness: 0.45, roughness: 0.5 }),
    goldAnod: std({ color: 0xc9a043, metalness: 0.9, roughness: 0.32, roughnessMap: br }),
    blueAnod: std({ color: 0x3b5b86, metalness: 0.85, roughness: 0.35, roughnessMap: br }),
    lens: phy({ color: 0x05070c, metalness: 0.4, roughness: 0.02, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.6 }),
    airbag: phy({ color: 0xe4e1d4, roughness: 0.75, sheen: 0.25, sheenColor: new THREE.Color(0xffffff), normalMap: fab, normalScale: new THREE.Vector2(0.8, 0.8) }),
    carbon: std({ color: 0x1c1c1e, roughness: 0.35, metalness: 0.5 }),
    copper: std({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
  };
}
export type Mats = ReturnType<typeof makeMats>;

/**
 * Merge every mesh under `root` (in `root`'s local space) that shares a material
 * into one mesh. Children for which `keep(o)` is true are left alone (moving
 * parts, tagged parts). Cuts thousands of draw calls to a few dozen.
 */
export function mergeStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false, tag?: (m: THREE.Mesh, sample: THREE.Mesh) => void) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; sample: THREE.Mesh; meshes: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      if (keep(c)) continue;
      const me = c as THREE.Mesh;
      if (me.isMesh && !(me as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(me.material) && me.visible) {
        const mat = me.material as THREE.Material;
        const key = `${mat.uuid}|${me.castShadow ? 1 : 0}${me.receiveShadow ? 1 : 0}`;
        let g = me.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        if (g.index) g = g.toNonIndexed();
        g.morphAttributes = {};
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, me.matrixWorld));
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { mat, geos: [], sample: me, meshes: [] }));
        b.geos.push(g);
        b.meshes.push(me);
      }
      visit(c);
    }
  };
  visit(root);
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    for (const me of b.meshes) {
      me.parent?.remove(me);
    }
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.sample.castShadow;
    mesh.receiveShadow = b.sample.receiveShadow;
    tag?.(mesh, b.sample);
    root.add(mesh);
  }
  // drop now-empty groups
  const prune = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      if (keep(c)) continue;
      prune(c);
      if (c.type === 'Group' && c.children.length === 0 && !Object.keys(c.userData).length) o.remove(c);
    }
  };
  prune(root);
}

export function shade<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}

export function at<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

export const box = (w: number, h: number, d: number, m: Mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
export const rbox = (w: number, h: number, d: number, r: number, m: Mat, seg = 3) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), m);
export const cyl = (rt: number, rb: number, h: number, m: Mat, seg = 24, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m);
export const sph = (r: number, m: Mat, ws = 24, hs = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
export const torus = (r: number, t: number, m: Mat, rs = 12, ts = 32, arc = Math.PI * 2) => new THREE.Mesh(new THREE.TorusGeometry(r, t, rs, ts, arc), m);

const UP = new THREE.Vector3(0, 1, 0);
/** A cylinder (rod/beam/strut) between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: Mat, seg = 8): THREE.Mesh {
  const len = a.distanceTo(b);
  const me = cyl(r, r, len, m, seg);
  me.position.copy(a).add(b).multiplyScalar(0.5);
  me.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return me;
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A smooth tube through points (cables, hoses). */
export function hose(points: THREE.Vector3[], r: number, m: Mat): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), r, 8, false), m);
}

/** Paraboloid dish with back ribs, feed and struts. Opens toward +Y. */
export function dishModel(diameter: number, mats = M()): THREE.Group {
  const g = new THREE.Group();
  const r = diameter / 2;
  const f = diameter * 0.42;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * r;
    pts.push(new THREE.Vector2(x, (x * x) / (4 * f)));
  }
  const inner = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mats.thermalWhite);
  (inner.material as THREE.Material).side = THREE.DoubleSide;
  g.add(inner);
  // rim
  const rim = torus(r, Math.max(0.012, diameter * 0.008), mats.thermalWhite, 8, 64);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = (r * r) / (4 * f);
  g.add(rim);
  // back ribs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = box(0.02, diameter * 0.05, r * 0.95, mats.paintGrey);
    rib.position.set(Math.sin(a) * r * 0.48, (r * r * 0.25) / (4 * f) - diameter * 0.03, Math.cos(a) * r * 0.48);
    rib.rotation.y = a;
    rib.rotation.x = -Math.atan((r * 0.5) / (2 * f)) * Math.cos(0);
    g.add(rib);
  }
  const hub = cyl(r * 0.18, r * 0.22, diameter * 0.08, mats.paintGrey, 24);
  hub.position.y = -diameter * 0.03;
  g.add(hub);
  // subreflector/feed + 3 struts
  const feed = cyl(r * 0.06, r * 0.09, f * 0.25, mats.thermalWhite, 16);
  feed.position.y = f * 0.86;
  g.add(feed);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = v3(Math.cos(a) * r * 0.78, (r * 0.78) ** 2 / (4 * f), Math.sin(a) * r * 0.78);
    g.add(rod(p, v3(0, f * 0.75, 0), Math.max(0.006, diameter * 0.006), mats.paintGrey, 6));
  }
  return shade(g);
}
