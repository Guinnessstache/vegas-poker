// Room / lobby layer: join codes, seating, pacing, timers, chat, WebRTC signaling.

import { randomBytes, randomInt } from 'node:crypto';
import { Table, MAX_SEATS } from './poker.js';
import { BOT_LEVELS, LEVEL_LABEL, makeBotProfile, pickBotName, decide, thinkTime, botLine } from './bots.js';

const SEAT_ORDER = [3, 4, 2, 5, 1, 6, 0, 7]; // best views (facing the dealer) first

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
    // Keep the table filled with computer players up to this many seated players (0 = off).
    fillBots: clampInt(s.fillBots, 0, MAX_SEATS, 0),
    botLevel: BOT_LEVELS.includes(s.botLevel) ? s.botLevel : 'medium',
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
    this.timers = { turn: null, advance: null, next: null, bot: null };
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
      // Fill the best-view seats (facing the dealer) first; a table-filling bot gives up its seat.
      let free = this.freeSeat();
      if (free < 0 && this.makeRoomForHuman()) free = this.freeSeat();
      if (free >= 0) this.sit(m, free, true);
      else m.wantsSeat = true; // seated as soon as a bot's seat frees up (end of hand)
      this.systemChat(`${m.name} joined the table.`);
    }
    if (this.pausedEmpty) { this.pausedEmpty = false; this.running = true; this.systemChat('Welcome back — resuming.'); }
    socket.join(this.code);
    this.emptySince = 0;
    this.broadcastRoom();
    this.sendState(m);
    socket.emit('chatHistory', this.chat.slice(-50));
    this.rebalanceBots();
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
    this.systemChat(m.bot ? `\u{1F916} ${m.name} left the table.` : `${m.name} left.`);
    this.io.to(this.code).emit('peerLeft', { pid: m.pid });
    if (this.hostKey === m.key) {
      const humans = [...this.members.values()].filter((x) => !x.bot);
      const next = humans.find((x) => x.connected) || humans[0];
      this.hostKey = next ? next.key : null;
      if (next) this.systemChat(`${next.name} is now the host.`);
    }
    if (!m.bot) this.rebalanceBots();
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
    // Nobody left but bots: stop dealing until someone comes back.
    if (!this.humansConnected() && this.running) { this.running = false; this.pausedEmpty = true; }
    this.checkEmpty();
  }

  humansConnected() { return [...this.members.values()].some((m) => m.connected && !m.bot); }

  checkEmpty() {
    if (!this.humansConnected() && !this.emptySince) this.emptySince = Date.now();
  }

  isHost(m) { return m.key === this.hostKey; }

  // ---------- computer players ----------
  freeSeat() {
    const i = SEAT_ORDER.find((s) => s < this.table.maxSeats && !this.table.seats[s]);
    return i === undefined ? -1 : i;
  }

  seatedCount() { return this.table.seats.filter((p) => p && !p.leaving).length; }
  bots() { return [...this.members.values()].filter((m) => m.bot); }
  betweenHands() { return this.table.street === 'idle' || this.table.handOver; }

  addBot(level, { auto = false } = {}) {
    const seat = this.freeSeat();
    if (seat < 0) return 'The table is full';
    level = BOT_LEVELS.includes(level) ? level : 'medium';
    const taken = new Set([...this.members.values()].map((x) => x.name));
    const pid = randomBytes(6).toString('hex');
    const m = {
      key: `bot:${pid}`, pid, name: pickBotName(taken), socketId: null, connected: true, seat: -1,
      bank: this.settings.startingStack, media: { cam: false, mic: false }, color: this.members.size % 8,
      bot: { level, auto, profile: makeBotProfile(level) },
    };
    this.members.set(m.key, m);
    this.emptySince = this.humansConnected() ? 0 : this.emptySince;
    const err = this.sit(m, seat, true);
    if (err) { this.members.delete(m.key); return err; }
    this.systemChat(`\u{1F916} ${m.name} (${LEVEL_LABEL[level]} bot) sat down.`);
    this.broadcastRoom();
    return null;
  }

  removeBot(m) {
    if (!m?.bot) return 'Not a bot';
    this.leave(m); // folds if mid-hand
    return null;
  }

  // Take an auto-fill bot out so a real player can sit (only between hands).
  makeRoomForHuman() {
    if (!this.betweenHands()) return false;
    const b = this.bots().filter((x) => x.bot.auto && x.seat >= 0).pop();
    if (!b) return false;
    this.leave(b);
    return true;
  }

  // Keep the table at `fillBots` seated players using auto bots.
  rebalanceBots() {
    const target = this.settings.fillBots;
    if (!this.betweenHands()) return; // settle after the hand
    // Freezeout: bots only fill seats before the first hand, so the game can actually end.
    const canAdd = this.settings.allowRebuy || this.table.handNumber === 0;
    // Waiting humans get seats first.
    for (const m of this.members.values()) {
      if (m.bot || !m.wantsSeat || m.seat >= 0 || !m.connected) continue;
      if (this.freeSeat() < 0 && !this.makeRoomForHuman()) break;
      m.wantsSeat = false;
      this.sit(m, this.freeSeat(), true);
    }
    const autos = () => this.bots().filter((b) => b.bot.auto);
    let guard = 0;
    while (target && canAdd && this.seatedCount() < target && this.freeSeat() >= 0 && guard++ < MAX_SEATS) {
      if (this.addBot(this.settings.botLevel, { auto: true })) break;
    }
    while (this.seatedCount() > Math.max(target, 0) && autos().length && guard++ < MAX_SEATS * 2) {
      if (!target || this.seatedCount() > target) this.leave(autos().pop()); else break;
    }
  }

  hostAddBot(m, level) {
    if (!this.isHost(m)) return 'Only the host can add bots';
    const err = this.addBot(level);
    if (!err) this.maybeStartHand();
    return err;
  }

  hostRemoveBot(m, pid) {
    if (!this.isHost(m)) return 'Only the host can remove bots';
    const b = this.memberByPid(pid);
    if (!b?.bot) return 'No such bot';
    return this.removeBot(b);
  }

  hostBotFill(m, count, level) {
    if (!this.isHost(m)) return 'Only the host can change bot settings';
    this.settings = normalizeSettings({ ...this.settings, fillBots: count, botLevel: level });
    const { fillBots, botLevel } = this.settings;
    this.systemChat(fillBots ? `Bots will keep the table at ${fillBots} players (${LEVEL_LABEL[botLevel]}).` : 'Auto-fill bots turned off.');
    if (!fillBots) for (const b of this.bots().filter((x) => x.bot.auto)) { if (this.betweenHands()) this.leave(b); else b.bot.leaveAfterHand = true; }
    this.rebalanceBots();
    this.broadcastRoom();
    this.maybeStartHand();
    return null;
  }

  botAct(m, seat, hand) {
    const t = this.table;
    if (t.toAct !== seat || t.handNumber !== hand || m.seat !== seat) return;
    let choice = null;
    try { choice = decide(t, seat, m.bot.profile); } catch (e) { console.error('[bot]', e); }
    let r = choice ? t.act(seat, choice.action, choice.amount) : { ok: false };
    if (!r.ok) {
      const legal = t.legalActions(seat);
      if (!legal) return;
      r = t.act(seat, legal.canCheck ? 'check' : 'fold');
    }
    this.afterChange();
  }

  // After each hand: bots that busted rebuy (or leave in a freezeout), table talk, fill seats.
  botsAfterHand(results) {
    const t = this.table;
    const bigPot = t.bb * 20;
    for (const w of results?.winners || []) {
      const m = this.memberBySeat(w.seat);
      if (m?.bot && w.amount >= bigPot && Math.random() < 0.25) this.pushChat({ pid: m.pid, name: m.name, text: botLine('win') });
    }
    for (const b of this.bots()) {
      const p = b.seat >= 0 ? t.seats[b.seat] : null;
      if (b.bot.leaveAfterHand) { this.leave(b); continue; }
      if (!p || p.stack > 0) continue;
      if (this.settings.allowRebuy) {
        p.stack = this.settings.startingStack;
        if (Math.random() < 0.4) this.pushChat({ pid: b.pid, name: b.name, text: botLine('rebuy') });
        this.systemChat(`\u{1F916} ${b.name} rebought (${this.settings.startingStack.toLocaleString()}).`);
      } else {
        this.pushChat({ pid: b.pid, name: b.name, text: botLine('bust') });
        this.leave(b);
      }
    }
    this.rebalanceBots();
  }

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
        const results = t.lastResults;
        t.endHandCleanup();
        // Bust-outs: auto-stand players with no chips if rebuys are off.
        for (const m of this.members.values()) {
          const p = m.seat >= 0 ? t.seats[m.seat] : null;
          if (m.seat >= 0 && !p) m.seat = -1; // seat was cleared (left mid-hand)
        }
        this.botsAfterHand(results);
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
    clearTimeout(this.timers.bot);
    this.timers.bot = null;
    const seat = t.toAct;
    if (seat < 0) return;
    const m = this.memberBySeat(seat);
    if (m?.bot) {
      const hand = t.handNumber;
      let delay = thinkTime(t, seat, m.bot.profile);
      if (t.street === 'preflop' && t.seats.every((q) => !q || !q.acted)) delay += 2000; // let the deal animation play
      this.timers.bot = setTimeout(() => { this.timers.bot = null; this.botAct(m, seat, hand); }, delay);
    }
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
    // Starting stack only affects new buy-ins / rebuys. Bot settings have their own control.
    next.fillBots = this.settings.fillBots;
    next.botLevel = this.settings.botLevel;
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
        bot: m.bot ? m.bot.level : null,
        botAuto: m.bot ? !!m.bot.auto : false,
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
