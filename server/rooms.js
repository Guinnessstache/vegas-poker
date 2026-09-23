// Room / lobby layer: join codes, seating, pacing, timers, chat, WebRTC signaling.

import { randomBytes, randomInt } from 'node:crypto';
import { Table, MAX_SEATS } from './poker.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 5;
const DISCONNECT_REMOVE_MS = 3 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export const rooms = new Map();

function makeCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('Could not allocate room code');
}

const clampInt = (v, min, max, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

export function cleanName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

export function normalizeSettings(s = {}) {
  const bigBlind = clampInt(s.bigBlind, 2, 1_000_000, 100);
  return {
    startingStack: clampInt(s.startingStack, bigBlind * 10, 100_000_000, 10_000),
    bigBlind,
    smallBlind: Math.max(1, Math.floor(bigBlind / 2)),
    actionTime: clampInt(s.actionTime, 10, 120, 30),
    allowRebuy: s.allowRebuy !== false,
  };
}

export class Room {
  constructor(io, settings) {
    this.io = io;
    this.code = makeCode();
    this.settings = normalizeSettings(settings);
    this.table = new Table({ smallBlind: this.settings.smallBlind, bigBlind: this.settings.bigBlind, maxSeats: MAX_SEATS });
    this.members = new Map(); // key -> member
    this.hostKey = null;
    this.running = false;
    this.timers = { turn: null, advance: null, next: null };
    this.deadline = 0;
    this.chat = [];
    this.emptySince = Date.now();
    rooms.set(this.code, this);
  }

  // ---------- membership ----------
  memberBySocket(socketId) {
    for (const m of this.members.values()) if (m.socketId === socketId) return m;
    return null;
  }
  memberByPid(pid) {
    for (const m of this.members.values()) if (m.pid === pid) return m;
    return null;
  }

  join(socket, key, name) {
    let m = this.members.get(key);
    if (m) {
      // Reconnect.
      if (m.socketId && m.socketId !== socket.id) this.io.sockets.sockets.get(m.socketId)?.disconnect(true);
      m.socketId = socket.id;
      m.connected = true;
      if (name) m.name = cleanName(name);
      clearTimeout(m.removeTimer);
      if (m.seat >= 0 && this.table.seats[m.seat]) this.table.seats[m.seat].name = m.name;
    } else {
      m = {
        key,
        pid: randomBytes(6).toString('hex'),
        name: cleanName(name),
        socketId: socket.id,
        connected: true,
        seat: -1,
        bank: this.settings.startingStack, // chips held while standing
        media: { cam: false, mic: false },
        color: this.members.size % 8,
      };
      this.members.set(key, m);
      if (!this.hostKey) this.hostKey = key;
      // Fill the best-view seats (facing the dealer) first.
      const free = [3, 4, 2, 5, 1, 6, 0, 7].find((i) => i < this.table.maxSeats && !this.table.seats[i]);
      if (free !== undefined) this.sit(m, free, true);
      this.systemChat(`${m.name} joined the table.`);
    }
    socket.join(this.code);
    this.emptySince = 0;
    this.broadcastRoom();
    this.sendState(m);
    socket.emit('chatHistory', this.chat.slice(-50));
    this.maybeStartHand();
    return m;
  }

  sit(m, seat, quiet = false) {
    if (m.seat >= 0) {
      if (this.table.seats[m.seat]?.inHand && !this.table.handOver && this.table.street !== 'idle') return 'Cannot change seats during a hand';
      this.stand(m, true);
    }
    if (m.bank <= 0) {
      if (!this.settings.allowRebuy) return 'You are out of chips';
      m.bank = this.settings.startingStack;
    }
    if (!this.table.sit(seat, { id: m.pid, name: m.name, stack: m.bank })) return 'Seat taken';
    m.seat = seat;
    m.bank = 0;
    if (!quiet) this.systemChat(`${m.name} sat down.`);
    this.afterChange();
    this.maybeStartHand();
    return null;
  }

  stand(m, quiet = false) {
    if (m.seat < 0) return;
    const p = this.table.seats[m.seat];
    if (p) {
      m.bank = p.stack;
      this.table.stand(m.seat);
    }
    m.seat = -1;
    if (!quiet) this.systemChat(`${m.name} stood up.`);
    this.afterChange();
  }

  leave(m) {
    this.stand(m, true);
    this.members.delete(m.key);
    this.systemChat(`${m.name} left.`);
    this.io.to(this.code).emit('peerLeft', { pid: m.pid });
    if (this.hostKey === m.key) {
      const next = [...this.members.values()].find((x) => x.connected) || [...this.members.values()][0];
      this.hostKey = next ? next.key : null;
      if (next) this.systemChat(`${next.name} is now the host.`);
    }
    this.broadcastRoom();
    this.checkEmpty();
  }

  disconnect(m) {
    m.connected = false;
    m.socketId = null;
    m.media = { cam: false, mic: false };
    this.io.to(this.code).emit('peerLeft', { pid: m.pid });
    m.removeTimer = setTimeout(() => {
      if (!m.connected && this.members.get(m.key) === m) this.leave(m);
    }, DISCONNECT_REMOVE_MS);
    this.broadcastRoom();
    // If it's their turn, shorten the clock.
    if (m.seat >= 0 && this.table.toAct === m.seat) this.startTurnTimer();
    this.checkEmpty();
  }

  checkEmpty() {
    const anyone = [...this.members.values()].some((m) => m.connected);
    if (!anyone && !this.emptySince) this.emptySince = Date.now();
  }

  isHost(m) { return m.key === this.hostKey; }

  // ---------- game flow ----------
  start(m) {
    if (!this.isHost(m)) return 'Only the host can start the game';
    if (!this.table.canStart()) return 'Need at least 2 seated players with chips';
    this.running = true;
    this.systemChat('The host started the game. Good luck!');
    this.broadcastRoom();
    this.maybeStartHand();
    return null;
  }

  pause(m) {
    if (!this.isHost(m)) return 'Only the host can pause';
    this.running = false;
    this.systemChat('The game will pause after this hand.');
    this.broadcastRoom();
    return null;
  }

  maybeStartHand() {
    if (!this.running || this.timers.next) return;
    const t = this.table;
    if (t.street !== 'idle') return;
    if (!t.canStart()) return;
    this.timers.next = setTimeout(() => {
      this.timers.next = null;
      if (!this.running || t.street !== 'idle') return;
      // Apply any pending blind change.
      t.sb = this.settings.smallBlind;
      t.bb = this.settings.bigBlind;
      // Sync names.
      for (const m of this.members.values()) if (m.seat >= 0 && t.seats[m.seat]) t.seats[m.seat].name = m.name;
      if (t.startHand()) this.afterChange();
    }, 1200);
  }

  act(m, action, amount) {
    if (m.seat < 0) return 'You are not seated';
    const r = this.table.act(m.seat, action, amount);
    if (!r.ok) return r.error;
    this.afterChange();
    return null;
  }

  // Run after every mutation: flush events, schedule pacing, send state.
  afterChange() {
    const t = this.table;
    const events = t.drainEvents();
    if (events.length) this.io.to(this.code).emit('events', events);

    clearTimeout(this.timers.turn);
    this.timers.turn = null;
    this.deadline = 0;

    if (t.pendingAdvance && !this.timers.advance) {
      const allInRunout = t.seats.filter((p) => p && p.inHand && !p.folded && !p.allIn).length <= 1;
      const delay = allInRunout ? 2200 : 1100;
      this.timers.advance = setTimeout(() => {
        this.timers.advance = null;
        t.advance();
        this.afterChange();
      }, delay);
    } else if (t.handOver && !this.timers.next) {
      const uncontested = t.lastResults?.uncontested;
      this.timers.next = setTimeout(() => {
        this.timers.next = null;
        t.endHandCleanup();
        // Bust-outs: auto-stand players with no chips if rebuys are off.
        for (const m of this.members.values()) {
          const p = m.seat >= 0 ? t.seats[m.seat] : null;
          if (m.seat >= 0 && !p) m.seat = -1; // seat was cleared (left mid-hand)
        }
        this.afterChange();
        this.maybeStartHand();
      }, uncontested ? 2800 : 6500);
    } else if (t.toAct >= 0) {
      this.startTurnTimer();
    }
    this.sendStateAll();
  }

  startTurnTimer() {
    const t = this.table;
    clearTimeout(this.timers.turn);
    const seat = t.toAct;
    if (seat < 0) return;
    const m = this.memberBySeat(seat);
    const p = t.seats[seat];
    let ms = this.settings.actionTime * 1000;
    if (t.street === 'preflop' && t.seats.every((q) => !q || !q.acted)) ms += 2500; // deal animation
    if (!m || !m.connected) ms = 6000;
    if (p?.sittingOut) ms = 1500;
    this.deadline = Date.now() + ms;
    this.turnTotal = ms;
    const hand = t.handNumber;
    this.timers.turn = setTimeout(() => {
      if (t.toAct !== seat || t.handNumber !== hand) return;
      const legal = t.legalActions(seat);
      if (!legal) return;
      t.act(seat, legal.canCheck ? 'check' : 'fold');
      if (m && m.connected && !p.sittingOut && !legal.canCheck) {
        // Timed out facing a bet: sit them out so the table isn't held up.
        p.sittingOut = true;
        this.toSocket(m, 'toast', 'You timed out and were sat out. Click "I\'m back" to play again.');
      }
      this.afterChange();
    }, ms);
    this.sendStateAll();
  }

  memberBySeat(seat) {
    for (const m of this.members.values()) if (m.seat === seat) return m;
    return null;
  }

  rebuy(m) {
    if (!this.settings.allowRebuy) return 'Rebuys are disabled';
    if (m.seat < 0) { m.bank = Math.max(m.bank, this.settings.startingStack); this.afterChange(); return null; }
    const p = this.table.seats[m.seat];
    if (p.inHand && this.table.street !== 'idle' && !this.table.handOver) return 'Wait until the hand is over';
    if (p.stack >= this.settings.startingStack) return 'You already have a full stack';
    const add = this.settings.startingStack - p.stack;
    p.stack = this.settings.startingStack;
    this.systemChat(`${m.name} topped up (+${add.toLocaleString()}).`);
    this.afterChange();
    this.maybeStartHand();
    return null;
  }

  setSittingOut(m, value) {
    if (m.seat < 0) return 'Not seated';
    this.table.seats[m.seat].sittingOut = !!value;
    if (this.table.toAct === m.seat) this.startTurnTimer();
    this.afterChange();
    this.maybeStartHand();
    return null;
  }

  updateSettings(m, s) {
    if (!this.isHost(m)) return 'Only the host can change settings';
    const next = normalizeSettings({ ...this.settings, ...s });
    // Starting stack only affects new buy-ins / rebuys.
    this.settings = next;
    this.systemChat(`Blinds are now ${next.smallBlind.toLocaleString()}/${next.bigBlind.toLocaleString()} (from next hand).`);
    this.broadcastRoom();
    return null;
  }

  // ---------- chat / media / signaling ----------
  systemChat(text) { this.pushChat({ system: true, text }); }

  pushChat(msg) {
    msg.ts = Date.now();
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this.io.to(this.code).emit('chat', msg);
  }

  userChat(m, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 240);
    if (!text) return;
    const now = Date.now();
    if (m.lastChat && now - m.lastChat < 400) return;
    m.lastChat = now;
    this.pushChat({ pid: m.pid, name: m.name, text });
  }

  setMedia(m, media) {
    m.media = { cam: !!media?.cam, mic: !!media?.mic };
    this.broadcastRoom();
  }

  relaySignal(m, to, data) {
    const target = this.memberByPid(to);
    if (!target || !target.socketId) return;
    this.io.to(target.socketId).emit('rtc', { from: m.pid, data });
  }

  toSocket(m, ev, payload) {
    if (m.socketId) this.io.to(m.socketId).emit(ev, payload);
  }

  // ---------- broadcasting ----------
  roomInfo() {
    const host = this.members.get(this.hostKey);
    return {
      code: this.code,
      hostPid: host ? host.pid : null,
      running: this.running,
      settings: this.settings,
      members: [...this.members.values()].map((m) => ({
        pid: m.pid, name: m.name, seat: m.seat, connected: m.connected, media: m.media, color: m.color,
      })),
    };
  }

  broadcastRoom() { this.io.to(this.code).emit('room', this.roomInfo()); }

  sendState(m) {
    if (!m.socketId) return;
    const t = this.table;
    const p = m.seat >= 0 ? t.seats[m.seat] : null;
    this.io.to(m.socketId).emit('state', {
      table: t.publicState(),
      deadline: this.deadline,
      turnTotal: this.turnTotal || 0,
      serverNow: Date.now(),
      you: {
        pid: m.pid,
        seat: m.seat,
        isHost: this.isHost(m),
        hole: p && p.inHand ? p.hole.slice() : [],
        legal: p ? t.legalActions(m.seat) : null,
        sittingOut: p ? p.sittingOut : false,
        bank: m.bank,
      },
    });
  }

  sendStateAll() { for (const m of this.members.values()) this.sendState(m); }

  destroy() {
    Object.values(this.timers).forEach(clearTimeout);
    for (const m of this.members.values()) clearTimeout(m.removeTimer);
    rooms.delete(this.code);
  }
}

// Sweep abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.emptySince && now - r.emptySince > EMPTY_ROOM_TTL_MS) r.destroy();
  }
}, 60 * 1000).unref();
