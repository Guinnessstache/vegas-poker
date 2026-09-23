// GameView: turns server state + events into 3D table visuals and animations.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TABLE, seatAnchors, DEALER, buildChair, stadiumPoint } from './scene/table.js';
import { Card3D } from './scene/cards.js';
import { ChipPile, flyChips } from './scene/chips.js';
import { PlayerAvatar, Dealer, SEAT_COLORS } from './scene/avatars.js';
import { tween, wait, setTweenSpeed, finishAllTweens } from './scene/tween.js';

const Y = TABLE.feltY;
const CARD_Y = Y + 0.003;
const fmt = (n) => Math.round(n).toLocaleString();

const ACTION_LABEL = { fold: 'FOLD', check: 'CHECK', call: 'CALL', bet: 'BET', raise: 'RAISE', allin: 'ALL-IN' };

export class GameView {
  constructor(world, { sfx, onSeatClick }) {
    this.world = world;
    this.scene = world.scene;
    this.sfx = sfx;
    this.onSeatClick = onSeatClick;
    this.mySeat = -1;
    this.room = null;
    this.state = null;
    this.members = new Map(); // pid -> member
    this.queue = [];
    this.processing = false;
    this.vm = { stacks: Array(8).fill(0), bets: Array(8).fill(0), pot: 0, cards: Array(8).fill(null), inHand: Array(8).fill(false) };
    this.boardCards = [];
    this.camView = 'seat';
    this.floatBoard = false; // tilt community cards up toward the camera (great on phones)
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();

    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);

    // Dealer
    this.dealer = new Dealer();
    this.dealer.group.position.copy(DEALER.pos);
    this.dealer.group.rotation.y = Math.PI;
    this.scene.add(this.dealer.group);
    // Card deck on table near the dealer
    this.deckMesh = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const c = new Card3D(null);
      c.root.position.set(0, i * 0.0013, 0);
      this.deckMesh.add(c.root);
    }
    this.deckMesh.position.copy(DEALER.deckPos).setY(CARD_Y);
    this.deckMesh.rotation.y = 0.3;
    this.scene.add(this.deckMesh);

    // Seats
    this.seats = [];
    for (let i = 0; i < TABLE.seats; i++) {
      const a = seatAnchors(i);
      const chair = buildChair();
      chair.position.copy(a.chair);
      chair.rotation.y = a.yaw;
      this.scene.add(chair);

      const avatar = new PlayerAvatar(i);
      avatar.group.position.copy(a.chair).setY(0);
      avatar.group.rotation.y = a.yaw;
      this.scene.add(avatar.group);

      const stackPile = new ChipPile({ layout: 'row' });
      stackPile.group.position.copy(a.stack).setY(Y);
      stackPile.group.rotation.y = a.yaw;
      this.scene.add(stackPile.group);

      const betPile = new ChipPile({ layout: 'cluster' });
      betPile.group.position.copy(a.bet).setY(Y);
      betPile.group.rotation.y = a.yaw;
      this.scene.add(betPile.group);

      const label = this.makeSeatLabel(i);
      label.obj.position.copy(stadiumPoint(a.theta, -0.02)).setY(Y + 0.16);
      this.scene.add(label.obj);

      const sitBtn = document.createElement('button');
      sitBtn.className = 'sit-btn';
      sitBtn.textContent = 'Sit here';
      sitBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onSeatClick?.(i); });
      const sitObj = new CSS2DObject(sitBtn);
      sitObj.position.copy(a.chair).setY(1.0);
      sitObj.visible = false;
      this.scene.add(sitObj);

      const betLabelEl = document.createElement('div');
      betLabelEl.className = 'bet-label';
      const betLabel = new CSS2DObject(betLabelEl);
      betLabel.position.copy(a.bet).setY(Y + 0.06).addScaledVector(a.inward, -0.07);
      betLabel.visible = false;
      this.scene.add(betLabel);

      this.seats.push({ i, a, chair, avatar, stackPile, betPile, label, sitObj, betLabel, betLabelEl, cards: [] });
    }

    this.potPile = new ChipPile({ layout: 'cluster' });
    this.potPile.group.position.copy(DEALER.pot).setY(Y);
    this.scene.add(this.potPile.group);
    const potEl = document.createElement('div');
    potEl.className = 'pot-label';
    this.potLabelEl = potEl;
    this.potLabel = new CSS2DObject(potEl);
    this.potLabel.position.copy(DEALER.pot).setY(Y + 0.12);
    this.potLabel.visible = false;
    this.scene.add(this.potLabel);

    world.onUpdate((dt) => this.update(dt));
  }

  makeSeatLabel(i) {
    const el = document.createElement('div');
    el.className = 'seat-label';
    el.innerHTML = `
      <div class="sl-reaction"></div>
      <div class="sl-action"></div>
      <div class="sl-top"><span class="sl-dot"></span><span class="sl-name"></span><span class="sl-tag"></span><span class="sl-mic">🎙</span></div>
      <div class="sl-stack"></div>
      <div class="sl-hand"></div>
      <div class="sl-timer"><div></div></div>`;
    const obj = new CSS2DObject(el);
    obj.visible = false;
    return {
      obj, el,
      name: el.querySelector('.sl-name'),
      stack: el.querySelector('.sl-stack'),
      tag: el.querySelector('.sl-tag'),
      action: el.querySelector('.sl-action'),
      hand: el.querySelector('.sl-hand'),
      timer: el.querySelector('.sl-timer > div'),
      timerWrap: el.querySelector('.sl-timer'),
      dot: el.querySelector('.sl-dot'),
      mic: el.querySelector('.sl-mic'),
      reaction: el.querySelector('.sl-reaction'),
    };
  }

  // ---------------- camera ----------------
  seatCamera(i) {
    const a = seatAnchors(i);
    // Portrait phones: sit a bit closer and aim at the board (your cards are shown flat in the HUD).
    const portrait = this.world.camera.aspect < 1;
    const pos = stadiumPoint(a.theta, TABLE.railW + (portrait ? 0.34 : 0.62)).setY(portrait ? 1.5 : 1.62);
    const look = new THREE.Vector3(0, Y, -0.12).lerp(a.cards.clone().setY(Y), portrait ? 0.12 : 0.32);
    return { pos, look };
  }

  applyCamera() {
    const w = this.world;
    const mine = this.mySeat;
    if (this.camView === 'orbit') {
      const cur = w.camera.position.clone();
      w.setCameraGoal(cur, new THREE.Vector3(0, Y, 0), 'orbit');
      return;
    }
    if (this.camView === 'overhead') {
      const base = mine >= 0 ? seatAnchors(mine) : null;
      const dir = base ? base.chair.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1);
      // Stay below the lamp shade (bottom at ~2.27m) so it never blocks the view.
      w.setCameraGoal(dir.multiplyScalar(2.15).setY(2.2), new THREE.Vector3(0, Y, -0.05).addScaledVector(dir, -0.15), 'overhead');
      return;
    }
    if (mine >= 0) {
      const { pos, look } = this.seatCamera(mine);
      w.setCameraGoal(pos, look, 'seat');
    } else {
      w.setCameraGoal(new THREE.Vector3(0, 1.75, 2.35), new THREE.Vector3(0, Y, -0.1), 'seat');
    }
  }

  setCameraView(view) {
    this.camView = view;
    this.applyCamera();
  }

  // ---------------- room / members ----------------
  setRoom(room, myPid) {
    this.room = room;
    this.myPid = myPid;
    this.members = new Map(room.members.map((m) => [m.pid, m]));
    this.refreshSeats();
  }

  memberForSeat(seat) {
    const s = this.state?.table.seats[seat];
    if (!s) return null;
    return this.members.get(s.id) || null;
  }

  // ---------------- state ----------------
  applyState(state) {
    const prevSeat = this.mySeat;
    this.state = state;
    this.mySeat = state.you.seat;
    if (prevSeat !== this.mySeat) this.applyCamera();
    if (!this.processing && this.queue.length === 0) this.reconcile();
    else this.refreshSeats();
  }

  // Immediate, non-animated sync with authoritative state.
  reconcile() {
    const st = this.state;
    if (!st) return;
    const t = st.table;
    for (let i = 0; i < TABLE.seats; i++) {
      const s = t.seats[i];
      this.vm.stacks[i] = s ? s.stack : 0;
      this.vm.bets[i] = s ? s.bet : 0;
      this.vm.inHand[i] = !!(s && s.hasCards);
      if (s && s.cards) this.vm.cards[i] = s.cards;
      if (!s || !s.inHand) this.vm.cards[i] = null;
    }
    this.vm.pot = t.pot;
    this.syncPiles();
    // Hole cards
    for (let i = 0; i < TABLE.seats; i++) {
      const s = t.seats[i];
      const seat = this.seats[i];
      if (s && s.hasCards) {
        const mine = i === this.mySeat;
        const known = mine ? st.you.hole : s.cards || this.vm.cards[i];
        if (seat.cards.length !== 2) {
          seat.cards.forEach((c) => c.dispose());
          seat.cards = [new Card3D(null), new Card3D(null)];
          seat.cards.forEach((c) => this.scene.add(c.root));
        }
        seat.cards.forEach((c, k) => {
          const pose = this.cardPose(i, k);
          c.root.position.copy(pose.pos);
          c.root.rotation.order = 'YXZ';
          c.root.rotation.set(pose.tilt, pose.yaw, 0);
          if (known && known[k]) { c.setCard(known[k]); c.setFaceUp(true); } else { c.setCard(null); c.setFaceUp(false); }
        });
      } else if (seat.cards.length) {
        seat.cards.forEach((c) => c.dispose());
        seat.cards = [];
      }
    }
    // Board
    const board = t.board;
    if (this.boardCards.length !== board.length || this.boardCards.some((c, k) => c.card !== board[k])) {
      this.boardCards.forEach((c) => c.dispose());
      this.boardCards = board.map((card, k) => {
        const c = new Card3D(card);
        c.setFaceUp(true);
        c.root.position.copy(DEALER.board(k)).setY(CARD_Y);
        this.scene.add(c.root);
        return c;
      });
    }
    if (!t.handOver) this.boardCards.forEach((c) => c.setHighlight(false));
    this.emitBoard();
    // Dealer button
    if (t.button >= 0) {
      const bp = seatAnchors(t.button).button;
      this.world.table.dealerButton.position.set(bp.x, Y + 0.006, bp.z);
    }
    this.refreshSeats();
  }

  cardPose(seat, k) {
    const a = seatAnchors(seat);
    const mine = seat === this.mySeat;
    if (mine) {
      const pos = stadiumPoint(a.theta, 0.02).setY(CARD_Y + 0.03).addScaledVector(a.playerRight, (k - 0.5) * 0.085);
      return { pos, yaw: a.yaw + (k - 0.5) * -0.12, tilt: 0.75 };
    }
    const pos = a.cards.clone().setY(CARD_Y + k * 0.0015).addScaledVector(a.playerRight, (k - 0.5) * 0.06);
    return { pos, yaw: a.yaw + (k - 0.5) * 0.18, tilt: 0 };
  }

  syncPiles() {
    for (let i = 0; i < TABLE.seats; i++) {
      this.seats[i].stackPile.set(this.vm.stacks[i]);
      this.seats[i].betPile.set(this.vm.bets[i]);
      const b = this.vm.bets[i];
      this.seats[i].betLabel.visible = b > 0;
      this.seats[i].betLabelEl.textContent = fmt(b);
    }
    this.potPile.set(this.vm.pot);
    this.potLabel.visible = this.vm.pot > 0;
    this.potLabelEl.textContent = `POT ${fmt(this.vm.pot)}`;
  }

  refreshSeats() {
    const st = this.state;
    if (!st) return;
    const t = st.table;
    const meSeated = this.mySeat >= 0;
    const midHand = t.street !== 'idle' && !t.handOver;
    for (let i = 0; i < TABLE.seats; i++) {
      const s = t.seats[i];
      const seat = this.seats[i];
      const L = seat.label;
      if (!s) {
        seat.avatar.clear();
        L.obj.visible = false;
        seat.sitObj.visible = !meSeated;
        continue;
      }
      seat.sitObj.visible = false;
      const m = this.members.get(s.id);
      const color = m ? m.color : i;
      seat.avatar.setPlayer(s.name, color);
      seat.avatar.setCamOn(!!(m && m.media && m.media.cam));
      seat.avatar.group.visible = i !== this.mySeat; // we're sitting in our own seat
      seat.avatar.state = s.folded ? 'folded' : seat.avatar.state === 'winner' && t.handOver ? 'winner' : 'idle';
      L.obj.visible = i !== this.mySeat;
      L.name.textContent = s.name;
      L.stack.textContent = s.allIn ? 'ALL-IN' : fmt(this.processing ? this.vm.stacks[i] : s.stack);
      L.dot.style.background = SEAT_COLORS[color % 8];
      const tags = [];
      if (t.button === i && t.street !== 'idle') tags.push('D');
      if (s.sittingOut) tags.push('AWAY');
      if (m && !m.connected) tags.push('OFFLINE');
      L.tag.textContent = tags.join(' · ');
      L.el.classList.toggle('folded', !!s.folded);
      L.el.classList.toggle('acting', t.toAct === i);
      L.el.classList.toggle('empty-stack', s.stack === 0 && !s.inHand);
      L.mic.style.display = m && m.media && m.media.mic ? '' : 'none';
      if (!midHand && !t.handOver) { L.hand.textContent = ''; }
    }
    // Turn ring
    const ring = this.world.table.turnRing;
    if (t.toAct >= 0) {
      const a = seatAnchors(t.toAct);
      ring.position.set(a.cards.x, Y + 0.002, a.cards.z);
      ring.visible = true;
    } else ring.visible = false;
    this.updateTimers();
  }

  updateTimers() {
    const st = this.state;
    if (!st) return;
    const t = st.table;
    const now = Date.now() + (st.clockSkew || 0);
    for (let i = 0; i < TABLE.seats; i++) {
      const L = this.seats[i].label;
      if (t.toAct === i && st.deadline) {
        const total = Math.max(1, st.turnTotal || st.deadline - (st.turnStart || st.deadline - 30000));
        const left = Math.max(0, st.deadline - now);
        L.timerWrap.style.display = '';
        L.timer.style.width = `${(left / total) * 100}%`;
        L.timer.style.background = left < 5000 ? '#ff4d4d' : left < 10000 ? '#ffc53d' : '#5ee08a';
      } else L.timerWrap.style.display = 'none';
    }
    // Shared countdown for the HUD (everyone sees whose turn it is and how long is left).
    if (t.toAct >= 0 && st.deadline && !t.handOver) {
      const total = Math.max(1, st.turnTotal || 30000);
      const left = Math.max(0, st.deadline - now);
      this.onTimer?.({ seat: t.toAct, name: t.seats[t.toAct]?.name || '', left, total, mine: t.toAct === this.mySeat });
    } else this.onTimer?.(null);
  }

  showAction(seat, text, cls = '') {
    const L = this.seats[seat].label;
    L.action.textContent = text;
    L.action.className = `sl-action show ${cls}`;
    clearTimeout(L.actionTimer);
    L.actionTimer = setTimeout(() => { L.action.className = 'sl-action'; }, 2600);
  }

  showReaction(seat, emoji) {
    if (seat < 0) return;
    const L = this.seats[seat].label;
    const span = document.createElement('span');
    span.textContent = emoji;
    L.reaction.appendChild(span);
    setTimeout(() => span.remove(), 2200);
  }

  // ---------------- events ----------------
  handleEvents(events) {
    this.queue.push(...events);
    // If we fall far behind (e.g. tab was hidden), fast-forward.
    if (this.queue.length > 40 || document.hidden) setTweenSpeed(100);
    if (!this.processing) this.pump();
  }

  async pump() {
    this.processing = true;
    while (this.queue.length) {
      const ev = this.queue.shift();
      // Catch up if events pile up (slow device, or many quick actions).
      setTweenSpeed(this.queue.length > 25 ? 100 : this.queue.length > 6 ? 2.5 : 1);
      try { await this.play(ev); } catch (e) { console.error('event anim error', e); }
    }
    setTweenSpeed(1);
    this.processing = false;
    this.reconcile();
  }

  seatPos(seat, which) {
    const a = seatAnchors(seat);
    return (which === 'stack' ? a.stack : which === 'bet' ? a.bet : a.cards).clone().setY(Y);
  }

  async play(ev) {
    const st = this.state;
    switch (ev.type) {
      case 'handStart': {
        // Sweep old cards back to the dealer.
        const old = [...this.boardCards, ...this.seats.flatMap((s) => s.cards)];
        this.boardCards = [];
        this.emitBoard();
        this.seats.forEach((s) => { s.cards = []; s.label.hand.textContent = ''; s.avatar.state = 'idle'; });
        this.vm.cards = Array(8).fill(null);
        await Promise.all(old.map((c, k) => c.moveTo(DEALER.muck.clone().setY(CARD_Y + k * 0.001), 0, { duration: 0.35, arc: 0.05 }).then(() => c.dispose())));
        // Move dealer button
        const btn = this.world.table.dealerButton;
        const from = btn.position.clone();
        const to = seatAnchors(ev.button).button.setY(Y + 0.006);
        this.sfx?.play('slide');
        await tween(0.5, (t) => { btn.position.lerpVectors(from, to, t); btn.position.y += Math.sin(t * Math.PI) * 0.03; });
        this.vm.pot = 0;
        this.syncPiles();
        break;
      }
      case 'blind': {
        this.showAction(ev.seat, ev.kind === 'sb' ? `SMALL BLIND ${fmt(ev.amount)}` : `BIG BLIND ${fmt(ev.amount)}`);
        await this.moveChipsToBet(ev.seat, ev.amount);
        break;
      }
      case 'deal': {
        const order = ev.order;
        const jobs = [];
        for (let round = 0; round < 2; round++) {
          for (const seat of order) {
            const c = new Card3D(null);
            c.root.rotation.order = 'YXZ';
            c.root.position.copy(DEALER.deckPos).setY(CARD_Y + 0.02);
            this.scene.add(c.root);
            this.seats[seat].cards[round] = c;
            const pose = this.cardPose(seat, round);
            this.dealer.pulseDeal(pose.pos.x > 0 ? 1 : -1);
            this.sfx?.play('card');
            jobs.push(c.moveTo(pose.pos, pose.yaw, { duration: 0.42, arc: 0.06, spin: 1.2 }).then(() => { c.root.rotation.x = pose.tilt; }));
            await wait(0.11);
          }
        }
        await Promise.all(jobs);
        // Reveal my own cards.
        const mine = this.mySeat;
        if (mine >= 0 && this.seats[mine].cards.length === 2 && st?.you.hole.length === 2) {
          const cs = this.seats[mine].cards;
          cs.forEach((c, k) => c.setCard(st.you.hole[k]));
          await Promise.all(cs.map((c) => c.flip(true, 0.3)));
          this.sfx?.play('card');
        }
        break;
      }
      case 'action': {
        const label = ACTION_LABEL[ev.action] || ev.action.toUpperCase();
        const amt = ev.amount && ev.action !== 'check' && ev.action !== 'fold' ? ` ${fmt(ev.amount)}` : '';
        this.showAction(ev.seat, label + amt, ev.action);
        if (ev.action === 'fold') {
          this.sfx?.play('fold');
          const cs = this.seats[ev.seat].cards;
          this.seats[ev.seat].cards = [];
          this.seats[ev.seat].avatar.state = 'folded';
          await Promise.all(cs.map((c, k) => c.flip(false, 0.2).then(() => c.moveTo(DEALER.muck.clone().setY(CARD_Y + 0.004 + k * 0.001), 0.4, { duration: 0.4, arc: 0.08 })).then(() => c.dispose())));
        } else if (ev.action === 'check') {
          this.sfx?.play('check');
          await wait(0.35);
        } else {
          this.sfx?.play(ev.action === 'allin' ? 'allin' : 'chips');
          await this.moveChipsToBet(ev.seat, ev.added || 0, ev.amount);
        }
        break;
      }
      case 'refund': {
        const s = ev.seat;
        this.vm.bets[s] -= ev.amount;
        this.syncPiles();
        await flyChips(this.scene, ev.amount, this.seatPos(s, 'bet'), this.seatPos(s, 'stack'), { duration: 0.35 });
        this.vm.stacks[s] += ev.amount;
        this.syncPiles();
        break;
      }
      case 'collect': {
        const moving = this.vm.bets.map((b, i) => ({ b, i })).filter((x) => x.b > 0);
        if (moving.length) {
          this.sfx?.play('chips');
          for (const m of moving) this.vm.bets[m.i] = 0;
          this.syncPiles();
          await Promise.all(moving.map((m) => flyChips(this.scene, m.b, this.seatPos(m.i, 'bet'), DEALER.pot.clone().setY(Y), { duration: 0.45, arc: 0.06 })));
        }
        this.vm.pot = ev.pot;
        this.syncPiles();
        break;
      }
      case 'board': {
        const start = this.boardCards.length;
        const newCards = ev.cards.map((card, k) => {
          const c = new Card3D(card);
          c.setFaceUp(false);
          c.root.position.copy(DEALER.deckPos).setY(CARD_Y + 0.02);
          this.scene.add(c.root);
          this.boardCards.push(c);
          return { c, slot: start + k };
        });
        for (const { c, slot } of newCards) {
          this.sfx?.play('card');
          this.dealer.pulseDeal(-1);
          await c.moveTo(DEALER.board(ev.cards.length === 3 ? 0 : slot).setY(CARD_Y), 0, { duration: 0.32, arc: 0.04 });
        }
        if (ev.cards.length === 3) {
          // Spread the flop like a dealer does.
          await Promise.all(newCards.map(({ c, slot }) => c.moveTo(DEALER.board(slot).setY(CARD_Y), 0, { duration: 0.35, arc: 0 })));
        }
        await Promise.all(newCards.map(({ c }, k) => wait(k * 0.08).then(() => c.flip(true, 0.35))));
        this.sfx?.play('card');
        this.emitBoard();
        await wait(0.25);
        break;
      }
      case 'reveal':
      case 'showdown': {
        const flips = [];
        for (const h of ev.hands) {
          this.vm.cards[h.seat] = h.cards;
          const cs = this.seats[h.seat].cards;
          cs.forEach((c, k) => { c.setCard(h.cards[k]); flips.push(c.flip(true, 0.4)); });
          if (h.hand) this.seats[h.seat].label.hand.textContent = h.hand;
        }
        if (flips.length) this.sfx?.play('card');
        await Promise.all(flips);
        await wait(ev.type === 'showdown' ? 0.9 : 0.4);
        break;
      }
      case 'win': {
        const s = ev.seat;
        const seat = this.seats[s];
        seat.avatar.state = 'winner';
        if (ev.best) {
          const best = new Set(ev.best);
          this.boardCards.forEach((c) => c.setHighlight(best.has(c.card)));
          seat.cards.forEach((c) => c.setHighlight(best.has(c.card)));
          this.emitBoard(best);
        }
        const name = st?.table.seats[s]?.name || 'Player';
        const potName = ev.potCount > 1 ? (ev.pot === 0 ? 'the main pot' : `side pot ${ev.pot}`) : 'the pot';
        this.onBanner?.(`${name} wins ${fmt(ev.amount)}${ev.hand ? ` with ${ev.hand}` : ''}`, ev.hand ? `Takes ${potName}` : 'Everyone else folded', s === this.mySeat);
        this.showAction(s, `WINS ${fmt(ev.amount)}`, 'win');
        this.sfx?.play(s === this.mySeat ? 'bigwin' : 'win');
        this.vm.pot = Math.max(0, this.vm.pot - ev.amount);
        this.syncPiles();
        await flyChips(this.scene, ev.amount, DEALER.pot.clone().setY(Y), this.seatPos(s, 'stack'), { duration: 0.7, arc: 0.2 });
        this.vm.stacks[s] += ev.amount;
        this.syncPiles();
        await wait(0.6);
        break;
      }
      case 'handEnd':
        await wait(0.2);
        break;
      default:
        break;
    }
  }

  async moveChipsToBet(seat, added, totalBet) {
    if (added <= 0) return;
    this.vm.stacks[seat] -= added;
    this.syncPiles();
    this.seats[seat].label.stack.textContent = fmt(this.vm.stacks[seat]);
    await flyChips(this.scene, added, this.seatPos(seat, 'stack'), this.seatPos(seat, 'bet'), { duration: 0.4, arc: 0.08 });
    this.vm.bets[seat] = totalBet != null ? totalBet : this.vm.bets[seat] + added;
    this.syncPiles();
  }

  // ---------------- per-frame ----------------
  // Tell the HUD which community cards are showing (for the flat on-screen board).
  emitBoard(best = null) {
    this.onBoard?.(this.boardCards.filter((c) => c.faceUp && c.card).map((c) => ({ card: c.card, hl: best ? best.has(c.card) : !!c.highlight })), this.state?.table);
  }

  // Float the community cards above the felt, tilted to face the camera.
  updateBoardFloat(dt) {
    const cam = this.world.camera;
    const k = 1 - Math.exp(-dt * 6);
    const up = new THREE.Vector3(0, 1, 0);
    this.boardCards.forEach((c, i) => {
      const lift = c.lift;
      const on = this.floatBoard && !c.root.userData.moving;
      const targetY = on ? 0.075 + Math.sin(this.world.time * 1.4 + i * 0.7) * 0.006 : 0;
      lift.position.y += (targetY - lift.position.y) * k;
      const targetS = on ? 1.12 : 1;
      lift.scale.setScalar(lift.scale.x + (targetS - lift.scale.x) * k);
      if (!on) { lift.quaternion.slerp(this._q.identity(), k); return; }
      const pos = new THREE.Vector3();
      c.root.getWorldPosition(pos);
      pos.y += lift.position.y;
      const n = cam.position.clone().sub(pos).normalize();          // card face normal -> camera
      const top = up.clone().addScaledVector(n, -up.dot(n)).normalize(); // screen-up
      const z = top.clone().negate();                               // card top edge is local -Z
      const x = new THREE.Vector3().crossVectors(n, z);
      this._m.makeBasis(x, n, z);
      const world = new THREE.Quaternion().setFromRotationMatrix(this._m);
      // Tilt most of the way (not fully vertical) so it still reads as "on the table".
      const target = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(-n.x, -n.z) + Math.PI), world, 0.8);
      const parentInv = c.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      lift.quaternion.slerp(parentInv.multiply(target), k);
    });
  }

  update(dt) {
    this.updateBoardFloat(dt);
    const toAct = this.state?.table.toAct;
    for (const s of this.seats) s.avatar.update(dt, this.world.camera, toAct === s.i);
    this.dealer.update(dt);
    // Turn ring on the felt doubles as a countdown: the arc drains and shifts green -> amber -> red.
    const ring = this.world.table.turnRing;
    if (ring.visible) {
      const st = this.state;
      const total = Math.max(1, st?.turnTotal || 30000);
      const left = st?.deadline ? Math.max(0, st.deadline - Date.now()) : total;
      const frac = Math.min(1, left / total);
      const segs = ring.geometry.parameters.thetaSegments;
      ring.geometry.setDrawRange(0, Math.max(1, Math.ceil(frac * segs)) * 6);
      ring.material.color.set(left < 5000 ? 0xff4d4d : left < 10000 ? 0xffc53d : 0x5ee08a);
      const urgent = left < 5000;
      ring.material.opacity = urgent ? 0.6 + Math.sin(this.world.time * 12) * 0.35 : 0.85;
      if (urgent && this.mySeat === st?.table.toAct) {
        const sec = Math.ceil(left / 1000);
        if (sec !== this.lastTick && sec > 0) { this.lastTick = sec; this.sfx?.play('tick'); }
      }
    }
    this.timerAcc = (this.timerAcc || 0) + dt;
    if (this.timerAcc > 0.2) { this.timerAcc = 0; this.updateTimers(); }
  }

  setSpeaking(pid, level) {
    for (const s of this.seats) {
      const seatState = this.state?.table.seats[s.i];
      if (seatState && seatState.id === pid) {
        s.avatar.speaking = level;
        s.label.el.classList.toggle('speaking', level > 0.15);
      }
    }
  }

  setVideoForPid(pid, videoEl) {
    for (const s of this.seats) {
      const seatState = this.state?.table.seats[s.i];
      if (seatState && seatState.id === pid) s.avatar.setVideo(videoEl);
    }
  }

  // Called when seats change so video elements get re-attached to the right avatar.
  rebindVideos(videoMap) {
    for (const s of this.seats) {
      const seatState = this.state?.table.seats[s.i];
      const v = seatState ? videoMap.get(seatState.id) : null;
      s.avatar.setVideo(v || null);
      const m = seatState ? this.members.get(seatState.id) : null;
      s.avatar.setCamOn(!!(m && m.media && m.media.cam));
    }
  }

  skipAnimations() { finishAllTweens(); }
}
