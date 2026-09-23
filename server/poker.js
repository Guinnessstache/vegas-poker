// Authoritative No-Limit Texas Hold'em table engine.
// Pure game logic: no sockets, no timers. The room layer drives it and
// broadcasts `table.drainEvents()` + snapshots after every call.

import { randomInt } from 'node:crypto';
import { evaluate, freshDeck, shuffle } from './handEval.js';

export const MAX_SEATS = 8;

const cryptoRng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export class Table {
  constructor({ smallBlind = 50, bigBlind = 100, maxSeats = MAX_SEATS, rng = cryptoRng } = {}) {
    this.sb = smallBlind;
    this.bb = bigBlind;
    this.maxSeats = maxSeats;
    this.rng = rng;
    this.seats = new Array(maxSeats).fill(null);
    this.button = -1;
    this.street = 'idle'; // idle | preflop | flop | turn | river | showdown
    this.board = [];
    this.deck = [];
    this.toAct = -1;
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.handNumber = 0;
    this.pendingAdvance = false; // betting round finished, room should call advance()
    this.handOver = false;       // hand finished, room should schedule next hand
    this.lastResults = null;
    this.events = [];
  }

  // ---------- seating ----------
  sit(seat, player) {
    if (seat < 0 || seat >= this.maxSeats || this.seats[seat]) return false;
    this.seats[seat] = {
      id: player.id,
      name: player.name,
      stack: player.stack,
      bet: 0,
      totalBet: 0,
      hole: [],
      inHand: false,
      folded: false,
      allIn: false,
      acted: false,
      canRaise: true,
      sittingOut: false,
      shown: false,
      lastAction: null,
    };
    return true;
  }

  stand(seat) {
    const p = this.seats[seat];
    if (!p) return;
    if (p.inHand && !p.folded && this.isBetting()) {
      // Leaving mid-hand = fold (forfeits chips already bet).
      if (this.toAct === seat) this.act(seat, 'fold');
      else { p.folded = true; this.emit({ type: 'action', seat, action: 'fold' }); this.afterFoldOutOfTurn(); }
    }
    if (p.inHand && this.street !== 'idle' && !this.handOver) {
      p.leaving = true; // remove after hand so pot math stays intact
    } else {
      this.seats[seat] = null;
    }
  }

  isBetting() {
    return ['preflop', 'flop', 'turn', 'river'].includes(this.street) && !this.handOver;
  }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  nextSeat(from, pred) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i + this.maxSeats) % this.maxSeats;
      if (this.seats[s] && pred(this.seats[s], s)) return s;
    }
    return -1;
  }

  eligibleForHand() {
    return this.seats
      .map((p, i) => (p && !p.sittingOut && !p.leaving && p.stack > 0 ? i : -1))
      .filter((i) => i >= 0);
  }

  canStart() { return this.eligibleForHand().length >= 2; }

  // ---------- hand lifecycle ----------
  startHand() {
    // Clear seats that left during the last hand.
    this.seats.forEach((p, i) => { if (p && p.leaving) this.seats[i] = null; });
    const eligible = this.eligibleForHand();
    if (eligible.length < 2) { this.street = 'idle'; return false; }

    this.handNumber++;
    this.board = [];
    this.deck = shuffle(freshDeck(), this.rng);
    this.pendingAdvance = false;
    this.handOver = false;
    this.lastResults = null;
    for (const p of this.seats) {
      if (!p) continue;
      Object.assign(p, { bet: 0, totalBet: 0, hole: [], inHand: false, folded: false, allIn: false, acted: false, canRaise: true, shown: false, lastAction: null });
    }
    for (const i of eligible) this.seats[i].inHand = true;

    const inHand = (p) => p.inHand;
    this.button = this.nextSeat(this.button < 0 ? this.maxSeats - 1 : this.button, inHand);
    const headsUp = eligible.length === 2;
    const sbSeat = headsUp ? this.button : this.nextSeat(this.button, inHand);
    const bbSeat = this.nextSeat(sbSeat, inHand);
    this.sbSeat = sbSeat;
    this.bbSeat = bbSeat;

    this.street = 'preflop';
    this.emit({ type: 'handStart', hand: this.handNumber, button: this.button, sb: sbSeat, bb: bbSeat });

    this.postBlind(sbSeat, this.sb, 'sb');
    this.postBlind(bbSeat, this.bb, 'bb');
    this.currentBet = this.bb;
    this.minRaise = this.bb;

    // Deal two cards each, one at a time starting left of the button.
    const order = [];
    let s = this.nextSeat(this.button, inHand);
    for (let n = 0; n < eligible.length; n++) { order.push(s); s = this.nextSeat(s, inHand); }
    for (let round = 0; round < 2; round++) for (const seat of order) this.seats[seat].hole.push(this.deck.pop());
    this.emit({ type: 'deal', order });

    this.toAct = this.nextSeat(bbSeat, (p) => p.inHand && !p.folded && !p.allIn);
    this.checkRoundComplete();
    return true;
  }

  postBlind(seat, amount, kind) {
    const p = this.seats[seat];
    const amt = Math.min(amount, p.stack);
    p.stack -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.stack === 0) p.allIn = true;
    this.emit({ type: 'blind', seat, kind, amount: amt });
  }

  activePlayers() { // not folded, in hand
    return this.seats.map((p, i) => (p && p.inHand && !p.folded ? i : -1)).filter((i) => i >= 0);
  }

  potTotal() {
    return this.seats.reduce((sum, p) => sum + (p ? p.totalBet - p.bet : 0), 0);
  }

  legalActions(seat) {
    const p = this.seats[seat];
    if (!p || seat !== this.toAct || !this.isBetting() || this.pendingAdvance) return null;
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    const maxTo = p.bet + p.stack;
    const minTo = Math.min(this.currentBet + this.minRaise, maxTo);
    const othersCanAct = this.seats.some((q, i) => i !== seat && q && q.inHand && !q.folded && !q.allIn);
    const canRaise = p.canRaise && maxTo > this.currentBet && othersCanAct;
    return {
      canCheck: toCall === 0,
      toCall,
      canRaise,
      minRaiseTo: minTo,
      maxRaiseTo: maxTo,
      isBet: this.currentBet === 0,
    };
  }

  // action: fold | check | call | raise (amount = total "raise to") | allin
  act(seat, action, amount = 0) {
    const legal = this.legalActions(seat);
    if (!legal) return { ok: false, error: 'Not your turn' };
    const p = this.seats[seat];
    amount = Math.floor(Number(amount) || 0);

    if (action === 'allin') {
      if (legal.canRaise) { action = 'raise'; amount = legal.maxRaiseTo; }
      else action = legal.canCheck ? 'check' : 'call';
    }
    if (action === 'check' && !legal.canCheck) return { ok: false, error: 'Cannot check' };
    if (action === 'call' && legal.canCheck) action = 'check';

    switch (action) {
      case 'fold':
        p.folded = true;
        p.lastAction = 'fold';
        this.emit({ type: 'action', seat, action: 'fold' });
        break;
      case 'check':
        p.acted = true;
        p.lastAction = 'check';
        this.emit({ type: 'action', seat, action: 'check' });
        break;
      case 'call': {
        const amt = legal.toCall;
        this.commit(p, amt);
        p.acted = true;
        p.lastAction = p.allIn ? 'allin' : 'call';
        this.emit({ type: 'action', seat, action: p.lastAction, amount: p.bet, added: amt });
        break;
      }
      case 'raise': {
        if (!legal.canRaise) return { ok: false, error: 'Raising not allowed' };
        if (amount > legal.maxRaiseTo) amount = legal.maxRaiseTo;
        if (amount < legal.minRaiseTo) return { ok: false, error: `Minimum raise is to ${legal.minRaiseTo}` };
        const added = amount - p.bet;
        const raiseSize = amount - this.currentBet;
        const wasBet = this.currentBet === 0;
        this.commit(p, added);
        p.acted = true;
        if (raiseSize >= this.minRaise) {
          // Full raise re-opens action for everyone.
          this.minRaise = raiseSize;
          for (const q of this.seats) if (q && q !== p && q.inHand && !q.folded && !q.allIn) { q.acted = false; q.canRaise = true; }
        } else {
          // Incomplete all-in raise: players who already acted may only call/fold.
          for (const q of this.seats) if (q && q !== p && q.acted) q.canRaise = false;
        }
        this.currentBet = amount;
        p.lastAction = p.allIn ? 'allin' : wasBet ? 'bet' : 'raise';
        this.emit({ type: 'action', seat, action: p.lastAction, amount: p.bet, added });
        break;
      }
      default:
        return { ok: false, error: 'Unknown action' };
    }

    this.afterAction(seat);
    return { ok: true };
  }

  commit(p, amt) {
    amt = Math.min(amt, p.stack);
    p.stack -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.stack === 0) p.allIn = true;
  }

  afterFoldOutOfTurn() {
    if (this.activePlayers().length === 1) this.winUncontested();
    else this.checkRoundComplete();
  }

  afterAction(seat) {
    if (this.activePlayers().length === 1) { this.winUncontested(); return; }
    this.toAct = this.nextSeat(seat, (q) => q.inHand && !q.folded && !q.allIn && (!q.acted || q.bet < this.currentBet));
    this.checkRoundComplete();
  }

  roundComplete() {
    const needs = this.seats.some((q) => q && q.inHand && !q.folded && !q.allIn && (!q.acted || q.bet < this.currentBet));
    return !needs;
  }

  checkRoundComplete() {
    if (this.handOver) return;
    // Lone player who can still act with nothing to call: nobody to bet against.
    const canAct = this.seats.filter((q) => q && q.inHand && !q.folded && !q.allIn);
    if (canAct.length === 1 && canAct[0].bet >= this.currentBet) canAct[0].acted = true;
    if (canAct.length === 0 || this.roundComplete()) {
      this.toAct = -1;
      this.returnUncalled();
      this.pendingAdvance = true;
    }
  }

  returnUncalled() {
    let top = null; let topBet = -1; let second = 0;
    for (const p of this.seats) {
      if (!p || !p.inHand) continue;
      if (p.bet > topBet) { second = Math.max(second, topBet); topBet = p.bet; top = p; }
      else second = Math.max(second, p.bet);
    }
    if (top && topBet > second) {
      const refund = topBet - second;
      top.bet -= refund;
      top.totalBet -= refund;
      top.stack += refund;
      if (top.stack > 0) top.allIn = false;
      this.emit({ type: 'refund', seat: this.seats.indexOf(top), amount: refund });
    }
  }

  // Called by the room after a pause once pendingAdvance is set.
  advance() {
    if (!this.pendingAdvance || this.handOver) return;
    this.pendingAdvance = false;
    // Sweep bets into the pot.
    this.emit({ type: 'collect', pot: this.seats.reduce((s, p) => s + (p ? p.totalBet : 0), 0) });
    for (const p of this.seats) if (p) { p.bet = 0; p.acted = false; p.canRaise = true; if (p.lastAction !== 'fold' && p.lastAction !== 'allin') p.lastAction = null; }
    this.currentBet = 0;
    this.minRaise = this.bb;

    const next = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' }[this.street];
    if (next === 'showdown') { this.showdown(); return; }
    this.deck.pop(); // burn
    const n = next === 'flop' ? 3 : 1;
    const cards = [];
    for (let i = 0; i < n; i++) cards.push(this.deck.pop());
    this.board.push(...cards);
    this.street = next;
    this.emit({ type: 'board', street: next, cards, board: this.board.slice() });

    // If at most one player can still bet, run it out and reveal hands.
    const canAct = this.seats.filter((q) => q && q.inHand && !q.folded && !q.allIn);
    if (canAct.length <= 1) {
      this.revealAllIn();
      this.pendingAdvance = true;
      this.toAct = -1;
      return;
    }
    this.toAct = this.nextSeat(this.button, (q) => q.inHand && !q.folded && !q.allIn);
    this.checkRoundComplete();
  }

  revealAllIn() {
    const reveal = [];
    this.seats.forEach((p, i) => {
      if (p && p.inHand && !p.folded && !p.shown) { p.shown = true; reveal.push({ seat: i, cards: p.hole.slice() }); }
    });
    if (reveal.length) this.emit({ type: 'reveal', hands: reveal });
  }

  winUncontested() {
    this.toAct = -1;
    this.returnUncalled();
    const seat = this.activePlayers()[0];
    const p = this.seats[seat];
    const pot = this.seats.reduce((s, q) => s + (q ? q.totalBet : 0), 0);
    this.emit({ type: 'collect', pot });
    p.stack += pot;
    for (const q of this.seats) if (q) { q.bet = 0; }
    this.lastResults = { winners: [{ seat, amount: pot, hand: null }], uncontested: true };
    this.emit({ type: 'win', seat, amount: pot, pot: 0, hand: null, uncontested: true });
    this.finishHand();
  }

  // Build main + side pots from per-player contributions.
  buildPots() {
    const contrib = this.seats.map((p) => (p && p.inHand ? p.totalBet : 0));
    const live = this.seats.map((p, i) => (p && p.inHand && !p.folded ? i : -1)).filter((i) => i >= 0);
    const levels = [...new Set(live.map((i) => contrib[i]))].filter((l) => l > 0).sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      contrib.forEach((c) => { amount += Math.max(0, Math.min(c, L) - prev); });
      const eligible = live.filter((i) => contrib[i] >= L);
      if (amount > 0) pots.push({ amount, eligible });
      prev = L;
    }
    // Dead money from folded players above the top live level.
    let leftover = 0;
    contrib.forEach((c) => { leftover += Math.max(0, c - prev); });
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
    // Merge adjacent pots with identical eligibility.
    const merged = [];
    for (const pot of pots) {
      const last = merged[merged.length - 1];
      if (last && last.eligible.join() === pot.eligible.join()) last.amount += pot.amount;
      else merged.push({ ...pot });
    }
    return merged;
  }

  showdown() {
    this.street = 'showdown';
    this.toAct = -1;
    const live = this.activePlayers();
    const evals = {};
    for (const i of live) evals[i] = evaluate([...this.seats[i].hole, ...this.board]);

    this.emit({
      type: 'showdown',
      hands: live.map((i) => ({ seat: i, cards: this.seats[i].hole.slice(), hand: evals[i].name, best: evals[i].best })),
    });
    for (const i of live) this.seats[i].shown = true;

    const pots = this.buildPots();
    const winners = [];
    pots.forEach((pot, potIndex) => {
      let bestVal = -1;
      let potWinners = [];
      for (const i of pot.eligible) {
        const v = evals[i].value;
        if (v > bestVal) { bestVal = v; potWinners = [i]; }
        else if (v === bestVal) potWinners.push(i);
      }
      // Odd chips go to the first winner left of the button.
      potWinners.sort((a, b) => ((a - this.button - 1 + this.maxSeats) % this.maxSeats) - ((b - this.button - 1 + this.maxSeats) % this.maxSeats));
      const share = Math.floor(pot.amount / potWinners.length);
      let odd = pot.amount - share * potWinners.length;
      for (const w of potWinners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        this.seats[w].stack += amt;
        winners.push({ seat: w, amount: amt, hand: evals[w].name, pot: potIndex, best: evals[w].best });
        this.emit({ type: 'win', seat: w, amount: amt, pot: potIndex, potCount: pots.length, hand: evals[w].name, best: evals[w].best });
      }
    });
    this.lastResults = { winners, pots };
    this.finishHand();
  }

  finishHand() {
    this.handOver = true;
    this.pendingAdvance = false;
    this.toAct = -1;
    this.emit({ type: 'handEnd', hand: this.handNumber });
  }

  // Called by the room before the next hand; resets to idle.
  endHandCleanup() {
    for (let i = 0; i < this.maxSeats; i++) {
      const p = this.seats[i];
      if (!p) continue;
      if (p.leaving) { this.seats[i] = null; continue; }
      p.inHand = false; p.bet = 0; p.totalBet = 0; p.folded = false; p.allIn = false; p.lastAction = null;
      p.hole = []; p.shown = false;
    }
    this.street = 'idle';
    this.board = [];
    this.handOver = false;
  }

  // Snapshot safe to broadcast (no hidden cards).
  publicState() {
    return {
      seats: this.seats.map((p, i) => p && {
        seat: i,
        id: p.id,
        name: p.name,
        stack: p.stack,
        bet: p.bet,
        inHand: p.inHand,
        folded: p.folded,
        allIn: p.allIn,
        sittingOut: p.sittingOut,
        lastAction: p.lastAction,
        cards: p.shown ? p.hole.slice() : null,
        hasCards: p.inHand && !p.folded && p.hole.length === 2,
      }),
      board: this.board.slice(),
      pot: this.potTotal(),
      button: this.button,
      toAct: this.toAct,
      street: this.street,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      handNumber: this.handNumber,
      sb: this.sb,
      bb: this.bb,
      handOver: this.handOver,
    };
  }
}
