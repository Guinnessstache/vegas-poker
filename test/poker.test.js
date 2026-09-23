import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../server/handEval.js';
import { Table } from '../server/poker.js';

const ev = (s) => evaluate(s.split(' '));

test('hand categories', () => {
  assert.equal(ev('As Ks Qs Js Ts 2d 3c').name, 'Royal Flush');
  assert.equal(ev('5s 4s 3s 2s As Kd Kc').name, 'Straight Flush, Five high');
  assert.equal(ev('9h 9d 9s 9c 2d 3c 4h').name, 'Four of a Kind, Nines');
  assert.equal(ev('Kh Kd Ks Tc Td 3c 4h').name, 'Full House, Kings full of Tens');
  assert.equal(ev('Ah 9h 7h 4h 2h Kd Qc').name, 'Flush, Ace high');
  assert.equal(ev('Ah 2d 3c 4s 5h Kd Qc').name, 'Straight, Five high');
  assert.equal(ev('6h 6d 6s Ac Kd 3c 2h').name, 'Three of a Kind, Sixes');
  assert.equal(ev('Jh Jd 4s 4c Kd 3c 2h').name, 'Two Pair, Jacks and Fours');
  assert.equal(ev('Qh Qd 9s 7c 5d 3c 2h').name, 'Pair of Queens');
  assert.equal(ev('Ah Jd 9s 7c 5d 3c 2h').name, 'Ace High');
});

test('hand ordering and kickers', () => {
  assert.ok(ev('Ah Ad Ks 7c 5d 3c 2h').value > ev('Ah Ad Qs 7c 5d 3c 2h').value);
  assert.ok(ev('2h 3d 4s 5c 6d Kc Kh').value > ev('Ah 2d 3s 4c 5d Kc Qh').value); // 6-high > wheel
  // Board plays -> tie
  assert.equal(ev('2h 3d As Ks Qs Js Ts').value, ev('4c 5c As Ks Qs Js Ts').value);
  // Two pair with better kicker
  assert.ok(ev('Ah Kd Qs Qc 5d 5c 2h').value > ev('Jh Td Qs Qc 5d 5c 2h').value);
});

// Deterministic deck helper: cards are popped from the end, so list them reversed.
function riggedTable(players, deckTopFirst, opts = {}) {
  const t = new Table({ smallBlind: 50, bigBlind: 100, ...opts });
  players.forEach((stack, i) => t.sit(i, { id: 'p' + i, name: 'P' + i, stack }));
  t.startHand();
  // Replace deck + redeal hole cards deterministically.
  const deck = deckTopFirst.slice().reverse();
  const inHand = t.seats.map((p, i) => (p && p.inHand ? i : -1)).filter((i) => i >= 0);
  const order = [];
  let s = t.nextSeat(t.button, (p) => p.inHand);
  for (let n = 0; n < inHand.length; n++) { order.push(s); s = t.nextSeat(s, (p) => p.inHand); }
  for (const i of inHand) t.seats[i].hole = [];
  for (let r = 0; r < 2; r++) for (const seat of order) t.seats[seat].hole.push(deck.pop());
  t.deck = deck;
  t.drainEvents();
  return t;
}

const total = (t) => t.seats.reduce((s, p) => s + (p ? p.stack + p.totalBet : 0), 0);
function runOut(t) { let guard = 0; while (t.pendingAdvance && guard++ < 10) t.advance(); }

test('blinds and heads-up order', () => {
  const t = new Table({ smallBlind: 50, bigBlind: 100 });
  t.sit(0, { id: 'a', name: 'A', stack: 1000 });
  t.sit(3, { id: 'b', name: 'B', stack: 1000 });
  t.startHand();
  assert.equal(t.button, 0);
  assert.equal(t.seats[0].bet, 50); // button posts SB heads-up
  assert.equal(t.seats[3].bet, 100);
  assert.equal(t.toAct, 0); // SB acts first preflop
  t.act(0, 'call');
  assert.equal(t.toAct, 3); // BB option
  t.act(3, 'check');
  assert.ok(t.pendingAdvance);
  t.advance();
  assert.equal(t.street, 'flop');
  assert.equal(t.board.length, 3);
  assert.equal(t.toAct, 3); // BB acts first postflop heads-up
});

test('everyone folds to big blind; uncalled bets returned', () => {
  const t = new Table();
  for (let i = 0; i < 4; i++) t.sit(i, { id: 'p' + i, name: 'P' + i, stack: 1000 });
  t.startHand(); // button 0, sb 1, bb 2, UTG 3
  assert.equal(t.toAct, 3);
  t.act(3, 'raise', 300);
  t.act(0, 'fold');
  t.act(1, 'fold');
  t.act(2, 'fold');
  assert.ok(t.handOver);
  assert.equal(t.seats[3].stack, 1000 + 50 + 100);
  assert.equal(t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0), 4000);
});

test('min-raise enforcement and re-open', () => {
  const t = new Table();
  for (let i = 0; i < 3; i++) t.sit(i, { id: 'p' + i, name: 'P' + i, stack: 5000 });
  t.startHand(); // btn 0, sb 1, bb 2 -> UTG = 0
  assert.equal(t.toAct, 0);
  assert.equal(t.act(0, 'raise', 150).ok, false); // min raise to 200
  assert.equal(t.act(0, 'raise', 300).ok, true);
  const l = t.legalActions(1);
  assert.equal(l.minRaiseTo, 500);
  t.act(1, 'raise', 800); // raise of 500
  assert.equal(t.legalActions(2).minRaiseTo, 1300);
  t.act(2, 'call');
  assert.equal(t.toAct, 0);
  t.act(0, 'call');
  assert.ok(t.pendingAdvance);
});

test('side pots with three all-ins', () => {
  // Seats: 0 btn(1000), 1 sb(300), 2 bb(600). Board gives seat1 best, seat2 second, seat0 worst.
  const t = riggedTable([1000, 300, 600], [
    // hole cards dealt left of button first: seat1, seat2, seat0, seat1, seat2, seat0
    'Ah', 'Kh', '2c', 'Ad', 'Kd', '7s',
    'xx', '9c', '8d', '3h', 'xx', '4s', 'xx', 'Jd',
  ].map((c) => (c === 'xx' ? '5c' : c)));
  // hands: s1 AhAd, s2 KhKd, s0 2c7s. Board 9c 8d 3h 4s Jd
  t.act(0, 'allin');
  t.act(1, 'allin');
  t.act(2, 'allin');
  assert.equal(total(t), 1900);
  runOut(t);
  assert.ok(t.handOver);
  // Main pot 900 -> seat1, side pot (600-300)*2 = 600 -> seat2, seat0 gets 400 back
  assert.equal(t.seats[1].stack, 900);
  assert.equal(t.seats[2].stack, 600);
  assert.equal(t.seats[0].stack, 400);
  assert.equal(t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0), 1900);
});

test('split pot divides evenly', () => {
  const t = riggedTable([1000, 1000], [
    // heads-up: button 0 is sb; deal order starts left of button -> seat1, seat0
    '2c', '2d', '3c', '3d',
    '5c', 'As', 'Ks', 'Qs', '5h', 'Js', '5d', 'Ts',
  ]);
  t.act(0, 'call');
  t.act(1, 'check');
  for (let street = 0; street < 3; street++) {
    t.advance();
    t.act(1, 'check');
    t.act(0, 'check');
  }
  t.advance();
  assert.ok(t.handOver);
  assert.equal(t.seats[0].stack, 1000);
  assert.equal(t.seats[1].stack, 1000);
});

test('short all-in blind and incomplete raise', () => {
  const t = new Table();
  t.sit(0, { id: 'a', name: 'A', stack: 5000 });
  t.sit(1, { id: 'b', name: 'B', stack: 5000 });
  t.sit(2, { id: 'c', name: 'C', stack: 250 });
  t.startHand(); // btn0 sb1 bb2 -> utg 0
  t.act(0, 'raise', 200);
  t.act(1, 'call');
  // C all-in to 250 is an incomplete raise (50 < 100)
  t.act(2, 'allin');
  assert.equal(t.currentBet, 250);
  const l = t.legalActions(0);
  assert.equal(l.canRaise, false);
  assert.equal(l.toCall, 50);
  t.act(0, 'call');
  t.act(1, 'call');
  assert.ok(t.pendingAdvance);
  assert.equal(total(t), 10250);
});

test('random full games conserve chips', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let game = 0; game < 200; game++) {
    const t = new Table({ rng });
    const n = 2 + Math.floor(rng() * 7);
    for (let i = 0; i < n; i++) t.sit(i, { id: 'p' + i, name: 'P' + i, stack: 200 + Math.floor(rng() * 3000) });
    const start = total(t);
    for (let hand = 0; hand < 30; hand++) {
      if (!t.startHand()) break;
      let guard = 0;
      while (!t.handOver && guard++ < 500) {
        if (t.pendingAdvance) { t.advance(); continue; }
        const seat = t.toAct;
        const l = t.legalActions(seat);
        assert.ok(l, 'someone must be able to act');
        const r = rng();
        if (r < 0.15 && !l.canCheck) t.act(seat, 'fold');
        else if (r < 0.3 && l.canRaise) t.act(seat, 'raise', l.minRaiseTo + Math.floor(rng() * (l.maxRaiseTo - l.minRaiseTo)));
        else if (r < 0.35) t.act(seat, 'allin');
        else t.act(seat, l.canCheck ? 'check' : 'call');
      }
      assert.ok(t.handOver, 'hand must finish');
      assert.equal(t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0), start, 'chips conserved');
      t.endHandCleanup();
    }
  }
});
