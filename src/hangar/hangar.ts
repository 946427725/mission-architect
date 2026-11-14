// The high-bay game: a third-person engineer builds the spacecraft by hand.
// Owns its own WebGL renderer; the App switches between this and the solar
// system view (route planning and flight).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Evaluation, evaluate } from '../game/evaluate';
import { ROLE_INFO } from '../game/simulate';
import { Design, RoleId, missionOf } from '../game/state';
import type { App } from '../ui/app';
import { sound } from '../ui/sound';
import { buildRealCraft, partCenter, setPartVisible } from './craft';
import { CRAFT_POS, Collider, HighBay, INSTALL_SPOT, RING_R, ROOM, SPAWN, buildHighBay } from './env';
import { Engineer } from './engineer';
import { Hud, Label, Task } from './hud';
import { M, at, cyl, rod, shade, v3 } from './kit';
import { PanelCtx, drawScreens, gaugesFor, panelHTML, partName, tasksFor } from './panels';
import { BuiltStation, STATIONS, StationId, buildStation, captureHomes, stationById } from './stations';
import { LaunchPad } from './pad';
import { SpaceCinema } from './space';

type Mode = 'off' | 'attract' | 'play' | 'cinema';
const ROLE_ORDER: RoleId[] = ['flight', 'engineer', 'science', 'ops'];
const FIELD_PART: Record<string, string> = { powerId: 'power', antennaId: 'antenna', shieldId: 'shield', avionicsId: 'avionics', batteryId: 'battery', txId: 'tx', landingId: 'landing' };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const partOf = (key: string) => {
  const [f] = key.split(':');
  return f === 'instr' ? key : FIELD_PART[f];
};
export function isInstalled(d: Design, key: string): boolean {
  const [f, v] = key.split(':');
  if (f === 'instr') return d.instruments.includes(v);
  if (f === 'rocketId') return false;
  return (d as unknown as Record<string, string>)[f] === v;
}
export function applyKey(d: Design, key: string, remove = false): Design {
  const [f, v] = key.split(':');
  const n: Design = { ...d, instruments: [...d.instruments] };
  if (f === 'instr') n.instruments = remove ? n.instruments.filter((x) => x !== v) : n.instruments.includes(v) ? n.instruments : [...n.instruments, v];
  else (n as unknown as Record<string, string>)[f] = v;
  return n;
}
const usesCrane = (key: string) => key.startsWith('landingId:') || key.startsWith('shieldId:') || key === 'powerId:solar-l' || key === 'antennaId:hga30';

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Walker {
  eng: Engineer;
  role: RoleId;
  pos: THREE.Vector3;
  vel: THREE.Vector2;
  name: string;
}

export class Hangar {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.05, 400);
  readonly hud = new Hud();
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private gtao: GTAOPass | null = null;
  private outline: OutlinePass;
  private bloom: UnrealBloomPass;
  private bay: HighBay;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private craftHolder = new THREE.Group();
  private fixture = new THREE.Group();
  private craft: THREE.Group | null = null;
  private craftKey = '';
  private craftSize = 3;
  private craftHeight = 2;
  private stationGroup = new THREE.Group();
  stations: BuiltStation[] = [];
  private missionKey = '';
  private walkers: Walker[] = [];
  active = 0;
  mode: Mode = 'off';
  private colliders: Collider[] = [];
  private keys = new Set<string>();
  private camYaw = 0;
  private camPitch = 0.32;
  private camDist = 6.2;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private focus: { target: THREE.Vector3; yaw: number; dist: number; pitch: number } | null = null;
  private goal: { x: number; z: number; station?: StationId; install?: boolean; path: THREE.Vector2[] } | null = null;
  private goalMarker: THREE.Mesh;
  carrying: string[] = [];
  private carryObjs = new Map<string, THREE.Object3D>();
  private flying = new Set<string>();
  private tweens: Tween[] = [];
  private craneQueue: string[] = [];
  private craneBusy = false;
  openId: StationId | null = null;
  near: StationId | 'install' | null = null;
  private lastEv: Evaluation | null = null;
  private pumping = 0;
  private hovered: THREE.Object3D | null = null;
  private ray = new THREE.Raycaster();
  private pointer = { x: 0, y: 0, downX: 0, downY: 0, down: false, drag: false, t0: 0, button: 0 };
  private lastTime = performance.now();
  private quality: 'high' | 'low';
  private screenTimer = 0;
  private mapTimer = 0;
  private hoverTimer = 0;
  private attractT = 0;
  private hintShown = false;
  private movedOnce = false;
  private pad: LaunchPad | null = null;
  private space: SpaceCinema | null = null;
  private saidIntro = new Set<string>();
  private rocketSpin = 0;
  private visible = true;

  constructor(private host: HTMLElement, private app: App) {
    const q = new URLSearchParams(location.search).get('q');
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.quality = q === 'low' || q === 'high' ? q : coarse || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // shadows are re-rendered only when something moves (see frame())
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      const box = document.createElement("div");
      box.className = "gl-lost";
      box.innerHTML = "<div><b>The graphics card reset.</b><span>This can happen when the GPU is busy or the laptop switched graphics modes.</span><button onclick=\"location.reload()\">Reload the game</button></div>";
      document.body.appendChild(box);
    });
    this.scene.background = new THREE.Color(0xdfe4e9);

    this.bay = buildHighBay(this.quality);
    this.scene.add(this.bay.group);
    this.craftHolder.position.set(CRAFT_POS.x, 0.24, CRAFT_POS.z);
    this.scene.add(this.craftHolder);
    this.scene.add(this.fixture);
    this.scene.add(this.stationGroup);
    this.goalMarker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    this.goalMarker.rotation.x = -Math.PI / 2;
    this.goalMarker.position.y = 0.015;
    this.scene.add(this.goalMarker);

    // post-processing: MSAA scene target -> ambient occlusion -> outline -> bloom -> output
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: this.quality === 'high' ? 4 : 2, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (new URLSearchParams(location.search).get('q') === 'ultra') {
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 2, thickness: 1.2, scale: 1, samples: 16 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    this.outline = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.camera);
    this.outline.edgeStrength = 4;
    this.outline.edgeGlow = 0.6;
    this.outline.edgeThickness = 1.5;
    this.outline.visibleEdgeColor.set('#4cc9ff');
    this.outline.hiddenEdgeColor.set('#1d5a77');
    this.composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.55, 2.4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camYaw = Math.PI;
    this.bindInput();
    this.hud.onUse = () => this.use();
    this.hud.onUseHold = (down) => this.holdUse(down);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const desktop = /Electron/i.test(navigator.userAgent);
    this.minTier = 0;
    // integrated laptop GPUs (Intel UHD/Iris) start one step lower in a browser
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const integrated = /Intel|UHD|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu);
    this.applyTier(desktop ? 0 : this.quality === 'low' || integrated ? 2 : 1);
    this.renderer.setAnimationLoop(() => this.frame());
    document.addEventListener('visibilitychange', () => (this.lastTime = performance.now()));
  }

  // ------------------------------------------------------------ lifecycle
  setMode(mode: Mode) {
    this.mode = mode;
    this.shadowFrames = 3;
    this.visible = mode !== 'off';
    this.host.style.display = this.visible ? '' : 'none';
    this.hud.show(mode === 'play' ? 'play' : mode === 'cinema' ? 'cinema' : 'off');
    if (mode !== 'play') {
      for (const w of this.walkers) {
        w.eng.setBodyVisible(true);
        w.eng.fpHands.visible = false;
        w.eng.carryAnchor.position.set(0, 1.1, 0.42);
      }
      if (this.locked) document.exitPointerLock?.();
      this.closePanel();
      this.hud.prompt(null);
      this.hud.tooltip(null);
    }
    if (mode === 'play') sound.ambienceStart();
    else sound.ambienceStop();
    this.lastTime = performance.now();
  }

  private resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.gtao?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < 700 ? 64 : 52;
    this.camera.updateProjectionMatrix();
    this.pad?.resize(w, h);
    this.space?.resize(w, h);
  }

  get design(): Design | null {
    return this.app.design;
  }

  /** Preview a mission on the title/select screens (no player). */
  preview(d: Design) {
    this.ensureMission(d);
    this.syncCraft(d);
    this.syncShelves(d);
    if (this.mode !== 'attract') this.setMode('attract');
  }

  /** Enter play mode for the current app design. */
  enter(intro: boolean) {
    const d = this.design!;
    this.ensureMission(d);
    this.syncCraft(d);
    this.setupWalkers(intro);
    this.setMode('play');
    this.onDesignChanged(true);
    if (intro) {
      this.fpYaw = Math.PI;
      this.fpPitch = -0.06;
      const p = this.walkers[this.active].pos;
      this.camYaw = 0.12;
      this.camTarget.set(p.x, 1.5, p.z);
      this.camPos.set(2, 7, 12.5);
      const m = missionOf(d);
      const first = tasksFor(d, this.app.ev!, this.ctx())[0];
      this.hud.say(
        d.difficulty === 'sandbox'
          ? `Welcome to the high bay. Sandbox mode: the budget is huge and nothing random happens. Build anything you like for ${m.name}.`
          : `Welcome to the high bay. This is ${m.name}. The team left a starter spacecraft on the stand, but it is not ready to fly. Work down the task list on the left${first ? `, starting with ${first.label.toLowerCase()}` : ''}.`,
        'FLIGHT DIRECTOR',
        9000,
        true,
      );
      if (!this.hintShown) {
        this.hintShown = true;
        const touch = matchMedia('(pointer: coarse)').matches;
        this.hud.hint(touch ? 'Left stick to walk · drag to look · tap a station to go there · <b>USE</b> to interact' : this.fp ? '<b>Click</b> to look around · <b>WASD</b> walk · look at a part and press <b>E</b> · <b>V</b> 3rd person' + (this.app.team.enabled ? ' · <b>Tab</b> switch player' : '') : '<b>WASD</b> walk · <b>Shift</b> run · drag to look · click anything to go there · <b>E</b> use' + (this.app.team.enabled ? ' · <b>Tab</b> switch player' : ''));
        setTimeout(() => this.hud.hint(null), 14000);
      }
    }
  }

  private ctx(): PanelCtx {
    return {
      app: this.app,
      carrying: this.carrying,
      team: this.app.team.enabled,
      activeRole: this.walkers[this.active]?.role ?? 'engineer',
      playerFor: (r) => this.playerName(r),
    };
  }

  private playerName(r: RoleId): string {
    const p = this.app.team.players;
    const i = ROLE_ORDER.indexOf(r);
    return p[i % p.length] || `Player ${(i % p.length) + 1}`;
  }

  private ensureMission(d: Design) {
    const m = missionOf(d);
    const key = m.id;
    if (key === this.missionKey) return;
    this.missionKey = key;
    for (const s of this.stations) this.stationGroup.remove(s.group);
    this.stations = [];
    this.colliders = [...this.bay.colliders];
    for (const def of STATIONS) {
      if (def.types && !def.types.includes(m.type)) continue;
      const st = buildStation(def, m, ROLE_INFO[def.role].color);
      st.group.userData.stationId = def.id;
      st.group.traverse((o) => (o.userData.stationId = def.id));
      for (const s of st.slots) s.obj.traverse((o) => (o.userData.slotKey = s.key));
      this.stationGroup.add(st.group);
      this.stations.push(st);
      this.colliders.push(...st.colliders);
    }
    this.stationGroup.updateMatrixWorld(true);
    for (const st of this.stations) captureHomes(st);
    this.carrying = [];
    this.carryObjs.clear();
    this.craftKey = '';
    // reflections come from the room itself
    requestAnimationFrame(() => this.refreshEnv());
  }

  private refreshEnv() {
    const hidden: THREE.Object3D[] = [];
    for (const w of this.walkers) if (w.eng.root.visible) (hidden.push(w.eng.root), (w.eng.root.visible = false));
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.scene, 0.03, 0.1, 80, { size: 256, position: new THREE.Vector3(0, 4, 3) });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.9;
    for (const o of hidden) o.visible = true;
  }

  private setupWalkers(reset: boolean) {
    const team = this.app.team.enabled;
    const roles: RoleId[] = team ? ROLE_ORDER : ['engineer'];
    const same = this.walkers.length === roles.length && this.walkers.every((w, i) => w.role === roles[i] && w.name === (team ? this.playerName(roles[i]) : 'You'));
    if (!same) {
      for (const w of this.walkers) this.scene.remove(w.eng.root);
      this.walkers = roles.map((r) => {
        const name = team ? this.playerName(r) : 'You';
        const eng = new Engineer(team ? ROLE_INFO[r].color : '#4cc9ff', name, team ? ROLE_INFO[r].title.split(' ').slice(-1)[0] : 'Mission Engineer');
        eng.onStep = (_f, sp) => this.walkers[this.active]?.eng === eng && sound.step(sp > 2.4);
        this.scene.add(eng.root);
        return { eng, role: r, pos: new THREE.Vector3(), vel: new THREE.Vector2(), name };
      });
      reset = true;
    }
    if (reset) {
      this.walkers.forEach((w, i) => {
        if (team) {
          const st = this.stations.find((s) => s.def.role === w.role && s.def.id !== 'gate') ?? this.stations[0];
          w.pos.set(st.def.stand[0] + (i % 2 ? 0.6 : -0.6) * 0, 0, st.def.stand[1]);
          if (i === 0) w.pos.set(SPAWN.x - 1.2, 0, SPAWN.z);
          w.eng.heading = Math.PI;
        } else {
          w.pos.copy(SPAWN);
          w.eng.heading = Math.PI;
        }
        w.eng.root.position.copy(w.pos);
        w.eng.carrying = false;
      });
      this.active = 0;
      this.dropAll();
    }
    this.updateRoleChip();
  }

  private updateRoleChip() {
    if (!this.app.team.enabled) {
      this.hud.setRole('');
      return;
    }
    const w = this.walkers[this.active];
    this.hud.setRole(
      `<span class="gr-label">Playing as</span>${this.walkers
        .map((x, i) => `<button class="gr-p ${i === this.active ? 'on' : ''}" data-act="h-switch" data-idx="${i}" style="--rc:${ROLE_INFO[x.role].color}"><b>${x.name}</b><small>${ROLE_INFO[x.role].title}</small></button>`)
        .join('')}<kbd>Tab</kbd>`,
    );
    void w;
  }

  toggleView() {
    this.fp = !this.fp;
    const me = this.walkers[this.active];
    if (this.fp) this.fpYaw = me.eng.heading;
    else {
      this.camYaw = me.eng.heading + Math.PI;
      if (this.locked) document.exitPointerLock?.();
    }
    this.setAim(null);
    this.hud.toast(this.fp ? 'First person: you are the engineer' : 'Third person view');
    sound.select();
  }

  switchTo(i: number) {
    if (!this.walkers[i] || i === this.active) return;
    this.dropAll();
    this.closePanel();
    this.active = i;
    this.goal = null;
    this.walkers.forEach((x) => x.eng.setBodyVisible(true));
    this.fpYaw = this.walkers[i].eng.heading;
    this.updateRoleChip();
    const w = this.walkers[i];
    sound.sheet();
    this.hud.say(`${w.name}, you have the controls. You are the ${ROLE_INFO[w.role].title}: ${ROLE_INFO[w.role].owns.toLowerCase()}.`, 'FLIGHT DIRECTOR', 5000, true);
  }

  // ------------------------------------------------------------ craft
  private craftSignature(d: Design) {
    return [d.missionId, d.powerId, d.antennaId, d.shieldId, d.landingId, d.avionicsId, d.batteryId, d.txId, d.instruments.slice().sort().join(',')].join('|');
  }

  private syncCraft(d: Design, hidePart?: string): THREE.Group | null {
    const key = this.craftSignature(d);
    if (key === this.craftKey && !hidePart) return this.craft;
    this.craftKey = key;
    if (this.craft) this.craftHolder.remove(this.craft);
    const b = buildRealCraft(d);
    this.craftSize = b.radius;
    this.craftHeight = b.height;
    this.craft = b.model;
    const lander = missionOf(d).type === 'lander';
    this.craft.position.y = lander ? 0 : 1.05;
    this.craft.rotation.y = lander ? -0.5 : 0.35;
    this.craftHolder.add(this.craft);
    this.shadowFrames = 3;
    if (hidePart) setPartVisible(this.craft, hidePart, false);
    this.craft.traverse((o) => (o.userData.craft = true));
    // holding fixture for orbiters/probes
    this.fixture.clear();
    if (!lander) {
      const m = M();
      const y = 0.24 + 1.05 + 0.5;
      const f = new THREE.Group();
      f.add(at(cyl(0.62, 0.62, 0.12, m.alu, 40, true), 0, y - 0.04, 0));
      f.add(at(cyl(0.7, 0.66, 0.08, m.paintDark, 40), 0, y - 0.12, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        f.add(rod(v3(Math.cos(a) * 0.66, y - 0.15, Math.sin(a) * 0.66), v3(Math.cos(a) * 1.5, 0.24, Math.sin(a) * 1.5), 0.06, m.paintGrey, 10));
        f.add(at(cyl(0.16, 0.18, 0.06, m.paintDark, 16), Math.cos(a) * 1.5, 0.27, Math.sin(a) * 1.5));
      }
      f.position.copy(CRAFT_POS);
      this.fixture.add(shade(f));
    }
    return this.craft;
  }

  // ------------------------------------------------------------ shelves
  private syncShelves(d: Design) {
    for (const st of this.stations)
      for (const s of st.slots) {
        if (s.key.startsWith('rocketId:')) {
          const on = d.rocketId === s.key.split(':')[1];
          s.obj.userData.chosen = on;
          continue;
        }
        if (this.flying.has(s.key) || this.carrying.includes(s.key)) continue;
        const inst = isInstalled(d, s.key);
        s.obj.visible = !inst;
        if (!inst && s.obj.parent !== s.parent) this.returnHome(s.key, false);
      }
  }

  private slot(key: string) {
    for (const st of this.stations) for (const s of st.slots) if (s.key === key) return { st, s };
    return null;
  }

  /** Put an item back on its shelf (optionally animated from where it is). */
  private returnHome(key: string, animate: boolean, from?: THREE.Vector3) {
    const f = this.slot(key);
    if (!f) return;
    const { s } = f;
    if (!animate) {
      s.parent.attach(s.obj);
      s.obj.position.copy(s.parent.worldToLocal(s.home.clone()));
      const pq = new THREE.Quaternion();
      s.parent.getWorldQuaternion(pq);
      s.obj.quaternion.copy(pq.invert().multiply(s.homeQuat));
      s.obj.scale.setScalar(s.homeScale);
      s.obj.visible = true;
      return;
    }
    this.scene.attach(s.obj);
    if (from) s.obj.position.copy(from);
    s.obj.visible = true;
    const p0 = s.obj.position.clone();
    const q0 = s.obj.quaternion.clone();
    const s0 = s.obj.scale.x;
    const parentScale = new THREE.Vector3();
    s.parent.getWorldScale(parentScale);
    const s1 = s.homeScale * parentScale.x;
    this.flying.add(key);
    this.tween(1.0, (k) => {
      const e = ease(k);
      s.obj.position.lerpVectors(p0, s.home, e);
      s.obj.position.y += Math.sin(k * Math.PI) * 1.2;
      s.obj.quaternion.slerpQuaternions(q0, s.homeQuat, e);
      s.obj.scale.setScalar(lerp(s0, s1, e));
    }, () => {
      this.flying.delete(key);
      this.returnHome(key, false);
      if (this.design && isInstalled(this.design, key)) s.obj.visible = false;
    });
  }

  // ------------------------------------------------------------ carry / install
  pick(key: string) {
    const d = this.design;
    if (!d || this.mode !== 'play') return;
    if (this.app.team.enabled) {
      const st = this.slot(key)?.st;
      const w = this.walkers[this.active];
      if (st && st.def.role !== w.role) {
        this.hud.say(`That hardware belongs to ${this.playerName(st.def.role)} (${ROLE_INFO[st.def.role].title}). Press Tab to switch players.`, 'FLIGHT DIRECTOR', 5000, true);
        sound.warn();
        return;
      }
    }
    if (key.startsWith('rocketId:')) {
      this.app.applyDesign(applyKey(d, key));
      sound.select();
      return;
    }
    if (isInstalled(d, key)) {
      this.hud.say(`${partName(key)} is already on the spacecraft.`, 'FLIGHT', 3500);
      return;
    }
    if (usesCrane(key)) {
      this.craneQueue.push(key);
      this.flying.add(key);
      this.runCrane();
      this.closePanel();
      this.hud.say(`${partName(key)} is too big to carry. The overhead crane will lift it onto the spacecraft.`, 'CRANE OPERATOR', 5000);
      return;
    }
    const field = key.split(':')[0];
    // replace anything of the same kind already in our hands
    for (const k of [...this.carrying]) if (k.split(':')[0] === field && field !== 'instr') this.putBack(k);
    if (this.carrying.length >= 3) {
      this.hud.say('Your hands are full. Install what you are carrying first: walk to the blue ring in front of the spacecraft.', 'FLIGHT', 5000, true);
      sound.warn();
      return;
    }
    const f = this.slot(key);
    if (!f) return;
    const w = this.walkers[this.active];
    w.eng.reach();
    w.eng.carrying = true;
    w.eng.heavy = key.startsWith('powerId:gphs2');
    this.carrying.push(key);
    this.autoInstallAt = performance.now() + (field === 'instr' ? 1600 : 450);
    const obj = f.s.obj;
    this.scene.attach(obj);
    const p0 = obj.position.clone();
    const q0 = obj.quaternion.clone();
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3()).length();
    const s0 = obj.scale.x;
    const target = Math.min(1, (this.fp ? 0.4 : 0.62) / Math.max(0.01, size)) * s0;
    this.carryObjs.set(key, obj);
    sound.pickup();
    this.tween(0.45, (k) => {
      const e = ease(k);
      const anchor = new THREE.Vector3();
      w.eng.carryAnchor.getWorldPosition(anchor);
      anchor.y += (this.carrying.indexOf(key) || 0) * 0.22;
      obj.position.lerpVectors(p0, anchor, e);
      obj.position.y += Math.sin(k * Math.PI) * 0.3;
      const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, w.eng.heading, 0));
      obj.quaternion.slerpQuaternions(q0, tq, e);
      obj.scale.setScalar(lerp(s0, target, e));
    }, () => {
      w.eng.carryAnchor.attach(obj);
      obj.position.set(0, this.carrying.indexOf(key) * (this.fp ? 0.12 : 0.22), 0);
    });
    this.onDesignChanged(false);
    if (!this.saidIntro.has('carry')) {
      this.saidIntro.add('carry');
      this.hud.say(`Got it: ${partName(key)}. You carry it to the spacecraft and it locks into place. To walk there yourself, use WASD, look at the spacecraft and press E.`, 'FLIGHT', 7000, true);
    }
    if (field !== 'instr' && this.openId) this.closePanel();
    else this.renderPanel();
  }

  private putBack(key: string) {
    const obj = this.carryObjs.get(key);
    this.carrying = this.carrying.filter((k) => k !== key);
    this.carryObjs.delete(key);
    if (!obj) return;
    const from = new THREE.Vector3();
    obj.getWorldPosition(from);
    this.returnHome(key, true, from);
    this.walkers[this.active].eng.carrying = this.carrying.length > 0;
  }

  private dropAll() {
    for (const k of [...this.carrying]) this.putBack(k);
  }

  /** Install everything in the active engineer's hands. */
  installCarried() {
    if (!this.carrying.length || !this.design) return;
    const keys = [...this.carrying];
    const w = this.walkers[this.active];
    w.eng.reach();
    w.eng.heading = Math.atan2(CRAFT_POS.x - w.pos.x, CRAFT_POS.z - w.pos.z);
    keys.forEach((key, i) => setTimeout(() => this.installOne(key), i * 420));
    this.carrying = [];
    w.eng.carrying = false;
  }

  private installOne(key: string, fromObj?: THREE.Object3D) {
    const d = this.design!;
    const obj = fromObj ?? this.carryObjs.get(key);
    this.carryObjs.delete(key);
    const part = partOf(key);
    const field = key.split(':')[0];
    // the part being replaced (if any) flies back to its shelf
    let oldKey: string | null = null;
    let oldFrom: THREE.Vector3 | null = null;
    if (field !== 'instr') {
      const cur = (d as unknown as Record<string, string>)[field];
      if (cur && cur !== 'none' && cur !== 'single') {
        oldKey = `${field}:${cur}`;
        oldFrom = this.craft ? partCenter(this.craft, part) : null;
      }
    }
    const nd = applyKey(d, key);
    this.flying.add(key);
    this.app.applyDesign(nd, true);
    const model = this.syncCraft(nd, part);
    const to = (model && partCenter(model, part)) ?? new THREE.Vector3(CRAFT_POS.x, 2, CRAFT_POS.z);
    if (oldKey && oldFrom && this.slot(oldKey)) this.returnHome(oldKey, true, oldFrom);
    if (!obj) {
      if (model) setPartVisible(model, part, true);
      this.flying.delete(key);
      return;
    }
    this.scene.attach(obj);
    const p0 = obj.position.clone();
    const s0 = obj.scale.x;
    let s1 = s0;
    if (model) {
      let found: THREE.Object3D | null = null;
      model.traverse((o) => {
        if (!found && o.userData.part === part) found = o;
      });
      if (found) {
        const a = new THREE.Box3().setFromObject(found).getSize(new THREE.Vector3()).length();
        const b = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).length() / Math.max(1e-6, s0);
        s1 = a / Math.max(0.01, b);
      }
    }
    const q0 = obj.quaternion.clone();
    const q1 = new THREE.Quaternion();
    this.craftHolder.getWorldQuaternion(q1);
    sound.whoosh();
    this.tween(0.9, (k) => {
      const e = ease(k);
      obj.position.lerpVectors(p0, to, e);
      obj.position.y += Math.sin(k * Math.PI) * 1.4;
      obj.quaternion.slerpQuaternions(q0, q1, e);
      obj.scale.setScalar(lerp(s0, s1, e));
    }, () => {
      obj.visible = false;
      this.flying.delete(key);
      this.returnHome(key, false);
      obj.visible = false;
      if (this.craft) {
        setPartVisible(this.craft, part, true);
        this.pop(this.craft, part);
      }
      this.sparkle(to);
      sound.install();
      this.onDesignChanged(false);
    });
  }

  /** Take a part off the spacecraft and send it back to its shelf. */
  removePart(key: string) {
    const d = this.design;
    if (!d) return;
    const [field] = key.split(':');
    const part = partOf(key);
    const from = this.craft ? partCenter(this.craft, part) : null;
    let nd: Design;
    if (field === 'instr') nd = applyKey(d, key, true);
    else nd = { ...d, instruments: [...d.instruments], [field]: field === 'avionicsId' ? 'single' : 'none' } as Design;
    this.app.applyDesign(nd, true);
    this.syncCraft(nd);
    if (from) this.returnHome(key, true, from);
    sound.pickup();
    this.onDesignChanged(false);
  }

  private pop(model: THREE.Object3D, part: string) {
    let found: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (!found && o.userData.part === part) found = o;
    });
    if (!found) return;
    const o = found as THREE.Object3D;
    const base = o.scale.clone();
    this.tween(0.35, (k) => o.scale.copy(base).multiplyScalar(1 + Math.sin(k * Math.PI) * 0.08), () => o.scale.copy(base));
    this.outline.selectedObjects = [o];
    this.outline.visibleEdgeColor.set('#7dffb0');
    setTimeout(() => {
      if (this.outline.selectedObjects[0] === o) this.outline.selectedObjects = [];
      this.outline.visibleEdgeColor.set('#4cc9ff');
    }, 900);
  }

  private sparkle(at3: THREE.Vector3) {
    const n = 26;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      pos.set([at3.x, at3.y, at3.z], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.06, transparent: true, opacity: 1, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.tween(0.8, (k) => {
      for (let i = 0; i < n; i++) {
        const v = vel[i];
        pos[i * 3] = at3.x + v.x * k * 0.6;
        pos[i * 3 + 1] = at3.y + v.y * k * 0.6 - 2 * k * k;
        pos[i * 3 + 2] = at3.z + v.z * k * 0.6;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k;
    }, () => {
      this.scene.remove(pts);
      geo.dispose();
      mat.dispose();
    });
  }

  // ------------------------------------------------------------ crane
  private runCrane() {
    if (this.craneBusy) return;
    const key = this.craneQueue.shift();
    if (!key) return;
    const f = this.slot(key);
    const c = this.bay.crane;
    if (!f) {
      this.flying.delete(key);
      return;
    }
    this.craneBusy = true;
    const obj = f.s.obj;
    const objBox = new THREE.Box3().setFromObject(obj);
    const top = objBox.max.y;
    const home = f.s.home;
    const travel = (x: number, z: number, y: number, dur: number, done: () => void) => {
      const x0 = c.x;
      const z0 = c.z;
      const y0 = c.y;
      this.tween(dur, (k) => {
        const e = ease(k);
        c.x = lerp(x0, x, e);
        c.z = lerp(z0, z, e);
        c.y = lerp(y0, y, e);
        c.apply();
      }, done);
    };
    sound.craneStart();
    const dist1 = Math.hypot(c.x - home.x, c.z - home.z);
    travel(home.x, home.z, 8, 0.8 + dist1 / 6, () => {
      travel(home.x, home.z, top + 0.9, 1.4, () => {
        c.hook.attach(obj);
        sound.clunk();
        travel(home.x, home.z, Math.max(top + 2.5, 6.5), 1.4, () => {
          const d = this.design!;
          const part = partOf(key);
          const dist2 = Math.hypot(home.x - CRAFT_POS.x, home.z - CRAFT_POS.z);
          travel(CRAFT_POS.x, CRAFT_POS.z, Math.max(top + 2.5, 6.5), 0.8 + dist2 / 6, () => {
            // fit the item into its place on the spacecraft
            let oldFrom: THREE.Vector3 | null = null;
            const field = key.split(':')[0];
            const cur = (d as unknown as Record<string, string>)[field];
            const oldKey = cur && cur !== 'none' ? `${field}:${cur}` : null;
            if (oldKey && this.craft) oldFrom = partCenter(this.craft, part);
            const nd = applyKey(this.design!, key);
            this.app.applyDesign(nd, true);
            const model = this.syncCraft(nd, part);
            const to = (model && partCenter(model, part)) ?? CRAFT_POS.clone().setY(2);
            if (oldKey && oldFrom && this.slot(oldKey)) this.returnHome(oldKey, true, oldFrom);
            const objNow = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
            const off = objNow.y - c.y;
            travel(CRAFT_POS.x, CRAFT_POS.z, to.y - off, 2.0, () => {
              this.scene.attach(obj);
              obj.visible = false;
              this.flying.delete(key);
              this.returnHome(key, false);
              obj.visible = false;
              if (this.craft) {
                setPartVisible(this.craft, part, true);
                this.pop(this.craft, part);
              }
              this.sparkle(to);
              sound.install();
              this.onDesignChanged(false);
              travel(c.x, c.z, 9.5, 1.6, () => {
                sound.craneStop();
                this.craneBusy = false;
                this.runCrane();
              });
            });
          });
        });
      });
    });
  }

  // ------------------------------------------------------------ panels
  openStation(id: StationId) {
    const st = this.stations.find((s) => s.def.id === id);
    if (!st || !this.design) return;
    this.openId = id;
    const w = this.walkers[this.active];
    if (this.fp) {
      this.fpLookAt = new THREE.Vector3(st.def.label[0], Math.min(1.6, st.def.label[1] * 0.45), st.def.label[2]);
      if (this.locked) document.exitPointerLock?.();
    }
    w.eng.heading = st.def.face;
    w.eng.reach();
    const lab = new THREE.Vector3(...st.def.label);
    const FRAME: Partial<Record<StationId, [number, number, number]>> = {
      // [distance, pitch, target height]
      power: [6.8, 0.2, 1.5], systems: [5.8, 0.2, 1.4], science: [6.4, 0.32, 1.1], comms: [7.4, 0.18, 1.7], landing: [9.5, 0.3, 1.3],
      fuel: [4.6, 0.3, 1.0], rockets: [5.2, 0.22, 1.5], flight: [6.6, 0.1, 2.9], ops: [6.6, 0.1, 2.9], orbit: [7.5, 0.08, 3.6], gate: [9, 0.12, 4.2],
    };
    const [dist, pitch, ty] = FRAME[id] ?? [5, 0.25, 1.5];
    this.focus = {
      target: new THREE.Vector3(lerp(w.pos.x, lab.x, 0.7), ty, lerp(w.pos.z, lab.z, 0.7)),
      yaw: st.def.face + Math.PI,
      dist,
      pitch,
    };
    sound.sheet();
    this.renderPanel();
    if (id === 'ops' || id === 'comms') this.app.maybeProgramEvent();
    const key = 'st:' + id;
    if (!this.saidIntro.has(key)) {
      this.saidIntro.add(key);
      const line = INTRO[id]?.(this.design);
      if (line) this.hud.say(line, 'FLIGHT', 7500);
    }
  }

  renderPanel() {
    if (!this.openId || !this.design || !this.app.ev) return;
    const st = stationById(this.openId);
    this.hud.openPanel(panelHTML(this.openId, this.design, this.app.ev, this.ctx()), ROLE_INFO[st.role].color);
  }

  closePanel() {
    if (!this.openId) return;
    this.openId = null;
    this.focus = null;
    this.fpLookAt = null;
    this.hud.closePanel();
    this.holdUse(false);
  }

  // ------------------------------------------------------------ actions from the HUD
  action(act: string, el: HTMLElement): boolean {
    if (!act.startsWith('h-')) return false;
    const d = this.design;
    switch (act) {
      case 'h-close':
        this.closePanel();
        break;
      case 'h-pick':
        this.pick(el.dataset.key!);
        break;
      case 'h-remove':
        this.removePart(el.dataset.key!);
        break;
      case 'h-drop':
        this.dropAll();
        this.renderPanel();
        break;
      case 'h-set':
        if (!d) break;
        this.app.applyDesign({ ...d, [el.dataset.field!]: el.dataset.num ? Number(el.dataset.val) : el.dataset.val } as Design);
        sound.select();
        break;
      case 'h-route':
        this.closePanel();
        this.app.openRoute();
        break;
      case 'h-best':
        this.app.autoPick();
        break;
      case 'h-routekind':
        this.app.setRouteKind(el.dataset.val as 'direct' | 'jga');
        break;
      case 'h-history':
        this.closePanel();
        this.app.openRoute(true);
        break;
      case 'h-fuel-auto':
        this.app.autoFuel();
        break;
      case 'h-goto':
        this.goTo(el.dataset.station as StationId);
        break;
      case 'h-switch':
        this.switchTo(Number(el.dataset.idx));
        break;
      case 'h-radio-x':
        this.hud.dismissRadio();
        break;
      case 'h-gauge':
        this.goToGauge(el.dataset.id!);
        break;
      case 'h-pro':
        this.closePanel();
        this.app.openPro();
        break;
      case 'h-menu':
        this.app.openMenu();
        break;
      default:
        return false;
    }
    return true;
  }

  private goToGauge(id: string) {
    const map: Record<string, StationId> = { mass: 'rockets', power: 'power', dv: 'fuel', budget: 'ops', data: 'comms', science: 'science', time: 'flight' };
    if (map[id]) this.goTo(map[id]);
  }

  /** Walk (pathfind around the spacecraft stand) to a station, then open it. */
  goTo(id: StationId | 'install'): void {
    if (this.mode !== 'play') return;
    const w = this.walkers[this.active];
    if (this.app.team.enabled && id !== 'install' && id !== 'gate') {
      const def = stationById(id);
      if (def.role !== w.role) {
        const idx = this.walkers.findIndex((x) => x.role === def.role);
        if (idx >= 0) {
          this.switchTo(idx);
          this.goTo(id);
          return;
        }
      }
    }
    const target = id === 'install' ? new THREE.Vector2(INSTALL_SPOT.x, INSTALL_SPOT.z) : new THREE.Vector2(...stationById(id).stand);
    this.closePanel();
    this.goal = { x: target.x, z: target.y, station: id === 'install' ? undefined : id, install: id === 'install', path: this.plan(new THREE.Vector2(w.pos.x, w.pos.z), target) };
  }

  /** Straight line, or two tangent waypoints around the stand circle. */
  private plan(a: THREE.Vector2, b: THREE.Vector2): THREE.Vector2[] {
    const c = new THREE.Vector2(CRAFT_POS.x, CRAFT_POS.z);
    const R = RING_R + 0.9;
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
    const closest = a.clone().add(ab.clone().multiplyScalar(t));
    if (closest.distanceTo(c) > R - 0.2) return [b];
    const angA = Math.atan2(a.y - c.y, a.x - c.x);
    const angB = Math.atan2(b.y - c.y, b.x - c.x);
    const diff = wrapA(angB - angA);
    const steps = Math.max(2, Math.ceil(Math.abs(diff) / 0.6));
    const pts: THREE.Vector2[] = [];
    for (let i = 1; i < steps; i++) {
      const ang = angA + (diff * i) / steps;
      pts.push(new THREE.Vector2(c.x + Math.cos(ang) * R, c.y + Math.sin(ang) * R));
    }
    pts.push(b);
    return pts;
  }

  // ------------------------------------------------------------ use key
  use() {
    if (this.mode !== 'play') return;
    if (this.fp && this.aim && !this.openId) {
      const a = this.aim;
      if (a.kind === 'slot' && a.key) {
        if (this.app.team.enabled && a.sid && stationById(a.sid).role !== this.walkers[this.active].role) return this.pick(a.key);
        this.walkers[this.active].eng.reach();
        return this.pick(a.key);
      }
      if (a.kind === 'craft' && this.carrying.length) return this.installCarried();
      if (a.kind === 'station' && a.sid) {
        this.near = a.sid;
      }
    }
    if (this.near === 'install' && this.carrying.length) return this.installCarried();
    if (this.near && this.near !== 'install') {
      if (this.openId === this.near) return this.closePanel();
      if (this.app.team.enabled) {
        const def = stationById(this.near);
        const w = this.walkers[this.active];
        if (def.role !== w.role && def.id !== 'gate') {
          this.hud.say(`This is ${this.playerName(def.role)}'s station (${ROLE_INFO[def.role].title}). Press Tab to switch players, or talk it through as a team.`, 'FLIGHT DIRECTOR', 5500, true);
          sound.warn();
          return;
        }
      }
      return this.openStation(this.near);
    }
    if (this.openId) this.closePanel();
  }

  holdUse(down: boolean) {
    if (this.openId !== 'fuel') {
      if (!down) this.pumpStop();
      return;
    }
    if (down) this.pumpStart(1);
    else this.pumpStop();
  }

  pumpStart(dir: number) {
    if (this.pumping === dir) return;
    this.pumping = dir;
    sound.pumpStart();
  }

  pumpStop() {
    if (!this.pumping) return;
    this.pumping = 0;
    sound.pumpStop();
    if (this.design) this.app.applyDesign({ ...this.design });
  }

  // ------------------------------------------------------------ design changes
  /** Called by the App after every design change. */
  onDesignChanged(full = true) {
    const d = this.design;
    const ev = this.app.ev;
    if (!d || !ev) return;
    if (full) this.syncCraft(d);
    this.syncShelves(d);
    // gauges (with a preview of what the carried parts would do)
    let pv: Evaluation | null = null;
    if (this.carrying.length) {
      let nd = d;
      for (const k of this.carrying) nd = applyKey(nd, k);
      pv = evaluate(nd);
    }
    this.hud.gauges(gaugesFor(ev, pv));
    const tasks = tasksFor(d, ev, this.ctx());
    this.hud.tasks(
      tasks.map<Task>((t) => ({ ...t, color: ROLE_INFO[stationById(t.station as StationId).role].color })),
      this.app.team.enabled ? 'Team tasks' : 'Mission tasks',
    );
    const m = missionOf(d);
    const obj = m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0];
    this.hud.setHeader(`<button class="gh-menu" data-act="h-menu" aria-label="Menu"><i></i><i></i><i></i></button><div class="gh-mission"><b>${m.name}</b><span>${obj.name} · ${d.difficulty}</span></div>`);
    if (this.openId) this.renderPanel();
    this.react(ev);
    this.lastEv = ev;
    this.screensDirty = true;
  }

  /** Flight Director commentary when checks change state. */
  private react(ev: Evaluation) {
    const prev = this.lastEv;
    if (!prev || prev.mission.id !== ev.mission.id) return;
    if (!prev.launchable && ev.launchable) {
      this.hud.say('All stations report GO. Walk to the launch gate at the big door when you are ready to fly.', 'FLIGHT DIRECTOR', 7000, true);
      return;
    }
    for (const c of ev.checks) {
      const o = prev.checks.find((x) => x.id === c.id);
      if (!o || o.status === c.status) continue;
      const text = c.detail.replace(/<[^>]+>/g, '');
      if (c.status === 'fail') {
        this.hud.say(`${c.label}: ${text}`, 'FLIGHT', 8000, true);
        sound.warn();
        return;
      }
      if (o.status === 'fail' && c.status === 'ok') {
        this.hud.say(`${c.label} is GO. ${text.split(/(?<=[.!])\s/)[0]}`, 'FLIGHT', 5000, true);
        return;
      }
    }
  }

  // ------------------------------------------------------------ launch
  launchSequence(onDone: () => void) {
    this.closePanel();
    this.setMode('cinema');
    const door = this.bay.door;
    const from = this.camPos.clone();
    const fromT = this.camTarget.clone();
    sound.doorOpen();
    this.tween(3.2, (k) => {
      const e = ease(k);
      door.position.y = e * 10.6;
      this.camPos.lerpVectors(from, new THREE.Vector3(-10.5, 2.4, 3.8), e);
      this.camTarget.lerpVectors(fromT, new THREE.Vector3(0, 4.8, 12.5), e);
    }, () => {
      const fade = document.createElement('div');
      fade.className = 'whiteout';
      document.body.appendChild(fade);
      requestAnimationFrame(() => fade.classList.add('on'));
      setTimeout(() => {
        door.position.y = 0;
        this.pad ??= new LaunchPad(this.renderer);
        this.pad.resize(this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight);
        this.pad.start(this.design!, () => {
          this.pad?.stop();
          this.setMode('off');
          onDone();
        });
        fade.classList.remove('on');
        setTimeout(() => fade.remove(), 900);
      }, 650);
    });
  }

  /** Start the real-looking flight (launch to landing) on this renderer. */
  startSpace(d: Design, sim: import('../game/simulate').SimResult): SpaceCinema {
    this.space ??= new SpaceCinema(this.renderer);
    this.space.setQuality(this.tier);
    // space is black: never let the light high-bay backdrop show through transparent pixels
    this.renderer.domElement.style.background = '#000';
    this.setMode('cinema');
    this.hud.show('off');
    this.space.resize(this.renderer.domElement.clientWidth || window.innerWidth, this.renderer.domElement.clientHeight || window.innerHeight);
    this.space.start(d, sim);
    return this.space;
  }

  endSpace() {
    if (!this.space?.active && this.mode !== 'cinema') return;
    this.space?.stop();
    this.renderer.domElement.style.background = '';
    if (this.app.screen !== 'hangar') this.setMode('off');
  }

  // ------------------------------------------------------------ input
  private bindInput() {
    const el = this.renderer.domElement;
    const typing = (e: Event) => {
      const t = e.target as HTMLElement;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    };
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'play' || typing(e)) return;
      if ($modalOpen()) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q'].includes(k)) {
        this.keys.add(k);
        if (k !== 'shift' && k !== 'q') {
          this.autoInstallAt = 0;
          this.goal = null;
          if (this.openId && !k.startsWith('arrow')) this.closePanel();
          if (!this.movedOnce) {
            this.movedOnce = true;
            setTimeout(() => this.hud.hint(null), 2500);
          }
        }
        if (k.startsWith('arrow')) e.preventDefault();
      }
      if (k === 'e' || k === 'enter' || k === ' ') {
        if (k !== 'e' && (e.target as HTMLElement)?.closest?.('button')) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        e.preventDefault();
        if (!e.repeat) this.use();
        if (this.openId === 'fuel') this.holdUse(true);
      }
      if (k === 'tab' && this.app.team.enabled) {
        e.preventDefault();
        this.switchTo((this.active + 1) % this.walkers.length);
      }
      if (k === 'escape') this.closePanel();
      if (k === 'v') this.toggleView();
    });
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest?.('#gamehud button') as HTMLElement | null;
      if (b) setTimeout(() => b.blur(), 0);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'e' || k === 'enter' || k === ' ') this.holdUse(false);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.holdUse(false);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.mode !== 'play') return;
      this.fpYaw -= e.movementX * 0.0022;
      this.fpPitch = Math.max(-1.3, Math.min(1.25, this.fpPitch - e.movementY * 0.0022));
      this.fpLookAt = null;
    });
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play' && this.mode !== 'attract') return;
      if (this.fp && this.mode === 'play' && e.pointerType === 'mouse') {
        if (this.locked) {
          if (e.button === 0) this.use();
          return;
        }
        if (this.openId) this.closePanel();
        try {
          const p = (el.requestPointerLock as () => Promise<void> | void)?.call(el);
          if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
        } catch {
          /* pointer lock not allowed here: drag to look instead */
        }
      }
      this.pointer.down = true;
      this.pointer.drag = false;
      this.pointer.downX = this.pointer.x = e.clientX;
      this.pointer.downY = this.pointer.y = e.clientY;
      this.pointer.t0 = performance.now();
      this.pointer.button = e.button;
      el.setPointerCapture(e.pointerId);
      sound.unlock();
    });
    el.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.pointer.down) {
        if (Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY) > 6) this.pointer.drag = true;
        if (this.pointer.drag && this.mode === 'play' && this.fp && !this.locked) {
          this.fpYaw -= dx * 0.005;
          this.fpPitch = Math.max(-1.3, Math.min(1.25, this.fpPitch - dy * 0.004));
          this.fpLookAt = null;
        } else if (this.pointer.drag && this.mode === 'play') {
          this.camYaw -= dx * 0.006;
          this.camPitch = Math.max(-0.15, Math.min(1.25, this.camPitch + dy * 0.004));
          if (this.focus) this.focus.yaw -= dx * 0.006;
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      const wasDrag = this.pointer.drag;
      this.pointer.down = false;
      this.pointer.drag = false;
      if (!wasDrag && performance.now() - this.pointer.t0 < 600 && this.mode === 'play' && (!this.fp || e.pointerType !== 'mouse')) this.click(e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => {
      this.setHover(null);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'play') return;
        e.preventDefault();
        this.camDist = Math.max(2.4, Math.min(14, this.camDist * (1 + Math.sign(e.deltaY) * 0.1)));
        if (this.focus) this.focus.dist = Math.max(2.4, Math.min(14, this.focus.dist * (1 + Math.sign(e.deltaY) * 0.1)));
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerup', () => {
      if (this.pumping) this.pumpStop();
    });
    document.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('[data-hold=fuel],[data-hold=drain]') as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      this.pumpStart(b.dataset.hold === 'fuel' ? 1 : -1);
    });
    document.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('h-range') || !this.design) return;
      this.app.applyDesign({ ...this.design, [t.dataset.field!]: Number(t.value) } as Design, false, true);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value} h`;
    });
    document.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.classList.contains('h-range') && this.design) this.app.applyDesign({ ...this.design });
    });
  }

  private pick3D(x: number, y: number, hoverOnly = false): THREE.Intersection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const objs: THREE.Object3D[] = hoverOnly ? [...this.stations.flatMap((st) => st.slots.map((s) => s.obj)), this.craftHolder] : [this.stationGroup, this.craftHolder, this.bay.group];
    const hits = this.ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let vis = true;
      while (o) {
        if (!o.visible) vis = false;
        o = o.parent;
      }
      if (vis && !(h.object as THREE.Mesh & { material: THREE.Material }).material?.transparent) return h;
      if (vis && h.object.userData.slotKey) return h;
    }
    return null;
  }

  private click(x: number, y: number) {
    const h = this.pick3D(x, y);
    if (!h) return;
    const o = h.object;
    const slotKey = o.userData.slotKey as string | undefined;
    const sid = o.userData.stationId as StationId | undefined;
    if (slotKey && sid) {
      if (this.openId === sid) return this.pick(slotKey);
      this.goTo(sid);
      this.pendingPick = slotKey;
      return;
    }
    if (o.userData.craft) {
      if (this.carrying.length) return this.goTo('install');
      return this.hud.say(this.craftTip(o) ?? 'Your spacecraft. Bring parts to the blue ring to install them.', 'FLIGHT', 4500);
    }
    if (sid) return this.goTo(sid);
    // floor (or anything else): walk there
    const p = h.point;
    const w = this.walkers[this.active];
    const target = new THREE.Vector2(Math.max(-ROOM.x + 0.6, Math.min(ROOM.x - 0.6, p.x)), Math.max(-ROOM.z + 0.6, Math.min(ROOM.z - 0.6, p.z)));
    this.closePanel();
    this.goal = { x: target.x, z: target.y, path: this.plan(new THREE.Vector2(w.pos.x, w.pos.z), target) };
    this.goalMarker.position.set(target.x, 0.015, target.y);
    (this.goalMarker.material as THREE.MeshBasicMaterial).opacity = 0.9;
  }
  private pendingPick: string | null = null;
  private autoInstallAt = 0;
  /** first-person view (the default): the camera is the engineer's eyes */
  fp = true;
  private fpYaw = Math.PI;
  private fpPitch = -0.06;
  private fpLookAt: THREE.Vector3 | null = null;
  private locked = false;
  private bob = 0;
  private aim: { kind: 'slot' | 'station' | 'craft'; key?: string; sid?: StationId; dist: number; obj: THREE.Object3D } | null = null;
  private aimTimer = 0;
  private screensDirty = true;

  // ------------------------------------------------------------ adaptive quality
  /** 0 = best. The governor steps down when frames are slow and back up when there is headroom. */
  tier = 0;
  private minTier = 0;
  private perf = { ema: 16, slow: 0, fast: 0, warm: 0 };

  private governor(raw: number) {
    if (document.hidden || raw > 0.25 || this.mode === 'off') {
      this.perf.warm = 0;
      return;
    }
    const p = this.perf;
    p.ema = p.ema * 0.93 + raw * 1000 * 0.07;
    p.warm += raw;
    if (p.warm < 2.5) return;
    if (p.ema > 22) {
      p.slow += raw;
      p.fast = 0;
      if (p.slow > 1.2 && this.tier < 4) {
        this.applyTier(this.tier + 1);
        p.slow = 0;
        p.warm = 1;
        p.ema = 16;
      }
    } else if (p.ema < 11) {
      p.fast += raw;
      p.slow = 0;
      if (p.fast > 10 && this.tier > this.minTier) {
        this.applyTier(this.tier - 1);
        p.fast = 0;
        p.warm = 1;
      }
    } else {
      p.slow = 0;
      p.fast = 0;
    }
  }

  applyTier(t: number) {
    this.tier = t;
    const dpr = window.devicePixelRatio || 1;
    const pr = [Math.min(dpr, 2), Math.min(dpr, 1.5), Math.min(dpr, 1), Math.min(dpr, 0.85), 0.7][t];
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    const samples = [4, 4, 2, 0, 0][t];
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2])
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    this.bloom.enabled = t < 3;
    this.space?.setQuality(t);
    const sm = [2048, 2048, 1024, 1024, 512][t];
    const sun = this.bay.sun;
    if (sun.shadow.mapSize.x !== sm) {
      sun.shadow.mapSize.set(sm, sm);
      sun.shadow.map?.dispose();
      (sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.shadowFrames = 3;
    document.body.classList.toggle('lowfx', t >= 2);
    this.resize();
  }


  private craftTip(o: THREE.Object3D): string | null {
    let p: THREE.Object3D | null = o;
    while (p && !p.userData.part) p = p.parent;
    if (!p) return null;
    const part = p.userData.part as string;
    if (part.startsWith('instr:')) return `${partName(part)} · installed on the spacecraft.`;
    const field = Object.keys(FIELD_PART).find((f) => FIELD_PART[f] === part);
    if (!field) return null;
    const val = (this.design as unknown as Record<string, string>)[field];
    return `${partName(`${field}:${val}`)} · installed on the spacecraft.`;
  }

  private setHover(o: THREE.Object3D | null) {
    if (o === this.hovered) return;
    this.hovered = o;
    if (!o) {
      this.outline.selectedObjects = [];
      this.hud.tooltip(null);
      this.renderer.domElement.style.cursor = '';
      return;
    }
    this.outline.selectedObjects = [o];
    this.renderer.domElement.style.cursor = 'pointer';
  }

  private updateHover() {
    if (this.pointer.down || this.mode !== 'play' || matchMedia('(pointer: coarse)').matches) return;
    const h = this.pick3D(this.pointer.x, this.pointer.y, true);
    const key = h?.object.userData.slotKey as string | undefined;
    if (key) {
      const f = this.slot(key);
      if (f && f.s.obj.visible) {
        this.setHover(f.s.obj);
        const d = this.design!;
        const tip = partName(key, d, this.app.ev!);
        this.hud.tooltip(`<b>${tip}</b><span>${this.openId === f.st.def.id ? (key.startsWith('rocketId:') ? 'Click to choose this rocket' : 'Click to pick it up') : `Click to walk to ${f.st.def.name}`}</span>`, this.pointer.x, this.pointer.y);
        return;
      }
    }
    if (h?.object.userData.craft) {
      const t = this.craftTip(h.object);
      if (t) {
        this.hud.tooltip(`<b>${t.split(' · ')[0]}</b><span>Installed on the spacecraft</span>`, this.pointer.x, this.pointer.y);
        this.outline.selectedObjects = [];
        this.hovered = null;
        this.renderer.domElement.style.cursor = 'help';
        return;
      }
    }
    if (h?.object.userData.stationId) {
      this.setHover(null);
      this.renderer.domElement.style.cursor = 'pointer';
      return;
    }
    this.setHover(null);
  }

  // ------------------------------------------------------------ simulation
  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    this.tweens.push({ t: 0, dur, step, done });
  }

  private collide(p: THREE.Vector3, r: number) {
    p.x = Math.max(-ROOM.x + r + 0.1, Math.min(ROOM.x - r - 0.1, p.x));
    p.z = Math.max(-ROOM.z + r + 0.1, Math.min(ROOM.z - r - 0.3, p.z));
    for (const c of this.colliders) {
      if (c.kind === 'circle') {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + r;
        if (d < min && d > 1e-6) {
          p.x = c.x + (dx / d) * min;
          p.z = c.z + (dz / d) * min;
        }
      } else {
        const cx = Math.max(c.x0, Math.min(c.x1, p.x));
        const cz = Math.max(c.z0, Math.min(c.z1, p.z));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-6) {
            p.x = cx + (dx / d) * r;
            p.z = cz + (dz / d) * r;
          } else {
            // inside the box: push out the shortest way
            const opts = [
              [c.x0 - r - p.x, 0],
              [c.x1 + r - p.x, 0],
              [0, c.z0 - r - p.z],
              [0, c.z1 + r - p.z],
            ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
            p.x += opts[0];
            p.z += opts[1];
          }
        }
      }
    }
  }

  private frame() {
    const now = performance.now();
    const raw = (now - this.lastTime) / 1000;
    const dt = Math.min(0.05, raw);
    this.lastTime = now;
    if (!this.visible) return;
    this.governor(raw);
    if (this.pad?.active) {
      this.pad.update(dt);
      return;
    }
    if (this.space?.active) {
      this.space.update(dt);
      return;
    }
    // tweens
    for (const t of [...this.tweens]) {
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.step(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(t), 1);
        t.done?.();
      }
    }
    if (this.mode === 'play') this.updatePlay(dt);
    else if (this.mode === 'attract') this.updateAttract(dt);
    else if (this.mode === 'cinema') {
      for (const w of this.walkers) w.eng.update(dt, 0);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    }
    // rockets on the display table: the chosen one rises and turns
    this.rocketSpin += dt * 0.5;
    for (const st of this.stations)
      if (st.def.id === 'rockets')
        for (const s of st.slots) {
          const on = !!s.obj.userData.chosen;
          s.obj.position.y = damp(s.obj.position.y, on ? 0.18 : 0.04, 6, dt);
          s.obj.rotation.y = on ? this.rocketSpin : damp(s.obj.rotation.y, 0, 4, dt);
        }
    // goal marker fade
    const gm = this.goalMarker.material as THREE.MeshBasicMaterial;
    gm.opacity = Math.max(0, gm.opacity - dt * 0.8);
    this.bay.installMarker.visible = this.mode === 'play';
    const im = this.bay.installMarker.material as THREE.MeshBasicMaterial;
    im.opacity = this.carrying.length ? 0.6 + Math.sin(now * 0.008) * 0.35 : 0.18;
    this.bay.installMarker.scale.setScalar(this.carrying.length ? 1 + Math.sin(now * 0.008) * 0.06 : 1);
    this.screenTimer += dt;
    if (this.design && this.app.ev && (this.screenTimer > 1 || (this.screensDirty && this.screenTimer > 0.25))) {
      drawScreens(this.stations, this.bay.statusBoard, this.design, this.app.ev, this.ctx(), !this.screensDirty);
      this.screensDirty = false;
      this.screenTimer = 0;
    }
    // the shadow map is a cache: re-render only while parts or the crane move (every other frame)
    this.shadowTick = (this.shadowTick + 1) % 2;
    if (this.shadowFrames > 0 || ((this.tweens.length || this.craneBusy) && this.shadowTick === 0)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowFrames = Math.max(0, this.shadowFrames - 1);
    }
    this.composer.render(dt);
  }
  /** Force shadow re-renders for the next few frames (after scene changes). */
  shadowFrames = 3;
  private shadowTick = 0;
  private viewShift = 0;

  /** Pixels to push the attract-mode spacecraft to the right (to make room for UI on the left). */
  attractShift = 0;
  private attractR = 11.5;
  private attractShiftNow = 0;

  private updateAttract(dt: number) {
    this.attractT += dt;
    // sweep across the front of the stand (the work platform stands behind it)
    const a = 0.3 + Math.sin(this.attractT * 0.09) * 0.85;
    // frame the spacecraft by its size: a Spirit-size rover close up, Juno's wings from further back
    const want = this.attractShift > 0 ? Math.max(7.6, Math.min(11.5, this.craftSize * 1.3 + 5.4)) : 11.5;
    this.attractR = damp(this.attractR, want, 2, dt);
    const r = this.attractR;
    const h = this.attractShift > 0 ? 1.4 + r * 0.3 : 3.4;
    this.camera.position.set(CRAFT_POS.x + Math.sin(a) * r, h + Math.sin(this.attractT * 0.11) * 0.5, CRAFT_POS.z + Math.cos(a) * r);
    this.camera.lookAt(CRAFT_POS.x, this.attractShift > 0 ? Math.min(2.6, 0.5 + this.craftHeight * 0.45) : 2.0, CRAFT_POS.z);
    this.attractShiftNow = damp(this.attractShiftNow, this.attractShift, 4, dt);
    const cw = this.renderer.domElement.clientWidth;
    const ch = this.renderer.domElement.clientHeight;
    if (this.attractShiftNow > 0.5) this.camera.setViewOffset(cw, ch, -this.attractShiftNow, 0, cw, ch);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    for (const w of this.walkers) w.eng.root.visible = false;
  }

  private updatePlay(dt: number) {
    for (const w of this.walkers) w.eng.root.visible = true;
    const me = this.walkers[this.active];
    if (!me) return;
    // ---- movement input
    let ix = 0;
    let iz = 0;
    const K = this.keys;
    if (K.has('w') || K.has('arrowup')) iz += 1;
    if (K.has('s') || K.has('arrowdown')) iz -= 1;
    if (K.has('a') || K.has('arrowleft')) ix -= 1;
    if (K.has('d') || K.has('arrowright')) ix += 1;
    if (this.hud.joyVec.x || this.hud.joyVec.y) {
      ix = this.hud.joyVec.x;
      iz = -this.hud.joyVec.y;
      this.goal = null;
    }
    const fwd = this.fp ? new THREE.Vector2(Math.sin(this.fpYaw), Math.cos(this.fpYaw)) : new THREE.Vector2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
    const right = this.fp ? new THREE.Vector2(-Math.cos(this.fpYaw), Math.sin(this.fpYaw)) : new THREE.Vector2(Math.cos(this.camYaw), -Math.sin(this.camYaw));
    let want = new THREE.Vector2();
    const run = K.has('shift');
    if (ix || iz) {
      want = fwd.clone().multiplyScalar(iz).add(right.clone().multiplyScalar(ix));
      const len = Math.min(1, want.length());
      want.normalize().multiplyScalar(len * (run ? 3.6 : 1.7));
    } else if (this.goal) {
      const g = this.goal.path[0];
      const to = new THREE.Vector2(g.x - me.pos.x, g.y - me.pos.z);
      const d = to.length();
      const last = this.goal.path.length === 1;
      if (d < (last ? 0.18 : 0.6)) {
        this.goal.path.shift();
        if (!this.goal.path.length) {
          const st = this.goal.station;
          const inst = this.goal.install;
          this.goal = null;
          if (st) {
            this.openStation(st);
            if (this.pendingPick) {
              const k = this.pendingPick;
              this.pendingPick = null;
              setTimeout(() => this.pick(k), 250);
            }
          } else if (inst && this.carrying.length) this.installCarried();
        }
      } else {
        const sp = Math.min(4.4, d > 4 ? 4.4 : 1.7 + d * 0.5);
        want = to.normalize().multiplyScalar(last ? Math.min(sp, d * 3) : sp);
      }
    }
    const heavy = me.eng.carrying && me.eng.heavy;
    if (heavy) want.multiplyScalar(0.7);
    me.vel.x = damp(me.vel.x, want.x, 10, dt);
    me.vel.y = damp(me.vel.y, want.y, 10, dt);
    me.pos.x += me.vel.x * dt;
    me.pos.z += me.vel.y * dt;
    this.collide(me.pos, 0.32);
    // other engineers stay out of the way
    for (const o of this.walkers)
      if (o !== me) {
        const dx = me.pos.x - o.pos.x;
        const dz = me.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 1e-6) {
          me.pos.x = o.pos.x + (dx / d) * 0.7;
          me.pos.z = o.pos.z + (dz / d) * 0.7;
        }
      }
    const speed = me.vel.length();
    if (this.fp) {
      // auto-walking: look where you are going; otherwise the body follows the view
      if (this.goal && speed > 0.3 && !this.fpLookAt) {
        this.fpYaw += wrapA(Math.atan2(me.vel.x, me.vel.y) - this.fpYaw) * (1 - Math.exp(-dt * 5));
        this.fpPitch = damp(this.fpPitch, -0.08, 3, dt);
      }
      me.eng.heading = this.fpYaw;
    } else if (speed > 0.15) me.eng.heading += wrapA(Math.atan2(me.vel.x, me.vel.y) - me.eng.heading) * (1 - Math.exp(-dt * 12));
    for (const w of this.walkers) {
      w.eng.root.position.copy(w.pos);
      const v = w === me ? speed : 0;
      if (w !== me) w.eng.lookAt = me.eng.root.position.clone().setY(1.6);
      w.eng.update(dt, v);
    }

    // ---- carry picked parts to the spacecraft automatically (unless the player walks themselves)
    if (this.autoInstallAt && performance.now() > this.autoInstallAt && this.carrying.length && !this.goal && !(ix || iz)) {
      this.autoInstallAt = 0;
      this.goTo('install');
      if (!this.saidIntro.has('autocarry')) {
        this.saidIntro.add('autocarry');
        this.hud.say('Carrying it to the spacecraft. The part locks in when you reach the blue ring.', 'FLIGHT', 5000);
      }
    }

    // ---- what are we near?
    let near: StationId | 'install' | null = null;
    let best = 1.6;
    if (this.carrying.length) {
      const d = Math.hypot(me.pos.x - INSTALL_SPOT.x, me.pos.z - INSTALL_SPOT.z);
      if (d < 1.8) near = 'install';
    }
    if (!near)
      for (const st of this.stations) {
        const d = Math.hypot(me.pos.x - st.def.stand[0], me.pos.z - st.def.stand[1]);
        if (d < best) {
          best = d;
          near = st.def.id;
        }
      }
    this.near = near;
    if (this.openId && near !== this.openId) this.closePanel();
    me.eng.lookAt = near === 'install' ? new THREE.Vector3(CRAFT_POS.x, 2, CRAFT_POS.z) : near ? new THREE.Vector3(...stationById(near as StationId).label).setY(1.4) : null;
    if (this.openId) this.hud.prompt(null);
    else if (near === 'install') this.hud.prompt(`Install ${this.carrying.length > 1 ? `${this.carrying.length} parts` : partName(this.carrying[0])}`);
    else if (near) this.hud.prompt(`Use ${stationById(near as StationId).name}`);
    else if (this.carrying.length) this.hud.prompt(null);
    else this.hud.prompt(null);
    for (const st of this.stations) {
      const ring = st.ring.material as THREE.MeshBasicMaterial;
      const on = near === st.def.id || this.openId === st.def.id;
      ring.opacity = damp(ring.opacity, on ? 0.85 : 0.22, 8, dt);
    }

    // ---- fuel pump
    if (this.pumping && this.design) {
      const max = ({ mars: 400, jupiter: 2600, pluto: 500 } as Record<string, number>)[this.design.missionId] ?? 1000;
      const nd = { ...this.design, propellantKg: Math.max(0, Math.min(max, this.design.propellantKg + this.pumping * dt * max * 0.16)) };
      this.app.applyDesign(nd, false, true);
      if (nd.propellantKg === 0 || nd.propellantKg === max) this.pumpStop();
    }

    // ---- camera
    if (this.fp) this.firstPersonCamera(me, speed, dt);
    else this.thirdPersonCamera(me, speed, dt);
    // keep the station centred in the part of the screen the panel does not cover
    const wide = window.innerWidth > 760;
    const shiftTo = this.openId && wide ? Math.min(440, window.innerWidth * 0.3) / 2 : 0;
    this.viewShift = damp(this.viewShift, shiftTo, 6, dt);
    const cw = this.renderer.domElement.clientWidth;
    const ch = this.renderer.domElement.clientHeight;
    if (this.viewShift > 0.5) this.camera.setViewOffset(cw, ch, this.viewShift, 0, cw, ch);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    if (this.fp) {
      this.aimTimer += dt;
      if (this.aimTimer > 0.07) {
        this.aimTimer = 0;
        this.updateAim();
      }
    }
    this.hud.crosshair(this.fp && this.mode === 'play', this.locked || matchMedia('(pointer: coarse)').matches || !!this.openId || !!this.goal || this.carrying.length > 0);

    // ---- HUD: labels, hover, minimap
    this.updateLabels();
    if (!this.fp) {
      this.hoverTimer += dt;
      if (this.hoverTimer > 0.06) {
        this.hoverTimer = 0;
        this.updateHover();
      }
    }
    this.mapTimer += dt;
    if (this.mapTimer > 0.1) {
      this.mapTimer = 0;
      this.drawMap();
    }
  }

  private firstPersonCamera(me: Walker, speed: number, dt: number) {
    me.eng.setBodyVisible(false);
    me.eng.fpHands.visible = me.eng.carrying;
    const eye = new THREE.Vector3(me.pos.x, 1.62, me.pos.z);
    if (this.fpLookAt) {
      const d = this.fpLookAt.clone().sub(eye);
      this.fpYaw += wrapA(Math.atan2(d.x, d.z) - this.fpYaw) * (1 - Math.exp(-dt * 5));
      this.fpPitch = damp(this.fpPitch, Math.atan2(d.y, Math.hypot(d.x, d.z)), 5, dt);
    }
    // gentle head bob while walking
    const walk = Math.min(1, speed / 1.6);
    this.bob += dt * speed * 4.3;
    eye.y += Math.sin(this.bob * 2) * 0.022 * walk;
    const rx = -Math.cos(this.fpYaw);
    const rz = Math.sin(this.fpYaw);
    eye.x += rx * Math.sin(this.bob) * 0.012 * walk;
    eye.z += rz * Math.sin(this.bob) * 0.012 * walk;
    const dir = new THREE.Vector3(Math.sin(this.fpYaw) * Math.cos(this.fpPitch), Math.sin(this.fpPitch), Math.cos(this.fpYaw) * Math.cos(this.fpPitch));
    this.camPos.copy(eye);
    this.camTarget.copy(eye).add(dir);
    this.camera.position.copy(eye);
    this.camera.lookAt(this.camTarget);
    if (Math.abs(this.camera.fov - 70) > 0.01 && window.innerWidth >= 700) {
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
    }
    // the carried part sits in your hands, low and to the right of the view
    const anchorW = eye.clone().add(dir.clone().multiplyScalar(0.55)).add(new THREE.Vector3(rx, 0, rz).multiplyScalar(0.12)).add(new THREE.Vector3(0, -0.3, 0));
    me.eng.root.updateMatrixWorld();
    me.eng.carryAnchor.position.copy(me.eng.root.worldToLocal(anchorW));
    me.eng.carryAnchor.rotation.set(-this.fpPitch * 0.7, 0, 0);
  }

  private thirdPersonCamera(me: Walker, speed: number, dt: number) {
    me.eng.setBodyVisible(true);
    me.eng.fpHands.visible = false;
    me.eng.carryAnchor.position.set(0, 1.1, 0.42);
    me.eng.carryAnchor.rotation.set(0, 0, 0);
    if (Math.abs(this.camera.fov - 52) > 0.01 && window.innerWidth >= 700) {
      this.camera.fov = 52;
      this.camera.updateProjectionMatrix();
    }
    const target = new THREE.Vector3(me.pos.x, 1.45, me.pos.z);
    let yaw = this.camYaw;
    let dist = this.camDist;
    let pitch = this.camPitch;
    if (this.focus) {
      target.copy(this.focus.target);
      yaw = this.focus.yaw;
      dist = this.focus.dist;
      pitch = this.focus.pitch;
      this.camYaw = damp(this.camYaw, yaw, 3, dt);
    } else if (speed > 0.6 && !this.pointer.drag && (this.goal || this.hud.joyVec.x || this.hud.joyVec.y)) {
      // gently swing the camera behind the walker when click-walking
      this.camYaw += wrapA(me.eng.heading + Math.PI - this.camYaw) * (1 - Math.exp(-dt * 0.8));
    }
    this.camTarget.x = damp(this.camTarget.x, target.x, 7, dt);
    this.camTarget.y = damp(this.camTarget.y, target.y, 7, dt);
    this.camTarget.z = damp(this.camTarget.z, target.z, 7, dt);
    const cy = this.focus ? damp(this.camYaw, yaw, 4, dt) : this.camYaw;
    const desired = new THREE.Vector3(
      this.camTarget.x + Math.sin(cy) * Math.cos(pitch) * dist,
      this.camTarget.y + Math.sin(pitch) * dist,
      this.camTarget.z + Math.cos(cy) * Math.cos(pitch) * dist,
    );
    desired.x = Math.max(-ROOM.x + 0.4, Math.min(ROOM.x - 0.4, desired.x));
    desired.z = Math.max(-ROOM.z + 0.4, Math.min(ROOM.z - 0.4, desired.z));
    desired.y = Math.max(0.5, Math.min(ROOM.h - 1.5, desired.y));
    this.camPos.x = damp(this.camPos.x, desired.x, 6, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, 6, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, 6, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** What is under the crosshair (first person)? */
  private updateAim() {
    if (this.openId || this.mode !== 'play') {
      this.setAim(null);
      return;
    }
    this.ray.setFromCamera(new THREE.Vector2(this.viewShift > 0.5 ? -((this.viewShift * 2) / this.renderer.domElement.clientWidth) : 0, 0), this.camera);
    this.ray.far = 7;
    const hits = this.ray.intersectObjects([this.stationGroup, this.craftHolder], true);
    this.ray.far = Infinity;
    let found: typeof this.aim = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let vis = true;
      while (o) {
        if (!o.visible) vis = false;
        o = o.parent;
      }
      if (!vis) continue;
      const ud = h.object.userData;
      if (ud.slotKey && h.distance < 4.8) found = { kind: 'slot', key: ud.slotKey, sid: ud.stationId, dist: h.distance, obj: h.object };
      else if (ud.craft && h.distance < 7) found = { kind: 'craft', dist: h.distance, obj: h.object };
      else if (ud.stationId && h.distance < 4.5) found = { kind: 'station', sid: ud.stationId, dist: h.distance, obj: h.object };
      break;
    }
    this.setAim(found);
  }

  private setAim(a: typeof this.aim) {
    this.aim = a;
    if (!a) {
      this.hud.aimLabel(null);
      if (this.hovered) this.setHover(null);
      return;
    }
    const d = this.design!;
    if (a.kind === 'slot' && a.key) {
      const f = this.slot(a.key);
      if (f) this.setHover(f.s.obj);
      const rocket = a.key.startsWith('rocketId:');
      this.hud.aimLabel(`<b>${partName(a.key, d, this.app.ev!)}</b><span><kbd>E</kbd> ${rocket ? 'Choose this rocket' : 'Pick it up'}</span>`);
    } else if (a.kind === 'craft') {
      this.setHover(null);
      const tip = this.craftTip(a.obj);
      this.hud.aimLabel(this.carrying.length ? `<b>Your spacecraft</b><span><kbd>E</kbd> Install ${this.carrying.length > 1 ? `${this.carrying.length} parts` : partName(this.carrying[0])}</span>` : tip ? `<b>${tip.split(' · ')[0]}</b><span>on the spacecraft</span>` : `<b>Your spacecraft</b>`);
    } else if (a.kind === 'station' && a.sid) {
      this.setHover(null);
      this.hud.aimLabel(`<b>${stationById(a.sid).name}</b><span><kbd>E</kbd> Use</span>`);
    }
  }

  private updateLabels() {
    const d = this.design;
    const ev = this.app.ev;
    if (!d || !ev) return;
    const tasks = tasksFor(d, ev, this.ctx());
    const cur = tasks.find((t) => t.current)?.station;
    const me = this.walkers[this.active];
    const r = this.renderer.domElement.getBoundingClientRect();
    const list: Label[] = this.stations.map((st) => {
      const p = new THREE.Vector3(...st.def.label);
      const dist = Math.hypot(me.pos.x - p.x, me.pos.z - p.z);
      p.project(this.camera);
      const show = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && this.openId !== st.def.id;
      const mine = tasks.filter((t) => t.station === st.def.id);
      const stt = mine.some((t) => t.st === 'fail') ? 'fail' : mine.some((t) => t.st === 'warn') ? 'warn' : mine.length ? 'ok' : 'none';
      return {
        id: st.def.id,
        x: r.left + ((p.x + 1) / 2) * r.width,
        y: r.top + ((1 - p.y) / 2) * r.height,
        show,
        name: st.def.name,
        color: ROLE_INFO[st.def.role].color,
        st: stt,
        current: cur === st.def.id,
        dist,
      };
    });
    this.hud.labels(list);
  }

  private drawMap() {
    const d = this.design;
    if (!d) return;
    const tasks = tasksFor(d, this.app.ev!, this.ctx());
    const cur = tasks.find((t) => t.current)?.station;
    this.hud.minimap((ctx, W, H) => {
      const sx = (x: number) => ((x + ROOM.x) / (ROOM.x * 2)) * (W - 20) + 10;
      const sz = (z: number) => ((z + ROOM.z) / (ROOM.z * 2)) * (H - 20) + 10;
      ctx.fillStyle = 'rgba(10,14,20,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, W - 20, H - 20);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(sx(-5.5), sz(ROOM.z) - 4, sx(5.5) - sx(-5.5), 6);
      ctx.beginPath();
      ctx.arc(sx(CRAFT_POS.x), sz(CRAFT_POS.z), (RING_R / (ROOM.x * 2)) * (W - 20), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(242,194,48,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,194,48,0.7)';
      ctx.stroke();
      for (const st of this.stations) {
        const x = sx(st.def.stand[0]);
        const z = sz(st.def.stand[1]);
        ctx.beginPath();
        ctx.arc(x, z, cur === st.def.id ? 9 : 6, 0, Math.PI * 2);
        ctx.fillStyle = ROLE_INFO[st.def.role].color;
        ctx.globalAlpha = cur === st.def.id ? 1 : 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (cur === st.def.id) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      this.walkers.forEach((w, i) => {
        const x = sx(w.pos.x);
        const z = sz(w.pos.z);
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(-w.eng.heading + Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(7, 7);
        ctx.lineTo(0, 3);
        ctx.lineTo(-7, 7);
        ctx.closePath();
        ctx.fillStyle = i === this.active ? '#ffffff' : ROLE_INFO[w.role].color;
        ctx.fill();
        ctx.restore();
      });
    });
  }
}

function $modalOpen(): boolean {
  const m = document.querySelector('#modal-root');
  return !!m && m.children.length > 0;
}

const INTRO: Partial<Record<StationId, (d: Design) => string>> = {
  power: (d) =>
    missionOf(d).target === 'mars'
      ? 'Power rack. Solar panels are cheap, but Martian dust storms can bury them. The MMRTG nuclear battery works day and night. Click a part to pick it up.'
      : missionOf(d).target === 'jupiter'
        ? 'Power rack. Jupiter gets 4% of the sunlight Earth does. Juno flew giant solar wings; Galileo flew nuclear. Pick one up.'
        : 'Power rack. At Pluto sunlight is 0.06% of Earth\'s, so solar panels are useless. New Horizons flew one GPHS-RTG.',
  systems: () => 'Avionics and batteries. A backup computer saves the mission when a part fails. Batteries cover peak loads and the night.',
  fuel: () => 'Fuel cart. Hold E (or the pump button) to load hydrazine. More fuel means more Δv for course corrections and braking, but more mass for the rocket.',
  landing: () => 'Landing systems. Your rover\'s mass decides which one can land it. The crane will move the one you choose.',
  orbit: () => 'Orbit planning. A tight orbit gives more close passes for science, but needs a bigger braking burn. A moon tour flies through the worst radiation.',
  science: () => 'Science lab. Instruments marked with a star count extra for your goal. Every instrument adds mass, power, cost and data. Pick up to three and carry them over.',
  comms: () => 'Antennas and radios. Data rate grows with dish area and drops with distance squared. A bigger dish gets more science home, but weighs more.',
  ops: () => 'Ground and budget. Rent Deep Space Network time here and watch the budget. Every part has a price.',
  flight: () => 'Flight Dynamics. Planets have to line up: open the launch-window chart and pick a date. Blue means cheap.',
  rockets: () => 'Rocket models, 1:45 scale. The rocket must lift your spacecraft\'s mass to your launch energy. Bigger rockets cost more.',
  gate: () => 'The launch gate. When every station reports GO, hold the launch button to roll out to the pad.',
};

