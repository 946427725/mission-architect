// Small turntable view of the player's spacecraft.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Design } from '../game/state';
import { buildCraftModel } from './craftModel';

export class CraftPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private controls: OrbitControls;
  private model: THREE.Object3D | null = null;
  private key = '';
  private running = true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(4.2, 2.4, 4.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 12;
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a1a10, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
    sun.position.set(5, 6, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5ad1ff, 1.2);
    rim.position.set(-5, 1, -4);
    this.scene.add(rim);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(d: Design) {
    const key = [d.missionId, d.powerId, d.antennaId, d.shieldId, d.landingId, d.instruments.join(',')].join('|');
    if (key === this.key) return;
    this.key = key;
    if (this.model) this.scene.remove(this.model);
    this.model = buildCraftModel(d, 3.4);
    this.scene.add(this.model);
  }

  setVisible(v: boolean) {
    this.running = v;
  }

  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }
}
