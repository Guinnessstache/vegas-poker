// The casino floor around the poker table.
import * as THREE from 'three';
import {
  carpetTexture, damaskTexture, marbleTexture, woodTexture, neonTexture, slotScreen, radialGlowTexture, feltTexture,
} from './textures.js';
import { buildNPC } from './avatars.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROOM = { w: 44, d: 36, h: 6.5 };

export function buildCasino(scene, quality = 'high') {
  const root = new THREE.Group();
  root.name = 'casino';
  scene.add(root);
  const animators = [];

  // ---------- Floor ----------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95, metalness: 0 }),
  );
  floor.material.map.repeat.set(ROOM.w / 2.6, ROOM.d / 2.6);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // Raised poker-room platform with a brass railing
  const platR = 4.2;
  const plat = new THREE.Mesh(
    new THREE.CylinderGeometry(platR, platR + 0.05, 0.12, 96),
    new THREE.MeshStandardMaterial({ map: woodTexture('#3a1a0c', [6, 1], 12), roughness: 0.3, metalness: 0.1 }),
  );
  plat.position.y = -0.06 + 0.001;
  plat.receiveShadow = true;
  root.add(plat);
  const rugTex = carpetTexture();
  rugTex.repeat.set(4, 4);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(platR - 0.25, 96), new THREE.MeshStandardMaterial({ map: rugTex, color: 0x9a8a8a, roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.004;
  rug.receiveShadow = true;
  root.add(rug);

  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.22, metalness: 1 });
  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 12);
  const railPosts = new THREE.InstancedMesh(postGeo, brass, 36);
  const m4 = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.28) continue; // entrance gap facing +z
    if (k >= 36) break;
    m4.makeTranslation(Math.cos(a) * (platR - 0.12), 0.45, Math.sin(a) * (platR - 0.12));
    railPosts.setMatrixAt(k++, m4);
  }
  railPosts.count = k;
  root.add(railPosts);
  const railTop = new THREE.Mesh(new THREE.TorusGeometry(platR - 0.12, 0.035, 10, 128, Math.PI * 2 - 0.62), brass);
  railTop.rotation.x = Math.PI / 2;
  railTop.rotation.z = Math.PI / 2 + 0.31;
  railTop.position.y = 0.9;
  root.add(railTop);
  const velvet = new THREE.Mesh(new THREE.TorusGeometry(platR - 0.12, 0.02, 8, 128, Math.PI * 2 - 0.62), new THREE.MeshStandardMaterial({ color: 0x6a0a18, roughness: 0.8 }));
  velvet.rotation.copy(railTop.rotation);
  velvet.position.y = 0.6;
  root.add(velvet);

  // ---------- Walls ----------
  const wallMat = new THREE.MeshStandardMaterial({ map: damaskTexture(), roughness: 0.85 });
  const wainMat = new THREE.MeshStandardMaterial({ map: woodTexture('#2d1409', [10, 1], 3), roughness: 0.4 });
  const walls = [
    { pos: [0, ROOM.h / 2, -ROOM.d / 2], rot: 0, len: ROOM.w },
    { pos: [0, ROOM.h / 2, ROOM.d / 2], rot: Math.PI, len: ROOM.w },
    { pos: [-ROOM.w / 2, ROOM.h / 2, 0], rot: Math.PI / 2, len: ROOM.d },
    { pos: [ROOM.w / 2, ROOM.h / 2, 0], rot: -Math.PI / 2, len: ROOM.d },
  ];
  const sconceGlow = radialGlowTexture('rgba(255,200,130,1)', 'rgba(255,160,80,0)');
  const sconceMat = new THREE.SpriteMaterial({ map: sconceGlow, color: 0xffc080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  for (const w of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w.len, ROOM.h), wallMat);
    wall.position.set(...w.pos);
    wall.rotation.y = w.rot;
    root.add(wall);
    const wain = new THREE.Mesh(new THREE.PlaneGeometry(w.len, 1.2), wainMat);
    wain.position.set(w.pos[0], 0.6, w.pos[2]);
    wain.rotation.y = w.rot;
    wain.translateZ(0.02);
    root.add(wain);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w.len, 0.06, 0.05), brass);
    trim.position.set(w.pos[0], 1.22, w.pos[2]);
    trim.rotation.y = w.rot;
    trim.translateZ(0.03);
    root.add(trim);
    // Sconces
    for (let s = -w.len / 2 + 3; s < w.len / 2 - 1; s += 5) {
      const sp = new THREE.Sprite(sconceMat);
      sp.scale.set(1.1, 1.1, 1);
      sp.position.set(w.pos[0], 2.6, w.pos[2]);
      sp.rotation.y = w.rot;
      const off = new THREE.Vector3(s, 0, 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), w.rot);
      sp.position.add(off);
      root.add(sp);
    }
  }

  // ---------- Ceiling with coffers + downlights ----------
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ color: 0x1a0d08, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  root.add(ceil);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a160a, roughness: 0.5, metalness: 0.2 });
  for (let x = -ROOM.w / 2 + 4; x < ROOM.w / 2; x += 4) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, ROOM.d), beamMat);
    b.position.set(x, ROOM.h - 0.17, 0);
    root.add(b);
  }
  for (let z = -ROOM.d / 2 + 4; z < ROOM.d / 2; z += 4) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.35, 0.25), beamMat);
    b.position.set(0, ROOM.h - 0.17, z);
    root.add(b);
  }
  const dlGeo = new THREE.CircleGeometry(0.09, 16);
  dlGeo.rotateX(Math.PI / 2);
  const dlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.6), toneMapped: false });
  const cols = Math.floor(ROOM.w / 2), rows = Math.floor(ROOM.d / 2);
  const downlights = new THREE.InstancedMesh(dlGeo, dlMat, cols * rows);
  let n = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -ROOM.w / 2 + 1 + i * 2, z = -ROOM.d / 2 + 1 + j * 2;
    if (Math.hypot(x, z) < 3) continue;
    m4.makeTranslation(x, ROOM.h - 0.01, z);
    downlights.setMatrixAt(n++, m4);
  }
  downlights.count = n;
  root.add(downlights);

  // ---------- Lamp above the poker table ----------
  const lamp = new THREE.Group();
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x0f2a1a, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 0.35, 48, 1, true), shadeMat);
  const shadeInner = new THREE.Mesh(new THREE.CircleGeometry(1.08, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 1.2), toneMapped: false }));
  shadeInner.rotation.x = Math.PI / 2;
  shadeInner.position.y = 0.05;
  shade.scale.set(1.5, 1, 0.85);
  shadeInner.scale.set(1.5, 0.85, 1);
  const lampTrim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.02, 8, 64), brass);
  lampTrim.rotation.x = Math.PI / 2;
  lampTrim.scale.set(1.5, 0.85, 1);
  lampTrim.position.y = -0.175;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, ROOM.h - 2.6, 6), brass);
  cord.position.y = (ROOM.h - 2.6) / 2 + 0.17;
  lamp.add(shade, shadeInner, lampTrim, cord);
  lamp.position.y = 2.45;
  root.add(lamp);

  // ---------- Columns ----------
  const marble = new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.2, metalness: 0 });
  const colGeo = new THREE.CylinderGeometry(0.42, 0.42, ROOM.h, 32);
  const capGeo = new THREE.CylinderGeometry(0.58, 0.46, 0.35, 32);
  const colPositions = [[-8, -7], [8, -7], [-8, 7], [8, 7], [-15, 0], [15, 0], [0, -12], [0, 12]];
  for (const [x, z] of colPositions) {
    const c = new THREE.Mesh(colGeo, marble);
    c.position.set(x, ROOM.h / 2, z);
    c.castShadow = quality === 'high';
    root.add(c);
    for (const y of [0.2, ROOM.h - 0.2]) {
      const cap = new THREE.Mesh(capGeo, brass);
      cap.position.set(x, y, z);
      if (y < 1) cap.rotation.x = Math.PI;
      root.add(cap);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.6, 0.6), toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 3.2, z);
    root.add(ring);
  }

  // ---------- Chandeliers ----------
  const crystalGeo = new THREE.OctahedronGeometry(0.06, 0);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 2.2, roughness: 0.05, metalness: 0.3 });
  const chandPositions = [[-9, 0], [9, 0], [0, -8], [0, 8]];
  for (const [x, z] of chandPositions) {
    const g = new THREE.Group();
    const count = 3 * 18;
    const inst = new THREE.InstancedMesh(crystalGeo, crystalMat, count);
    let ci = 0;
    for (let ring = 0; ring < 3; ring++) {
      const r = 0.35 + ring * 0.3, y = -ring * 0.28;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + ring * 0.2;
        m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r);
        inst.setMatrixAt(ci++, m4);
      }
    }
    g.add(inst);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), brass);
    g.add(hub);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), brass);
    chain.position.y = 0.5;
    g.add(chain);
    g.position.set(x, ROOM.h - 1.2, z);
    root.add(g);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sconceGlow, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8, toneMapped: false }));
    glow.scale.set(3, 3, 1);
    glow.position.set(x, ROOM.h - 1.45, z);
    root.add(glow);
  }

  // ---------- Slot machine banks ----------
  const screens = [0, 1, 2, 3, 4, 5].map((i) => slotScreen(i + 1));
  animators.push((t) => screens.forEach((s) => s.update(t)));
  const slotBodyGeo = new THREE.BoxGeometry(0.72, 1.45, 0.6);
  slotBodyGeo.translate(0, 0.725, 0);
  const slotBodyMats = [0x7a0f1f, 0x14307a, 0x5a1a7a, 0x0f5a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.6 }));
  const screenGeo = new THREE.PlaneGeometry(0.56, 0.42);
  const toppers = ['#ff2a6d', '#ffd23a', '#2af6ff', '#b86bff'];
  const topperTex = toppers.map((col, i) => neonTexture(['777', 'JACKPOT', 'LUCKY', 'WILD'][i], col, { w: 512, h: 160, font: 'bold 90px "Arial Black", Impact, sans-serif' }));
  const topperGeo = new THREE.PlaneGeometry(0.7, 0.22);
  const trayGeo = new THREE.BoxGeometry(0.6, 0.06, 0.18);
  const screenMats = screens.map((scr) => new THREE.MeshBasicMaterial({ map: scr.texture, toneMapped: false }));
  const topperMats = topperTex.map((t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
  const stoolSeat = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20);
  const stoolPole = new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8);
  const stoolMat = new THREE.MeshStandardMaterial({ color: 0x3a0a10, roughness: 0.6 });
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.2, metalness: 1 });
  const bulbGeo = new THREE.SphereGeometry(0.018, 6, 4);
  const bulbOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.2), toneMapped: false });
  const bulbsAll = [];

  function slotBank(cx, cz, count, facing, bankIdx) {
    const bank = new THREE.Group();
    bank.position.set(cx, 0, cz);
    bank.rotation.y = facing;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.78;
      const body = new THREE.Mesh(slotBodyGeo, slotBodyMats[(i + bankIdx) % slotBodyMats.length]);
      body.position.x = x;
      body.castShadow = false;
      bank.add(body);
      const s = new THREE.Mesh(screenGeo, screenMats[(i + bankIdx * 2) % screens.length]);
      s.position.set(x, 1.15, 0.305);
      s.rotation.x = -0.12;
      bank.add(s);
      const top = new THREE.Mesh(topperGeo, topperMats[(i + bankIdx) % 4]);
      top.position.set(x, 1.62, 0.2);
      bank.add(top);
      const tray = new THREE.Mesh(trayGeo, trayMat);
      tray.position.set(x, 0.72, 0.36);
      bank.add(tray);
      // Chaser bulbs along the top edge
      const bulbs = [];
      for (let b = 0; b < 8; b++) {
        const bulb = new THREE.Mesh(bulbGeo, bulbOn);
        bulb.userData.dynamic = true;
        bulb.position.set(x - 0.33 + b * 0.094, 1.47, 0.31);
        bank.add(bulb);
        bulbs.push(bulb);
      }
      bulbsAll.push(bulbs);
      // Stool
      const stool = new THREE.Group();
      const ss = new THREE.Mesh(stoolSeat, stoolMat); ss.position.y = 0.66;
      const sp = new THREE.Mesh(stoolPole, trayMat); sp.position.y = 0.31;
      stool.add(ss, sp);
      stool.position.set(x, 0, 0.75);
      bank.add(stool);
    }
    root.add(bank);
    return bank;
  }

  const banks = [
    [-13, -13, 8, 0], [-13, -10.6, 8, Math.PI],
    [13, -13, 8, 0], [13, -10.6, 8, Math.PI],
    [-13, 10.6, 8, 0], [-13, 13, 8, Math.PI],
    [13, 10.6, 8, 0], [13, 13, 8, Math.PI],
    [-20.4, -4, 7, Math.PI / 2], [20.4, -4, 7, -Math.PI / 2],
  ];
  banks.forEach((b, i) => slotBank(b[0], b[1], b[2], b[3], i));
  animators.push((t) => {
    const f = Math.floor(t * 10);
    bulbsAll.forEach((bulbs, bi) => bulbs.forEach((b, i) => { b.visible = (i + f + bi) % 3 !== 0; }));
  });

  // NPCs at some slot machines
  const npcAnim = [];
  let seed = 7;
  banks.forEach((b, bi) => {
    const bankGroup = root.children[root.children.length - banks.length + bi];
    for (let i = 0; i < b[2]; i++) {
      if ((i * 7 + bi * 3) % 3 !== 0) continue;
      const h = buildNPC(seed += 13); // static (merged) to keep draw calls low
      const x = (i - (b[2] - 1) / 2) * 0.78;
      h.group.position.set(x, 0.12, 0.72);
      h.group.rotation.y = 0; // facing -z toward machine (local)
      h.group.scale.setScalar(0.98);
      bankGroup.add(h.group);
    }
  });

  // ---------- Other table games ----------
  function blackjackTable(x, z, rot) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 1.1, Math.PI, 0, true);
    shape.lineTo(1.1, 0.15); shape.lineTo(-1.1, 0.15); shape.closePath();
    const felt = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c3f7a, roughness: 0.9 }));
    felt.position.y = 0.76;
    felt.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.07, 10, 48, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a1510, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.76;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.74, 16), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.5 }));
    base.position.y = 0.37;
    g.add(felt, rim, base);
    const dealer = buildNPC(seed += 31, true);
    dealer.group.userData.dynamic = true;
    dealer.group.position.set(0, 0, -0.35);
    dealer.group.rotation.y = Math.PI;
    g.add(dealer.group);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.25 + i * 0.25);
      const npc = buildNPC(seed += 17);
      npc.group.userData.dynamic = true;
      npc.group.position.set(Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55);
      npc.group.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      if ((i + x) % 2) g.add(npc.group);
      npcAnim.push({ h: npc, phase: Math.random() * 10 });
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    root.add(g);
  }
  blackjackTable(-8.5, -3.2, Math.PI / 2 + 0.5);
  blackjackTable(-8.5, 3.6, Math.PI / 2 - 0.5);

  // Roulette
  {
    const g = new THREE.Group();
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.2), new THREE.MeshStandardMaterial({ color: 0x2a1510, roughness: 0.4 }));
    tableTop.position.y = 0.74;
    const feltMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: feltTexture(1.7, 1.0, '#0d6b3c'), roughness: 0.9 }));
    feltMesh.position.set(0.35, 0.785, 0);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x3a1e10, roughness: 0.3 }));
    bowl.position.set(-0.85, 0.82, 0);
    const wheelTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const x = c.getContext('2d');
      for (let i = 0; i < 37; i++) {
        x.fillStyle = i === 0 ? '#0a7a2a' : i % 2 ? '#b3121f' : '#111';
        x.beginPath(); x.moveTo(256, 256); x.arc(256, 256, 250, (i / 37) * Math.PI * 2, ((i + 1) / 37) * Math.PI * 2); x.fill();
      }
      x.fillStyle = '#c9a04a'; x.beginPath(); x.arc(256, 256, 120, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#6b3a1a'; x.beginPath(); x.arc(256, 256, 90, 0, Math.PI * 2); x.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const wheel = new THREE.Mesh(new THREE.CircleGeometry(0.36, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: wheelTex, roughness: 0.3, metalness: 0.2 }));
    wheel.position.set(-0.85, 0.885, 0);
    const spindle = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 12), brass);
    spindle.position.set(-0.85, 0.93, 0);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.5 }));
    legs.position.y = 0.35;
    wheel.userData.dynamic = spindle.userData.dynamic = true;
    g.add(tableTop, feltMesh, bowl, wheel, spindle, legs);
    animators.push((t, dt) => { wheel.rotation.y += dt * 0.9; spindle.rotation.y = wheel.rotation.y; });
    for (let i = 0; i < 4; i++) {
      const npc = buildNPC(seed += 23, true);
      npc.group.userData.dynamic = true;
      npc.group.position.set(-0.3 + i * 0.5, 0, i % 2 ? 0.95 : -0.95);
      npc.group.rotation.y = i % 2 ? 0 : Math.PI;
      g.add(npc.group);
      npcAnim.push({ h: npc, phase: i * 2 });
    }
    g.position.set(9, 0, 1);
    g.rotation.y = -Math.PI / 2;
    root.add(g);
  }

  animators.push((t) => {
    for (const a of npcAnim) {
      const h = a.h;
      h.headPivot.rotation.y = Math.sin(t * 0.4 + a.phase) * 0.4;
      h.torso.scale.y = 1 + Math.sin(t * 1.5 + a.phase) * 0.012;
      if (h.arms[1]) h.arms[1].shoulder.rotation.x = 1.0 + Math.max(0, Math.sin(t * 0.8 + a.phase)) * 0.3;
    }
  });

  // ---------- Bar ----------
  {
    const g = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(10, 1.1, 0.8), new THREE.MeshStandardMaterial({ map: woodTexture('#3a1a0c', [6, 1], 31), roughness: 0.25 }));
    counter.position.set(0, 0.55, 2.2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.06, 0.95), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.3 }));
    top.position.set(0, 1.13, 2.2);
    const shelfBack = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.45, 0.15), toneMapped: false }));
    shelfBack.position.set(0, 2.2, 0.05);
    g.add(counter, top, shelfBack);
    const bottleGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.3, 10);
    const bottleColors = [0x2a8a3a, 0x8a4a1a, 0xdddddd, 0x6a1a1a, 0x1a3a8a, 0xc9a04a];
    const glassMats = bottleColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8, emissive: c, emissiveIntensity: 0.4 }));
    for (let shelf = 0; shelf < 3; shelf++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 }));
      board.position.set(0, 1.3 + shelf * 0.8, 0.2);
      g.add(board);
      for (let b = 0; b < 40; b++) {
        const bottle = new THREE.Mesh(bottleGeo, glassMats[(b * 7 + shelf) % glassMats.length]);
        bottle.position.set(-4.7 + b * 0.24, 1.3 + shelf * 0.8 + 0.165, 0.2);
        g.add(bottle);
      }
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: neonTexture('COCKTAILS', '#ff3aa8'), transparent: true, toneMapped: false, color: new THREE.Color(2, 2, 2) }));
    sign.position.set(0, 4.3, 0.08);
    g.add(sign);
    for (let i = 0; i < 8; i++) {
      const stool = new THREE.Group();
      const ss = new THREE.Mesh(stoolSeat, stoolMat); ss.position.y = 0.76;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.74, 8), trayMat); sp.position.y = 0.37;
      stool.add(ss, sp);
      stool.position.set(-4 + i * 1.15, 0, 3.1);
      g.add(stool);
      if (i % 3 === 1) {
        const npc = buildNPC(seed += 41);
        npc.group.position.set(-4 + i * 1.15, 0.2, 3.15);
        g.add(npc.group);
      }
    }
    g.position.set(0, 0, -ROOM.d / 2);
    root.add(g);
  }

  // ---------- Neon signage ----------
  const pokerSign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: neonTexture('POKER ROOM', '#ffcc33'), transparent: true, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.2), depthWrite: false }));
  pokerSign.position.set(0, 4.6, -6.5);
  root.add(pokerSign);
  const cashier = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: neonTexture('CASHIER', '#33e0ff'), transparent: true, toneMapped: false, color: new THREE.Color(2, 2, 2), depthWrite: false }));
  cashier.position.set(ROOM.w / 2 - 0.1, 3.4, 8);
  cashier.rotation.y = -Math.PI / 2;
  root.add(cashier);
  const highLimit = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: neonTexture('HIGH LIMIT', '#ff3355'), transparent: true, toneMapped: false, color: new THREE.Color(2, 2, 2), depthWrite: false }));
  highLimit.position.set(0, 3.6, ROOM.d / 2 - 0.1);
  highLimit.rotation.y = Math.PI;
  root.add(highLimit);
  animators.push((t) => {
    // Occasional neon flicker
    const f = Math.sin(t * 37) > 0.97 ? 0.5 : 1;
    pokerSign.material.color.setScalar(2.2 * f);
  });

  mergeStatic(root);

  return {
    root,
    lamp,
    update(t, dt) { for (const a of animators) a(t, dt); },
  };
}

// Bake all static meshes that share a material into one draw call.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    for (let p = o; p; p = p.parent) if (p.userData.dynamic) return;
    const geo = o.geometry;
    if (!geo.attributes.position || !geo.attributes.normal || !geo.attributes.uv) return;
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(o.matrixWorld);
    if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    buckets.get(key).geos.push(g);
    remove.push(o);
  });
  for (const o of remove) o.removeFromParent();
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, b.material);
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    m.matrixAutoUpdate = false;
    root.add(m);
  }
}
