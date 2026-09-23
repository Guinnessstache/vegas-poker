// 3D playing cards.
import * as THREE from 'three';
import { getCardAtlas } from './textures.js';
import { tween, ease } from './tween.js';

export const CARD_SIZE = { w: 0.1, h: 0.14 };
const THICK = 0.0012;

let geo = null;
let backMat = null;
const faceMats = {};

function ensureShared() {
  if (geo) return;
  geo = new THREE.PlaneGeometry(CARD_SIZE.w, CARD_SIZE.h);
  geo.rotateX(-Math.PI / 2); // lie flat, texture top -> -z
  backMat = new THREE.MeshStandardMaterial({ map: getCardAtlas().back(), roughness: 0.4, metalness: 0, alphaTest: 0.5, side: THREE.FrontSide });
}

function faceMat(card) {
  if (!faceMats[card]) {
    faceMats[card] = new THREE.MeshStandardMaterial({ map: getCardAtlas().face(card), roughness: 0.38, metalness: 0, alphaTest: 0.5 });
  }
  return faceMats[card];
}

export class Card3D {
  constructor(card = null) {
    ensureShared();
    this.root = new THREE.Group();     // position + yaw
    this.lift = new THREE.Group();     // optional float/tilt toward the viewer
    this.flipper = new THREE.Group();  // flip around long axis + tilt
    this.root.add(this.lift);
    this.lift.add(this.flipper);
    this.front = new THREE.Mesh(geo, backMat);
    this.front.position.y = THICK / 2;
    this.back = new THREE.Mesh(geo, backMat);
    this.back.rotation.z = Math.PI; // faces down
    this.back.position.y = -THICK / 2;
    this.front.castShadow = true;
    this.flipper.add(this.front, this.back);
    this.faceUp = false;
    this.card = null;
    this.setCard(card);
    this.setFaceUp(false);
    this.highlight = null;
  }

  setCard(card) {
    this.card = card;
    this.front.material = card ? faceMat(card) : backMat;
  }

  setFaceUp(up) {
    this.faceUp = up;
    this.flipper.rotation.z = up ? 0 : Math.PI;
  }

  async flip(up = true, duration = 0.35) {
    if (this.faceUp === up) return;
    const from = this.flipper.rotation.z;
    const to = up ? 0 : Math.PI;
    const baseY = this.flipper.position.y;
    this.faceUp = up;
    await tween(duration, (t) => {
      this.flipper.rotation.z = from + (to - from) * t;
      this.flipper.position.y = baseY + Math.sin(t * Math.PI) * 0.05;
    }, ease.inOutCubic);
    this.flipper.position.y = baseY;
  }

  // Move with an arc from current position to target.
  async moveTo(pos, yaw = this.root.rotation.y, { duration = 0.45, arc = 0.12, spin = 0, easing = ease.outCubic } = {}) {
    const p0 = this.root.position.clone();
    const y0 = this.root.rotation.y;
    this.root.userData.moving = true;
    let dy = yaw - y0;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    await tween(duration, (t) => {
      this.root.position.lerpVectors(p0, pos, t);
      this.root.position.y += Math.sin(t * Math.PI) * arc;
      this.root.rotation.y = y0 + dy * t + Math.sin(t * Math.PI) * spin;
    }, easing);
    this.root.userData.moving = false;
  }

  setHighlight(on) {
    if (on && !this.highlight) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD_SIZE.w * 1.14, CARD_SIZE.h * 1.1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
      );
      m.position.y = -0.002;
      this.flipper.add(m);
      this.highlight = m;
    } else if (!on && this.highlight) {
      this.flipper.remove(this.highlight);
      this.highlight.geometry.dispose();
      this.highlight.material.dispose();
      this.highlight = null;
    }
  }

  dispose() {
    this.setHighlight(false);
    this.root.removeFromParent();
  }
}
