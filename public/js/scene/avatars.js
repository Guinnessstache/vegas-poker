// Seated player avatars (with webcam "portrait" heads), the dealer, and background NPCs.
import * as THREE from 'three';
import { initialsTexture } from './textures.js';
import { PersonRig, PEOPLE } from './people.js';

// Realistic characters (people.js), once loaded and enabled; null = stylized primitives.
let people = null;
let peopleVersion = 0;
export function setPeople(templates) {
  const players = templates ? Object.fromEntries(Object.entries(templates).filter(([c]) => PEOPLE.includes(c))) : {};
  people = Object.keys(players).length ? players : null;
  peopleVersion++;
}
// The bots' names tell us who they are; human players get any character (their name picks it).
const WOMEN = new Set(['dolly', 'marge', 'lady luck', 'stella', 'maxine', 'rosa', 'vera', 'queenie', 'lola', 'mae']);
const MEN = new Set(['lucky lou', 'vinnie', 'big tex', 'sal', 'rocco', 'tommy two-pair', 'frankie', 'duke', 'johnny chips', 'slim', 'bugsy', 'nicky nuts', 'hank', 'benny']);
const rigsInUse = new Map(); // PlayerAvatar -> character code
const nameHash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

export const SEAT_COLORS = ['#b8342f', '#2f6bb8', '#2f9a5a', '#8a4fc0', '#d08a1e', '#1f9aa8', '#c04f8a', '#6b6b6b'];
const SUIT_COLORS = [0x1c1c22, 0x2a2f3a, 0x3a2418, 0x14202e, 0x2e1a2a, 0x1f2a1f, 0x3a3a3a, 0x241c14];
const SKIN = [0xe2b99a, 0xc68e6b, 0x8d5a3c, 0xf1cfb4, 0xa8754f, 0x5e3b27];

const geoCache = {};
const G = (key, make) => geoCache[key] || (geoCache[key] = make());

function limb(len, r) {
  return G(`limb${len}_${r}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
}

// A stylized humanoid built from primitives. Returns parts for animation.
export function buildHuman({ suit = 0x222222, shirt = 0xf2f2f2, skin = 0xd9a88a, hair = 0x2a1a10, seated = true, detail = 'high', vest = false, bowtie = false } = {}) {
  const g = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.6, metalness: 0.05 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.55 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.8 });
  const seg = detail === 'low' ? 8 : 16;

  const hips = new THREE.Group();
  hips.position.y = seated ? 0.56 : 0.95;
  g.add(hips);

  // Torso
  const torso = new THREE.Mesh(G('torso' + seg, () => new THREE.CapsuleGeometry(0.17, 0.3, 6, seg)), suitMat);
  torso.scale.set(1.05, 1, 0.68);
  torso.position.y = 0.3;
  torso.castShadow = true;
  hips.add(torso);
  // Shirt front / collar
  const shirtFront = new THREE.Mesh(G('shirt', () => new THREE.PlaneGeometry(0.1, 0.26)), shirtMat);
  shirtFront.position.set(0, 0.38, -0.118);
  shirtFront.rotation.y = Math.PI;
  hips.add(shirtFront);
  if (vest) {
    const vestMesh = new THREE.Mesh(G('vest' + seg, () => new THREE.CapsuleGeometry(0.172, 0.2, 6, seg)), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
    vestMesh.scale.set(1.06, 1, 0.7);
    vestMesh.position.y = 0.25;
    hips.add(vestMesh);
  }
  if (bowtie) {
    const bt = new THREE.Mesh(G('bow', () => new THREE.BoxGeometry(0.07, 0.025, 0.02)), new THREE.MeshStandardMaterial({ color: 0x7a0010, roughness: 0.4 }));
    bt.position.set(0, 0.5, -0.12);
    hips.add(bt);
  }

  // Neck + head
  const neck = new THREE.Mesh(G('neck', () => new THREE.CylinderGeometry(0.045, 0.05, 0.08, 12)), skinMat);
  neck.position.y = 0.58;
  hips.add(neck);
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.72;
  hips.add(headPivot);
  const head = new THREE.Mesh(G('head' + seg, () => new THREE.SphereGeometry(0.105, seg * 2, seg)), skinMat);
  head.scale.set(0.9, 1.08, 0.95);
  head.castShadow = true;
  headPivot.add(head);
  const hairMesh = new THREE.Mesh(G('hair' + seg, () => new THREE.SphereGeometry(0.11, seg * 2, seg, 0, Math.PI * 2, 0, Math.PI * 0.42)), hairMat);
  hairMesh.scale.set(0.93, 1.06, 0.99);
  hairMesh.position.set(0, 0.018, 0.012);
  hairMesh.rotation.x = 0.55; // cap tilts back so the face shows
  headPivot.add(hairMesh);
  // Simple eyes to give direction
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const x of [-0.035, 0.035]) {
    const e = new THREE.Mesh(G('eye', () => new THREE.SphereGeometry(0.011, 8, 6)), eyeMat);
    e.position.set(x, 0.015, -0.093);
    headPivot.add(e);
  }

  // Arms (upper + fore), shoulders at +-0.2
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.47, 0);
    hips.add(shoulder);
    const upper = new THREE.Mesh(limb(0.2, 0.055), suitMat);
    upper.position.y = -0.14;
    upper.castShadow = true;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(limb(0.2, 0.048), suitMat);
    fore.position.y = -0.13;
    fore.castShadow = true;
    elbow.add(fore);
    const hand = new THREE.Mesh(G('hand', () => new THREE.SphereGeometry(0.045, 12, 8)), skinMat);
    hand.scale.set(1, 1.2, 0.6);
    hand.position.y = -0.27;
    elbow.add(hand);
    arms.push({ shoulder, elbow, side });
  }

  // Pelvis joins the legs to the torso
  const pelvis = new THREE.Mesh(G('pelvis' + seg, () => new THREE.CapsuleGeometry(0.1, 0.16, 4, seg)), suitMat);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.9);
  pelvis.position.y = 0.0;
  hips.add(pelvis);

  // Legs
  if (seated) {
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(limb(0.3, 0.075), suitMat);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.set(side * 0.1, 0.02, -0.18);
      hips.add(thigh);
      const shin = new THREE.Mesh(limb(0.35, 0.06), suitMat);
      shin.position.set(side * 0.1, -0.24, -0.38);
      hips.add(shin);
    }
  } else {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(limb(0.75, 0.075), suitMat);
      leg.position.set(side * 0.1, -0.48, 0);
      hips.add(leg);
    }
  }

  return { group: g, hips, torso, headPivot, head, hair: hairMesh, arms, materials: { suitMat, skinMat } };
}

// Default pose: arms reaching forward onto the rail.
function poseArmsOnTable(h, reach = 1) {
  for (const a of h.arms) {
    a.shoulder.rotation.x = 0.55 * reach;
    a.shoulder.rotation.z = a.side * 0.1;
    a.elbow.rotation.x = 1.0 * reach;
  }
}

export class PlayerAvatar {
  constructor(seatIndex) {
    this.seat = seatIndex;
    this.group = new THREE.Group();
    const c = seatIndex % SUIT_COLORS.length;
    this.human = buildHuman({ suit: SUIT_COLORS[c], skin: SKIN[(seatIndex * 5) % SKIN.length], hair: [0x2a1a10, 0x111111, 0x6b4a2a, 0xb89a6a][seatIndex % 4] });
    this.group.add(this.human.group);
    poseArmsOnTable(this.human, 1);

    // Portrait disc (video or initials), replaces the 3D head when shown.
    this.portrait = new THREE.Group();
    this.portrait.position.y = 0.72 + 0.56 + 0.04;
    const discGeo = G('disc', () => new THREE.CircleGeometry(0.15, 48));
    this.portraitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.disc = new THREE.Mesh(discGeo, this.portraitMat);
    this.rimMat = new THREE.MeshStandardMaterial({ color: 0xd4a84a, metalness: 1, roughness: 0.25, emissive: 0x000000 });
    this.rim = new THREE.Mesh(G('rim', () => new THREE.TorusGeometry(0.152, 0.012, 12, 64)), this.rimMat);
    const backing = new THREE.Mesh(G('discBack', () => new THREE.CircleGeometry(0.155, 48)), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    backing.rotation.y = Math.PI;
    backing.position.z = -0.002;
    this.portrait.add(this.disc, this.rim, backing);
    this.portrait.visible = false;
    this.group.add(this.portrait);

    this.video = null;
    this.videoTex = null;
    this.name = '';
    this.colorHex = SEAT_COLORS[seatIndex];
    this.state = 'idle'; // idle | folded | acting | winner
    this.speaking = 0;
    this.t = Math.random() * 10;
    this.group.visible = false;
  }

  setPlayer(name, colorIdx) {
    const color = SEAT_COLORS[colorIdx % SEAT_COLORS.length];
    if (name !== this.name || color !== this.colorHex) {
      this.name = name;
      this.colorHex = color;
      if (this.initialsTex) this.initialsTex.dispose();
      this.initialsTex = initialsTexture(name, color);
      if (!this.videoTex) this.portraitMat.map = this.initialsTex;
      this.portraitMat.needsUpdate = true;
    }
    this.pickRig();
    this.group.visible = true;
  }

  // Swap between the realistic character (chosen from the player's name, so each person keeps
  // the same look every game) and the stylized one.
  pickRig() {
    const key = `${peopleVersion}|${this.name}`;
    if (key === this.rigKey) return;
    this.rigKey = key;
    let code = null;
    if (people && this.name) {
      const all = Object.keys(people).sort();
      const n = this.name.toLowerCase();
      const pool = all.filter((c) => (WOMEN.has(n) ? c[0] === 'f' : MEN.has(n) ? c[0] === 'm' : true));
      const list = pool.length ? pool : all;
      const start = nameHash(this.name) % list.length;
      const taken = new Set([...rigsInUse].filter(([a]) => a !== this && a.group.visible).map(([, c]) => c));
      code = list[start];
      for (let i = 0; i < list.length; i++) { const c = list[(start + i) % list.length]; if (!taken.has(c)) { code = c; break; } }
    }
    if (code) rigsInUse.set(this, code); else rigsInUse.delete(this);
    if (code === (this.rigCode || null)) return;
    if (this.rig) { this.group.remove(this.rig.group); this.rig = null; }
    this.rigCode = code;
    if (code) {
      this.rig = new PersonRig(people[code]);
      this.group.add(this.rig.group);
    }
    this.human.group.visible = !this.rig;
    this.updateHeadVisibility();
  }

  clear() { this.group.visible = false; this.setVideo(null); this.name = ''; }

  // Attach a <video> element (or null) as the face.
  setVideo(videoEl) {
    if (videoEl === this.video) return;
    if (this.videoTex) { this.videoTex.dispose(); this.videoTex = null; }
    this.video = videoEl;
    if (videoEl) {
      this.videoTex = new THREE.VideoTexture(videoEl);
      this.videoTex.colorSpace = THREE.SRGBColorSpace;
      this.portraitMat.map = this.videoTex;
      this.fitVideo();
      videoEl.addEventListener('loadedmetadata', () => this.fitVideo(), { once: true });
      videoEl.addEventListener('resize', () => this.fitVideo());
    } else {
      this.portraitMat.map = this.initialsTex || null;
    }
    this.portraitMat.needsUpdate = true;
    this.updateHeadVisibility();
  }

  fitVideo() {
    if (!this.videoTex || !this.video) return;
    const w = this.video.videoWidth || 4, h = this.video.videoHeight || 3;
    const a = w / h;
    const t = this.videoTex;
    if (a > 1) { t.repeat.set(1 / a, 1); t.offset.set((1 - 1 / a) / 2, 0); }
    else { t.repeat.set(1, a); t.offset.set(0, (1 - a) / 2); }
  }

  setCamOn(on) { this.camOn = on; this.updateHeadVisibility(); }
  setShowPortrait(on) { this.showPortraitAlways = on; this.updateHeadVisibility(); }

  updateHeadVisibility() {
    const showVideo = !!(this.video && this.camOn);
    if (!showVideo && this.videoTex) this.portraitMat.map = this.initialsTex; else if (showVideo) this.portraitMat.map = this.videoTex;
    this.portraitMat.needsUpdate = true;
    this.portrait.visible = showVideo || !!this.showPortraitAlways;
    this.human.head.visible = !showVideo;
    this.human.hair.visible = !showVideo;
    this.portrait.position.y = showVideo ? 1.3 : 1.62;
    if (this.rig) {
      this.rig.setHeadHidden(showVideo);
      if (showVideo) this.portrait.position.y = this.rig.headY + 0.08;
    }
    this.portraitBase = showVideo ? 1.25 : 0.6;
  }

  update(dt, camera, isTurn) {
    if (!this.group.visible) return;
    this.t += dt;
    if (this.rig) this.rig.update(dt, { state: this.state, isTurn, lookAt: this.lookAt });
    else this.animateHuman(dt, isTurn);
    this.updatePortrait(camera);
  }

  animateHuman(dt, isTurn) {
    const h = this.human;
    // Breathing + idle sway
    const lean = this.state === 'folded' ? 0.12 : this.state === 'winner' ? -0.05 : 0;
    h.hips.rotation.x += ((lean + Math.sin(this.t * 0.7) * 0.015) - h.hips.rotation.x) * Math.min(1, dt * 3);
    h.torso.scale.y = 1 + Math.sin(this.t * 1.6) * 0.012;
    h.headPivot.rotation.y = Math.sin(this.t * 0.37) * 0.25;
    h.headPivot.rotation.x = isTurn ? 0.25 : Math.sin(this.t * 0.23) * 0.06 + 0.1;
    const reach = this.state === 'folded' ? 0.4 : 1;
    for (const a of h.arms) {
      a.shoulder.rotation.x += (0.55 * reach - a.shoulder.rotation.x) * Math.min(1, dt * 3);
      a.elbow.rotation.x += (1.0 * reach - a.elbow.rotation.x) * Math.min(1, dt * 3);
    }
    if (this.state === 'winner') {
      for (const a of h.arms) { a.shoulder.rotation.x = 2.6 + Math.sin(this.t * 6) * 0.2; a.elbow.rotation.x = 0.3; }
    }
  }

  updatePortrait(camera) {
    // Portrait faces the camera (yaw only for stability).
    if (this.portrait.visible && camera) {
      const wp = new THREE.Vector3();
      this.portrait.getWorldPosition(wp);
      const dx = camera.position.x - wp.x, dz = camera.position.z - wp.z;
      const worldYaw = Math.atan2(dx, dz);
      this.portrait.rotation.y = worldYaw - this.group.rotation.y;
      // Keep a similar on-screen size: shrink players sitting right next to the camera.
      const dist = Math.hypot(dx, dz, camera.position.y - wp.y);
      this.portrait.scale.setScalar((this.portraitBase || 1) * THREE.MathUtils.clamp(dist / 2.3, 0.38, 1.15));
    }
    // Speaking glow on the rim
    const s = this.speaking;
    this.rimMat.emissive.setRGB(0.2 * s, 1.2 * s, 0.4 * s);
  }
}

export class Dealer {
  constructor() {
    this.human = buildHuman({ suit: 0x141414, shirt: 0xf4f4f4, skin: 0xd9a88a, hair: 0x1a0f08, vest: true, bowtie: true, seated: false });
    this.group = new THREE.Group();
    this.group.add(this.human.group);
    this.rig = null;
    this.t = 0;
    this.dealing = 0;
    for (const a of this.human.arms) { a.shoulder.rotation.x = 0.35; a.elbow.rotation.x = 0.9; }
  }

  pulseDeal(side = 1) {
    this.dealing = 1; this.dealSide = side;
    if (this.rig) { this.rig.dealing = 1; this.rig.dealSide = side; }
  }

  // Realistic dealer (people.js) or null for the stylized one.
  setRig(rig) {
    if (this.rig) this.group.remove(this.rig.group);
    this.rig = rig;
    if (rig) this.group.add(rig.group);
    this.human.group.visible = !rig;
  }

  update(dt) {
    this.t += dt;
    if (this.rig) { this.rig.update(dt, {}); return; }
    const h = this.human;
    h.headPivot.rotation.y = Math.sin(this.t * 0.3) * 0.35;
    h.torso.scale.y = 1 + Math.sin(this.t * 1.5) * 0.01;
    this.dealing = Math.max(0, this.dealing - dt * 3);
    for (const a of h.arms) {
      const active = a.side === (this.dealSide || 1) ? this.dealing : 0;
      a.shoulder.rotation.x = 0.35 + active * 0.6;
      a.elbow.rotation.x = 0.9 - active * 0.5;
    }
  }
}

export function buildNPC(seed, standing = false) {
  const r = (n) => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * n; };
  const suits = [0x2a2a30, 0x5a1a1a, 0x1a3a5a, 0x3a3a2a, 0x6a4a2a, 0x2a4a3a, 0x7a6a5a, 0x4a1a4a];
  const h = buildHuman({ suit: suits[Math.floor(r(suits.length))], skin: SKIN[Math.floor(r(SKIN.length))], hair: [0x2a1a10, 0x111111, 0x6b4a2a, 0xb89a6a, 0x999999][Math.floor(r(5))], seated: !standing, detail: 'low' });
  if (!standing) poseArmsOnTable(h, 0.9);
  else for (const a of h.arms) { a.shoulder.rotation.x = 0.1; a.shoulder.rotation.z = a.side * 0.08; }
  return h;
}
