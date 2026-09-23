// Procedurally generated textures (no image assets needed).
import * as THREE from 'three';

let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function toTexture(c, { srgb = true, repeat = null, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// Seeded random so textures look the same every load.
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function noise(ctx, w, h, amount, alpha, seed = 3) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    if (alpha != null) d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------- Suits ----------------
export function suitPath(ctx, suit, x, y, s) {
  // Draws a suit symbol centered at x,y with height ~s.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.beginPath();
  if (suit === 'h') {
    ctx.moveTo(0, 38);
    ctx.bezierCurveTo(-10, 25, -50, 5, -50, -20);
    ctx.bezierCurveTo(-50, -42, -22, -52, 0, -28);
    ctx.bezierCurveTo(22, -52, 50, -42, 50, -20);
    ctx.bezierCurveTo(50, 5, 10, 25, 0, 38);
  } else if (suit === 'd') {
    ctx.moveTo(0, -50);
    ctx.quadraticCurveTo(18, -20, 38, 0);
    ctx.quadraticCurveTo(18, 20, 0, 50);
    ctx.quadraticCurveTo(-18, 20, -38, 0);
    ctx.quadraticCurveTo(-18, -20, 0, -50);
  } else if (suit === 's') {
    ctx.moveTo(0, -50);
    ctx.bezierCurveTo(-10, -30, -50, -10, -48, 14);
    ctx.bezierCurveTo(-46, 36, -16, 38, -4, 22);
    ctx.quadraticCurveTo(-8, 40, -20, 50);
    ctx.lineTo(20, 50);
    ctx.quadraticCurveTo(8, 40, 4, 22);
    ctx.bezierCurveTo(16, 38, 46, 36, 48, 14);
    ctx.bezierCurveTo(50, -10, 10, -30, 0, -50);
  } else { // clubs
    ctx.arc(0, -24, 22, 0, Math.PI * 2);
    ctx.moveTo(-18, 8);
    ctx.arc(-24, 8, 22, 0, Math.PI * 2);
    ctx.moveTo(46, 8);
    ctx.arc(24, 8, 22, 0, Math.PI * 2);
    ctx.moveTo(-5, 10);
    ctx.quadraticCurveTo(-6, 40, -20, 50);
    ctx.lineTo(20, 50);
    ctx.quadraticCurveTo(6, 40, 5, 10);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export const SUIT_COLOR = { h: '#c8102e', d: '#c8102e', s: '#111418', c: '#111418' };
const RANK_LABEL = { T: '10' };

// ---------------- Cards ----------------
export const CARD_W = 256, CARD_H = 358; // atlas cell size (drawn at 200x280 units, scaled up)
const BASE_W = 200, BASE_H = 280;
const ATLAS_COLS = 13, ATLAS_ROWS = 5; // row 4 = back

const PIPS = {
  // [x, y] in a 0..1 box, y down. Flip = drawn upside down.
  2: [[0.5, 0.1], [0.5, 0.9]],
  3: [[0.5, 0.1], [0.5, 0.5], [0.5, 0.9]],
  4: [[0.2, 0.1], [0.8, 0.1], [0.2, 0.9], [0.8, 0.9]],
  5: [[0.2, 0.1], [0.8, 0.1], [0.5, 0.5], [0.2, 0.9], [0.8, 0.9]],
  6: [[0.2, 0.1], [0.8, 0.1], [0.2, 0.5], [0.8, 0.5], [0.2, 0.9], [0.8, 0.9]],
  7: [[0.2, 0.1], [0.8, 0.1], [0.5, 0.3], [0.2, 0.5], [0.8, 0.5], [0.2, 0.9], [0.8, 0.9]],
  8: [[0.2, 0.1], [0.8, 0.1], [0.5, 0.3], [0.2, 0.5], [0.8, 0.5], [0.5, 0.7], [0.2, 0.9], [0.8, 0.9]],
  9: [[0.2, 0.1], [0.8, 0.1], [0.2, 0.37], [0.8, 0.37], [0.5, 0.5], [0.2, 0.63], [0.8, 0.63], [0.2, 0.9], [0.8, 0.9]],
  10: [[0.2, 0.1], [0.8, 0.1], [0.5, 0.25], [0.2, 0.37], [0.8, 0.37], [0.2, 0.63], [0.8, 0.63], [0.5, 0.75], [0.2, 0.9], [0.8, 0.9]],
};

function drawCardFace(ctx, ox, oy, rank, suit) {
  const w = BASE_W, h = BASE_H;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(CARD_W / BASE_W, CARD_H / BASE_H);
  // Base
  roundRect(ctx, 2, 2, w - 4, h - 4, 16);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fffdf8'); g.addColorStop(1, '#f1ece2');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#cfc8b8'; ctx.stroke();

  const color = SUIT_COLOR[suit];
  ctx.fillStyle = color;
  const label = RANK_LABEL[rank] || rank;

  // Corner indices (both corners, second rotated)
  for (const rot of [0, Math.PI]) {
    ctx.save();
    if (rot) { ctx.translate(w, h); ctx.rotate(rot); }
    ctx.font = `bold ${label.length > 1 ? 40 : 46}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(label, 28, 12);
    suitPath(ctx, suit, 28, 76, 30);
    ctx.restore();
  }

  const n = rank === 'A' ? 1 : rank === 'T' ? 10 : Number(rank);
  if (rank === 'A') {
    suitPath(ctx, suit, w / 2, h / 2, suit === 's' ? 110 : 80);
    if (suit === 's') { // decorative ring for the ace of spades
      ctx.strokeStyle = '#b8912e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 70, 78, 0, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (n >= 2 && n <= 10) {
    const bx = 52, by = 42, bw = w - 104, bh = h - 84;
    for (const [px, py] of PIPS[n]) {
      ctx.save();
      const x = bx + px * bw, y = by + py * bh;
      if (py > 0.55) { ctx.translate(x, y); ctx.rotate(Math.PI); ctx.translate(-x, -y); }
      suitPath(ctx, suit, x, y, 38);
      ctx.restore();
    }
  } else {
    // Court card: framed panel with ornament, big letter and suit.
    const fx = 48, fy = 40, fw = w - 96, fh = h - 80;
    const panel = ctx.createLinearGradient(0, fy, 0, fy + fh);
    const tint = color === '#c8102e' ? ['#fbe3d6', '#f3c9b6'] : ['#dfe6f3', '#c3cfe6'];
    panel.addColorStop(0, tint[0]); panel.addColorStop(1, tint[1]);
    roundRect(ctx, fx, fy, fw, fh, 8);
    ctx.fillStyle = panel; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#b8912e'; ctx.stroke();
    roundRect(ctx, fx + 6, fy + 6, fw - 12, fh - 12, 6);
    ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
    // Mirrored halves
    for (const rot of [0, Math.PI]) {
      ctx.save();
      if (rot) { ctx.translate(w, h); ctx.rotate(rot); }
      // crown / emblem
      ctx.fillStyle = '#b8912e';
      const cx = w / 2, cy = fy + 38;
      ctx.beginPath();
      if (rank === 'K') {
        ctx.moveTo(cx - 26, cy + 12); ctx.lineTo(cx - 26, cy - 8); ctx.lineTo(cx - 13, cy + 2);
        ctx.lineTo(cx, cy - 14); ctx.lineTo(cx + 13, cy + 2); ctx.lineTo(cx + 26, cy - 8); ctx.lineTo(cx + 26, cy + 12);
      } else if (rank === 'Q') {
        ctx.moveTo(cx - 22, cy + 12); ctx.quadraticCurveTo(cx - 24, cy - 10, cx - 10, cy - 4);
        ctx.quadraticCurveTo(cx, cy - 18, cx + 10, cy - 4); ctx.quadraticCurveTo(cx + 24, cy - 10, cx + 22, cy + 12);
      } else {
        ctx.moveTo(cx - 20, cy + 12); ctx.lineTo(cx - 14, cy - 10); ctx.lineTo(cx + 14, cy - 10); ctx.lineTo(cx + 20, cy + 12);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = color;
      suitPath(ctx, suit, cx, cy + 40, 30);
      ctx.restore();
    }
    ctx.fillStyle = color;
    ctx.font = 'bold 84px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rank, w / 2, h / 2 + 4);
  }
  ctx.restore();
}

function drawCardBack(ctx, ox, oy) {
  const w = BASE_W, h = BASE_H;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(CARD_W / BASE_W, CARD_H / BASE_H);
  roundRect(ctx, 2, 2, w - 4, h - 4, 16);
  ctx.fillStyle = '#f8f4ea'; ctx.fill();
  roundRect(ctx, 12, 12, w - 24, h - 24, 10);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#8e0f1f'); g.addColorStop(1, '#5a0712');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,215,140,0.35)'; ctx.lineWidth = 1.5;
  for (let i = -h; i < w + h; i += 14) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = '#d4af37';
  roundRect(ctx, 18, 18, w - 36, h - 36, 8); ctx.stroke();
  // Emblem
  ctx.fillStyle = '#5a0712';
  ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 46, 56, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#d4af37'; ctx.stroke();
  ctx.fillStyle = '#d4af37';
  suitPath(ctx, 's', w / 2, h / 2 - 14, 34);
  ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HR', w / 2, h / 2 + 26);
  ctx.restore();
}

let cardAtlas = null;
export function getCardAtlas() {
  if (cardAtlas) return cardAtlas;
  const [c, ctx] = canvas(CARD_W * ATLAS_COLS, CARD_H * ATLAS_ROWS);
  const ranks = '23456789TJQKA';
  const suits = 'shdc';
  suits.split('').forEach((s, row) => ranks.split('').forEach((r, col) => drawCardFace(ctx, col * CARD_W, row * CARD_H, r, s)));
  drawCardBack(ctx, 0, 4 * CARD_H);
  const base = toTexture(c);
  const cache = {};
  const texFor = (col, row) => {
    const key = col + ',' + row;
    if (cache[key]) return cache[key];
    const t = base.clone();
    t.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
    t.offset.set(col / ATLAS_COLS, 1 - (row + 1) / ATLAS_ROWS);
    t.needsUpdate = true;
    return (cache[key] = t);
  };
  cardAtlas = {
    face: (card) => texFor(ranks.indexOf(card[0]), suits.indexOf(card[1])),
    back: () => texFor(0, 4),
    canvas: c,
  };
  return cardAtlas;
}

// ---------------- Chips ----------------
export const CHIP_DENOMS = [
  { v: 25000, base: '#1c7c8c', accent: '#f4e2a1', text: '25K' },
  { v: 5000, base: '#8a4b20', accent: '#f6e7c8', text: '5K' },
  { v: 1000, base: '#e0b418', accent: '#1b1b1b', text: '1K' },
  { v: 500, base: '#6b2c91', accent: '#f5f0ff', text: '500' },
  { v: 100, base: '#141414', accent: '#f2f2f2', text: '100' },
  { v: 25, base: '#1d7a3a', accent: '#f5f5f5', text: '25' },
  { v: 5, base: '#b3121f', accent: '#f8f8f8', text: '5' },
  { v: 1, base: '#e8e4d8', accent: '#1b3a8a', text: '1' },
];

export function chipFaceTexture(d) {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const cx = S / 2;
  ctx.fillStyle = d.base;
  ctx.fillRect(0, 0, S, S);
  // Edge spots
  ctx.fillStyle = d.accent;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save(); ctx.translate(cx, cx); ctx.rotate(a);
    ctx.fillRect(-14, -cx, 28, 30);
    ctx.restore();
  }
  // Inner rings
  ctx.lineWidth = 6; ctx.strokeStyle = d.accent;
  ctx.beginPath(); ctx.arc(cx, cx, 84, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(cx, cx, 72, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Center inlay
  const g = ctx.createRadialGradient(cx, cx - 20, 10, cx, cx, 70);
  g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#e8dfc9');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cx, 66, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = d.base === '#e8e4d8' ? d.accent : d.base;
  ctx.font = `bold ${d.text.length > 3 ? 40 : 50}px Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.text, cx, cx + 2);
  noise(ctx, S, S, 10, null, 11);
  return toTexture(c);
}

export function chipEdgeTexture(d) {
  const [c, ctx] = canvas(256, 16);
  ctx.fillStyle = d.base; ctx.fillRect(0, 0, 256, 16);
  ctx.fillStyle = d.accent;
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 32 + 4, 0, 14, 16);
  return toTexture(c);
}

// ---------------- Table surfaces ----------------
export function feltTexture(lengthM, widthM, color = '#0d6b3c') {
  const W = 2048, H = Math.round(2048 * (widthM / lengthM));
  const [c, ctx] = canvas(W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.6);
  g.addColorStop(0, shade(color, 18)); g.addColorStop(1, shade(color, -25));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 18, null, 5);
  const pxPerM = W / lengthM;
  // Betting line (stadium inset)
  const inset = 0.3 * pxPerM;
  ctx.strokeStyle = 'rgba(232, 200, 120, 0.55)'; ctx.lineWidth = 4;
  const r = H / 2 - inset;
  ctx.beginPath();
  ctx.moveTo(H / 2, inset); ctx.lineTo(W - H / 2, inset);
  ctx.arc(W - H / 2, H / 2, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(H / 2, H - inset);
  ctx.arc(H / 2, H / 2, r, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  // Board card boxes
  const cw = 0.1 * pxPerM, ch = 0.14 * pxPerM, gap = 0.014 * pxPerM;
  const totalW = cw * 5 + gap * 4;
  ctx.strokeStyle = 'rgba(232, 200, 120, 0.28)'; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    roundRect(ctx, W / 2 - totalW / 2 + i * (cw + gap) - 4, H / 2 - ch / 2 - 4, cw + 8, ch + 8, 10);
    ctx.stroke();
  }
  // Logo text arcs
  ctx.fillStyle = 'rgba(232, 200, 120, 0.22)';
  ctx.font = `bold ${Math.round(0.07 * pxPerM)}px Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HIGH ROLLER', W / 2, H / 2 + ch * 0.95);
  ctx.font = `italic ${Math.round(0.04 * pxPerM)}px Georgia, serif`;
  ctx.fillText("No-Limit Texas Hold'em", W / 2, H / 2 + ch * 1.35);
  ctx.save();
  ctx.translate(W / 2, H / 2 - ch * 1.0);
  ctx.fillStyle = 'rgba(232, 200, 120, 0.18)';
  suitPath(ctx, 's', -90, 0, 40); suitPath(ctx, 'h', -30, 0, 40); suitPath(ctx, 'd', 30, 0, 40); suitPath(ctx, 'c', 90, 0, 40);
  ctx.restore();
  return toTexture(c);
}

export function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export function leatherTexture() {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#2a1510'; ctx.fillRect(0, 0, 512, 512);
  const r = rng(9);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 220 : 0},${r() > 0.5 ? 200 : 0},${r() * 0.04})`;
    const s = 2 + r() * 10;
    ctx.beginPath(); ctx.arc(r() * 512, r() * 512, s, 0, Math.PI * 2); ctx.fill();
  }
  noise(ctx, 512, 512, 14, null, 21);
  return toTexture(c, { repeat: [24, 1] });
}

export function woodTexture(base = '#5a2d14', repeat = [1, 1], seed = 4) {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  for (let y = 0; y < 512; y += 1) {
    const v = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 6) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(0,0,0,${v * 0.18})`;
    ctx.fillRect(0, y, 512, 1);
  }
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(255,200,150,${r() * 0.06})`;
    ctx.lineWidth = 1 + r() * 2;
    const y = r() * 512;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + (r() - 0.5) * 30, 340, y + (r() - 0.5) * 30, 512, y);
    ctx.stroke();
  }
  noise(ctx, 512, 512, 10, null, seed);
  return toTexture(c, { repeat });
}

export function carpetTexture() {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#4a0d18'; ctx.fillRect(0, 0, S, S);
  const cell = S / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = gx * cell + cell / 2, cy = gy * cell + cell / 2;
      // diamond lattice
      ctx.strokeStyle = '#c99a2e'; ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy - cell / 2); ctx.lineTo(cx + cell / 2, cy); ctx.lineTo(cx, cy + cell / 2); ctx.lineTo(cx - cell / 2, cy); ctx.closePath();
      ctx.stroke();
      // medallion
      ctx.fillStyle = '#123f4a';
      ctx.beginPath(); ctx.arc(cx, cy, cell * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e0b84a'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#7a1a2b';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * cell * 0.16, cy + Math.sin(a) * cell * 0.16, cell * 0.07, cell * 0.03, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e0b84a';
      ctx.beginPath(); ctx.arc(cx, cy, cell * 0.06, 0, Math.PI * 2); ctx.fill();
      // corner stars
      ctx.fillStyle = '#1f6a5a';
      ctx.beginPath(); ctx.arc(gx * cell, gy * cell, cell * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8c35a';
      ctx.beginPath(); ctx.arc(gx * cell, gy * cell, cell * 0.03, 0, Math.PI * 2); ctx.fill();
    }
  }
  noise(ctx, S, S, 30, null, 8);
  return toTexture(c, { repeat: [14, 14] });
}

export function damaskTexture() {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#3b0b12'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(200, 150, 70, 0.14)';
  for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 2; gx++) {
    const cx = gx * 256 + 128 + (gy % 2) * 0, cy = gy * 256 + 128;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 40, cy + Math.sin(a) * 60, 22, 50, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill();
  }
  noise(ctx, S, S, 12, null, 14);
  return toTexture(c, { repeat: [16, 2] });
}

export function marbleTexture() {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#e9e2d6'; ctx.fillRect(0, 0, S, S);
  const r = rng(22);
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(90, 80, 70, ${0.05 + r() * 0.15})`;
    ctx.lineWidth = 0.5 + r() * 2.5;
    ctx.beginPath();
    let x = r() * S, y = 0;
    ctx.moveTo(x, y);
    while (y < S) { x += (r() - 0.5) * 40; y += 20 + r() * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  noise(ctx, S, S, 8, null, 23);
  return toTexture(c, { repeat: [2, 3] });
}

// Generic glowing sign text (use as emissiveMap / map on MeshBasicMaterial).
export function neonTexture(text, color, { w = 1024, h = 256, font = 'bold 150px "Arial Black", Impact, sans-serif', border = true } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = font;
  ctx.shadowColor = color; ctx.shadowBlur = 30;
  ctx.lineWidth = 10; ctx.strokeStyle = color;
  if (border) { roundRect(ctx, 16, 16, w - 32, h - 32, 40); ctx.stroke(); }
  ctx.strokeText(text, w / 2, h / 2 + 6);
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, w / 2, h / 2 + 6);
  return toTexture(c);
}

// Animated slot-machine screen: returns {texture, update(time)}.
export function slotScreen(seed) {
  const W = 256, H = 192;
  const [c, ctx] = canvas(W, H);
  const tex = toTexture(c, { mips: false });
  const symbols = ['7', '♦', '★', 'BAR', '♣', '$', '♥'];
  const colors = ['#ff3355', '#ffd23a', '#33e0ff', '#ff8a1f', '#6bff6b', '#ffe066', '#ff55cc'];
  const r = rng(seed);
  const reels = [0, 1, 2].map(() => ({ pos: r() * 7, speed: 0, stopAt: 0 }));
  let phase = r() * 10;
  let last = -1;
  const bg = ['#20062c', '#061a33', '#2c0610', '#062c1a'][seed % 4];
  function update(t) {
    const frame = Math.floor(t * 12);
    if (frame === last) return;
    last = frame;
    const cycle = (t + phase) % 9;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(255,255,255,0.12)'); grd.addColorStop(0.5, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.12)');
    reels.forEach((rl, i) => {
      const spinning = cycle < 2 + i * 0.5;
      if (spinning) rl.pos += 0.9 + i * 0.1; else rl.pos = Math.round(rl.pos);
      const x = 18 + i * 76;
      ctx.fillStyle = '#f7f1e3'; ctx.fillRect(x, 26, 68, 140);
      for (let k = -1; k <= 1; k++) {
        const idx = ((Math.floor(rl.pos) + k) % 7 + 7) % 7;
        const off = spinning ? (rl.pos % 1) * 46 : 0;
        ctx.fillStyle = colors[idx];
        ctx.font = `bold ${symbols[idx].length > 1 ? 22 : 38}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(symbols[idx], x + 34, 96 + k * 46 + off);
      }
      ctx.fillStyle = grd; ctx.fillRect(x, 26, 68, 140);
    });
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 3; ctx.strokeRect(14, 22, W - 28, 148);
    if (cycle > 3.5 && cycle < 5 && seed % 3 === 0) {
      ctx.fillStyle = frame % 2 ? '#ffd23a' : '#ff3355';
      ctx.font = 'bold 26px Arial Black, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('WINNER!', W / 2, 16);
    }
    tex.needsUpdate = true;
  }
  update(0);
  return { texture: tex, update };
}

export function radialGlowTexture(inner = 'rgba(255,220,160,1)', outer = 'rgba(255,220,160,0)') {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

// Circle "initials" portrait for players without a camera.
export function initialsTexture(name, color) {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 90, 20, 128, 128, 140);
  g.addColorStop(0, shade(color, 20)); g.addColorStop(1, shade(color, -25));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 110px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const initials = name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  ctx.fillText(initials, 128, 136);
  return toTexture(c);
}
