// A clean-room engineer in a full "bunny suit" (hood, goggles, face mask,
// nitrile gloves, shoe covers) with a procedural walk / run / carry / reach rig.
import * as THREE from 'three';
import { M, at, cyl, rbox, sph } from './kit';

let _blob: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(20,24,30,0.85)');
  g.addColorStop(0.45, 'rgba(20,24,30,0.45)');
  g.addColorStop(1, 'rgba(20,24,30,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}

const capsule = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), m);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
}
interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

function badgeTexture(name: string, role: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f7f7f5';
  x.fillRect(0, 0, 256, 128);
  x.fillStyle = color;
  x.fillRect(0, 0, 256, 34);
  x.fillStyle = '#111';
  x.font = '800 38px Archivo, Arial, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(name.slice(0, 11).toUpperCase(), 14, 66);
  x.font = '600 22px Archivo, Arial, sans-serif';
  x.fillStyle = '#444';
  x.fillText(role, 14, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Engineer {
  readonly root = new THREE.Group();
  readonly carryAnchor = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private arms: [Arm, Arm];
  private legs: [Leg, Leg];
  private band: THREE.Mesh;
  private blob!: THREE.Mesh;
  /** gloved hands shown in first person while carrying */
  readonly fpHands = new THREE.Group();
  private badge: THREE.Mesh;
  heading = 0;
  private phase = 0;
  private speed = 0;
  private carryT = 0;
  private reachT = 0;
  private reachClock = -1;
  private t = Math.random() * 10;
  carrying = false;
  heavy = false;
  /** world point the engineer looks at (optional) */
  lookAt: THREE.Vector3 | null = null;
  onStep: ((foot: number, speed: number) => void) | null = null;
  private lastStepSign = 0;

  constructor(color = '#5ad1ff', name = 'Engineer', role = 'Systems') {
    const m = M();
    this.root.add(this.hips);
    this.hips.position.y = 0.98;
    // pelvis
    const pelvis = sph(0.2, m.suit, 28, 18);
    pelvis.scale.set(0.95, 0.62, 0.68);
    pelvis.position.y = -0.02;
    this.hips.add(pelvis);
    // torso (lathe profile, flattened front-to-back)
    const prof = [
      [0.0, -0.02], [0.165, 0.0], [0.178, 0.1], [0.185, 0.2], [0.205, 0.32], [0.212, 0.4], [0.19, 0.465], [0.12, 0.512], [0.065, 0.53], [0.0, 0.535],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), m.suit);
    torso.scale.z = 0.66;
    this.spine.add(torso);
    this.spine.position.y = 0.04;
    this.hips.add(this.spine);
    // zipper + storm flap + belt seam
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.44, 0.012), m.suitSeam);
    zip.position.set(0.012, 0.27, 0.124);
    zip.rotation.x = -0.07;
    this.spine.add(zip);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.012, 8, 40), m.suitSeam);
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.66;
    belt.position.y = 0.06;
    this.spine.add(belt);
    // name badge
    this.badge = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.065), new THREE.MeshStandardMaterial({ map: badgeTexture(name, role, color), roughness: 0.4 }));
    this.badge.position.set(-0.085, 0.36, 0.126);
    this.badge.rotation.y = -0.18;
    this.spine.add(this.badge);

    // neck + head (hood, face, goggles, mask)
    this.neck.position.y = 0.53;
    this.spine.add(this.neck);
    this.neck.add(at(cyl(0.065, 0.075, 0.1, m.suit, 20), 0, 0.03, 0));
    this.head.position.y = 0.08;
    this.neck.add(this.head);
    const face = sph(0.102, m.skin, 32, 24);
    face.scale.set(0.92, 1.1, 1);
    face.position.set(0, 0.1, 0.005);
    this.head.add(face);
    const hoodR = 0.128;
    const front = Math.PI / 2;
    const open = 0.95;
    const hoodBack = new THREE.Mesh(new THREE.SphereGeometry(hoodR, 40, 28, front + open, Math.PI * 2 - open * 2, 0, Math.PI), m.suit);
    const hoodTop = new THREE.Mesh(new THREE.SphereGeometry(hoodR, 20, 10, front - open, open * 2, 0, Math.PI * 0.33), m.suit);
    const hoodBot = new THREE.Mesh(new THREE.SphereGeometry(hoodR, 20, 10, front - open, open * 2, Math.PI * 0.74, Math.PI * 0.26), m.suit);
    for (const h of [hoodBack, hoodTop, hoodBot]) {
      h.scale.set(1, 1.12, 1.04);
      h.position.y = 0.1;
      h.material = m.suit;
      (h.material as THREE.Material).side = THREE.DoubleSide;
      this.head.add(h);
    }
    // hood edge (elastic face opening)
    const edge = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.011, 8, 32), m.suit);
    edge.scale.set(0.95, 1.25, 1);
    edge.position.set(0, 0.1, 0.112);
    edge.rotation.y = 0;
    this.head.add(edge);
    const gog = new THREE.Mesh(new THREE.SphereGeometry(0.108, 32, 8, front - 0.9, 1.8, Math.PI * 0.4, Math.PI * 0.13), m.goggle);
    gog.position.y = 0.1;
    gog.scale.set(1, 1.1, 1.1);
    this.head.add(gog);
    const gogFrame = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 4, front - 0.95, 1.9, Math.PI * 0.39, Math.PI * 0.015), m.goggleFrame);
    gogFrame.position.y = 0.1;
    gogFrame.scale.set(1, 1.1, 1.1);
    this.head.add(gogFrame);
    const gogFrame2 = gogFrame.clone();
    gogFrame2.geometry = new THREE.SphereGeometry(0.11, 32, 4, front - 0.95, 1.9, Math.PI * 0.53, Math.PI * 0.015);
    this.head.add(gogFrame2);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.106, 32, 10, front - 1.0, 2.0, Math.PI * 0.53, Math.PI * 0.27), m.mask);
    mask.position.y = 0.1;
    mask.scale.set(1, 1.1, 1.12);
    this.head.add(mask);

    // arms
    const mkArm = (side: number): Arm => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.222, 0.44, 0);
      this.spine.add(shoulder);
      shoulder.add(at(sph(0.082, m.suit, 20, 14), 0, -0.01, 0));
      const upper = capsule(0.068, 0.2, m.suit);
      upper.position.y = -0.15;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      elbow.add(sph(0.063, m.suit, 16, 12));
      const crease = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20), m.suit);
      crease.rotation.x = Math.PI / 2;
      crease.position.y = -0.03;
      elbow.add(crease);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.2, 18), m.suit);
      fore.position.y = -0.11;
      elbow.add(fore);
      const cuff = cyl(0.049, 0.046, 0.075, m.nitrile, 18);
      cuff.position.y = -0.235;
      elbow.add(cuff);
      const wrist = new THREE.Group();
      wrist.position.y = -0.27;
      elbow.add(wrist);
      const palm = rbox(0.085, 0.095, 0.04, 0.018, m.nitrile);
      palm.position.y = -0.05;
      wrist.add(palm);
      const fingers = rbox(0.08, 0.075, 0.032, 0.015, m.nitrile);
      fingers.position.set(0, -0.12, 0.008);
      fingers.rotation.x = 0.35;
      wrist.add(fingers);
      const thumb = capsule(0.014, 0.04, m.nitrile);
      thumb.position.set(-side * 0.045, -0.055, 0.025);
      thumb.rotation.z = side * 0.6;
      thumb.rotation.x = 0.5;
      wrist.add(thumb);
      return { shoulder, elbow, wrist };
    };
    this.arms = [mkArm(1), mkArm(-1)];
    // role colour armband on the left upper arm
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.063, 0.05, 20, 1, true), new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 }));
    this.band.position.y = -0.1;
    this.arms[0].shoulder.add(this.band);

    // legs
    const mkLeg = (side: number): Leg => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.098, -0.03, 0);
      this.hips.add(hip);
      const thigh = capsule(0.095, 0.3, m.suit);
      thigh.position.y = -0.21;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      knee.add(sph(0.078, m.suit, 16, 12));
      for (const dy of [-0.04, 0.03]) {
        const kc = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.013, 8, 22), m.suit);
        kc.rotation.x = Math.PI / 2;
        kc.position.y = dy;
        knee.add(kc);
      }
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.066, 0.36, 20), m.suit);
      shin.position.y = -0.2;
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.position.y = -0.44;
      knee.add(ankle);
      const boot = capsule(0.062, 0.15, m.suit);
      boot.rotation.x = Math.PI / 2;
      boot.scale.set(1, 1, 0.78);
      boot.position.set(0, -0.025, 0.05);
      ankle.add(boot);
      const cover = cyl(0.066, 0.07, 0.12, m.suit, 18);
      cover.position.y = 0.02;
      ankle.add(cover);
      const sole = rbox(0.115, 0.026, 0.285, 0.012, m.sole);
      sole.position.set(0, -0.073, 0.05);
      ankle.add(sole);
      return { hip, knee, ankle };
    };
    this.legs = [mkLeg(1), mkLeg(-1)];

    this.carryAnchor.position.set(0, 1.1, 0.42);
    this.root.add(this.carryAnchor);
    // The engineer does not cast into the (cached) shadow map; a soft contact
    // shadow follows them instead, so walking never forces a shadow re-render.
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.root.add(blob);
    this.blob = blob;
    // first-person hands (only visible from the player's own eyes while carrying)
    const m2 = M();
    for (const s of [-1, 1]) {
      const hand = new THREE.Group();
      const palm = rbox(0.085, 0.045, 0.15, 0.02, m2.nitrile);
      hand.add(palm);
      const cuff = cyl(0.045, 0.05, 0.12, m2.suit, 16);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = 0.12;
      hand.add(cuff);
      const thumb = capsule(0.014, 0.05, m2.nitrile);
      thumb.rotation.z = Math.PI / 2;
      thumb.position.set(-s * 0.05, 0.01, -0.03);
      hand.add(thumb);
      hand.position.set(s * 0.15, -0.07, 0.06);
      hand.rotation.set(0.25, 0, s * -0.35);
      this.fpHands.add(hand);
    }
    this.fpHands.visible = false;
    this.carryAnchor.add(this.fpHands);
  }

  setIdentity(color: string, name: string, role: string) {
    (this.band.material as THREE.MeshStandardMaterial).color.set(color);
    const mat = this.badge.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = badgeTexture(name, role, color);
    mat.needsUpdate = true;
  }

  /** First person: hide the body (the camera is in the head) but keep carried items. */
  setBodyVisible(v: boolean) {
    this.hips.visible = v;
    this.blob.visible = v;
  }

  /** True while a gesture or a pose blend is still playing. */
  busy(): boolean {
    return this.reachClock >= 0 || Math.abs(this.carryT - (this.carrying ? 1 : 0)) > 0.01 || this.speed > 0.05;
  }

  /** Play a short reach-forward gesture (pressing a button, grabbing a part). */
  reach() {
    this.reachClock = 0;
  }

  /** Advance animation. `vel` = current horizontal speed in m/s. */
  update(dt: number, vel: number) {
    this.t += dt;
    this.speed = lerp(this.speed, vel, 1 - Math.exp(-dt * 10));
    const sp = this.speed;
    this.carryT = lerp(this.carryT, this.carrying ? 1 : 0, 1 - Math.exp(-dt * 8));
    if (this.reachClock >= 0) {
      this.reachClock += dt;
      this.reachT = this.reachClock < 0.25 ? this.reachClock / 0.25 : this.reachClock < 0.55 ? 1 : Math.max(0, 1 - (this.reachClock - 0.55) / 0.3);
      if (this.reachClock > 0.85) this.reachClock = -1;
    } else this.reachT = 0;

    const walkT = clamp(sp / 1.4, 0, 1);
    const runT = clamp((sp - 2.0) / 1.6, 0, 1);
    const stride = lerp(1.45, 2.5, runT);
    this.phase += ((dt * sp) / stride) * Math.PI * 2;
    const A = 0.42 * walkT + 0.32 * runT;
    const K = lerp(0.95, 1.55, runT);
    const t = this.t;

    // legs
    for (let i = 0; i < 2; i++) {
      const p = this.phase + (i ? Math.PI : 0);
      const leg = this.legs[i];
      const thigh = -A * Math.sin(p);
      const knee = (0.06 + K * Math.max(0, Math.cos(p)) ** 1.6) * walkT + (1 - walkT) * 0.03;
      leg.hip.rotation.x = thigh - 0.05 * runT;
      leg.knee.rotation.x = knee;
      leg.ankle.rotation.x = -(thigh + knee) * 0.82 + 0.15 * walkT * Math.max(0, -Math.sin(p));
      leg.hip.rotation.z = (i ? -1 : 1) * 0.015;
    }
    const s = Math.sin(this.phase);
    if (walkT > 0.3) {
      const sign = Math.sign(s);
      if (sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        this.onStep?.(sign, sp);
      }
    }
    // body
    const bob = (0.022 * walkT + 0.03 * runT) * Math.cos(2 * this.phase);
    const breath = Math.sin(t * 1.6) * 0.006 * (1 - walkT);
    this.hips.position.y = 0.98 + bob - 0.02 * runT + breath * 0.3;
    this.hips.position.x = Math.sin(this.phase) * 0.012 * walkT + Math.sin(t * 0.45) * 0.008 * (1 - walkT);
    this.hips.rotation.y = 0.1 * A * s;
    this.hips.rotation.z = 0.025 * walkT * Math.sin(this.phase);
    this.spine.rotation.y = -this.hips.rotation.y * 1.4;
    this.spine.rotation.x = 0.05 * walkT + 0.18 * runT + breath + 0.05 * this.carryT;
    this.spine.rotation.z = -this.hips.rotation.z * 0.8;
    // head: stabilise and optionally look at something
    let yaw = -this.spine.rotation.y - this.hips.rotation.y;
    let pitch = -this.spine.rotation.x * 0.7;
    if (this.lookAt) {
      const wp = new THREE.Vector3();
      this.head.getWorldPosition(wp);
      const dir = this.lookAt.clone().sub(wp);
      const local = Math.atan2(dir.x, dir.z) - this.heading;
      const wrap = Math.atan2(Math.sin(local), Math.cos(local));
      yaw += clamp(wrap, -1.1, 1.1);
      pitch += clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.5, 0.6);
    } else {
      yaw += Math.sin(t * 0.37) * 0.25 * (1 - walkT);
    }
    this.neck.rotation.y = lerp(this.neck.rotation.y, yaw * 0.4, 1 - Math.exp(-dt * 6));
    this.head.rotation.y = lerp(this.head.rotation.y, yaw * 0.6, 1 - Math.exp(-dt * 6));
    this.head.rotation.x = lerp(this.head.rotation.x, pitch, 1 - Math.exp(-dt * 6));

    // arms: swing -> carry pose -> reach (right arm)
    const AA = 0.32 * walkT + 0.55 * runT;
    for (let i = 0; i < 2; i++) {
      const side = i ? -1 : 1;
      const p = this.phase + (i ? Math.PI : 0);
      const arm = this.arms[i];
      let sx = AA * Math.sin(p);
      let sz = side * (0.09 + 0.04 * runT);
      let el = -(0.3 + 0.15 * walkT + 0.85 * runT) - Math.max(0, Math.sin(p)) * 0.15 * walkT;
      let wr = 0;
      // carry pose (both forearms forward, hands under the load)
      sx = lerp(sx, -0.55 + Math.sin(p) * 0.04 * walkT, this.carryT);
      sz = lerp(sz, side * (this.heavy ? 0.28 : 0.2), this.carryT);
      el = lerp(el, this.heavy ? -1.0 : -1.2, this.carryT);
      wr = lerp(wr, 0.3, this.carryT);
      if (i === 1 && this.reachT > 0) {
        sx = lerp(sx, -1.35, this.reachT);
        sz = lerp(sz, -0.12, this.reachT);
        el = lerp(el, -0.25, this.reachT);
      }
      arm.shoulder.rotation.set(sx, 0, sz);
      arm.elbow.rotation.set(el, 0, 0);
      arm.wrist.rotation.set(wr, 0, 0);
      arm.shoulder.rotation.y = side * this.carryT * 0.25;
    }
    this.root.rotation.y = this.heading;
  }
}
