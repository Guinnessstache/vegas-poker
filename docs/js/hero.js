// Live 3D hero for the project site. Reuses the game's own table, card and chip code
// (copied into docs/js/scene by `npm run docs:sync`).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildTable, TABLE, DEALER, seatAnchors, buildChair } from './scene/table.js';
import { Card3D } from './scene/cards.js';
import { ChipPile } from './scene/chips.js';
import { tween, wait, updateTweens, ease } from './scene/tween.js';
import { setMaxAnisotropy, radialGlowTexture } from './scene/textures.js';

const HANDS = [
  { board: ['As', 'Ks', 'Qs', 'Js', 'Ts'], hole: ['9h', '9d'], name: 'Royal Flush' },
  { board: ['Ah', 'Ad', 'Kc', '7s', 'Ac'], hole: ['As', 'Kd'], name: 'Four Aces' },
  { board: ['Kh', 'Kd', '8c', '8s', '2h'], hole: ['Ks', '8d'], name: 'Full House' },
  { board: ['9h', 'Th', 'Jh', '2c', '4d'], hole: ['Qh', 'Kh'], name: 'Straight Flush' },
];

export function startHero(container, { onFail } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    onFail?.(e);
    return null;
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0604);
  scene.fog = new THREE.FogExp2(0x0b0604, 0.12);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);

  scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1008, 0.35));
  const spot = new THREE.SpotLight(0xffe0b0, 9, 9, Math.PI / 4.5, 0.6, 2);
  spot.position.set(0, 3.1, 0.2);
  spot.target.position.set(0, TABLE.height, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0002;
  spot.shadow.normalBias = 0.01;
  scene.add(spot, spot.target);
  const warm = new THREE.PointLight(0xff9a50, 6, 8, 2);
  warm.position.set(-2.5, 2.2, -2);
  scene.add(warm);

  // Floor with soft glow pool under the table
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a0a10, roughness: 0.95 }));
  floor.receiveShadow = true;
  scene.add(floor);

  const table = buildTable('high');
  table.turnRing.visible = false;
  scene.add(table.group);
  for (let i = 0; i < TABLE.seats; i++) {
    if (i === 3 || i === 4) continue; // keep the camera's foreground clear
    const a = seatAnchors(i);
    const chair = buildChair();
    chair.position.copy(a.chair);
    chair.rotation.y = a.yaw;
    scene.add(chair);
  }
  const bp = seatAnchors(4).button;
  table.dealerButton.position.set(bp.x, TABLE.height + 0.006, bp.z);

  // Distant bokeh lights to suggest the casino floor
  const glowTex = radialGlowTexture('rgba(255,200,120,1)', 'rgba(255,160,80,0)');
  const bokeh = new THREE.Group();
  const colors = [0xffc070, 0xff4d6d, 0x40d9ff, 0xffe066, 0xb86bff];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: colors[i % colors.length], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 + Math.random() * 0.4 });
    const s = new THREE.Sprite(m);
    const ang = Math.random() * Math.PI * 2, r = 5 + Math.random() * 6;
    s.position.set(Math.cos(ang) * r, 0.6 + Math.random() * 3.5, Math.sin(ang) * r);
    const sc = 0.3 + Math.random() * 0.7;
    s.scale.set(sc, sc, 1);
    s.userData.phase = Math.random() * 10;
    bokeh.add(s);
  }
  scene.add(bokeh);

  // Chips: a few player stacks + pot
  const Y = TABLE.feltY;
  const stacks = [
    [seatAnchors(3).stack, 18400], [seatAnchors(4).stack, 9250], [seatAnchors(2).stack, 26700],
    [seatAnchors(5).stack, 12100], [seatAnchors(1).stack, 7300], [seatAnchors(6).stack, 15500],
  ];
  for (const [pos, amt] of stacks) {
    const p = new ChipPile({ layout: 'row' });
    p.set(amt);
    p.group.position.copy(pos).setY(Y);
    p.group.rotation.y = Math.atan2(pos.x, pos.z);
    scene.add(p.group);
  }
  const pot = new ChipPile({ layout: 'cluster' });
  pot.group.position.copy(DEALER.pot).setY(Y);
  scene.add(pot.group);

  // Deck by the dealer
  for (let i = 0; i < 10; i++) {
    const c = new Card3D(null);
    c.root.position.copy(DEALER.deckPos).setY(Y + 0.003 + i * 0.0013);
    c.root.rotation.y = 0.3;
    scene.add(c.root);
  }

  let cards = [];
  const CARD_Y = Y + 0.003;
  async function dealHand(h) {
    // Sweep old cards
    await Promise.all(cards.map((c, k) => c.moveTo(DEALER.muck.clone().setY(CARD_Y + k * 0.001), 0, { duration: 0.4, arc: 0.05 }).then(() => c.dispose())));
    cards = [];
    pot.set(2000 + Math.floor(Math.random() * 30) * 500);
    // Hole cards in front of the hero seat, face up
    const a = seatAnchors(3);
    for (let k = 0; k < 2; k++) {
      const c = new Card3D(h.hole[k]);
      c.root.rotation.order = 'YXZ';
      c.root.position.copy(DEALER.deckPos).setY(CARD_Y + 0.02);
      scene.add(c.root);
      cards.push(c);
      const pos = a.cards.clone().setY(CARD_Y + k * 0.0015).addScaledVector(a.playerRight, (k - 0.5) * 0.07);
      c.moveTo(pos, a.yaw + (k - 0.5) * 0.2, { duration: 0.5, arc: 0.08, spin: 1.2 }).then(() => c.flip(true, 0.35));
      await wait(0.15);
    }
    await wait(0.6);
    for (let k = 0; k < 5; k++) {
      const c = new Card3D(h.board[k]);
      c.root.position.copy(DEALER.deckPos).setY(CARD_Y + 0.02);
      scene.add(c.root);
      cards.push(c);
      await c.moveTo(DEALER.board(k).setY(CARD_Y), 0, { duration: 0.35, arc: 0.04 });
      c.flip(true, 0.35);
      await wait(k < 2 ? 0.12 : 0.55);
    }
    await wait(0.5);
    cards.forEach((c) => c.setHighlight(true));
    onHand?.(h.name);
  }

  let onHand = null;
  let handIdx = 0;
  let running = true;
  (async function loop() {
    while (running) {
      await dealHand(HANDS[handIdx++ % HANDS.length]);
      await wait(4.5);
      cards.forEach((c) => c.setHighlight(false));
    }
  })();

  // Resize + render loop (paused when off-screen or tab hidden)
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 58 : 36;
    // On wide screens push the table to the right so the headline sits on open felt.
    if (w > 900) camera.setViewOffset(w, h, -w * 0.2, h * 0.04, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.2, w, h); // phones: lift the table above the text
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(container);

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 }).observe(container);
  const mouse = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5), { passive: true });

  const clock = new THREE.Timer();
  let t = 0;
  const look = new THREE.Vector3(0, Y, 0.05);
  renderer.setAnimationLoop(() => {
    clock.update();
    const dt = Math.min(0.1, clock.getDelta());
    if (!visible || document.hidden) return;
    t += reduceMotion ? 0 : dt;
    updateTweens(dt);
    const ang = 1.3 + Math.sin(t * 0.08) * 0.3 + mouse.x * 0.12;
    const r = 2.6 - Math.sin(t * 0.11) * 0.15;
    camera.position.set(Math.cos(ang) * r, 1.7 + Math.sin(t * 0.13) * 0.08 - mouse.y * 0.12, Math.sin(ang) * r);
    camera.lookAt(look);
    bokeh.children.forEach((s) => { s.material.opacity = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.userData.phase)); });
    renderer.render(scene, camera);
  });

  return {
    onHand(fn) { onHand = fn; },
    stop() { running = false; renderer.setAnimationLoop(null); },
  };
}
