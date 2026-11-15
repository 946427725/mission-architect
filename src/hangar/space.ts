// The mission after liftoff, shown for real: climbing out of the atmosphere,
// fairing and spacecraft separation, the long cruise, and the arrival: Mars
// entry / parachute / landing, Jupiter orbit insertion, or the Pluto flyby.
// Driven by the FlightPlayer timeline and the simulated events.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LANDINGS, POWER } from '../data/parts';
import { rocketById } from '../data/rockets';
import { SimEvent, SimResult } from '../game/simulate';
import { Design, missionOf } from '../game/state';
import { BODIES, BodyId, MU_SUN } from '../physics/constants';
import { orbitPath, planetState } from '../physics/ephemeris';
import { propagate } from '../physics/kepler';
import { planetHiRes } from '../scene/textures';
import { sound } from '../ui/sound';
import { buildRealCraft, setPartVisible } from './craft';
import { M, at, cyl, shade } from './kit';
import { buildRocket } from './rockets3d';
import { glow, puffTexture, rng } from './tex';

type ShotId = 'ascent' | 'cruise' | 'flyby' | 'mars' | 'jupiter' | 'pluto' | 'surface' | 'orbit' | 'depart' | 'lost';
interface Shot {
  id: ShotId;
  t: number;
  dur: number;
  blocking: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SUN_DIR = new THREE.Vector3(-0.55, 0.25, -0.8).normalize();
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** Mars turned so the camera sees mid-latitudes, not the polar ice cap. */
const MARS_TILT = Math.PI / 2 - 0.2;
/** Low afternoon Sun over the landing site, behind the descent camera. */
const MARS_SUN = new THREE.Vector3(0.6, 0.42, 0.68).normalize();
/** Where the three bridle cables attach on the rover deck (x, z). */
const CABLE_PTS: [number, number][] = [[-0.6, -0.6], [0.6, -0.6], [0, 0.7]];

// ------------------------------------------------------------------ small building blocks
const atmoVS = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const atmoFS = /* glsl */ `
uniform vec3 color; uniform vec3 sunDir; uniform float power; uniform float strength;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - max(dot(vN, vV), 0.0), power);
  float lit = smoothstep(-0.35, 0.45, dot(vN, sunDir));
  gl_FragColor = vec4(color * f * strength * lit, f * lit);
}`;

function atmosphere(radius: number, color: number, sunDir: THREE.Vector3, power = 3, strength = 1.6) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.ShaderMaterial({ vertexShader: atmoVS, fragmentShader: atmoFS, uniforms: { color: { value: new THREE.Color(color) }, sunDir: { value: sunDir }, power: { value: power }, strength: { value: strength } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

function planet(id: BodyId, radius: number, sunDir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: planetHiRes(id, id === 'jupiter' || id === 'earth' ? 1024 : 768), roughness: 1, metalness: 0 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat));
  const atm: Partial<Record<BodyId, [number, number, number]>> = { earth: [0x5aa8ff, 1.035, 1.9], mars: [0xe0a080, 1.02, 0.9], jupiter: [0xd8c8a8, 1.015, 0.6], pluto: [0x6fa8ff, 1.06, 1.4] };
  const a = atm[id];
  if (a) g.add(atmosphere(radius * a[1], a[0], sunDir, 3.2, a[2]));
  if (id === 'earth') {
    // a thin cloud deck
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const x = c.getContext('2d')!;
    const r = rng(17);
    // cloud bands sit at the equator and the stormy mid-latitudes
    const lat = () => {
      const b = [0.5, 0.3, 0.7, 0.18, 0.82][Math.floor(r() * 5)];
      return (b + (r() - 0.5) * 0.16) * 512;
    };
    x.filter = 'blur(6px)';
    for (let i = 0; i < 240; i++) {
      x.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.07})`;
      x.beginPath();
      x.ellipse(r() * 1024, lat(), 18 + r() * 80, 4 + r() * 12, (r() - 0.5) * 0.4, 0, Math.PI * 2);
      x.fill();
    }
    x.filter = 'blur(1.5px)';
    for (let i = 0; i < 380; i++) {
      x.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.08})`;
      x.beginPath();
      x.ellipse(r() * 1024, lat(), 3 + r() * 16, 1 + r() * 3, (r() - 0.5) * 0.6, 0, Math.PI * 2);
      x.fill();
    }
    x.filter = 'none';
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.008, 64, 48), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 1 })));
  }
  return g;
}

function plumeTexture(hot: string, cold: string, core = 'rgba(255,255,255,1)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, core);
  g.addColorStop(0.15, hot);
  g.addColorStop(0.6, cold);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An engine plume pointing down -Y from its origin. */
function plume(radius: number, length: number, hot = 'rgba(255,220,150,0.95)', cold = 'rgba(255,120,40,0.35)', core?: string): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius * 0.6, radius * 1.8, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: plumeTexture(hot, cold, core), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  m.visible = false;
  return m;
}

/** Simple soft particle system (puffs of plasma, dust, gas). */
class Puffs {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private next = 0;
  constructor(private n: number, additive: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, scale: { value: 600 }, opacity: { value: 1 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform float opacity; varying float vA; varying vec3 vC; void main(){ float a = texture2D(map, gl_PointCoord).a * vA * opacity; if (a < 0.004) discard; gl_FragColor = vec4(vC, a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, color: THREE.Color) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0.0001;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col.set([color.r, color.g, color.b], i * 3);
  }
  clear() {
    this.age.fill(0);
    this.alpha.fill(0);
  }
  set opacity(v: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.opacity.value = v;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) {
        this.age[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = Math.min(1, k * 8) * (1 - k);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

function centered(o: THREE.Object3D): { group: THREE.Group; radius: number; size: THREE.Vector3 } {
  const bb = new THREE.Box3().setFromObject(o);
  const c = bb.getCenter(new THREE.Vector3());
  o.position.sub(c);
  const g = new THREE.Group();
  g.add(o);
  const size = bb.getSize(new THREE.Vector3());
  return { group: g, radius: Math.max(0.5, size.length() / 2), size };
}

/** Glowing plasma trail streaming up behind the heat shield during entry (soft, camera-facing). */
function entryWake(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  const img = x.createImageData(64, 256);
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 64; i++) {
      const u = Math.abs(i / 63 - 0.5) * 2; // 0 centre .. 1 edge
      const v = 1 - j / 255; // 1 at the bottom (shield) .. 0 at the top
      const w = Math.max(0, 1 - u * (0.55 + (1 - v) * 0.45)); // widens upward
      const a = Math.pow(w, 2.2) * Math.pow(v, 1.6);
      const k = (j * 64 + i) * 4;
      img.data[k] = 255;
      img.data[k + 1] = Math.round(110 + 90 * v);
      img.data[k + 2] = Math.round(40 + 40 * v);
      img.data[k + 3] = Math.round(a * 255);
    }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sp.center.set(0.5, 0.04); // grows upward from the shield
  sp.scale.set(5.2, 11, 1);
  sp.visible = false;
  return sp;
}

/** Mars entry capsule: heat shield + back shell (+ optional cruise stage ring). */
function capsule(scale: number, withCruise: boolean): { group: THREE.Group; shield: THREE.Object3D; cruise: THREE.Object3D | null; shell: THREE.Object3D } {
  const m = M();
  const g = new THREE.Group();
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.85 });
  const shield = cyl(0.35, 2.25, 0.55, shieldMat, 48);
  shield.position.y = -0.3;
  g.add(shield);
  const shell = new THREE.Group();
  shell.add(at(cyl(1.0, 2.2, 1.6, m.thermalWhite, 48), 0, 0.8, 0));
  shell.add(at(cyl(0.55, 1.0, 0.55, m.thermalWhite, 32), 0, 1.85, 0));
  shell.add(at(cyl(0.5, 0.5, 0.06, m.paintGrey, 32), 0, 2.15, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    shell.add(at(cyl(0.05, 0.08, 0.12, m.darkMetal, 10), Math.cos(a) * 1.55, 0.6, Math.sin(a) * 1.55));
  }
  g.add(shell);
  let cruise: THREE.Object3D | null = null;
  if (withCruise) {
    const c = new THREE.Group();
    c.add(at(cyl(2.1, 2.1, 0.35, m.mliSilver, 48), 0, 0, 0));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 2.05, 48), m.solar);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.18;
    c.add(ring);
    c.add(at(cyl(0.12, 0.12, 0.7, m.thermalWhite, 12), 0, 0.5, 0));
    c.position.y = 2.35;
    g.add(c);
    cruise = c;
  }
  g.scale.setScalar(scale);
  shade(g, false, false);
  return { group: g, shield, cruise, shell };
}

/** Spirit/Opportunity-style airbag ball: lobes all round the folded lander. */
function airbagBall(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  const n = 26;
  const geo = new THREE.SphereGeometry(0.62, 20, 14);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const lobe = new THREE.Mesh(geo, m.airbag);
    lobe.position.set(Math.cos(a) * r * 1.15, y * 1.15, Math.sin(a) * r * 1.15);
    lobe.scale.setScalar(0.9 + ((i * 7) % 5) * 0.04);
    g.add(lobe);
  }
  shade(g, true, false);
  return g;
}

function parachute(): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 32; i++) {
    x.fillStyle = i % 4 === 0 ? '#c8432b' : i % 2 ? '#f2efe8' : '#e8e2d6';
    x.fillRect(i * 16, 0, 16, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2) * 0.9;
    pts.push(new THREE.Vector2(Math.sin(a) * 7.5, Math.cos(a) * 3.6));
  }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(pts.reverse(), 48), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
  dome.position.y = 14;
  g.add(dome);
  const lines: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lines.push(Math.cos(a) * 7.1, 14 + 1.1, Math.sin(a) * 7.1, 0, 0, 0);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xbfb8aa, transparent: true, opacity: 0.6 })));
  return g;
}

/** Martian ground: rolling terrain, rocks, dusty sky. */
function marsGround(): { group: THREE.Group; height: (x: number, z: number) => number } {
  const g = new THREE.Group();
  const r = rng(5);
  const bumps = Array.from({ length: 40 }, () => [(r() - 0.5) * 900, (r() - 0.5) * 900, 20 + r() * 120, (r() - 0.5) * 18] as const);
  const height = (x: number, z: number) => {
    let h = 0;
    for (const [bx, bz, br, bh] of bumps) h += bh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (br * br));
    h += Math.sin(x * 0.03) * Math.cos(z * 0.025) * 1.5 + Math.sin(x * 0.11 + z * 0.07) * 0.35;
    // a flat landing ellipse at the origin (like Jezero's landing zone)
    return h * clamp01((Math.hypot(x, z) - 25) / 60);
  };
  const geo = new THREE.PlaneGeometry(1200, 1200, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const h = height(x, z);
    p.setY(i, h);
    const k = 0.75 + r() * 0.12 + h * 0.01;
    cols.set([0.62 * k, 0.36 * k, 0.24 * k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  g.add(ground);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.95, flatShading: true }), 700);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 700; i++) {
    const rad = 6 + r() * 260;
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    let s = 0.08 + r() ** 3 * 1.2;
    if (rad < 45 && s > 0.3) s *= 0.25;
    mtx.compose(V(x, height(x, z) + s * 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), V(s * (0.8 + r() * 0.6), s * (0.5 + r() * 0.4), s));
    rocks.setMatrixAt(i, mtx);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  g.add(rocks);
  return { group: g, height };
}

function skyDome(top: number, horizon: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float t = smoothstep(-0.05, 0.6, vP.y); gl_FragColor = vec4(mix(hor, top, t), 1.0); }',
    }),
  );
}

// ------------------------------------------------------------------ the cinema
export interface Telemetry {
  day: number;
  earthKm: number;
  delay: string;
  sciFrac: number;
  power: number;
}

export class SpaceCinema {
  active = false;
  speed = 1;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.05, 30000);
  private composer: EffectComposer;
  private sunDir = SUN_DIR.clone();
  private sun: THREE.DirectionalLight;
  private sunSprite: THREE.Sprite;
  private stars: THREE.Points;
  private world = new THREE.Group(); // per-mission objects
  private d!: Design;
  private sim!: SimResult;
  private shot: Shot = { id: 'cruise', t: 0, dur: 0, blocking: false };
  private ui: HTMLElement;
  private map!: HTMLCanvasElement;
  private puffs = new Puffs(900, true);
  private dust = new Puffs(700, false);
  private craft!: THREE.Group;
  private craftR = 3;
  /** radius of the spacecraft folded inside the fairing */
  private stowR = 3;
  private fairRad = 2.2;
  private solar = false;
  private cap: ReturnType<typeof capsule> | null = null;
  private rocket: THREE.Group | null = null;
  private upper = new THREE.Group();
  private fairL = new THREE.Group();
  private fairR = new THREE.Group();
  private earth: THREE.Group | null = null;
  private target: THREE.Group | null = null;
  private jupiter: THREE.Group | null = null;
  private moon: THREE.Group | null = null;
  private ground: ReturnType<typeof marsGround> | null = null;
  private sky: THREE.Mesh | null = null;
  private chute: THREE.Group | null = null;
  private lander: THREE.Group | null = null;
  private plumes: THREE.Mesh[] = [];
  private mainPlume!: THREE.Mesh;
  private warn = 0;
  private storm = 0;
  private fail = { launch: false, landing: false };
  private prog = 0;
  private jd = 0;
  private tel: Telemetry = { day: 0, earthKm: 0, delay: '', sciFrac: 0, power: 0 };
  private capKey = '';
  private t = 0;
  private envRT: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  // Mars arrival state
  private landed = false;
  private descent: 'chute' | 'powered' | 'crane' | 'away' | 'bounce' = 'chute';
  private stage: THREE.Object3D | null = null; // the landing system part (sky crane / retro legs)
  private cables: THREE.LineSegments | null = null;
  private wake: THREE.Sprite | null = null;
  private heatGlow: THREE.Sprite | null = null;
  private hotRim: THREE.Mesh | null = null;
  private dustAcc = 0;
  private plasmaAcc = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const sc = this.scene;
    sc.background = new THREE.Color(0x000000);
    const pm = new THREE.PMREMGenerator(renderer);
    this.envRT = pm.fromScene(new RoomEnvironment(), 0.04);
    sc.environment = this.envRT.texture;
    sc.environmentIntensity = 0.22;
    this.sun = new THREE.DirectionalLight(0xfff4e6, 3.4);
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    sc.add(this.sun, this.sun.target);
    sc.add(new THREE.AmbientLight(0x8090b0, 0.08));
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow('rgba(255,250,235,1)', 'rgba(255,200,120,0)'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(12000);
    this.sunSprite.scale.setScalar(900);
    sc.add(this.sunSprite);
    // stars, denser along a Milky Way band
    const n = 9000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const r = rng(99);
    const band = V(0.3, 0.9, 0.3).normalize();
    for (let i = 0; i < n; i++) {
      let v: THREE.Vector3;
      do {
        v = V(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
      v.normalize();
      if (r() < 0.45) v.sub(band.clone().multiplyScalar(v.dot(band) * (0.85 + r() * 0.15))).normalize();
      pos.set([v.x * 15000, v.y * 15000, v.z * 15000], i * 3);
      const k = 0.35 + r() * 0.65;
      const tint = r();
      col.set(tint < 0.15 ? [k, k * 0.85, k * 0.7] : tint < 0.3 ? [k * 0.8, k * 0.88, k] : [k, k, k], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    sc.add(this.stars);
    sc.add(this.world);
    sc.add(this.puffs.points, this.dust.points);

    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(sc, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.dust.opacity = 0.38;

    this.ui = document.createElement('div');
    this.ui.className = 'sc-ui';
    this.ui.innerHTML = `<div class="sc-cap"><span class="sc-phase"></span><b></b><p></p></div><canvas class="sc-map" width="440" height="440"></canvas><div class="sc-credit">Planet images: NASA Blue Marble · NASA Viking (USGS) · NASA/JPL/SSI Cassini · NASA/JHUAPL/SwRI New Horizons</div>`;
    document.body.appendChild(this.ui);
    this.map = this.ui.querySelector('.sc-map') as HTMLCanvasElement;
  }

  resize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Follow the high bay's adaptive quality tier (0 = best). */
  setQuality(tier: number) {
    const samples = tier >= 3 ? 0 : tier >= 2 ? 2 : 4;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2])
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    this.bloom.enabled = tier < 3;
  }

  /** Is a sequence playing that the mission clock should wait for? */
  blocking(): boolean {
    return this.active && this.shot.blocking && this.shot.t < this.shot.dur;
  }

  // ---------------------------------------------------------------- set-up
  start(d: Design, sim: SimResult) {
    this.d = d;
    this.sim = sim;
    this.world.clear();
    this.puffs.clear();
    this.dust.clear();
    this.plumes = [];
    this.earth = this.target = this.jupiter = this.moon = null;
    this.ground = null;
    this.sky = null;
    this.chute = null;
    this.lander = null;
    this.storm = 0;
    this.warn = 0;
    this.t = 0;
    this.landed = false;
    this.descent = 'chute';
    this.stage = null;
    this.cables = null;
    this.dustAcc = this.plasmaAcc = 0;
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x000000);
    this.stars.visible = true;
    this.sunSprite.visible = true;
    this.sunDir.copy(SUN_DIR);
    this.scene.environmentIntensity = 0.22;
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(12000);
    this.sunSprite.scale.setScalar(900);
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = false;
    const m = missionOf(d);
    this.fail.launch = sim.events.some((e) => e.title === 'Launch failure');
    this.fail.landing = sim.events.some((e) => e.title === 'Landing failure');

    // the spacecraft as it flies: landers ride inside an entry capsule with a cruise stage
    let bottom = 0;
    this.wake = null;
    this.heatGlow = null;
    this.hotRim = null;
    if (m.type === 'lander') {
      const land = d.landingId ?? 'skycrane';
      const s = land === 'airbags' ? 0.62 : land === 'retro' ? 0.8 : 1;
      this.cap = capsule(s, true);
      const c = centered(this.cap.group);
      this.craft = c.group;
      this.craftR = this.stowR = c.radius;
      this.solar = false;
      bottom = -c.size.y / 2;
      // entry heating: a glow under the heat shield and a plasma sheath behind it
      // (added after centring so they do not change the capsule's bounds)
      this.heatGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow('rgba(255,150,70,1)', 'rgba(255,50,10,0)'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }));
      this.heatGlow.position.y = -0.75;
      this.heatGlow.scale.setScalar(7.5);
      this.heatGlow.visible = false;
      this.wake = entryWake();
      this.wake.position.y = -0.5;
      this.hotRim = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.09, 8, 72), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.hotRim.rotation.x = Math.PI / 2;
      this.hotRim.position.y = -0.56;
      this.hotRim.visible = false;
      this.cap.group.add(this.heatGlow, this.wake, this.hotRim);
    } else {
      this.cap = null;
      const b = buildRealCraft(d);
      this.solar = POWER.find((p) => p.id === d.powerId)?.kind === 'solar';
      const wings: THREE.Object3D[] = [];
      b.model.traverse((o) => {
        if (o.userData.part === 'power') wings.push(o);
      });
      const full = new THREE.Box3().setFromObject(b.model).getSize(V(0, 0, 0)).length() / 2;
      if (this.solar) for (const o of wings) o.scale.setScalar(0.05);
      const c = centered(b.model); // centred on the folded spacecraft
      for (const o of wings) o.scale.setScalar(1);
      this.craft = c.group;
      this.stowR = c.radius;
      this.craftR = Math.max(c.radius, full);
      bottom = -c.size.y / 2;
    }
    shade(this.craft, false, false);
    this.mainPlume = plume(0.25 * Math.max(1, this.stowR / 3), 6 * Math.max(1, this.stowR / 4), 'rgba(200,215,255,0.5)', 'rgba(120,150,255,0.12)', 'rgba(255,245,225,0.85)');
    this.mainPlume.position.y = bottom + 0.1; // at the engine end
    this.craft.add(this.mainPlume);
    this.world.add(this.craft);

    // Earth for the ascent and the departure
    this.earth = planet('earth', 2000, this.sunDir);
    this.world.add(this.earth);
    // rocket upper stage and fairing (shown during the ascent)
    this.buildUpperStage();
    this.rocket = buildRocket(d.rocketId);
    this.world.add(this.rocket);

    this.play('ascent', 15, true);
    this.ui.classList.add('show');
    this.active = true;
    sound.rumble(true);
  }

  private buildUpperStage() {
    const m = M();
    for (const o of [this.upper, this.fairL, this.fairR]) {
      o.clear();
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.userData = {};
    }
    const R = Math.max(2.2, this.stowR * 0.85);
    this.fairRad = R;
    this.upper.add(at(cyl(1.55, 1.55, 9, m.mliSilver, 32), 0, -4.5 - R, 0));
    this.upper.add(at(cyl(0.5, 1.15, 1.6, m.darkMetal, 24, true), 0, -9.8 - R, 0));
    const p = plume(0.9, 16, 'rgba(255,240,220,0.9)', 'rgba(140,170,255,0.25)');
    p.position.y = -10.4 - R;
    this.upper.add(p);
    this.plumes.push(p);
    const half = (sign: number) => {
      const pts: THREE.Vector2[] = [];
      const H = R * 2.6;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push(new THREE.Vector2(R * (t < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2))), -R + t * H));
      }
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 32, sign > 0 ? 0 : Math.PI, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5, side: THREE.DoubleSide }));
      return mesh;
    };
    this.fairL.add(half(1));
    this.fairR.add(half(-1));
    this.world.add(this.upper, this.fairL, this.fairR);
  }

  private play(id: ShotId, dur: number, blocking: boolean) {
    this.shot = { id, t: 0, dur, blocking };
    this.capKey = '';
    this.enterShot(id);
  }

  private enterShot(id: ShotId) {
    const m = missionOf(this.d);
    if (id === 'cruise') {
      sound.rumble(false);
      if (this.rocket) this.rocket.visible = false;
      this.upper.visible = this.fairL.visible = this.fairR.visible = false;
      this.craft.position.set(0, 0, 0);
      this.craft.visible = true;
      if (this.earth) this.earth.visible = true;
      if (!this.target) {
        this.target = planet(m.target, m.target === 'jupiter' ? 600 : m.target === 'pluto' ? 120 : 300, this.sunDir);
        this.world.add(this.target);
      }
    } else if (id === 'surface') {
      // the dust of the landing settles; the descent stage is long gone
      this.dust.clear();
      if (this.cables) this.cables.visible = false;
      if (this.stage) this.stage.visible = false;
      for (const p of this.plumes) p.visible = false;
    }
  }

  // ---------------------------------------------------------------- events from the mission clock
  onEvent(ev: SimEvent) {
    if (!this.active) return;
    const m = missionOf(this.d);
    const t = ev.title;
    if (t === 'Jupiter gravity assist') this.play('flyby', 8, true);
    else if (t === 'Seven minutes of terror') this.startMars();
    else if (t === 'Orbit insertion burn') this.startJupiter();
    else if (t === 'Closest approach') this.startPluto();
    else if (t === 'Trajectory correction 1' || t.startsWith('Main engine')) this.puffBurst();
    else if (/Safe mode|Computer reset|Reaction wheel/.test(t)) this.warn = 4;
    else if (t === 'Global dust storm') this.storm = 1;
    else if (t === 'Radiation ends the mission early') this.warn = 6;
    else if (t === 'Spacecraft lost') {
      this.warn = 3;
      sound.alarm();
      this.play('lost', 9999, false);
    }
    void m;
  }

  /** A Mission Control decision re-flew the mission: the landing (or loss) may change. */
  updateSim(sim: SimResult) {
    this.sim = sim;
    this.fail.landing = sim.events.some((e) => e.title === 'Landing failure');
  }

  setProgress(jd: number, cruiseFrac: number, tel: Telemetry) {
    this.jd = jd;
    this.prog = cruiseFrac;
    this.tel = tel;
  }

  private puffBurst() {
    for (let i = 0; i < 18; i++) {
      const dir = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.puffs.emit(this.craft.position.clone().add(dir.clone().multiplyScalar(this.craftR * 0.5)), dir.multiplyScalar(3 + Math.random() * 4), 0.7, 0.05, 0.45, new THREE.Color(0.55, 0.6, 0.7));
    }
    sound.whoosh();
  }

  private startMars() {
    const land = this.d.landingId ?? 'skycrane';
    // entry 7.2 s + parachute 3.6 s + landing system (touchdown, then a short pause)
    this.play('mars', land === 'airbags' ? 20.5 : land === 'retro' ? 20 : 21, true);
    if (this.target) this.target.visible = true;
  }

  private startJupiter() {
    this.play('jupiter', 13, true);
  }

  private startPluto() {
    this.play('pluto', 13, true);
    if (!this.moon) {
      this.moon = planet('mercury', 60, this.sunDir);
      this.world.add(this.moon);
    }
  }

  stop() {
    this.active = false;
    this.ui.classList.remove('show');
    sound.rumble(false);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt0: number) {
    if (!this.active) return;
    const dt = dt0 * this.speed;
    this.t += dt;
    const s = this.shot;
    s.t += dt;
    const k = clamp01(s.t / s.dur);
    switch (s.id) {
      case 'ascent':
        this.shotAscent(s.t);
        break;
      case 'cruise':
        this.shotCruise(dt);
        break;
      case 'flyby':
        this.shotFlyby(k);
        break;
      case 'mars':
        this.shotMars(s.t, dt);
        break;
      case 'jupiter':
        this.shotJupiter(s.t);
        break;
      case 'pluto':
        this.shotPluto(s.t);
        break;
      case 'surface':
        this.shotSurface(dt);
        break;
      case 'orbit':
        this.shotOrbit(dt);
        break;
      case 'depart':
        this.shotDepart(dt);
        break;
      case 'lost':
        this.shotLost(dt);
        break;
    }
    // shot hand-offs once a blocking sequence ends
    if (s.blocking && s.t >= s.dur) {
      if (s.id === 'ascent') this.play(this.fail.launch ? 'lost' : 'cruise', 9999, false);
      else if (s.id === 'flyby') this.play('cruise', 9999, false);
      else if (s.id === 'mars') this.play(this.fail.landing ? 'lost' : 'surface', 9999, false);
      else if (s.id === 'jupiter') this.play('orbit', 9999, false);
      else if (s.id === 'pluto') this.play('depart', 9999, false);
    }
    // warning light / tumble for faults
    if (this.warn > 0) {
      this.warn -= dt;
      this.craft.rotation.z += Math.sin(this.t * 3) * 0.004;
    }
    this.puffs.update(dt);
    this.dust.update(dt);
    this.updateCaption();
    if (Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this.drawMap();
    this.bloom.strength = this.scene.fog ? 0.3 : 0.7;
    this.sun.intensity = this.scene.fog ? 3.4 : 2.6;
    this.composer.render(dt0);
  }

  // ------------------------------------------------ ascent: climb, fairing, separation, departure
  private shotAscent(t: number) {
    const cam = this.camera;
    const rocket = this.rocket!;
    const earth = this.earth!;
    const R = Math.max(1.6, this.stowR);
    if (t < 4.2) {
      // climbing through the atmosphere: sky darkens from blue to black
      const k = t / 4.2;
      this.scene.background = new THREE.Color().setRGB(0.18 * (1 - k) + 0.0, 0.36 * (1 - k), 0.62 * (1 - k) + 0.02);
      this.stars.visible = k > 0.88;
      earth.visible = false;
      rocket.visible = true;
      this.craft.visible = false;
      this.upper.visible = this.fairL.visible = this.fairR.visible = false;
      rocket.position.set(0, t * t * 6, 0);
      const H = (rocket.userData.height as number) ?? 60;
      // wide enough to see the whole vehicle and its exhaust
      cam.position.set(H * 0.6, rocket.position.y + H * 0.1, H * 0.82);
      cam.lookAt(0, rocket.position.y + H * 0.3, 0);
      cam.fov = 52;
      if (!rocket.userData.plume) {
        const p = plume(2.2, 40);
        p.visible = true;
        rocket.add(p);
        rocket.userData.plume = p;
      }
      (rocket.userData.plume as THREE.Mesh).scale.set(1 + Math.sin(t * 40) * 0.04, 1 + k * 0.8, 1 + Math.sin(t * 40) * 0.04);
    } else {
      // above the atmosphere: Earth below, fairing opens, spacecraft separates
      const tt = t - 4.2;
      rocket.visible = false;
      this.scene.background = new THREE.Color(0x000000);
      this.stars.visible = true;
      earth.visible = true;
      earth.position.set(0, -2000 - 420, -300);
      earth.rotation.set(Math.PI / 2 - 0.35, earth.rotation.y + 0.0004, 0.3);
      this.upper.visible = true;
      this.fairL.visible = this.fairR.visible = true;
      this.craft.visible = true;
      this.plumes[0].visible = tt < 3.5 && !this.fail.launch;
      if (this.fail.launch) {
        // upper stage failure: the stack tumbles, the signal drops
        this.upper.rotation.z = tt * 0.6;
        this.craft.rotation.z = tt * 0.6;
        this.fairL.rotation.z = this.fairR.rotation.z = tt * 0.6;
        if (tt > 2.4 && this.warn <= 0) {
          this.warn = 3;
          sound.alarm();
        }
      } else {
        const fk = ease(seg(tt, 1.6, 4.6));
        const F = this.fairRad;
        this.fairL.position.set(-fk * F * 3.2, -fk * F * 0.8, -fk * F * 2.2);
        this.fairR.position.set(fk * F * 3.2, -fk * F * 0.8, -fk * F * 2.2);
        this.fairL.rotation.z = fk * 0.9;
        this.fairR.rotation.z = -fk * 0.9;
        if (tt > 1.6 && !this.upper.userData.fairingSound) {
          this.upper.userData.fairingSound = true;
          sound.clunk();
        }
        const sk = ease(seg(tt, 5.2, 10.8));
        this.craft.position.set(0, sk * R * 5, 0);
        this.upper.position.y = -sk * R * 1.2;
        if (tt > 5.2 && !this.upper.userData.sepSound) {
          this.upper.userData.sepSound = true;
          sound.clunk();
          this.puffBurst();
        }
        // solar arrays unfold after separation
        const dep = ease(seg(tt, 7, 10));
        if (this.solar)
          this.craft.traverse((o) => {
            if (o.userData.part === 'power') o.scale.setScalar(0.05 + dep * 0.95);
          });
        if (this.cap?.cruise) this.cap.cruise.scale.setScalar(1);
      }
      const orbit = tt * 0.06;
      const sepK = ease(seg(tt, 5.2, 11));
      const unfold = this.solar ? ease(seg(tt, 7, 10)) : 0;
      const dist = Math.max(R * 6.5, this.fairRad * 6.5) + sepK * R * 3 + unfold * Math.max(0, this.craftR - R) * 1.6;
      const focus = this.craft.position.clone().multiplyScalar(0.25 + sepK * 0.6);
      cam.position.set(Math.sin(0.6 + orbit) * dist, focus.y + R * 0.6, Math.cos(0.6 + orbit) * dist);
      cam.lookAt(focus.x, focus.y - R * (1.4 - sepK * 0.9), focus.z);
      if (this.fail.launch) {
        const d2 = this.fairRad * 13;
        cam.position.set(Math.sin(0.6 + orbit) * d2, this.fairRad * 2.5, Math.cos(0.6 + orbit) * d2);
        cam.lookAt(0, -this.fairRad * 2, 0);
      }
      cam.fov = 42;
    }
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------ cruise: deep space, Earth shrinking, target growing
  private shotCruise(dt: number) {
    const cam = this.camera;
    const m = missionOf(this.d);
    this.scene.background = new THREE.Color(0x000000);
    this.stars.visible = true;
    this.craft.position.set(0, 0, 0);
    this.craft.visible = true;
    this.craft.rotation.y += dt * (m.target === 'jupiter' ? 0.2 : 0.03);
    this.mainPlume.visible = false;
    if (this.jupiter) this.jupiter.visible = false;
    const p = this.prog;
    // Earth falls behind, the target grows ahead
    if (this.earth) {
      const dE = 6500 + p * 30000;
      this.earth.position.copy(V(0.2, -0.15, 1).normalize().multiplyScalar(dE));
      this.earth.visible = p < 0.35;
    }
    if (this.target) {
      const rT = m.target === 'jupiter' ? 600 : m.target === 'pluto' ? 120 : 300;
      const ang = 0.004 + p * p * 0.07; // apparent radius in radians
      const dist = rT / Math.tan(ang);
      this.target.position.copy(V(-0.15, 0.05, -1).normalize().multiplyScalar(Math.min(25000, dist)));
      this.target.visible = true;
      this.target.rotation.y += dt * 0.02;
    }
    const R = this.craftR;
    const sw = Math.sin(this.t * 0.06) * 0.5;
    if (p < 0.12 && this.earth) {
      // looking back at the Earth as it shrinks behind the spacecraft
      cam.position.set(-R * 2.2 + sw * R, R * 1.1, -R * 3.6);
      cam.lookAt(this.earth.position.clone().multiplyScalar(0.0006));
    } else {
      // over the shoulder, toward the target
      cam.position.set(R * 2.4 + sw * R, R * (0.9 + Math.sin(this.t * 0.11) * 0.3), R * 3.8);
      const tp = this.target ? this.target.position.clone().normalize().multiplyScalar(R * 6) : V(0, 0, -R * 6);
      cam.lookAt(tp.x * 0.6, tp.y * 0.6, tp.z * 0.6);
    }
    cam.fov = 45;
    cam.updateProjectionMatrix();
  }

  private shotFlyby(k: number) {
    const cam = this.camera;
    if (this.earth) this.earth.visible = false;
    if (!this.jupiter) {
      this.jupiter = planet('jupiter', 600, this.sunDir);
      this.world.add(this.jupiter);
    }
    this.jupiter.visible = true;
    this.jupiter.position.set(-900 + k * 1800, -200, -1400 + k * 600);
    this.jupiter.rotation.y += 0.002;
    if (this.target) this.target.visible = false;
    this.craft.position.set(0, 0, 0);
    const R = this.craftR;
    cam.position.set(R * 2.5, R * 0.8, R * 3.5);
    cam.lookAt(-R * 2, 0, -R * 6);
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------ Mars: entry, parachute, landing system, touchdown
  private ensureMarsGround() {
    if (this.ground) return;
    this.ground = marsGround();
    this.ground.group.visible = false;
    this.world.add(this.ground.group);
    this.sky = skyDome(0xc8a07a, 0xe6c4a0);
    this.sky.visible = false;
    this.world.add(this.sky);
    // the rover and its landing system, as built in the high bay
    const b = buildRealCraft(this.d);
    this.lander = new THREE.Group();
    this.lander.add(b.model);
    shade(this.lander, true, true);
    b.model.traverse((o) => {
      if (!this.stage && o.userData.part === 'landing') this.stage = o;
    });
    // sky crane bridle: cables from the descent stage down to the rover deck
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CABLE_PTS.length * 6), 3));
    this.cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x2b2724 }));
    this.cables.visible = false;
    this.cables.frustumCulled = false;
    b.model.add(this.cables);
    this.world.add(this.lander);
    this.lander.visible = false;
    this.chute = parachute();
    this.chute.visible = false;
    this.world.add(this.chute);
  }

  /** Sunlight with real shadows near the landing site (low Sun from behind the camera). */
  private marsShadow(on: boolean) {
    const sun = this.sun;
    if (!on) {
      sun.castShadow = false;
      return;
    }
    if (!sun.castShadow) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = c.bottom = -24;
      c.right = c.top = 24;
      c.near = 1;
      c.far = 320;
      c.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.04;
    }
    const p = this.lander?.position ?? V(0, 0, 0);
    sun.target.position.set(p.x, this.ground ? this.ground.height(p.x, p.z) : 0, p.z);
    sun.position.copy(sun.target.position).addScaledVector(MARS_SUN, 150);
    this.renderer.shadowMap.needsUpdate = true;
  }

  private shotMars(t: number, dt: number) {
    this.ensureMarsGround();
    if (this.earth) this.earth.visible = false;
    const cam = this.camera;
    const cap = this.cap!;
    const land = this.d.landingId ?? 'skycrane';
    const mars = this.target!;
    const g = this.ground!;
    const entryOn = t >= 3.5 && t < 7.2;
    if (this.heatGlow) this.heatGlow.visible = entryOn;
    if (this.wake) this.wake.visible = entryOn;
    if (this.hotRim) this.hotRim.visible = entryOn;
    const shieldMat = (cap.shield as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (t < 3.5) {
      // approach: the cruise stage is jettisoned, Mars fills the view
      this.marsShadow(false);
      shieldMat.emissiveIntensity = 0;
      this.scene.background = new THREE.Color(0x000000);
      mars.visible = true;
      mars.position.set(0, -360, -60);
      mars.rotation.x = MARS_TILT;
      mars.rotation.y += dt * 0.01;
      this.craft.position.set(0, 0, 0);
      if (cap.cruise) cap.cruise.position.y = 2.35 + ease(seg(t, 1, 3.5)) * 6;
      cam.position.set(9, 3, 11);
      cam.lookAt(0, -3, 0);
      cam.fov = 45;
    } else if (t < 7.2) {
      // entry: the heat shield glows at about 1,300 degrees C, plasma streams behind
      const tt = t - 3.5;
      const heat = Math.pow(Math.sin(Math.PI * clamp01(tt / 3.7)), 0.7);
      if (cap.cruise) cap.cruise.visible = false;
      mars.visible = true;
      mars.position.set(0, -305 + tt * 0.8, 0);
      mars.rotation.x = MARS_TILT;
      this.craft.position.set(0, 0, 0);
      this.craft.rotation.set(-0.42, 0.3, 0.1); // angle of attack: the glowing shield turns toward us
      shieldMat.emissive.setRGB(1, 0.32, 0.08);
      shieldMat.emissiveIntensity = heat * 1.5;
      if (this.hotRim) (this.hotRim.material as THREE.MeshBasicMaterial).opacity = heat * (0.75 + Math.random() * 0.25);
      const flick = 0.88 + Math.random() * 0.24;
      if (this.heatGlow) {
        this.heatGlow.scale.setScalar((3.4 + heat * 2.6) * flick);
        (this.heatGlow.material as THREE.SpriteMaterial).opacity = 0.15 + heat * 0.5;
      }
      if (this.wake) {
        this.wake.scale.set(4.6 + heat * 1.4, (6 + heat * 7) * flick, 1);
        (this.wake.material as THREE.SpriteMaterial).opacity = 0.85 * heat;
      }
      const rim = cap.shield.getWorldPosition(new THREE.Vector3());
      const s = cap.group.scale.x;
      this.plasmaAcc += dt * 320 * heat;
      while (this.plasmaAcc >= 1) {
        this.plasmaAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const rr = 2.25 * s * (0.85 + Math.random() * 0.25);
        this.puffs.emit(rim.clone().add(V(Math.cos(a) * rr, 0.1, Math.sin(a) * rr)), V(Math.cos(a) * 1.6, 12 + Math.random() * 10, Math.sin(a) * 1.6), 0.28, 0.16, 0.55, new THREE.Color(1, 0.3 + Math.random() * 0.2, 0.06));
      }
      this.scene.background = new THREE.Color().setRGB(0.03 + heat * 0.1, 0.012 + heat * 0.035, 0.01);
      const sh = 0.12 * heat;
      cam.position.set(6.5 + (Math.random() - 0.5) * sh, 0.9 + (Math.random() - 0.5) * sh, 7.5);
      cam.lookAt(0, -0.2, 0);
      cam.fov = 48;
    } else {
      // in the sky above the landing site
      const tt = t - 7.2;
      mars.visible = false;
      this.stars.visible = false;
      this.sunSprite.visible = false;
      this.scene.background = new THREE.Color(0xd9b48f);
      this.scene.fog ??= new THREE.Fog(0xd8b08a, 60, 900);
      g.group.visible = true;
      this.sky!.visible = true;
      if (tt < 3.6) {
        // supersonic parachute; the heat shield drops away
        this.descent = 'chute';
        const alt = 160 - tt * 18;
        this.craft.visible = true;
        this.craft.rotation.set(Math.sin(tt * 2) * 0.08, 0, Math.cos(tt * 1.7) * 0.06);
        this.craft.position.set(0, alt, 0);
        cap.shield.position.y = -0.3 - ease(seg(tt, 1.2, 3.6)) * 14;
        shieldMat.emissiveIntensity = Math.max(0, 0.6 - tt * 0.4);
        this.chute!.visible = true;
        this.chute!.position.set(0, alt + 2.2, 0);
        this.chute!.scale.setScalar(0.3 + ease(seg(tt, 0, 0.6)) * 0.7);
        if (!this.chute!.userData.pop) {
          this.chute!.userData.pop = true;
          sound.clunk();
        }
        cam.position.set(16, alt - 4, 24);
        cam.lookAt(0, alt + 4, 0);
        cam.fov = 50;
      } else if (land === 'airbags') this.airbagLanding(tt - 3.6, dt);
      else this.poweredDescent(tt - 3.6, dt, land === 'skycrane');
      this.marsShadow(true);
    }
    cam.updateProjectionMatrix();
  }

  /** Airbags: the ball drops from the backshell and bounces across the plain. */
  private airbagLanding(k2: number, dt: number) {
    const g = this.ground!;
    const cam = this.camera;
    const lander = this.lander!;
    this.descent = 'bounce';
    this.craft.visible = false;
    this.chute!.visible = k2 < 0.8;
    if (k2 < 0.8) this.chute!.position.y += 25 * dt;
    if (!lander.userData.bag) {
      const bag = airbagBall();
      lander.clear();
      lander.add(bag);
      lander.userData.bag = true;
    }
    lander.visible = true;
    const bt = Math.max(0, k2 - 0.4);
    const h = k2 < 0.4 ? 40 - k2 * 50 : Math.max(0, 22 * Math.exp(-bt * 0.55) * Math.abs(Math.cos(bt * 2.3)));
    const x = (7 / 0.3) * (1 - Math.exp(-0.3 * bt)); // rolls to a stop
    const gy = g.height(x, 0);
    lander.position.set(x, gy + 1.72 + h, 0);
    if (!lander.userData.crash) lander.rotation.z = -x / 1.77;
    // each impact throws up dust
    if (k2 >= 0.4 && h < 0.5) {
      if (!lander.userData.touch) {
        lander.userData.touch = true;
        const big = 22 * Math.exp(-bt * 0.55);
        this.dustBurst(V(x, gy, 0), Math.round(4 + big * 0.8));
        if (big > 3) sound.clunk();
      }
    } else if (h > 1.2) lander.userData.touch = false;
    if (bt > 7.5 && !this.landed) {
      this.landed = true;
      if (this.fail.landing) this.crash();
      else sound.install();
    }
    if (lander.userData.crash) lander.rotation.z += (-2.2 - lander.rotation.z) * Math.min(1, dt * 0.5);
    const yRel = lander.position.y - gy;
    cam.position.set(x - 9, gy + 2.8 + yRel * 0.4, 15);
    cam.lookAt(x, gy + 1 + yRel * 0.8, 0);
    cam.fov = 50;
  }

  /** Retro rockets, or the sky crane lowering the rover on cables and flying away. */
  private poweredDescent(k2: number, dt: number, sky: boolean) {
    const g = this.ground!;
    const cam = this.camera;
    const lander = this.lander!;
    const stage = this.stage;
    this.craft.visible = false;
    // the backshell and parachute are cut loose and pulled up out of frame
    this.chute!.visible = k2 < 0.8;
    if (k2 < 0.8) this.chute!.position.y += 30 * dt;
    lander.visible = true;
    let alt: number; // rover wheels above the ground
    let cable = 0;
    let away = 0;
    if (sky) {
      if (k2 < 3.6) {
        const x = k2 / 3.6;
        alt = 16 + 54 * (0.85 * (1 - x) ** 2 + 0.15 * (1 - x));
        this.descent = 'powered';
      } else if (k2 < 5.2) {
        alt = 16 - 7 * seg(k2, 3.6, 5.2);
        cable = 6.5 * ease(seg(k2, 3.6, 5.2));
        this.descent = 'crane';
      } else {
        alt = 9 * (1 - seg(k2, 5.2, 7.6)) ** 1.5;
        cable = 6.5;
        this.descent = this.landed ? 'away' : 'crane';
      }
      away = this.fail.landing ? 0 : Math.max(0, k2 - 7.9);
    } else {
      const x = seg(k2, 0, 7.4);
      alt = 70 * (0.8 * (1 - x) ** 2 + 0.2 * (1 - x));
      this.descent = 'powered';
    }
    const gy = g.height(0, 0);
    lander.position.set(0, gy + alt, 0);
    if (stage) {
      stage.position.set(away * away * 3, cable + away * away * 5 + away * 2, 0);
      stage.rotation.z = -Math.min(0.45, away * 0.35);
      stage.visible = away < 5;
    }
    // descent engines
    if (!lander.userData.flames && stage) {
      lander.userData.flames = true;
      const n = sky ? 8 : 12;
      const s = 0.75; // retro lander scale (see buildRover)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (sky ? Math.PI / 8 : 0);
        const p = plume(sky ? 0.12 : 0.09, sky ? 3.0 : 2.4, 'rgba(255,215,170,0.42)', 'rgba(255,150,90,0.1)', 'rgba(255,240,220,0.75)');
        p.visible = true;
        if (sky) {
          p.position.set(Math.cos(a) * 1.95, 2.85, Math.sin(a) * 1.95);
          p.rotation.set(-Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
        } else p.position.set(Math.cos(a) * 1.1 * s, 0.47 * s, Math.sin(a) * 1.1 * s);
        stage.add(p);
        this.plumes.push(p);
      }
      sound.rumble(true);
    }
    for (const p of this.plumes) if (p.visible) p.scale.set(1, 0.85 + Math.random() * 0.3, 1);
    // cables between the hovering stage and the rover
    if (this.cables && stage) {
      const show = sky && cable > 0.05 && away === 0;
      this.cables.visible = show;
      if (show) {
        const arr = this.cables.geometry.attributes.position as THREE.BufferAttribute;
        CABLE_PTS.forEach(([x, z], i) => {
          arr.setXYZ(i * 2, x, 1.45, z);
          arr.setXYZ(i * 2 + 1, x * 1.1 + stage.position.x, 3.2 + stage.position.y, z * 1.1);
        });
        arr.needsUpdate = true;
      }
    }
    // touchdown
    if (alt <= 0.01 && !this.landed) {
      this.landed = true;
      if (!sky) {
        for (const p of this.plumes) p.visible = false;
        sound.rumble(false);
      }
      this.dustBurst(V(0, gy, 0), 16);
      if (this.fail.landing) this.crash();
      else sound.install();
    }
    if (sky && away > 0 && !lander.userData.flyaway) {
      lander.userData.flyaway = true;
      sound.whoosh();
    }
    if (sky && away > 3 && !lander.userData.quiet) {
      lander.userData.quiet = true;
      sound.rumble(false);
    }
    if (lander.userData.crash) {
      lander.rotation.z += (1.05 - lander.rotation.z) * Math.min(1, dt * 2.5);
      lander.position.y += 0.8 * Math.sin(lander.rotation.z);
      for (const p of this.plumes) p.visible = false;
    }
    // engine blast lifts dust as the stage gets close to the ground
    const stageAlt = alt + (sky ? 3.35 + cable + away * away * 5 : 0.5);
    const rate = (sky ? 55 : 70) * clamp01(1 - stageAlt / (sky ? 24 : 20)) * (away > 3 || (!sky && this.landed) ? 0 : 1);
    this.dustAcc += rate * dt;
    while (this.dustAcc >= 1) {
      this.dustAcc -= 1;
      this.dustBurst(V(0, gy + 0.3, 0), 1);
    }
    // camera: level with the descending stack, pulling back as the cables pay out
    const focus = gy + alt + (sky ? (3.35 + cable) * 0.3 + 0.5 : 0.9);
    const dist = sky ? 13 + cable * 0.85 : 11;
    const a = 0.55 + k2 * 0.06;
    cam.position.set(Math.sin(a) * dist, Math.max(gy + 1.4, focus - 0.6), Math.cos(a) * dist);
    cam.lookAt(0, focus, 0);
    cam.fov = 50;
  }

  private crash() {
    const l = this.lander!;
    l.userData.crash = true;
    this.warn = 3;
    sound.rumble(false);
    sound.alarm();
    this.dustBurst(V(l.position.x, l.position.y, 0), 45);
  }

  private dustBurst(at3: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      this.dust.emit(at3.clone().add(V(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)), V(Math.cos(a) * sp, 0.4 + Math.random() * 1.8, Math.sin(a) * sp), 2 + Math.random() * 1.6, 0.9, 4.6, new THREE.Color(0.72, 0.52, 0.38));
    }
  }

  private shotSurface(dt: number) {
    const cam = this.camera;
    const lander = this.lander!;
    lander.visible = true;
    if (lander.userData.bag) {
      // the airbags deflate and retract; the rover drives off the lander
      lander.clear();
      const b = buildRealCraft(this.d);
      setPartVisible(b.model, 'landing', false);
      lander.add(shade(b.model, true, true));
      lander.userData.bag = false;
      lander.rotation.set(0, 0, 0);
    }
    if (this.stage) this.stage.visible = false;
    lander.position.y = this.ground!.height(lander.position.x, 0);
    lander.position.x += dt * 0.25;
    if (this.storm > 0) {
      this.storm = Math.min(1.6, this.storm + dt * 0.4);
      const fog = this.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.set(0xa07858);
        fog.near = 8;
        fog.far = 160 - this.storm * 80;
      }
      this.scene.background = new THREE.Color(0x8a6448);
      if (Math.random() < dt * 20) this.dust.emit(V(lander.position.x - 20 + Math.random() * 10, 0.5 + Math.random() * 3, (Math.random() - 0.5) * 20), V(6 + Math.random() * 4, 0.2, 0), 4, 2, 8, new THREE.Color(0.6, 0.42, 0.3));
    }
    const land = this.d.landingId ?? 'skycrane';
    const sc = land === 'airbags' ? 0.55 : land === 'retro' ? 0.75 : 1;
    const a = this.t * 0.08;
    const r = 3 + 4.2 * sc;
    const gy = lander.position.y;
    cam.position.set(lander.position.x + Math.sin(a) * r, gy + 0.9 + 1.2 * sc, Math.cos(a) * r);
    cam.lookAt(lander.position.x, gy + 0.4 + 0.6 * sc, 0);
    cam.fov = 48;
    this.marsShadow(true);
    cam.updateProjectionMatrix();
  }

  private shotLost(dt: number) {
    if (this.lander?.visible) {
      // the crash site: the dust drifts, nothing moves
      this.marsShadow(true);
      return;
    }
    // lost in space: the stack tumbles as the camera drifts away
    for (const o of [this.craft, this.upper, this.fairL, this.fairR]) o.rotation.z += dt * 0.5;
    this.craft.rotation.x += dt * 0.3;
    this.camera.position.multiplyScalar(1 + dt * 0.03);
    this.camera.lookAt(this.craft.position);
  }

  // ------------------------------------------------ Jupiter: arrival, orbit insertion burn, capture
  private shotJupiter(t: number) {
    const cam = this.camera;
    if (this.earth) this.earth.visible = false;
    const jup = this.target!;
    jup.visible = true;
    jup.rotation.y += 0.001;
    const R = this.craftR;
    this.craft.position.set(0, 0, 0);
    jup.position.set(-500, -350, -900 + Math.min(1, t / 13) * 300);
    this.mainPlume.visible = t > 3.8 && t < 10.5;
    if (this.mainPlume.visible) {
      this.mainPlume.scale.set(1 + Math.sin(t * 50) * 0.05, 1, 1 + Math.sin(t * 50) * 0.05);
      if (!this.mainPlume.userData.snd) {
        this.mainPlume.userData.snd = true;
        sound.rumble(true);
      }
    } else if (this.mainPlume.userData.snd) {
      this.mainPlume.userData.snd = false;
      sound.rumble(false);
    }
    const a = 0.4 + t * 0.05;
    cam.position.set(Math.sin(a) * R * 3.2, R * 0.9, Math.cos(a) * R * 3.2);
    cam.lookAt(-R * 0.6, -R * 0.4, -R * 1.5);
    cam.fov = 50;
    cam.updateProjectionMatrix();
  }

  private shotOrbit(dt: number) {
    const cam = this.camera;
    if (this.earth) this.earth.visible = false;
    const jup = this.target!;
    jup.visible = true;
    jup.position.set(0, -680, 0);
    jup.rotation.x = Math.PI / 2 - 0.35;
    jup.rotation.y += dt * 0.01;
    if (!jup.userData.aurora) {
      jup.userData.aurora = true;
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 6, 10, 96), new THREE.MeshBasicMaterial({ color: 0xa98bff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = s * 588;
        jup.add(ring);
      }
    }
    this.craft.rotation.y += dt * 0.2;
    if (this.warn > 0 && Math.random() < 0.3) this.puffBurst();
    const R = this.craftR;
    const a = this.t * 0.05;
    cam.position.set(Math.sin(a) * R * 3, R * 1.2, Math.cos(a) * R * 3);
    cam.lookAt(0, -R, 0);
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------ Pluto: approach, closest approach, looking back
  private shotPluto(t: number) {
    const cam = this.camera;
    if (this.earth) this.earth.visible = false;
    const pl = this.target!;
    const ch = this.moon!;
    pl.visible = true;
    ch.visible = true;
    const R = this.craftR;
    this.craft.position.set(0, 0, 0);
    const k = t / 13;
    // Pluto grows ahead, then sweeps past on the left (never through the camera)
    pl.position.set(-200 - k * 260, -70, -1700 + k * 1850);
    ch.position.copy(pl.position).add(V(-380, 150, -650));
    pl.rotation.y = -0.8 - (k - 0.7) * 0.35; // Tombaugh Regio (the 'heart') faces us at closest approach
    this.craft.rotation.y = -0.4 + k * 0.8;
    // camera behind the spacecraft, looking past it at Pluto
    const dir = pl.position.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize();
    cam.position.copy(dir).multiplyScalar(-R * 3.6).addScaledVector(side, -R * 1.3).add(V(0, R * 0.8, 0));
    cam.lookAt(dir.multiplyScalar(R * 5));
    cam.fov = 45;
    cam.updateProjectionMatrix();
  }

  private shotDepart(dt: number) {
    // looking back: Pluto's thin blue haze lit from behind by a distant Sun
    const cam = this.camera;
    const pl = this.target!;
    pl.visible = true;
    pl.position.set(0, 0, -900);
    pl.rotation.y += dt * 0.004;
    if (this.moon) this.moon.position.set(380, 60, -1300);
    this.sunDir.set(0.02, 0.0, -1).normalize(); // the atmosphere shader shares this vector
    this.scene.environmentIntensity = 0.03;
    this.sunSprite.scale.setScalar(2600); // the corona peeks round the edge of Pluto
    if (!pl.userData.backlit) {
      pl.userData.backlit = true;
      pl.traverse((o) => {
        const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
        if (u?.strength) {
          u.strength.value = 7;
          u.power.value = 2.2;
        }
      });
    }
    this.sunSprite.position.copy(V(0.02, 0.0, -1).normalize().multiplyScalar(12000));
    this.sun.position.copy(V(0.02, 0.0, -1)).multiplyScalar(100);
    this.craft.position.set(0, 0, 200);
    cam.position.set(0, 10, 260);
    cam.lookAt(0, 0, -900);
    cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- caption + mini map
  private updateCaption() {
    const m = missionOf(this.d);
    const tr = this.d.transfer!;
    const s = this.shot;
    const T = BODIES[m.target].name;
    let phase = '';
    let title = '';
    let sub = '';
    const t = s.t;
    switch (s.id) {
      case 'ascent':
        phase = 'Launch';
        if (t < 2.2) [title, sub] = ['Climbing through the atmosphere', `${rocketById(this.d.rocketId).name} at full thrust. In two minutes it is above 99% of the air.`];
        else if (t < 4.2) [title, sub] = ['Main engine cutoff', 'The first stage falls away. The upper stage lights for the push to escape speed.'];
        else if (this.fail.launch) [title, sub] = ['Upper stage failure', 'The stack starts to tumble. Mission control loses the signal.'];
        else if (t < 9) [title, sub] = ['Fairing separation', 'The nose cone splits in two: the spacecraft sees space for the first time.'];
        else if (t < 12.5) [title, sub] = ['Spacecraft separation', `Springs push it free. ${m.type === 'lander' ? 'The rover is folded inside the heat shield; solar panels on the cruise stage power the trip.' : 'The solar arrays and antennas unfold.'}`];
        else [title, sub] = [`On its way to ${T}`, `Leaving Earth at ${tr.vinfDep.toFixed(1)} km/s faster than escape speed. No engine needed now: it coasts along the orbit you picked.`];
        break;
      case 'cruise':
        phase = 'Cruise';
        title = `Day ${Math.max(0, Math.floor(this.tel.day))} · ${this.tel.earthKm >= 1e9 ? (this.tel.earthKm / 1e9).toFixed(2) + ' billion' : Math.round(this.tel.earthKm / 1e6) + ' million'} km from Earth`;
        sub = `Coasting to ${T}. Radio signals take ${this.tel.delay} each way, so the spacecraft flies on autopilot. Power: ${Math.round(this.tel.power)} W.`;
        if (this.warn > 0) sub = 'Fault detected: the spacecraft enters safe mode, points at the Sun and waits for orders from Earth.';
        break;
      case 'flyby':
        phase = 'Gravity assist';
        [title, sub] = ['Jupiter flyby', `Swinging past the giant planet steals some of its orbital energy: a free boost toward ${T}.`];
        break;
      case 'mars':
        phase = 'Arrival';
        if (t < 3.5) [title, sub] = ['Approaching Mars', 'The cruise stage is let go. Only the capsule enters the atmosphere.'];
        else if (t < 7.2) [title, sub] = [`Atmospheric entry at ${Math.sqrt(tr.vinfArr ** 2 + (2 * BODIES.mars.mu) / (BODIES.mars.radius + 125)).toFixed(1)} km/s`, 'The heat shield glows at about 1,300 °C. Radio is too slow to help: everything is automatic. "Seven minutes of terror."'];
        else if (t < 10.8) [title, sub] = ['Supersonic parachute', 'A 21 m parachute opens at twice the speed of sound. Then the heat shield drops away.'];
        else if (!this.landed) {
          const l = LANDINGS.find((x) => x.id === this.d.landingId) ?? LANDINGS[2];
          if (this.descent === 'crane') [title, sub] = ['Sky crane', 'Hovering 20 m up, the rocket stage lowers the rover on 7 m nylon cables.'];
          else if (l.id === 'skycrane') [title, sub] = ['Powered descent', 'The parachute is cut away. Eight rocket engines brake the rover and its descent stage.'];
          else if (l.id === 'retro') [title, sub] = ['Powered descent', 'Throttled rocket engines slow the lander to walking speed.'];
          else [title, sub] = ['Airbag landing', 'Giant airbags inflate and the lander bounces across the plain until it rolls to a stop.'];
        } else if (this.fail.landing) [title, sub] = ['Signal lost', 'The landing system failed in the last seconds. About 1 in 20 Mars landings like this fail.'];
        else if (this.d.landingId === 'skycrane' || !this.d.landingId) [title, sub] = ['Touchdown confirmed!', 'The cables are cut and the descent stage flies off to crash far away. The rover is safe on Mars.'];
        else [title, sub] = ['Touchdown confirmed!', 'The rover is safe on Mars. Mission control erupts.'];
        break;
      case 'surface':
        phase = 'Science';
        title = this.storm > 0 ? 'Global dust storm' : `Exploring Mars · ${Math.round(this.sim.science * this.tel.sciFrac)} science points so far`;
        sub = this.storm > 0 ? 'Dust blocks the Sun for weeks. Solar rovers can freeze; nuclear power keeps working.' : 'The rover drives, drills and photographs. Data goes home through relay orbiters overhead.';
        break;
      case 'jupiter':
        phase = 'Arrival';
        if (t < 3.8) [title, sub] = ['Arriving at Jupiter', 'Falling toward the biggest planet at over 50 km/s near closest approach.'];
        else if (t < 10.5) [title, sub] = ['Orbit insertion burn', 'The main engine fires against the direction of travel to brake. Miss this burn and the spacecraft flies away for ever.'];
        else [title, sub] = ['Captured into orbit', 'Jupiter now holds the spacecraft. Each orbit dives close over the poles.'];
        break;
      case 'orbit':
        phase = 'Science';
        title = `In orbit · ${Math.round(this.tel.sciFrac * 100)}% of the science returned`;
        sub = this.warn > 0 ? 'Radiation from Jupiter\'s belts hits the electronics on every close pass.' : 'Instruments sweep the cloud tops and auroras on each close pass.';
        break;
      case 'pluto':
        phase = 'Flyby';
        if (t < 5) [title, sub] = ['Approaching Pluto and Charon', 'After years of cruise, Pluto grows from a dot to a world in a few days.'];
        else [title, sub] = ['Closest approach', `Flying past at ${tr.vinfArr.toFixed(1)} km/s. There is no braking: every instrument records in a few frantic hours.`];
        break;
      case 'depart':
        phase = 'Science';
        title = 'Looking back at Pluto';
        sub = `Its thin nitrogen haze glows blue against the Sun. Now the data trickles home, ${Math.round(this.tel.sciFrac * 100)}% received so far.`;
        break;
      case 'lost':
        phase = 'Loss of signal';
        [title, sub] = ['Signal lost', 'Mission control keeps listening, but the spacecraft is silent.'];
        break;
    }
    const key = phase + title + sub;
    if (key === this.capKey) return;
    this.capKey = key;
    (this.ui.querySelector('.sc-phase') as HTMLElement).textContent = phase;
    (this.ui.querySelector('.sc-cap b') as HTMLElement).textContent = title;
    (this.ui.querySelector('.sc-cap p') as HTMLElement).textContent = sub;
    const cap = this.ui.querySelector('.sc-cap') as HTMLElement;
    cap.classList.remove('in');
    void cap.offsetWidth;
    cap.classList.add('in');
  }

  private drawMap() {
    const d = this.d;
    const tr = d.transfer;
    if (!tr) return;
    const m = missionOf(d);
    const ctx = this.map.getContext('2d')!;
    const W = this.map.width;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(8,12,18,0.72)';
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    const bodies: BodyId[] = tr.flyby ? ['earth', 'jupiter', m.target] : ['earth', m.target];
    const jd = Math.min(this.jd || tr.launchJD, tr.arriveJD);
    const maxR = Math.max(...bodies.map((b) => Math.hypot(...(planetState(b, jd).r as [number, number, number]))));
    const k = (W * 0.43) / maxR;
    const P = (r: number[]) => [W / 2 + r[0] * k, W / 2 - r[1] * k];
    ctx.fillStyle = '#ffd36a';
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    for (const b of bodies) {
      ctx.strokeStyle = b === 'earth' ? 'rgba(120,180,255,0.55)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      orbitPath(b, jd, 160).forEach((r, i) => {
        const [x, y] = P(r as unknown as number[]);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      const [x, y] = P(planetState(b, jd).r as unknown as number[]);
      ctx.fillStyle = b === 'earth' ? '#7fb6ff' : b === 'mars' ? '#ff8a5c' : b === 'jupiter' ? '#e3c08f' : '#d8c8b8';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // the path flown so far, and the spacecraft
    ctx.strokeStyle = '#ffc864';
    ctx.lineWidth = 3;
    ctx.beginPath();
    let first = true;
    let craft: number[] | null = null;
    for (const leg of tr.legs) {
      const end = Math.min(jd, leg.arriveJD);
      if (end <= leg.departJD) break;
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const t = ((end - leg.departJD) * 86400 * i) / steps;
        const st = propagate(leg.r1, leg.v1, t, MU_SUN);
        const [x, y] = P(st.r as unknown as number[]);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
        craft = [x, y];
      }
    }
    ctx.stroke();
    if (craft) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(craft[0], craft[1], 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffc864';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(238,243,248,0.85)';
    ctx.font = '600 22px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ROUTE · TOP VIEW', W / 2, W - 26);
  }
}
