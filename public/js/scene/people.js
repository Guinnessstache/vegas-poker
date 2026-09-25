// Realistic seated players built from Microsoft Rocketbox avatars (MIT licence, see
// public/models/people/LICENSE.txt). Each model is a rigged FBX; we pose it in code — no
// animation clips — so it can sit at any seat, rest its hands on the rail with two-bone IK,
// breathe, blink, look at whoever is acting, lean back when it folds and cheer when it wins.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Player characters (4 men, 4 women: every seat can look different) and the dealer.
export const PEOPLE = ['m005', 'm008', 'm016', 'm020', 'f014', 'f015', 'f016', 'f020'];
export const DEALER_CODE = 'm015';
const BASE = '/models/people/';
const SEAT_TOP = 0.55; // chair cushion height (table.js buildChair)

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const d2r = (deg) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- loading
const cache = new Map();

function loadPerson(code) {
  if (cache.has(code)) return cache.get(code);
  const p = new Promise((resolve, reject) => {
    const mgr = new THREE.LoadingManager();
    // The FBX points at the artists' original .tga files; we ship compressed copies instead.
    mgr.setURLModifier((u) => (/\.tga$/i.test(u) ? 'data:,' : u));
    const tl = new THREE.TextureLoader();
    const tex = (f, srgb) => {
      const t = tl.load(`${BASE}${code}/${f}`);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const made = {};
    const mat = (kind) => made[kind] || (made[kind] = kind === 'body'
      ? new THREE.MeshStandardMaterial({ map: tex('body.jpg', true), normalMap: tex('body_n.jpg'), roughness: 0.8 })
      : kind === 'head'
        ? new THREE.MeshStandardMaterial({ map: tex('head.jpg', true), normalMap: tex('head_n.jpg'), roughness: 0.62 })
        // hair, lashes and brows: colour + alpha cut-outs (not every character has them)
        : new THREE.MeshStandardMaterial({ map: tex('opacity.png', true), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }));
    new FBXLoader(mgr).load(`${BASE}${code}/model.fbx`, (obj) => {
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const pick = (m) => mat(/body/i.test(m.name) ? 'body' : /head/i.test(m.name) ? 'head' : 'hair');
        o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
        o.castShadow = true;
        o.frustumCulled = false; // posed far from the bind pose; bounds would be wrong
      });
      obj.animations = [];
      resolve(obj);
    }, undefined, reject);
  });
  cache.set(code, p);
  return p;
}

/** Load every character (resolves with { code: template }); failures are skipped. */
export async function loadPeople(codes = [...PEOPLE, DEALER_CODE]) {
  const out = {};
  await Promise.all(codes.map((c) => loadPerson(c).then((o) => { out[c] = o; }).catch((e) => console.warn('[people] load failed', c, e))));
  return out;
}

// ---------------------------------------------------------------- bone maths (model space)
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

// Rotate `bone` by `angle` around `axis`, both given in the model's own space (root local).
function rot(root, bone, axis, angle) {
  if (!angle) return;
  // parent orientation relative to the root
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q);
  root.getWorldQuaternion(_q2);
  _q.premultiply(_q2.invert()); // root^-1 * parent
  const r = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  bone.quaternion.premultiply(_q.clone().invert().multiply(r).multiply(_q));
  bone.updateMatrixWorld(true);
}

function pos(root, bone, out = new THREE.Vector3()) {
  bone.getWorldPosition(out);
  return root.worldToLocal(out);
}

// Model-space orientation of a bone.
function modelQuat(root, bone, out = new THREE.Quaternion()) {
  bone.getWorldQuaternion(out);
  root.getWorldQuaternion(_q2);
  return out.premultiply(_q2.invert());
}

function roll(root, bone, child, angle) {
  const a = pos(root, bone); const b = pos(root, child);
  rot(root, bone, b.sub(a).normalize(), angle);
}

// Hands-on-the-rail seated pose (model faces +Z, left arm along +X in its T-pose).
function seatPose(root, b, p = {}) {
  const r = (n, axis, deg) => rot(root, b[`Bip01_${n}`], axis, d2r(deg));
  r('L_Thigh', X, p.thigh ?? -88); r('R_Thigh', X, p.thigh ?? -88);
  r('L_Calf', X, p.calf ?? 95); r('R_Calf', X, p.calf ?? 95);
  r('L_Thigh', Y, -7); r('R_Thigh', Y, 7);
  r('L_Foot', X, -8); r('R_Foot', X, -8);
  r('Spine', X, p.lean ?? 10); r('Neck', X, -(p.lean ?? 10) * 0.6);
  r('L_UpperArm', Z, p.armDown ?? -72); r('R_UpperArm', Z, -(p.armDown ?? -72));
  r('L_UpperArm', X, -(p.armFwd ?? 22)); r('R_UpperArm', X, -(p.armFwd ?? 22));
  r('L_Forearm', X, -(p.fore ?? 70)); r('R_Forearm', X, -(p.fore ?? 70));
  roll(root, b.Bip01_L_Forearm, b.Bip01_L_Hand, d2r(p.twist ?? 80));
  roll(root, b.Bip01_R_Forearm, b.Bip01_R_Hand, d2r(-(p.twist ?? 80)));
  // Relaxed fingers: a gentle curl on every finger joint (not the thumb).
  for (const side of ['L', 'R']) {
    for (let f = 1; f <= 4; f++) {
      for (const seg of ['', '1', '2']) {
        const bone = b[`Bip01_${side}_Finger${f}${seg}`];
        if (bone) rot(root, bone, side === 'L' ? Z : Z, d2r(side === 'L' ? -14 : 14) * (seg === '' ? 0.6 : 1));
      }
    }
  }
}

// Standing with the arms down and a little forward (the dealer).
function standPose(root, b) {
  const r = (n, axis, deg) => rot(root, b[`Bip01_${n}`], axis, d2r(deg));
  r('Spine', X, 6); r('Neck', X, -3);
  r('L_UpperArm', Z, -70); r('R_UpperArm', Z, 70);
  r('L_UpperArm', X, -25); r('R_UpperArm', X, -25);
  r('L_Forearm', X, -60); r('R_Forearm', X, -60);
}

// ---------------------------------------------------------------- one person
export class PersonRig {
  /**
   * @param {object} template  from loadPeople
   * @param {{ standing?: boolean, seatTop?: number, hands?: {x:number,y:number,z:number}, lite?: boolean }} [o]
   *   seatTop: cushion height; hands: where both hands rest (x = half-spacing, local metres,
   *   -Z is forward); lite: skip blinking (background people seen from afar).
   */
  constructor(template, { standing = false, seatTop = SEAT_TOP, hands = null, lite = false } = {}) {
    this.standing = standing;
    this.hands = hands;
    this.lite = lite;
    this.root = cloneSkinned(template);
    this.group = new THREE.Group();
    this.group.add(this.root);
    this.b = {};
    this.root.traverse((o) => { if (o.isBone) this.b[o.name] = o; });
    this.list = Object.values(this.b);
    this.root.scale.setScalar(0.01);
    this.root.updateMatrixWorld(true);
    const rest = this.list.map((bn) => bn.quaternion.clone());
    const reset = () => { this.list.forEach((bn, i) => bn.quaternion.copy(rest[i])); this.root.updateMatrixWorld(true); };

    // Rest-pose hand orientation (palms face down in the T-pose).
    this.handRest = { L: modelQuat(this.root, this.b.Bip01_L_Hand), R: modelQuat(this.root, this.b.Bip01_R_Hand) };

    const capture = (fn) => { reset(); fn(); return this.list.map((bn) => bn.quaternion.clone()); };
    this.poses = standing ? { seat: capture(() => standPose(this.root, this.b)) } : {
      seat: capture(() => seatPose(this.root, this.b)),
      fold: capture(() => seatPose(this.root, this.b, { lean: -6 })),
      win: capture(() => seatPose(this.root, this.b, { lean: -4, armDown: 80, armFwd: 8, fore: 35, twist: 0 })),
    };
    reset();
    this.list.forEach((bn, i) => bn.quaternion.copy(this.poses.seat[i]));
    this.root.updateMatrixWorld(true);

    // Sit the pelvis on the cushion (or stand the toes on the floor), then turn to face
    // local -Z like the other avatars.
    const pelvis = pos(this.root, this.b.Bip01_Pelvis).multiplyScalar(0.01);
    this.root.rotation.y = Math.PI;
    if (standing) {
      const toe = pos(this.root, this.b.Bip01_L_Toe0 || this.b.Bip01_L_Foot).multiplyScalar(0.01);
      this.root.position.set(pelvis.x, 0.01 - toe.y, pelvis.z);
    } else {
      this.root.position.set(pelvis.x, seatTop + 0.1 - pelvis.y, 0.03 + pelvis.z);
    }
    this.root.updateMatrixWorld(true);

    this.t = Math.random() * 100;
    this.wFold = 0; this.wWin = 0; this.lean = 0;
    this.look = new THREE.Vector2();
    this.nextBlink = 1 + Math.random() * 3; this.blink = 0;
    this.headHidden = false;
    this.lids = [['LEyeBlinkTop', 1], ['REyeBlinkTop', 1], ['LEyeBlinkBottom', -0.3], ['REyeBlinkBottom', -0.3]]
      .filter(([n]) => this.b[`Bip01_${n}`]).map(([n, k]) => [this.b[`Bip01_${n}`], this.b[`Bip01_${n}`].position.clone(), k]);
    this.dealing = 0; this.dealSide = 1;
    this.update(0, {});
  }

  get headY() {
    this.group.updateMatrixWorld(true);
    const v = this.b.Bip01_Head.getWorldPosition(new THREE.Vector3());
    return this.group.worldToLocal(v).y;
  }

  setHeadHidden(hidden) {
    this.headHidden = hidden;
    this.b.Bip01_Head.scale.setScalar(hidden ? 0.001 : 1);
  }

  // Two-bone IK: put `hand` on `T` (model space) with the elbow bending toward `pole`.
  ik(upper, fore, hand, T, pole) {
    const root = this.root;
    const S = pos(root, upper); const E = pos(root, fore); const H = pos(root, hand);
    const a = E.distanceTo(S); const bl = H.distanceTo(E);
    const dist = THREE.MathUtils.clamp(T.distanceTo(S), Math.abs(a - bl) + 1, a + bl - 0.5);
    const want = Math.acos(THREE.MathUtils.clamp((a * a + bl * bl - dist * dist) / (2 * a * bl), -1, 1));
    const u = S.clone().sub(E); const v = H.clone().sub(E);
    const n = u.clone().cross(v);
    if (n.lengthSq() > 1e-8) rot(root, fore, n.normalize(), want - u.angleTo(v));
    const H2 = pos(root, hand).sub(S); const TS = T.clone().sub(S);
    const ax = H2.clone().cross(TS);
    if (ax.lengthSq() > 1e-8) rot(root, upper, ax.normalize(), H2.angleTo(TS));
    // Swing the elbow round the shoulder→hand line toward the pole.
    const dir = TS.normalize();
    const e = pos(root, fore).sub(S); e.addScaledVector(dir, -e.dot(dir));
    const p = pole.clone(); p.addScaledVector(dir, -p.dot(dir));
    if (e.lengthSq() > 1e-6 && p.lengthSq() > 1e-6) {
      const ang = Math.atan2(e.clone().cross(p).dot(dir), e.dot(p));
      rot(root, upper, dir, ang);
    }
  }

  // Lay the hand flat, fingers forward (turned in by `inward` radians).
  orientHand(side, inward, tilt) {
    const hand = this.b[`Bip01_${side}_Hand`];
    const s = side === 'L' ? 1 : -1;
    const want = new THREE.Quaternion().setFromAxisAngle(Y, s * (-Math.PI / 2 + inward));
    want.multiply(new THREE.Quaternion().setFromAxisAngle(Z, s * tilt)).multiply(this.handRest[side]);
    const parent = modelQuat(this.root, hand.parent);
    hand.quaternion.copy(parent.invert().multiply(want));
    hand.updateMatrixWorld(true);
  }

  /**
   * @param {number} dt
   * @param {{ state?: string, isTurn?: boolean, lookAt?: THREE.Vector3|null }} o  lookAt is a world point
   */
  update(dt, { state = 'idle', isTurn = false, lookAt = null } = {}) {
    const root = this.root; const b = this.b;
    this.t += dt;
    const k = Math.min(1, dt * 3);
    this.wFold += ((state === 'folded' ? 1 : 0) - this.wFold) * k;
    this.wWin += ((state === 'winner' ? 1 : 0) - this.wWin) * k;
    this.lean += ((isTurn ? 1 : 0) - this.lean) * k;
    this.dealing = Math.max(0, this.dealing - dt * 3);

    // Blend the captured poses.
    const { seat, fold, win } = this.poses;
    for (let i = 0; i < this.list.length; i++) {
      const q = this.list[i].quaternion.copy(seat[i]);
      if (fold && this.wFold > 0.001) q.slerp(fold[i], this.wFold);
      if (win && this.wWin > 0.001) q.slerp(win[i], this.wWin);
    }
    this.group.updateMatrixWorld(true);

    // Breathing and a slow idle sway; lean in a little on your turn.
    const t = this.t;
    rot(root, b.Bip01_Spine1, X, Math.sin(t * 1.5) * 0.018 + this.lean * 0.06);
    rot(root, b.Bip01_Spine, Z, Math.sin(t * 0.31) * 0.02);

    // Where to look: the acting player, else the cards when it's our turn, else drift.
    let yaw = Math.sin(t * 0.29) * 0.25 + Math.sin(t * 0.11) * 0.15;
    let pitch = 0.08 + Math.sin(t * 0.23) * 0.05;
    if (this.standing) { yaw = Math.sin(t * 0.3) * 0.45; pitch = 0.3; }
    else if (isTurn) { yaw = Math.sin(t * 0.4) * 0.08; pitch = 0.42; }
    else if (lookAt) {
      const head = b.Bip01_Head.getWorldPosition(new THREE.Vector3());
      const local = this.group.worldToLocal(lookAt.clone()).sub(this.group.worldToLocal(head));
      yaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -1.1, 1.1);
      pitch = 0.15;
    }
    if (this.wWin > 0.5) { yaw *= 0.3; pitch = -0.15; }
    this.look.x += (yaw - this.look.x) * Math.min(1, dt * 2.5);
    this.look.y += (pitch - this.look.y) * Math.min(1, dt * 2.5);
    // The model faces +Z, so "turn head left" is +Y and "look down" is +X.
    rot(root, b.Bip01_Neck, Y, this.look.x * 0.4);
    rot(root, b.Bip01_Head, Y, this.look.x * 0.6);
    rot(root, b.Bip01_Head, X, this.look.y);

    // Hands: on the rail, in the lap when folded; the winner's arms stay up.
    const armW = 1 - this.wWin;
    if (armW > 0.02) {
      for (const side of ['L', 'R']) {
        const s = side === 'L' ? 1 : -1;
        let tgt;
        if (this.standing) {
          // Hands just over the table edge; the dealing hand flicks out toward the players.
          const hp = this.hands || { x: 0.17, y: 0.9, z: -0.42 };
          tgt = new THREE.Vector3(-s * hp.x, hp.y, hp.z);
          const d = this.dealSide === s ? Math.sin(Math.min(1, this.dealing) * Math.PI) : 0;
          tgt.add(new THREE.Vector3(-s * 0.12 * d, -0.02 * d, -0.2 * d));
        } else {
          const hp = this.hands || { x: 0.17, y: 0.87, z: -0.43 };
          const rail = new THREE.Vector3(-s * hp.x, hp.y, hp.z); // model +X (its left) is our -X
          const lap = new THREE.Vector3(-s * 0.13, 0.66, -0.2);
          tgt = rail.lerp(lap, this.wFold);
        }
        tgt.x += Math.sin(t * 0.5 + s) * 0.01;
        tgt.z += Math.sin(t * 0.37 + s * 2) * 0.012;
        // group-local metres -> model space
        const T = root.worldToLocal(this.group.localToWorld(tgt));
        const upper = b[`Bip01_${side}_UpperArm`]; const fore = b[`Bip01_${side}_Forearm`]; const hand = b[`Bip01_${side}_Hand`];
        const before = [upper.quaternion.clone(), fore.quaternion.clone()];
        this.ik(upper, fore, hand, T, new THREE.Vector3(s * 0.55, -1, -0.35));
        this.orientHand(side, 0.35 + this.wFold * 0.5, 0.1);
        if (armW < 1) {
          upper.quaternion.copy(before[0].slerp(upper.quaternion, armW));
          fore.quaternion.copy(before[1].slerp(fore.quaternion, armW));
          upper.updateMatrixWorld(true);
        }
      }
    } else {
      // Pump the fists.
      const pump = Math.sin(t * 7) * 0.18;
      rot(root, b.Bip01_L_UpperArm, Z, pump);
      rot(root, b.Bip01_R_UpperArm, Z, -pump);
    }

    if (this.lite) return;
    // Blink every few seconds. The eyelid bones slide (they don't rotate); a little closed at
    // rest reads as relaxed rather than startled.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.15; this.nextBlink = 2 + Math.random() * 4; }
    let c = 0;
    if (this.blink > 0) { this.blink -= dt; c = Math.sin((1 - Math.max(0, this.blink) / 0.15) * Math.PI); }
    const close = 0.3 + c * 1.9 + this.lean * 0.25;
    for (const [bn, rest, k] of this.lids) bn.position.copy(rest).addScaledVector(X, -close * k);
  }
}
