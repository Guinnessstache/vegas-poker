// Quick Match lobby: nobody is dealt in until the players are ready (or the table fills).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Room, LOBBY_LAST_CALL_MS } from '../server/rooms.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
let sid = 0;
const fakeSocket = () => ({ id: `q${++sid}`, join() {}, emit() {} });
const KEY = (n) => `qm-key-${n}-xxxxxxxxxxxxxxxxxxxx`;
const SETTINGS = { fillBots: 6, botLevel: 'medium', quickLobby: true, listed: true };
const withTimers = (fn) => () => { mock.timers.enable({ apis: ['setTimeout', 'Date'] }); try { fn(); } finally { mock.timers.reset(); } };

test('nothing happens until players are ready, however long they wait', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  room.join(fakeSocket(), KEY('a'), 'Alice');
  room.join(fakeSocket(), KEY('b'), 'Bob');
  mock.timers.tick(10 * 60_000);
  assert.equal(room.running, false);
  assert.equal(room.bots().length, 0, 'no bots in the lobby');
  assert.equal(room.roomInfo().lobby, true);
  room.destroy();
}));

test('a solo player who presses Ready starts at once with bots', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  const alice = room.join(fakeSocket(), KEY('a'), 'Alice');
  room.setReady(alice, true);
  assert.equal(room.roomInfo().lobby, false);
  assert.equal(room.running, true);
  assert.equal(room.seatedCount(), 6, 'bots fill to 6');
  room.destroy();
}));

test('starts the moment everyone is ready', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  const a = room.join(fakeSocket(), KEY('a'), 'Alice');
  const b = room.join(fakeSocket(), KEY('b'), 'Bob');
  const c = room.join(fakeSocket(), KEY('c'), 'Cara');
  room.setReady(a, true);
  assert.equal(room.running, false);
  room.setReady(b, true);
  room.setReady(c, true);
  assert.equal(room.running, true);
  assert.equal(room.seatedCount(), 6, '3 players + 3 bots');
  room.destroy();
}));

test('once most are ready, the rest get 20 s; un-readying cancels it', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  const a = room.join(fakeSocket(), KEY('a'), 'Alice');
  const b = room.join(fakeSocket(), KEY('b'), 'Bob');
  const c = room.join(fakeSocket(), KEY('c'), 'Cara');
  room.setReady(a, true);
  assert.equal(room.roomInfo().lobbyLeft, 0, '1 of 3 ready: no countdown');
  room.setReady(b, true);
  assert.equal(room.roomInfo().lobbyLeft, LOBBY_LAST_CALL_MS, '2 of 3 ready: last call');
  room.setReady(b, false);
  assert.equal(room.roomInfo().lobbyLeft, 0, 'cancelled');
  room.setReady(b, true);
  mock.timers.tick(LOBBY_LAST_CALL_MS);
  assert.equal(room.running, true, 'started without Cara pressing Ready');
  assert.ok(c.seat >= 0, 'Cara is still seated');
  room.destroy();
}));

test('a new arrival joins un-ready and can cancel a last call', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  const a = room.join(fakeSocket(), KEY('a'), 'Alice');
  room.join(fakeSocket(), KEY('b'), 'Bob');
  room.setReady(a, true); // 1 of 2: last call
  assert.ok(room.roomInfo().lobbyLeft > 0);
  room.join(fakeSocket(), KEY('c'), 'Cara'); // 1 of 3: no longer most
  assert.equal(room.roomInfo().lobbyLeft, 0);
  assert.equal(room.roomInfo().members.find((m) => m.name === 'Cara').ready, false);
  room.destroy();
}));

test('if the only un-ready player leaves, the game starts', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  const a = room.join(fakeSocket(), KEY('a'), 'Alice');
  const b = room.join(fakeSocket(), KEY('b'), 'Bob');
  room.setReady(a, true);
  room.leave(b);
  assert.equal(room.running, true);
  room.destroy();
}));

test('a full table starts without waiting for Ready', withTimers(() => {
  const room = new Room(fakeIo(), SETTINGS);
  for (let i = 0; i < 8; i++) room.join(fakeSocket(), KEY(`p${i}`), `P${i}`);
  assert.equal(room.roomInfo().lobby, false);
  assert.equal(room.running, true);
  assert.equal(room.bots().length, 0);
  room.destroy();
}));

test('tables without the lobby behave exactly as before', () => {
  const room = new Room(fakeIo(), { fillBots: 6, botLevel: 'medium' });
  room.join(fakeSocket(), KEY('a'), 'Alice');
  assert.equal(room.roomInfo().lobby, false);
  assert.equal(room.seatedCount(), 6, 'bots fill immediately');
  room.destroy();
});
