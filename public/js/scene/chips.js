// Chip stacks built from denominations.
import * as THREE from 'three';
import { CHIP_DENOMS, chipFaceTexture, chipEdgeTexture } from './textures.js';
import { tween, ease } from './tween.js';

export const CHIP_R = 0.021;
export const CHIP_H = 0.0068;
const MAX_PER_COLUMN = 8;
const MAX_COLUMNS = 8;

let shared = null;
function ensureShared() {
  if (shared) return shared;
  const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 32, 1);
  geo.translate(0, CHIP_H / 2, 0);
  const mats = {};
  for (const d of CHIP_DENOMS) {
    const face = new THREE.MeshStandardMaterial({ map: chipFaceTexture(d), roughness: 0.45, metalness: 0.02 });
    const edge = new THREE.MeshStandardMaterial({ map: chipEdgeTexture(d), roughness: 0.5, metalness: 0.02 });
    edge.map.wrapS = THREE.RepeatWrapping;
    edge.map.repeat.set(1, 1);
    mats[d.v] = [edge, face, face];
  }
  shared = { geo, mats };
  return shared;
}

// Greedy breakdown into columns of chips.
export function breakdown(amount) {
  const cols = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of CHIP_DENOMS) {
    let n = Math.floor(rest / d.v);
    // Prefer a few more of smaller chips so stacks look rich instead of 1 big chip.
    if (n > 0) {
      rest -= n * d.v;
      while (n > 0) {
        const k = Math.min(n, MAX_PER_COLUMN);
        cols.push({ v: d.v, n: k });
        n -= k;
      }
    }
  }
  // Too many columns? merge smallest into larger by just trimming visually.
  return cols.slice(0, MAX_COLUMNS * 2);
}

// Visually break big single chips into smaller ones so a 10,000 stack isn't two chips.
function richBreakdown(amount) {
  let cols = breakdown(amount);
  const total = () => cols.reduce((s, c) => s + c.n, 0);
  let guard = 0;
  while (total() < 10 && guard++ < 6) {
    // Split the largest denom column into the next smaller denomination.
    const idx = cols.findIndex((c) => c.v > 25);
    if (idx < 0) break;
    const c = cols[idx];
    const di = CHIP_DENOMS.findIndex((d) => d.v === c.v);
    const smaller = CHIP_DENOMS[di + 1];
    if (!smaller) break;
    const value = c.v;
    c.n -= 1;
    if (c.n === 0) cols.splice(idx, 1);
    const k = value / smaller.v;
    if (!Number.isInteger(k) || k > 20) break;
    cols.push({ v: smaller.v, n: k });
    cols = mergeCols(cols);
  }
  return cols;
}

function mergeCols(cols) {
  const byV = new Map();
  for (const c of cols) byV.set(c.v, (byV.get(c.v) || 0) + c.n);
  const out = [];
  for (const d of CHIP_DENOMS) {
    let n = byV.get(d.v) || 0;
    while (n > 0) { const k = Math.min(n, MAX_PER_COLUMN); out.push({ v: d.v, n: k }); n -= k; }
  }
  return out;
}

export class ChipPile {
  constructor({ layout = 'row', rich = true } = {}) {
    ensureShared();
    this.group = new THREE.Group();
    this.amount = 0;
    this.layout = layout;
    this.rich = rich;
  }

  set(amount) {
    amount = Math.max(0, Math.round(amount));
    if (amount === this.amount && this.group.children.length) return;
    this.amount = amount;
    this.group.clear();
    if (!amount) return;
    const { geo, mats } = shared;
    const cols = this.rich ? richBreakdown(amount) : breakdown(amount);
    const n = cols.length;
    const spacing = CHIP_R * 2.08;
    cols.forEach((c, i) => {
      let x, z;
      if (this.layout === 'cluster') {
        // Hex-ish cluster
        const ring = i === 0 ? 0 : Math.ceil((Math.sqrt(12 * i - 3) - 3) / 6);
        const a = i === 0 ? 0 : (i / Math.max(1, ring * 6)) * Math.PI * 2 + ring;
        x = Math.cos(a) * ring * spacing;
        z = Math.sin(a) * ring * spacing;
      } else {
        const perRow = 4;
        const row = Math.floor(i / perRow), col = i % perRow;
        const inRow = Math.min(perRow, n - row * perRow);
        x = (col - (inRow - 1) / 2) * spacing;
        z = row * spacing;
      }
      for (let k = 0; k < c.n; k++) {
        const m = new THREE.Mesh(geo, mats[c.v]);
        m.position.set(x + (Math.sin(k * 7.1 + i) * 0.0012), k * CHIP_H, z + (Math.cos(k * 5.3 + i) * 0.0012));
        m.rotation.y = k * 1.3 + i;
        m.castShadow = k === c.n - 1 || k === 0;
        m.receiveShadow = true;
        this.group.add(m);
      }
    });
  }

  dispose() { this.group.clear(); this.group.removeFromParent(); }
}

// Fly a temporary pile of `amount` from world pos a to world pos b.
export async function flyChips(scene, amount, from, to, { duration = 0.5, arc = 0.15, yaw = 0 } = {}) {
  if (amount <= 0) return;
  const pile = new ChipPile({ layout: 'cluster', rich: false });
  pile.set(amount);
  pile.group.position.copy(from);
  pile.group.rotation.y = yaw;
  scene.add(pile.group);
  await tween(duration, (t) => {
    pile.group.position.lerpVectors(from, to, t);
    pile.group.position.y += Math.sin(t * Math.PI) * arc;
  }, ease.inOutCubic);
  pile.dispose();
}
