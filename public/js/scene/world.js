// Renderer, lighting, post-processing, camera rig and render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setMaxAnisotropy } from './textures.js';
import { buildCasino } from './casino.js';
import { buildTable, TABLE } from './table.js';
import { updateTweens } from './tween.js';

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, bloom: false, shadowMap: 512, antialias: false },
  medium: { pixelRatio: 1.25, shadows: true, bloom: true, shadowMap: 1024, antialias: true },
  high: { pixelRatio: 2, shadows: true, bloom: true, shadowMap: 2048, antialias: true },
};

export class World {
  constructor(container, qualityName = 'high') {
    this.container = container;
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName] || QUALITY.high;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.q.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

    // Which GPU is the browser actually using? (Software fallbacks run 10-50x slower.)
    const gl = renderer.getContext();
    let gpu = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch { /* ignore */ }
    this.gpuName = String(gpu || 'unknown');
    this.softwareGL = /swiftshader|llvmpipe|softpipe|software|basic render|warp|mesa offscreen/i.test(this.gpuName);
    console.info('[HighRoller] WebGL renderer:', this.gpuName);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0604);
    scene.fog = new THREE.FogExp2(0x140a06, 0.045);
    this.scene = scene;

    // Image-based lighting for nice reflections on chips, brass, leather.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;

    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.03, 80);
    this.camera.position.set(0, 1.6, 3);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffe2c0, 0x2a1008, 0.35);
    scene.add(hemi);

    const spot = new THREE.SpotLight(0xffe0b0, 8, 9, Math.PI / 4, 0.6, 2);
    spot.position.set(0, 3.2, 0);
    spot.target.position.set(0, TABLE.height, 0);
    spot.castShadow = this.q.shadows;
    spot.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.01;
    spot.shadow.radius = 4;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 6;
    scene.add(spot, spot.target);
    this.spot = spot;

    // Warm fill lights around the room
    const fills = [[-6, 3.8, -3], [6, 3.8, 3], [0, 3.8, -9]];
    for (const [x, y, z] of fills) {
      const p = new THREE.PointLight(0xffb070, 14, 16, 2);
      p.position.set(x, y, z);
      scene.add(p);
    }
    // Rim light for players around the table
    const rim = new THREE.PointLight(0xffd9a8, 1.2, 4, 2);
    rim.position.set(0, 1.9, 0);
    scene.add(rim);

    this.casino = buildCasino(scene, qualityName);
    this.table = buildTable(qualityName);
    scene.add(this.table.group);

    // Post-processing
    this.setupComposer();

    // Camera rig
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enabled = false;
    this.controls.target.set(0, TABLE.height, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 9;
    this.controls.enableDamping = true;

    this.camMode = 'lobby';
    this.camGoal = { pos: new THREE.Vector3(0, 1.6, 3), look: new THREE.Vector3(0, TABLE.height, 0) };
    this.camLook = new THREE.Vector3(0, TABLE.height, 0);
    this.mouse = new THREE.Vector2();
    this.lookOffset = new THREE.Vector2();
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });

    this.updaters = [];
    this.clock = new THREE.Timer();
    this.time = 0;
    window.addEventListener('resize', () => this.resize());
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTime = 0;
    renderer.setAnimationLoop(() => this.frame());
  }

  setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.q.antialias ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.65, 0.45, 1.35);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    this.q = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.spot.castShadow = this.q.shadows;
    if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; }
    this.spot.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.needsUpdate = true)); } });
    this.composer.dispose?.();
    this.bloom = null;
    this.setupComposer();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    // Wider FOV on portrait/narrow screens so the table fits.
    this.camera.fov = w / h < 1 ? 72 : w / h < 1.4 ? 62 : 54;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  // mode: lobby | seat | overhead | orbit | showdown
  setCameraGoal(pos, look, mode) {
    this.camGoal.pos.copy(pos);
    this.camGoal.look.copy(look);
    if (mode) this.camMode = mode;
    this.controls.enabled = this.camMode === 'orbit';
    if (this.camMode === 'orbit') {
      this.controls.target.copy(look);
    }
  }

  onUpdate(fn) { this.updaters.push(fn); }

  frame() {
    this.clock.update();
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    this.frameCount++;
    this.totalFrames = (this.totalFrames || 0) + 1;
    this.fpsTime += dt;
    if (this.fpsTime > 1) {
      this.fps = this.frameCount / this.fpsTime; this.frameCount = 0; this.fpsTime = 0;
      // Dynamic resolution: drop the pixel ratio if the GPU is struggling.
      this.slowSecs = this.fps < 28 ? (this.slowSecs || 0) + 1 : 0;
      const pr = this.renderer.getPixelRatio();
      if (this.slowSecs >= 4 && pr > 0.6) {
        this.slowSecs = 0;
        this.renderer.setPixelRatio(Math.max(0.6, pr > 1 ? pr - 0.5 : pr - 0.2));
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.resize();
      }
    }

    updateTweens(Math.min(0.5, this.clock.getDelta()));
    this.updateCamera(dt);
    this.casino.update(this.time, dt);
    for (const fn of this.updaters) fn(dt, this.time);

    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.camMode === 'orbit') {
      this.controls.update();
      return;
    }
    if (this.camMode === 'lobby') {
      const t = this.time * 0.06;
      const r = 4.2;
      this.camGoal.pos.set(Math.cos(t) * r, 1.9 + Math.sin(t * 2) * 0.2, Math.sin(t) * r);
      this.camGoal.look.set(0, TABLE.height + 0.1, 0);
    }
    const k = 1 - Math.exp(-dt * (this.camMode === 'lobby' ? 1.5 : 3.2));
    cam.position.lerp(this.camGoal.pos, k);
    this.camLook.lerp(this.camGoal.look, k);
    // Subtle head-look with the mouse in seated view.
    const lookAmt = this.camMode === 'seat' ? 1 : 0.25;
    this.lookOffset.lerp(new THREE.Vector2(this.mouse.x * 0.35 * lookAmt, this.mouse.y * 0.18 * lookAmt), 1 - Math.exp(-dt * 4));
    const look = this.camLook.clone();
    const right = new THREE.Vector3().subVectors(look, cam.position).cross(new THREE.Vector3(0, 1, 0)).normalize();
    look.addScaledVector(right, this.lookOffset.x);
    look.y += this.lookOffset.y;
    cam.lookAt(look);
  }
}
