// Computer players: evaluator accuracy, legal decisions, and the room-level bot features.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, freshDeck, shuffle } from '../server/handEval.js';
import { rank7, cardInt, decide, makeBotProfile, equity } from '../server/bots.js';
import { Table } from '../server/poker.js';

test('fast evaluator ranks hands exactly like the table evaluator', () => {
  const deck = freshDeck();
  for (let i = 0; i < 20000; i++) {
    const d = shuffle(deck.slice(), Math.random);
    const board = d.slice(4, 9);
    const a = [d[0], d[1], ...board]; const b = [d[2], d[3], ...board];
    assert.equal(Math.sign(rank7(a.map(cardInt)) - rank7(b.map(cardInt))), Math.sign(evaluate(a).value - evaluate(b).value), `${a} vs ${b}`);
  }
});

test('equity estimates match known values', () => {
  const h = (s) => s.split(' ').map(cardInt);
  assert.ok(Math.abs(equity(h('As Ah'), [], [0], 8000) - 0.85) < 0.03);
  assert.ok(Math.abs(equity(h('7s 2h'), [], [0], 8000) - 0.35) < 0.03);
});

test('bots only make legal moves across hundreds of hands', () => {
  const t = new Table({ smallBlind: 50, bigBlind: 100 });
  const levels = ['easy', 'medium', 'hard', 'hard', 'medium'];
  const prof = levels.map((l) => makeBotProfile(l));
  levels.forEach((l, i) => t.sit(i, { id: `b${i}`, name: l, stack: 10000 }));
  for (let h = 0; h < 300; h++) {
    for (const p of t.seats) if (p && p.stack === 0) p.stack = 10000;
    assert.ok(t.startHand());
    while (!t.handOver) {
      if (t.pendingAdvance) { t.advance(); continue; }
      const c = decide(t, t.toAct, prof[t.toAct]);
      const r = t.act(t.toAct, c.action, c.amount);
      assert.ok(r.ok, `${levels[t.toAct]} tried ${JSON.stringify(c)}: ${r.error}`);
    }
    t.endHandCleanup();
  }
  assert.equal(t.seats.filter(Boolean).reduce((s, p) => s + p.stack, 0) % 1, 0);
});

// ---------------- room integration (simulated time) ----------------
const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
let sid = 0;
const fakeSocket = () => ({ id: `s${++sid}`, join() {}, emit() {} });
const KEY = (n) => `human-key-${n}-xxxxxxxxxxxxxxxx`;

// Advance simulated time, playing check/call for the humans, until `done()` or `ms` runs out.
async function playFor(room, ms, humans = [], done = () => false) {
  for (let t = 0; t < ms && !done(); t += 250) {
    const seat = room.table.toAct;
    const h = humans.find((m) => m.seat === seat && seat >= 0);
    if (h) { const l = room.table.legalActions(seat); if (l) room.act(h, l.canCheck ? 'check' : 'call'); }
    mock.timers.tick(250);
    await Promise.resolve();
  }
}

test('auto-fill, seat hand-off, rebuys and pause when only bots remain', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    const { Room } = await import('../server/rooms.js');
    const room = new Room(fakeIo(), { fillBots: 5, botLevel: 'hard', startingStack: 2000, bigBlind: 200 });
    const alice = room.join(fakeSocket(), KEY('a'), 'Alice');
    assert.equal(room.seatedCount(), 5, 'filled to 5 players');
    assert.equal(room.bots().length, 4);
    assert.equal(room.members.get(room.hostKey), alice, 'a human is host');
    assert.equal(room.start(alice), null);
    await playFor(room, 240_000, [alice]);
    assert.ok(room.table.handNumber >= 5, `hands played: ${room.table.handNumber}`);
    for (const b of room.bots()) assert.ok(b.seat >= 0 || b.bot.leaveAfterHand);
    // A second human joins: a bot gives up its seat (now or at the end of the hand).
    const bob = room.join(fakeSocket(), KEY('b'), 'Bob');
    await playFor(room, 180_000, [alice, bob], () => room.betweenHands() && room.seatedCount() === 5);
    assert.ok(bob.seat >= 0, 'Bob got a seat');
    assert.equal(room.seatedCount(), 5, 'still 5 players');
    assert.equal(room.bots().length, 3);
    // Host adds a bot manually beyond the fill target: it stays.
    await playFor(room, 20_000, [alice, bob]);
    const before = room.bots().length;
    assert.equal(room.hostAddBot(alice, 'easy'), null);
    assert.equal(room.bots().length, before + 1);
    assert.equal(room.hostAddBot(bob, 'easy'), 'Only the host can add bots');
    // Everyone disconnects: the game pauses instead of bots playing forever.
    room.disconnect(alice); room.disconnect(bob);
    assert.equal(room.running, false);
    assert.ok(room.emptySince > 0, 'room can be cleaned up');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('freezeout: busted bots leave and are not replaced', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    const { Room } = await import('../server/rooms.js');
    const room = new Room(fakeIo(), { fillBots: 4, botLevel: 'easy', startingStack: 2000, bigBlind: 400, allowRebuy: false });
    const alice = room.join(fakeSocket(), KEY('c'), 'Alice');
    assert.equal(room.seatedCount(), 4);
    room.setSittingOut(alice, true); // let the bots fight it out
    room.start(alice);
    let most = 0;
    await playFor(room, 3_600_000, [], () => { most = Math.max(most, room.bots().length); return room.bots().length <= 1; });
    assert.equal(most, 3, 'no replacement bots were added');
    assert.ok(room.bots().length <= 1, `bots still seated: ${room.bots().length}`);
    for (const b of room.bots()) assert.ok(room.table.seats[b.seat].stack > 0);
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});
