// Poker table geometry + seat layout.
import * as THREE from 'three';
import { feltTexture, leatherTexture, woodTexture } from './textures.js';

export const TABLE = {
  L: 0.72,         // half-length of the straight section
  R: 0.74,         // felt radius
  railW: 0.16,     // padded rail width
  height: 0.76,    // felt surface height
  seats: 8,
};
TABLE.feltY = TABLE.height;

// Point on the stadium outline at angle theta (radians), expanded by `offset` meters.
export function stadiumPoint(theta, offset = 0) {
  const R = TABLE.R + offset;
  const dx = Math.cos(theta), dz = Math.sin(theta);
  // Binary search along the ray for distance-to-segment == R.
  let lo = 0, hi = TABLE.L + R + 2;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const x = dx * s, z = dz * s;
    const cx = Math.max(-TABLE.L, Math.min(TABLE.L, x));
    const d = Math.hypot(x - cx, z);
    if (d < R) lo = s; else hi = s;
  }
  return new THREE.Vector3(dx * lo, 0, dz * lo);
}

// Seat angles: dealer sits at -90deg (negative z), seats wrap around the rest clockwise.
export function seatAngle(i) {
  const start = -90 + 38, span = 360 - 76;
  return THREE.MathUtils.degToRad(start + (i * span) / (TABLE.seats - 1));
}

// Useful per-seat anchor points (all at y = 0; caller adds height).
export function seatAnchors(i) {
  const th = seatAngle(i);
  const chair = stadiumPoint(th, TABLE.railW + 0.42);
  const rail = stadiumPoint(th, TABLE.railW * 0.5);
  const cards = stadiumPoint(th, -0.2);
  const bet = stadiumPoint(th, -0.4);
  const stackBase = stadiumPoint(th, -0.1);
  // Face toward the table center (projected onto the long axis a bit for natural look).
  const center = new THREE.Vector3(THREE.MathUtils.clamp(rail.x, -TABLE.L * 0.6, TABLE.L * 0.6), 0, 0);
  const inward = center.clone().sub(rail).setY(0).normalize();
  const playerRight = new THREE.Vector3(-inward.z, 0, inward.x); // forward x up
  const stack = stackBase.clone().addScaledVector(playerRight, 0.2);
  const yaw = Math.atan2(-inward.x, -inward.z); // object rotation.y so local -Z faces inward
  const button = stadiumPoint(th, -0.3).addScaledVector(playerRight, -0.2);
  return { theta: th, chair, rail, cards, bet, stack, inward, yaw, button, playerRight };
}

export const DEALER = {
  pos: new THREE.Vector3(0, 0, -(TABLE.R + TABLE.railW + 0.38)),
  muck: new THREE.Vector3(0.32, 0, -(TABLE.R - 0.22)),
  deckPos: new THREE.Vector3(-0.28, 0, -(TABLE.R - 0.18)),
  pot: new THREE.Vector3(0, 0, -0.32),
  board: (i) => new THREE.Vector3((i - 2) * 0.114, 0, 0.0),
};

function stadiumShape(R, L) {
  const s = new THREE.Shape();
  s.moveTo(-L, -R);
  s.lineTo(L, -R);
  s.absarc(L, 0, R, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-L, R);
  s.absarc(-L, 0, R, Math.PI / 2, Math.PI * 1.5, false);
  return s;
}

function stadiumCurve(R, L, y) {
  // Closed 3D curve along the stadium (for the padded rail tube).
  const pts = [];
  const N = 160;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const p = stadiumPoint(th, R - TABLE.R);
    pts.push(new THREE.Vector3(p.x, y, p.z));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

// Flat ring between two outline offsets (meters from the felt edge), facing up.
export function bandGeometry(off0, off1, y = 0, N = 256) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const a = stadiumPoint(th, off0), b = stadiumPoint(th, off1);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    uv.push(i / N * 8, 0, i / N * 8, 1);
    if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure normals face up regardless of winding.
  const n = g.attributes.normal;
  if (n.getY(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

export function buildTable(quality = 'high') {
  const g = new THREE.Group();
  g.name = 'pokerTable';
  const { L, R, railW, height } = TABLE;

  // Felt top (flat shape with UVs remapped to 0..1 across the bounds).
  const feltShape = stadiumShape(R, L);
  const feltGeo = new THREE.ShapeGeometry(feltShape, 64);
  feltGeo.rotateX(-Math.PI / 2);
  // After rotateX(-90): shape y -> -z. Remap UVs.
  const pos = feltGeo.attributes.position;
  const uv = feltGeo.attributes.uv;
  const lenM = 2 * (L + R), widM = 2 * R;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + L + R) / lenM, 1 - (pos.getZ(i) + R) / widM);
  }
  const feltMat = new THREE.MeshStandardMaterial({ map: feltTexture(lenM, widM), roughness: 0.92, metalness: 0 });
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.position.y = height;
  felt.receiveShadow = true;
  g.add(felt);

  // Table body (wood apron under the rail)
  const bodyShape = stadiumShape(R + railW, L);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 48 });
  bodyGeo.rotateX(Math.PI / 2);
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture('#4a2210', [3, 1]), roughness: 0.35, metalness: 0.05 });
  const body = new THREE.Mesh(bodyGeo, woodMat);
  body.position.y = height - 0.022;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Padded leather rail (tube following the outline)
  const railR = railW * 0.55;
  const railCurve = stadiumCurve(R + railW * 0.55, L, height + 0.035);
  const railGeo = new THREE.TubeGeometry(railCurve, 200, railR, quality === 'low' ? 10 : 18, true);
  railGeo.scale(1, 0.55, 1);
  railGeo.translate(0, (height + 0.035) * 0.45, 0); // compensate scale on y
  const leather = new THREE.MeshPhysicalMaterial({
    map: leatherTexture(), color: 0x6a3a28, roughness: 0.42, metalness: 0,
    clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0x663322),
  });
  const rail = new THREE.Mesh(railGeo, leather);
  rail.castShadow = true;
  rail.receiveShadow = true;
  g.add(rail);

  // Wooden racetrack between felt and rail (flat band following the outline)
  const trackGeo = bandGeometry(-0.002, 0.04, 0);
  const track = new THREE.Mesh(trackGeo, new THREE.MeshStandardMaterial({ map: woodTexture('#6b3416', [4, 1], 7), roughness: 0.25, metalness: 0.1 }));
  track.position.y = height + 0.001;
  track.receiveShadow = true;
  g.add(track);

  // Brass trim line under the rail
  const trimCurve = stadiumCurve(R + railW + 0.005, L, height - 0.02);
  const trim = new THREE.Mesh(
    new THREE.TubeGeometry(trimCurve, 200, 0.006, 8, true),
    new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.25, metalness: 1 }),
  );
  g.add(trim);

  // Pedestal legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.5, metalness: 0.4 });
  for (const x of [-L * 0.8, L * 0.8]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, height - 0.12, 24), legMat);
    col.position.set(x, (height - 0.12) / 2, 0);
    col.castShadow = true;
    g.add(col);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.05, 32), legMat);
    foot.position.set(x, 0.025, 0);
    foot.receiveShadow = true;
    g.add(foot);
  }

  // Dealer chip tray (inset box)
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.12), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.3, metalness: 0.6 }));
  tray.position.set(0, height + 0.012, -(R - 0.06));
  tray.castShadow = true;
  g.add(tray);
  // Colorful chips in the tray
  const trayColors = [0x141414, 0x1d7a3a, 0xb3121f, 0x6b2c91, 0xe0b418, 0x8a4b20];
  const chipGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 20);
  chipGeo.rotateZ(Math.PI / 2);
  trayColors.forEach((c, i) => {
    const m = new THREE.Mesh(chipGeo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    m.position.set(-0.19 + i * 0.076, height + 0.03, -(R - 0.06));
    g.add(m);
  });

  // Dealer button
  const btnTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#f7f3e8'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#111'; x.font = 'bold 64px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('D', 64, 68);
    x.lineWidth = 6; x.strokeStyle = '#b8912e'; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
    const t = new THREE.CanvasTexture(x.canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dealerButton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.012, 32),
    [new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: btnTex, roughness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0xeeeeee })],
  );
  dealerButton.castShadow = true;
  dealerButton.position.set(0, height + 0.006, -0.5);
  dealerButton.name = 'dealerButton';
  g.add(dealerButton);

  // Turn indicator glow ring (moved to the active seat).
  const ringGeo = new THREE.RingGeometry(0.115, 0.15, 64, 1, Math.PI / 2, Math.PI * 2);
  ringGeo.rotateX(-Math.PI / 2);
  const turnRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false }));
  turnRing.position.y = height + 0.002;
  turnRing.name = 'turnRing';
  g.add(turnRing);

  return { group: g, dealerButton, turnRing, felt };
}

// Casino chair placed at a seat.
let chairParts = null;
export function buildChair() {
  if (!chairParts) {
    chairParts = {
      seatGeo: new THREE.CylinderGeometry(0.24, 0.22, 0.1, 24),
      backGeo: new THREE.BoxGeometry(0.46, 0.5, 0.08, 1, 1, 1),
      poleGeo: new THREE.CylinderGeometry(0.035, 0.035, 0.42, 12),
      baseGeo: new THREE.CylinderGeometry(0.26, 0.28, 0.03, 24),
      fabric: new THREE.MeshPhysicalMaterial({ color: 0x5a0f18, roughness: 0.75, sheen: 1, sheenColor: new THREE.Color(0xaa3344), sheenRoughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.25, metalness: 1 }),
    };
  }
  const p = chairParts;
  const g = new THREE.Group();
  const seat = new THREE.Mesh(p.seatGeo, p.fabric); seat.position.y = 0.5; seat.castShadow = true;
  const back = new THREE.Mesh(p.backGeo, p.fabric); back.position.set(0, 0.8, 0.2); back.rotation.x = -0.12; back.castShadow = true;
  const pole = new THREE.Mesh(p.poleGeo, p.metal); pole.position.y = 0.24;
  const base = new THREE.Mesh(p.baseGeo, p.metal); base.position.y = 0.015; base.receiveShadow = true;
  g.add(seat, back, pole, base);
  return g;
}
