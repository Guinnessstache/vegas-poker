// Achievement detection on rigged hands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../server/poker.js';
import { handAwards } from '../server/awards.js';
import { ACHIEVEMENTS } from '../public/js/achievements.js';

// Deal a hand with chosen hole cards and board, then play it out with `script(table)`.
function rigged({ stacks, holes, board, script, bb = 100 }) {
  const t = new Table({ smallBlind: bb / 2, bigBlind: bb, rng: () => 0.5 });
  stacks.forEach((s, i) => t.sit(i, { id: `p${i}`, name: `P${i}`, stack: s }));
  t.startHand();
  holes.forEach((h, i) => { t.seats[i].hole = h.slice(); });
  // advance() pops: burn, flop×3, burn, turn, burn, river
  const order = ['2d', board[0], board[1], board[2], '2d', board[3], '2d', board[4]];
  t.deck = [...order].reverse();
  script(t);
  let guard = 0;
  while (!t.handOver && guard++ < 50) {
    if (t.pendingAdvance) { t.advance(); continue; }
    const l = t.legalActions(t.toAct);
    t.act(t.toAct, l.canCheck ? 'check' : 'call');
  }
  assert.ok(t.handOver, 'hand finished');
  return t;
}
const ctx = (extra = {}) => ({ startingStack: 10000, isHuman: () => true, botLevel: () => null, peakSeated: 2, ...extra });
const ids = (awards, seat) => [...(awards.get(seat)?.ids || [])].sort();

test('every achievement id is unique and API-safe', () => {
  const seen = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.match(a.id, /^[A-Z0-9_]+$/);
    assert.ok(!seen.has(a.id)); seen.add(a.id);
    assert.ok(a.name.length <= 40 && a.desc.length <= 100);
  }
});

test('royal flush at showdown', () => {
  const t = rigged({ stacks: [10000, 10000], holes: [['As', 'Ks'], ['9h', '9d']], board: ['Qs', 'Js', 'Ts', '3c', '4d'], script: () => {} });
  const a = handAwards(t, ctx());
  assert.deepEqual(ids(a, 0), ['FIRST_HAND', 'FIRST_WIN', 'FRIENDLY_GAME', 'ROYAL_FLUSH', 'SHOWDOWN_WIN', 'STRAIGHT_FLUSH']);
  assert.deepEqual(ids(a, 1), ['FIRST_HAND', 'FRIENDLY_GAME']);
  assert.equal(a.get(0).stats.hands, 1);
});

test('the hammer: winning with 7-2 offsuit', () => {
  const t = rigged({ stacks: [10000, 10000], holes: [['7s', '2h'], ['Kh', 'Qd']], board: ['7d', '7c', '2c', '9s', '4h'], script: () => {} });
  const a = handAwards(t, ctx());
  assert.ok(a.get(0).ids.has('THE_HAMMER'));
  assert.ok(!a.get(0).ids.has('QUADS'));
});

test('all-in knockout of a Hard bot, big pot, double up', () => {
  const t = rigged({
    stacks: [10000, 10000], holes: [['Ah', 'Ad'], ['Kc', 'Kd']], board: ['As', '8c', '3h', '9d', 'Jc'],
    script: (tb) => { tb.act(tb.toAct, 'allin'); },
  });
  const a = handAwards(t, ctx({ isHuman: (s) => s === 0, botLevel: (s) => (s === 1 ? 'hard' : null) }));
  const w = ids(a, 0);
  for (const x of ['ALL_IN_WIN', 'BIG_POT', 'DOUBLE_UP', 'KNOCKOUT', 'SHARK_HUNTER', 'SHOWDOWN_WIN']) assert.ok(w.includes(x), x);
  assert.ok(!w.includes('FRIENDLY_GAME'), 'bots are not friends');
  assert.equal(a.get(0).stats.knockouts, 1);
});

test('nerves of steel: river bet that makes everyone fold', () => {
  const t = rigged({
    stacks: [10000, 10000, 10000], holes: [['4c', '5d'], ['Ah', 'Kh'], ['Qc', 'Jc']], board: ['2s', '8d', 'Th', 'Ks', '3c'],
    script: (tb) => {
      let g = 0;
      while (!tb.handOver && g++ < 40) {
        if (tb.pendingAdvance) { tb.advance(); continue; }
        const s = tb.toAct; const l = tb.legalActions(s);
        if (tb.street === 'river' && s === 0) tb.act(s, 'raise', 1500);
        else if (tb.street === 'river' && !l.canCheck) tb.act(s, 'fold');
        else tb.act(s, l.canCheck ? 'check' : 'call');
      }
    },
  });
  const a = handAwards(t, ctx());
  assert.ok(a.get(0).ids.has('NERVES_OF_STEEL'));
  assert.ok(!a.get(0).ids.has('SHOWDOWN_WIN'));
});

test('last one standing needs a table that started with 4+', () => {
  const mk = () => rigged({
    stacks: [10000, 3000], holes: [['Ah', 'Ad'], ['7c', '2d']], board: ['As', '8c', '3h', '9d', 'Jc'],
    script: (tb) => { tb.act(tb.toAct, 'allin'); },
  });
  assert.ok(handAwards(mk(), ctx({ peakSeated: 4 })).get(0).ids.has('LAST_ONE_STANDING'));
  assert.ok(!handAwards(mk(), ctx({ peakSeated: 2 })).get(0).ids.has('LAST_ONE_STANDING'));
});
