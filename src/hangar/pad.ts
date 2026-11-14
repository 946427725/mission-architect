// Launch pad cinematic: dawn sky, service tower, cryogenic venting, countdown,
// ignition, smoke clouds pushed out of the flame trench, liftoff and ascent.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { rocketById } from '../data/rockets';
import { Design, missionOf } from '../game/state';
import { formatJD } from '../physics/time';
import { sound } from '../ui/sound';
import { M, at, box, cyl, rod, shade, sph, v3 } from './kit';
import { buildRocket } from './rockets3d';
import { concreteSet, groundTexture, puffTexture } from './tex';

const N = 2200;

const smokeVS = /* glsl */ `
attribute vec3 iOffset;
attribute float iSize;
attribute float iAlpha;
attribute float iHeat;
attribute float iRot;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vH;
void main() {
  vUv = uv;
  vAlpha = iAlpha;
  vHeat = iHeat;
  vH = iOffset.y;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
  vec3 world = iOffset + right * p.x + up * p.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const smokeFS = /* glsl */ `
uniform sampler2D map;
uniform vec3 sunCol;
uniform float flame;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vH;
void main() {
  float a = texture2D(map, vUv).a * vAlpha;
  if (a < 0.003) discard;
  float shade = 0.55 + 0.45 * smoothstep(0.2, 0.9, vUv.y);
  vec3 smoke = vec3(0.86, 0.84, 0.82) * sunCol * shade;
  vec3 glow = vec3(1.0, 0.55, 0.2) * flame * exp(-vH * 0.035) * 0.9;
  vec3 col = mix(smoke + glow, vec3(1.0, 0.62, 0.3) * 1.6, vHeat);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const flameVS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flameFS = /* glsl */ `
uniform float time;
uniform float power;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float y = 1.0 - vUv.y; // 0 at the nozzle, 1 at the tip
  float n = noise(vec2(vUv.x * 10.0, y * 6.0 - time * 14.0));
  float core = smoothstep(0.55, 0.0, y) ;
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.15, 1.0, y + n * 0.25)) * power;
  vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.75), core);
  col += vec3(1.0, 0.95, 0.85) * pow(core, 3.0) * 2.0;
  float diamonds = 0.5 + 0.5 * sin(y * 40.0 - time * 3.0);
  col += vec3(0.6, 0.6, 1.0) * diamonds * core * 0.4;
  gl_FragColor = vec4(col * (1.6 + n), a * (0.55 + 0.45 * edge));
}`;

export class LaunchPad {
  active = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
  private composer: EffectComposer;
  private rocket: THREE.Group | null = null;
  private rocketH = 60;
  private flame: THREE.Mesh;
  private flameMat: THREE.ShaderMaterial;
  private fireLight: THREE.PointLight;
  private smoke: THREE.Mesh;
  private smokeGeo: THREE.InstancedBufferGeometry;
  private smokeMat: THREE.ShaderMaterial;
  private P = {
    pos: new Float32Array(N * 3),
    vel: new Float32Array(N * 3),
    age: new Float32Array(N),
    life: new Float32Array(N),
    size0: new Float32Array(N),
    size1: new Float32Array(N),
    heat: new Float32Array(N),
    rot: new Float32Array(N),
    kind: new Uint8Array(N),
  };
  private next = 0;
  private t = 0;
  private done: (() => void) | null = null;
  private ui: HTMLElement;
  private lastCount = 99;
  private liftT = -1;
  private y = 0;
  private v = 0;
  private sunDir = new THREE.Vector3();
  private tower = new THREE.Group();
  private frameN = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0xcdb9a6, 0.00028);
    // sky at dawn
    const sky = new Sky();
    sky.scale.setScalar(15000);
    const u = sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.85;
    const phi = THREE.MathUtils.degToRad(90 - 9);
    const theta = THREE.MathUtils.degToRad(115);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    sc.add(sky);
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    sc.environment = pm.fromScene(envScene, 0.02).texture;
    sc.environmentIntensity = 0.6;
    const sun = new THREE.DirectionalLight(0xffd6a8, 3.2);
    sun.position.copy(this.sunDir).multiplyScalar(400);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const scam = sun.shadow.camera;
    scam.left = -90;
    scam.right = 90;
    scam.top = 130;
    scam.bottom = -40;
    scam.near = 10;
    scam.far = 1200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    sc.add(sun, sun.target);
    sc.add(new THREE.HemisphereLight(0x9cc4ee, 0x6b5a45, 0.7));

    // ground: scrub + sand, a concrete pad, the ocean on the horizon
    const gt = groundTexture();
    gt.repeat.set(60, 60);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ map: gt, color: 0xffffff, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    sc.add(ground);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(20000, 8000), new THREE.MeshStandardMaterial({ color: 0x1f3a52, roughness: 0.12, metalness: 0.4 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.2, -5200);
    sc.add(sea);
    const cs = concreteSet();
    for (const t of [cs.map, cs.normalMap, cs.roughnessMap]) t.repeat.set(16, 16);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(110, 64), new THREE.MeshStandardMaterial({ map: cs.map, normalMap: cs.normalMap, roughnessMap: cs.roughnessMap, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    sc.add(pad);
    const m = M();
    // launch mount + flame trench
    const mount = new THREE.Group();
    mount.add(at(box(22, 6, 22, m.paintGrey), 0, 3, 0));
    mount.add(at(box(10, 6.2, 10, new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 1 })), 0, 3, 0));
    const trench = box(14, 0.2, 90, new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 1 }));
    trench.position.set(0, 0.1, 0);
    trench.rotation.y = Math.PI / 2;
    mount.add(trench);
    sc.add(shade(mount));
    // lightning masts with catenary wires
    const masts: THREE.Vector3[] = [v3(-60, 0, -50), v3(60, 0, -50), v3(0, 0, 70)];
    for (const p of masts) {
      const g = new THREE.Group();
      g.add(at(cyl(0.9, 1.4, 120, m.paintGrey, 12), 0, 60, 0));
      g.add(at(cyl(0.2, 0.2, 12, m.steel, 6), 0, 126, 0));
      g.position.copy(p);
      sc.add(shade(g));
    }
    for (let i = 0; i < 3; i++) {
      const a = masts[i].clone().setY(124);
      const b = masts[(i + 1) % 3].clone().setY(124);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        pts.push(a.clone().lerp(b, t).add(v3(0, -Math.sin(t * Math.PI) * 18, 0)));
      }
      sc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 })));
    }
    // water tower
    const wt = new THREE.Group();
    wt.add(at(sph(9, m.paintWhite, 32, 20), 0, 72, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      wt.add(rod(v3(Math.cos(a) * 7, 66, Math.sin(a) * 7), v3(Math.cos(a) * 11, 0, Math.sin(a) * 11), 0.7, m.paintGrey, 8));
    }
    wt.add(at(cyl(1.5, 1.5, 70, m.paintGrey, 12), 0, 35, 0));
    wt.position.set(170, 0, -120);
    sc.add(shade(wt));
    sc.add(this.tower);

    // exhaust flame
    this.flameMat = new THREE.ShaderMaterial({ vertexShader: flameVS, fragmentShader: flameFS, uniforms: { time: { value: 0 }, power: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.flame = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 6, 40, 32, 1, true), this.flameMat);
    this.flame.visible = false;
    sc.add(this.flame);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 600, 1.4);
    sc.add(this.fireLight);

    // smoke + vapour particles (instanced camera-facing quads)
    const base = new THREE.PlaneGeometry(1, 1);
    this.smokeGeo = new THREE.InstancedBufferGeometry();
    this.smokeGeo.index = base.index;
    this.smokeGeo.setAttribute('position', base.getAttribute('position'));
    this.smokeGeo.setAttribute('uv', base.getAttribute('uv'));
    this.smokeGeo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    for (const n of ['iSize', 'iAlpha', 'iHeat', 'iRot']) this.smokeGeo.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo.instanceCount = N;
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: smokeVS,
      fragmentShader: smokeFS,
      uniforms: { map: { value: puffTexture() }, sunCol: { value: new THREE.Color(1.0, 0.86, 0.74) }, flame: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.smoke = new THREE.Mesh(this.smokeGeo, this.smokeMat);
    this.smoke.frustumCulled = false;
    sc.add(this.smoke);

    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(sc, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 3.2));
    this.composer.addPass(new OutputPass());

    this.ui = document.createElement('div');
    this.ui.className = 'pad-ui';
    document.body.appendChild(this.ui);
  }

  resize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildTower(h: number) {
    this.tower.clear();
    const m = M();
    const red = new THREE.MeshStandardMaterial({ color: 0x8a2b20, roughness: 0.6, metalness: 0.3 });
    const H = h + 12;
    const s = 9;
    const g = new THREE.Group();
    for (const [x, z] of [[-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]]) g.add(at(box(0.7, H, 0.7, red), x, H / 2, z));
    for (let y = 0; y < H; y += 6) {
      for (const z of [-s / 2, s / 2]) {
        g.add(at(box(s, 0.4, 0.4, red), 0, y, z));
        g.add(rod(v3(-s / 2, y, z), v3(s / 2, y + 6, z), 0.18, red, 4));
      }
      for (const x of [-s / 2, s / 2]) {
        g.add(at(box(0.4, 0.4, s, red), x, y, 0));
        g.add(rod(v3(x, y, -s / 2), v3(x, y + 6, s / 2), 0.18, red, 4));
      }
      if (y % 12 === 0) g.add(at(box(s, 0.2, s, m.steel), 0, y, 0));
    }
    // access arm + umbilicals
    g.add(at(box(9, 3, 3, red), s / 2 + 4.5, h * 0.82, 0));
    g.add(at(box(2, 2.6, 2.6, m.paintWhite), s / 2 + 9, h * 0.82, 0));
    for (const fy of [0.3, 0.55]) g.add(at(box(7, 0.6, 0.6, m.darkMetal), s / 2 + 3.5, h * fy, 0));
    g.position.set(-(s / 2 + 12), 6, 0);
    this.tower.add(shade(g));
  }

  start(d: Design, done: () => void) {
    if (this.rocket) this.scene.remove(this.rocket);
    this.rocket = buildRocket(d.rocketId);
    this.rocketH = this.rocket.userData.height as number;
    this.rocket.position.y = 6;
    this.scene.add(this.rocket);
    this.buildTower(this.rocketH);
    const r = rocketById(d.rocketId);
    const wide = d.rocketId === 'falconheavy' || d.rocketId === 'sls';
    this.flame.scale.set(wide ? 2.1 : 1, 1, wide ? 1.4 : 1);
    this.done = done;
    this.t = 0;
    this.liftT = -1;
    this.y = 0;
    this.v = 0;
    this.lastCount = 99;
    this.P.age.fill(0);
    this.P.life.fill(0);
    this.flame.visible = false;
    this.fireLight.intensity = 0;
    this.active = true;
    this.renderer.toneMappingExposure = 0.62;
    const m = missionOf(d);
    this.ui.innerHTML = `<div class="pad-cap"><span>${m.name}</span><b>${r.name}</b><em>${d.transfer ? formatJD(d.transfer.launchJD) : ''}</em></div><div class="pad-count"></div><button class="pad-skip" data-act="pad-skip">Skip ›</button>`;
    this.ui.classList.add('show');
    this.ui.querySelector('.pad-skip')!.addEventListener('click', () => this.finish());
    sound.padAmbience(true);
  }

  stop() {
    this.active = false;
    this.renderer.toneMappingExposure = 1.05;
    this.ui.classList.remove('show');
    sound.padAmbience(false);
    sound.rumble(false);
  }

  private finish() {
    if (!this.active) return;
    const cb = this.done;
    this.done = null;
    this.ui.classList.add('fade');
    setTimeout(() => {
      this.ui.classList.remove('fade');
      cb?.();
    }, 500);
  }

  private emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, heat: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const P = this.P;
    P.pos.set([x, y, z], i * 3);
    P.vel.set([vx, vy, vz], i * 3);
    P.age[i] = 0.0001;
    P.life[i] = life;
    P.size0[i] = s0;
    P.size1[i] = s1;
    P.heat[i] = heat;
    P.rot[i] = Math.random() * Math.PI * 2;
    P.kind[i] = kind;
  }

  update(dt: number) {
    if (!this.active || !this.rocket) return;
    this.t += dt;
    const t = this.t;
    const H = this.rocketH;
    const rnd = Math.random;
    // ---- countdown T-6 .. T-0 between t = 2 and t = 8
    const T0 = 8;
    const remain = Math.ceil(T0 - t);
    const cd = this.ui.querySelector('.pad-count') as HTMLElement;
    if (t > 2 && remain >= 0 && remain !== this.lastCount && remain <= 6) {
      this.lastCount = remain;
      cd.textContent = remain === 0 ? 'LIFTOFF' : `T−${remain}`;
      cd.className = `pad-count on ${remain === 0 ? 'lift' : ''}`;
      if (remain > 0) sound.countBeep(remain);
    }
    if (t > T0 + 2.5) cd.className = 'pad-count';
    // ---- ignition and liftoff
    const ign = T0 - 0.6;
    if (t > ign && this.liftT < 0 && t > T0) {
      this.liftT = 0;
      sound.liftoff();
    }
    if (t > ign && !this.flame.visible) {
      this.flame.visible = true;
      sound.rumble(true);
    }
    if (this.liftT >= 0) {
      this.liftT += dt;
      const a = 2.2 + this.liftT * 1.6;
      this.v += a * dt;
      this.y += this.v * dt;
    }
    this.rocket.position.y = 6 + this.y;
    const power = t > ign ? Math.min(1, (t - ign) / 0.8) : 0;
    this.flameMat.uniforms.time.value = t;
    this.flameMat.uniforms.power.value = power;
    const flameLen = 40 + Math.min(120, this.y * 1.5);
    this.flame.scale.y = flameLen / 40;
    this.flame.position.set(0, this.rocket.position.y - (flameLen / 2) * 0.98 + 0.5, 0);
    this.fireLight.position.set(0, Math.max(4, this.rocket.position.y - 10), 0);
    this.fireLight.intensity = power * (1400 + rnd() * 500) * Math.max(0.15, 1 - this.y / 600);
    this.smokeMat.uniforms.flame.value = power * Math.max(0, 1 - this.y / 400);

    // ---- particles: venting before ignition, trench clouds after
    if (t < T0 + 1 && this.liftT < 0.6)
      for (let k = 0; k < 3; k++) {
        const hy = 6 + H * (0.35 + rnd() * 0.5);
        const side = rnd() < 0.5 ? -1 : 1;
        this.emit(0, side * 2.4, hy, (rnd() - 0.5) * 2, side * (1 + rnd()), -1.2 - rnd(), (rnd() - 0.5) * 0.8, 3 + rnd() * 2, 0.8, 3.5, 0);
      }
    if (power > 0) {
      const n = Math.round(30 * power);
      for (let k = 0; k < n; k++) {
        if (this.y < 40) {
          const dir = rnd() < 0.5 ? -1 : 1;
          const sp = 22 + rnd() * 34;
          this.emit(1, dir * (6 + rnd() * 3), 2 + rnd() * 2, (rnd() - 0.5) * 8, dir * sp, 3 + rnd() * 9, (rnd() - 0.5) * 14, 6 + rnd() * 6, 5, 22 + rnd() * 18, 0.5);
        }
        if (this.y > 4 && k % 2 === 0) {
          const ry = this.rocket.position.y - flameLen * 0.8;
          this.emit(2, (rnd() - 0.5) * 4, ry, (rnd() - 0.5) * 4, (rnd() - 0.5) * 5, -6 - rnd() * 6, (rnd() - 0.5) * 5, 5 + rnd() * 4, 4, 16 + rnd() * 10, 0.6);
        }
      }
    }
    const P = this.P;
    const off = this.smokeGeo.getAttribute('iOffset') as THREE.InstancedBufferAttribute;
    const size = this.smokeGeo.getAttribute('iSize') as THREE.InstancedBufferAttribute;
    const alpha = this.smokeGeo.getAttribute('iAlpha') as THREE.InstancedBufferAttribute;
    const heat = this.smokeGeo.getAttribute('iHeat') as THREE.InstancedBufferAttribute;
    const rot = this.smokeGeo.getAttribute('iRot') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < N; i++) {
      if (P.age[i] <= 0) {
        (alpha.array as Float32Array)[i] = 0;
        continue;
      }
      P.age[i] += dt;
      const k = P.age[i] / P.life[i];
      if (k >= 1) {
        P.age[i] = 0;
        (alpha.array as Float32Array)[i] = 0;
        continue;
      }
      const drag = P.kind[i] === 1 ? 0.9 : 0.6;
      const f = Math.exp(-drag * dt);
      P.vel[i * 3] *= f;
      P.vel[i * 3 + 2] *= f;
      P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * f + (P.kind[i] === 0 ? -0.2 : 2.2) * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] = Math.max(1, P.pos[i * 3 + 1] + P.vel[i * 3 + 1] * dt);
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt + 1.2 * dt;
      (off.array as Float32Array).set([P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]], i * 3);
      (size.array as Float32Array)[i] = P.size0[i] + (P.size1[i] - P.size0[i]) * Math.sqrt(k);
      const fadeIn = Math.min(1, k * 12);
      (alpha.array as Float32Array)[i] = fadeIn * (1 - k) ** 1.3 * (P.kind[i] === 0 ? 0.5 : 0.85);
      (heat.array as Float32Array)[i] = P.heat[i] * Math.exp(-P.age[i] * 5);
      (rot.array as Float32Array)[i] = P.rot[i] + P.age[i] * 0.15;
    }
    off.needsUpdate = size.needsUpdate = alpha.needsUpdate = heat.needsUpdate = rot.needsUpdate = true;

    // ---- camera: wide dawn shot -> low angle at the pad -> long-lens tracking
    const cam = this.camera;
    const shake = power * Math.max(0, 1 - this.y / 250) * 0.35;
    const mid = 6 + H * 0.5;
    if (t < 4.5) {
      const k = t / 4.5;
      cam.position.set(105 - k * 25, 7 + k * 5, 135 - k * 30);
      cam.lookAt(0, mid * 0.85, 0);
      cam.fov = 36;
    } else if (t < T0 + 4.5) {
      const k = (t - 4.5) / (T0 + 4.5 - 4.5);
      cam.position.set(58 - k * 8, 2.4 + k * 2, 80 - k * 8);
      const ly = Math.max(mid * 0.55, this.rocket.position.y + H * 0.3);
      cam.lookAt(0, ly, 0);
      cam.fov = 52;
    } else {
      const k = Math.min(1, (t - T0 - 4.5) / 6);
      cam.position.set(420 - k * 60, 12, 520 - k * 40);
      cam.lookAt(0, this.rocket.position.y + H * 0.3, 0);
      cam.fov = 26 - k * 6;
    }
    cam.position.x += (rnd() - 0.5) * shake;
    cam.position.y += (rnd() - 0.5) * shake;
    cam.updateProjectionMatrix();
    if ((this.frameN++ & 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    if (t > T0 + 10.5) this.finish();
  }
}
