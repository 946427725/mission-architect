import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { AU, BODIES, BodyId, MU_SUN, DAY } from '../physics/constants';
import { orbitPath, planetState } from '../physics/ephemeris';
import { propagate } from '../physics/kepler';
import { Transfer } from '../physics/porkchop';
import { V3 } from '../physics/vec';
import { glowTexture, planetTexture, ringTexture } from './textures';

export const UNITS_PER_AU = 10;
const S = UNITS_PER_AU / AU;
/** ecliptic km -> scene units (ecliptic plane is horizontal, y is up) */
export const toScene = (r: V3): THREE.Vector3 => new THREE.Vector3(r[0] * S, r[2] * S, -r[1] * S);

const VISUAL_RADIUS: Record<BodyId, number> = {
  mercury: 0.12, venus: 0.2, earth: 0.22, mars: 0.17, jupiter: 0.7, saturn: 0.6, uranus: 0.4, neptune: 0.4, pluto: 0.12,
};
const ALL: BodyId[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

interface PlanetObj {
  group: THREE.Group;
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  label: CSS2DObject;
  orbit: THREE.Line;
}

interface ArcSample {
  jd: number;
  p: THREE.Vector3;
}

export class SolarSystemView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private labels: CSS2DRenderer;
  private planets = new Map<BodyId, PlanetObj>();
  private transferGroup = new THREE.Group();
  private craft: THREE.Sprite;
  private trail: Line2;
  private trailMat: LineMaterial;
  private arc: ArcSample[] = [];
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
  private follow: BodyId | 'craft' | null = null;
  private followOffset = new THREE.Vector3();
  private closeupModel: THREE.Object3D | null = null;
  private jd = 0;
  private highlight = new Set<BodyId>();
  private lineMats: LineMaterial[] = [];
  private insetLeft = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.005, 50000);
    this.camera.position.set(0, 18, 28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 3000;
    this.controls.addEventListener('start', () => {
      this.camAnim = null;
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.45, 0.85));
    this.composer.addPass(new OutputPass());

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    const sunLight = new THREE.PointLight(0xfff2dd, 3.2, 0, 0);
    this.scene.add(sunLight);

    this.buildStars();
    this.buildSun();
    for (const id of ALL) this.buildPlanet(id);
    this.scene.add(this.transferGroup);

    const craftMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,244,214,1)', 'rgba(227,162,26,0)'), depthTest: false, transparent: true, blending: THREE.AdditiveBlending });
    this.craft = new THREE.Sprite(craftMat);
    this.craft.material.sizeAttenuation = false;
    this.craft.scale.setScalar(0.045);
    this.craft.visible = false;
    this.craft.renderOrder = 10;
    this.scene.add(this.craft);

    this.trailMat = this.lineMaterial(0xffd27a, 3, 1);
    this.trail = new Line2(new LineGeometry(), this.trailMat);
    this.trail.visible = false;
    this.scene.add(this.trail);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private lineMaterial(color: number, width: number, opacity: number): LineMaterial {
    const m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, worldUnits: false });
    m.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.lineMats.push(m);
    return m;
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.insetLeft > 0) this.camera.setViewOffset(w, h, -this.insetLeft / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
  }

  /** Shift the view centre right so a left-side panel does not hide the scene. */
  setViewInset(left: number) {
    if (left === this.insetLeft) return;
    this.insetLeft = left;
    this.resize();
  }

  private buildStars() {
    const n = 5000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 8000;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const t = Math.random();
      const c = t < 0.15 ? [1, 0.8, 0.65] : t < 0.3 ? [0.7, 0.8, 1] : [1, 1, 1];
      const b = 0.4 + Math.random() * 0.6;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
    this.scene.add(stars);
  }

  private buildSun() {
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 48, 32),
      new THREE.MeshBasicMaterial({ map: planetTexture('sun'), color: new THREE.Color(2.2, 1.7, 1.2) }),
    );
    this.scene.add(sun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(4.2);
    this.scene.add(glow);
    const div = document.createElement('div');
    div.className = 'body-label sun';
    div.textContent = 'Sun';
    const lbl = new CSS2DObject(div);
    lbl.position.set(0, 1.3, 0);
    sun.add(lbl);
  }

  private buildPlanet(id: BodyId) {
    const group = new THREE.Group();
    const radius = VISUAL_RADIUS[id];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 32),
      new THREE.MeshStandardMaterial({ map: planetTexture(id), roughness: 0.9, metalness: 0 }),
    );
    if (id === 'saturn') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.3, radius * 2.3, 96),
        new THREE.MeshBasicMaterial({ map: ringTexture(), side: THREE.DoubleSide, transparent: true }),
      );
      // map the 1D texture radially
      const uv = ring.geometry.attributes.uv as THREE.BufferAttribute;
      const p = ring.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (r - radius * 1.3) / (radius * 1.0), 0.5);
      }
      ring.rotation.x = -Math.PI / 2 + 0.47;
      mesh.add(ring);
    }
    mesh.rotation.z = id === 'uranus' ? 1.7 : 0.4;
    group.add(mesh);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color: BODIES[id].color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.material.sizeAttenuation = false;
    halo.scale.setScalar(0.03);
    group.add(halo);
    const div = document.createElement('div');
    div.className = 'body-label';
    div.textContent = BODIES[id].name;
    const label = new CSS2DObject(div);
    label.position.set(0, radius + 0.25, 0);
    group.add(label);
    this.scene.add(group);

    const pts = orbitPath(id, 2461360).map(toScene);
    const orbit = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: BODIES[id].color, transparent: true, opacity: 0.22 }),
    );
    this.scene.add(orbit);
    this.planets.set(id, { group, mesh, halo, label, orbit });
  }

  /** Emphasise the bodies that matter for this mission. */
  setHighlight(ids: BodyId[]) {
    this.highlight = new Set(ids);
    for (const [id, p] of this.planets) {
      const on = this.highlight.has(id);
      const om = p.orbit.material as THREE.LineBasicMaterial;
      om.opacity = on ? 0.6 : 0.1;
      om.color.set(on ? BODIES[id].color : '#bdbab0');
      p.label.element.classList.toggle('dim', !on);
    }
  }

  setDate(jd: number) {
    this.jd = jd;
    for (const [id, p] of this.planets) {
      p.group.position.copy(toScene(planetState(id, jd).r));
      p.mesh.rotation.y = (jd % 1) * Math.PI * 2 * (id === 'jupiter' || id === 'saturn' ? 2.4 : 1);
    }
  }

  get date() {
    return this.jd;
  }

  bodyPosition(id: BodyId): THREE.Vector3 {
    return this.planets.get(id)!.group.position.clone();
  }

  /** Draw a transfer (and keep samples for spacecraft animation). */
  showTransfer(tr: Transfer | null, preview = false) {
    for (const c of [...this.transferGroup.children]) {
      this.transferGroup.remove(c);
      if (c instanceof Line2) {
        c.geometry.dispose();
        this.lineMats = this.lineMats.filter((m) => m !== c.material);
        c.material.dispose();
      }
    }
    if (!preview) this.arc = [];
    if (!tr) return;
    const samples: ArcSample[] = [];
    for (const leg of tr.legs) {
      const n = 240;
      const tof = (leg.arriveJD - leg.departJD) * DAY;
      let r = leg.r1;
      let v = leg.v1;
      const legPts: THREE.Vector3[] = [toScene(r)];
      samples.push({ jd: leg.departJD, p: toScene(r) });
      for (let i = 1; i <= n; i++) {
        const s = propagate(r, v, tof / n, MU_SUN);
        r = s.r;
        v = s.v;
        const p = toScene(r);
        legPts.push(p);
        samples.push({ jd: leg.departJD + ((leg.arriveJD - leg.departJD) * i) / n, p });
      }
      const g = new LineGeometry();
      g.setPositions(legPts.flatMap((p) => [p.x, p.y, p.z]));
      const colors: number[] = [];
      const c1 = new THREE.Color(preview ? 0x8a8f94 : 0xf2f1ec);
      const c2 = new THREE.Color(preview ? 0x9a8a6a : 0xe3a21a);
      legPts.forEach((_, i) => {
        const c = c1.clone().lerp(c2, i / legPts.length);
        colors.push(c.r, c.g, c.b);
      });
      g.setColors(colors);
      const mat = this.lineMaterial(0xffffff, preview ? 1.5 : 2.5, preview ? 0.6 : 0.95);
      mat.vertexColors = true;
      if (!preview) {
        mat.dashed = false;
      }
      const line = new Line2(g, mat);
      line.computeLineDistances();
      this.transferGroup.add(line);
    }
    if (!preview) this.arc = samples;
  }

  /** Put the spacecraft marker at date jd along the stored arc (with trail). */
  setCraftAt(jd: number | null) {
    if (jd === null || this.arc.length === 0) {
      this.craft.visible = false;
      this.trail.visible = false;
      return;
    }
    let i = 1;
    while (i < this.arc.length - 1 && this.arc[i].jd < jd) i++;
    const a = this.arc[i - 1];
    const b = this.arc[i];
    const t = b.jd === a.jd ? 1 : Math.min(1, Math.max(0, (jd - a.jd) / (b.jd - a.jd)));
    const p = a.p.clone().lerp(b.p, t);
    this.craft.position.copy(p);
    this.craft.visible = true;
    const pts = this.arc.slice(0, i).map((s) => s.p);
    pts.push(p);
    if (pts.length >= 2) {
      const g = new LineGeometry();
      g.setPositions(pts.flatMap((q) => [q.x, q.y, q.z]));
      this.trail.geometry.dispose();
      this.trail.geometry = g;
      this.trail.computeLineDistances();
      this.trail.visible = true;
    }
  }

  craftPosition() {
    return this.craft.position.clone();
  }

  /** Smoothly move the camera. */
  flyTo(target: THREE.Vector3, camPos: THREE.Vector3, dur = 1400) {
    this.camAnim = { from: this.camera.position.clone(), to: camPos, tFrom: this.controls.target.clone(), tTo: target, t0: performance.now(), dur };
  }

  /** Frame the inner part of the solar system out to `au`. */
  frameSystem(au: number, center = new THREE.Vector3()) {
    this.follow = null;
    const d = au * UNITS_PER_AU;
    this.flyTo(center, new THREE.Vector3(center.x + d * 0.15, d * 1.35, center.z + d * 1.55));
  }

  /** Follow a planet or the spacecraft at a given distance (scene units). */
  followTarget(what: BodyId | 'craft' | null, dist = 2.5) {
    this.follow = what;
    if (!what) return;
    const p = what === 'craft' ? this.craft.position.clone() : this.bodyPosition(what);
    // look from the sunlit side
    const toSun = p.clone().negate().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(toSun, up).normalize();
    this.followOffset.copy(toSun.multiplyScalar(dist * 0.75)).add(up.multiplyScalar(dist * 0.35)).add(side.multiplyScalar(dist * 0.6));
    this.flyTo(p, p.clone().add(this.followOffset), 1600);
  }

  /** Show a spacecraft model next to a planet for the arrival close-up. */
  setCloseupModel(obj: THREE.Object3D | null, body?: BodyId) {
    if (this.closeupModel) this.scene.remove(this.closeupModel);
    this.closeupModel = obj;
    if (obj && body) {
      obj.userData.body = body;
      this.scene.add(obj);
    }
  }

  private tick() {
    const now = performance.now();
    if (this.follow) {
      const p = this.follow === 'craft' ? this.craft.position : this.bodyPosition(this.follow);
      if (!this.camAnim) {
        const delta = p.clone().sub(this.controls.target);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      } else {
        this.camAnim.tTo.copy(p);
        this.camAnim.to.copy(p.clone().add(this.followOffset));
      }
    }
    if (this.camAnim) {
      const a = this.camAnim;
      let t = (now - a.t0) / a.dur;
      if (t >= 1) {
        t = 1;
        this.camAnim = null;
      }
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e);
    }
    if (this.closeupModel) {
      const body = this.closeupModel.userData.body as BodyId;
      const c = this.bodyPosition(body);
      const r = VISUAL_RADIUS[body] * 1.9;
      const ang = now * 0.00025;
      this.closeupModel.position.set(c.x + Math.cos(ang) * r, c.y + Math.sin(ang * 0.7) * r * 0.25, c.z + Math.sin(ang) * r);
      this.closeupModel.rotation.y = -ang;
    }
    // hide halos when you are close enough to see the sphere
    for (const [id, p] of this.planets) {
      const d = this.camera.position.distanceTo(p.group.position);
      p.halo.visible = d > VISUAL_RADIUS[id] * 60;
    }
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }
}
