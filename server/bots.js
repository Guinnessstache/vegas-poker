// Computer opponents. Pure decision logic: given the table and a seat, return an action.
//
// How a bot thinks:
//  1. Estimate its equity (chance to win) by simulating random run-outs against the players
//     still in the hand (Monte Carlo). Medium/Hard bots narrow opponents' likely hands based
//     on how aggressively they've played this hand.
//  2. Compare equity with the price (pot odds) and its difficulty profile: how loose, how
//     aggressive, how often it bluffs, semi-bluffs with draws, or slow-plays monsters.
//  3. Pick a bet size that fits the hand and the table.
// Every bot also gets a small random personality so two "Medium" bots don't play identically.

export const BOT_LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const NAMES = [
  'Lucky Lou', 'Vinnie', 'Dolly', 'Big Tex', 'Sal', 'Marge', 'Rocco', 'Lady Luck', 'Tommy Two-Pair',
  'Frankie', 'Stella', 'Duke', 'Maxine', 'Johnny Chips', 'Rosa', 'Slim', 'Bugsy', 'Vera', 'Nicky Nuts',
  'Queenie', 'Hank', 'Lola', 'Benny', 'Mae',
];

export function pickBotName(taken, rng = Math.random) {
  const free = NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(rng() * free.length)];
  for (let i = 2; ; i++) { const n = `Bot ${i}`; if (!taken.has(n)) return n; }
}

// ---------------- difficulty profiles ----------------
const PROFILES = {
  // Loose-passive: plays lots of hands, calls too much, rarely raises, almost never bluffs.
  easy: { iters: 250, callSlack: 0.12, sticky: 0.55, raiseRel: 1.9, valueRel: 1.6, bluff: 0.03, semi: 0.08, slowplay: 0, trapCall: 0, readOpponents: 0, sizes: [0.5], preflopOpenRel: 1.6, mistakes: 0.12 },
  // Solid tight-aggressive: folds junk, bets good hands, some bluffs and draws.
  medium: { iters: 500, callSlack: 0.0, sticky: 0.1, raiseRel: 1.5, valueRel: 1.25, bluff: 0.07, semi: 0.28, slowplay: 0.05, trapCall: 0.05, readOpponents: 0.5, sizes: [0.5, 0.66, 0.75], preflopOpenRel: 1.2, mistakes: 0.04 },
  // Thinking player: reads ranges, uses position and pot odds, balanced bluffs, traps, varied sizing.
  hard: { iters: 900, callSlack: -0.02, sticky: 0, raiseRel: 1.35, valueRel: 1.15, bluff: 0.13, semi: 0.45, slowplay: 0.15, trapCall: 0.12, readOpponents: 1, sizes: [0.33, 0.5, 0.66, 0.8, 1.0, 1.3], preflopOpenRel: 1.1, mistakes: 0 },
};

export function makeBotProfile(level, rng = Math.random) {
  const base = PROFILES[level] || PROFILES.medium;
  const j = (x, spread) => x * (1 + (rng() * 2 - 1) * spread);
  return {
    level: PROFILES[level] ? level : 'medium',
    ...base,
    bluff: j(base.bluff, 0.4),
    semi: j(base.semi, 0.3),
    callSlack: base.callSlack + (rng() * 2 - 1) * 0.03,
    raiseRel: j(base.raiseRel, 0.08),
    aggression: j(1, 0.2),
  };
}

// ---------------- fast 7-card evaluator (bots only) ----------------
// Cards as ints: rank * 4 + suit, rank 0 = deuce … 12 = ace. Returns a comparable number
// (bigger wins). Checked against the table's evaluator in test/bots.test.js.
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
export const cardInt = (c) => RANKS.indexOf(c[0]) * 4 + SUITS.indexOf(c[1]);

const cnt = new Int8Array(13);
const suitMask = new Int32Array(4);
const suitCnt = new Int8Array(4);

function straightHigh(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace played low
  for (let hi = 13; hi >= 4; hi--) if (((m >> (hi - 4)) & 0x1f) === 0x1f) return hi - 1;
  return -1;
}
const val = (cat, a = 0, b = 0, c = 0, d = 0, e = 0) => cat * 1048576 + a * 65536 + b * 4096 + c * 256 + d * 16 + e;
function topBits(mask, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  while (out.length < n) out.push(0);
  return out;
}

export function rank7(cards, n = cards.length) {
  cnt.fill(0); suitMask.fill(0); suitCnt.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i]; const r = c >> 2; const s = c & 3;
    cnt[r]++; suitMask[s] |= 1 << r; suitCnt[s]++; rankMask |= 1 << r;
  }
  let flush = -1;
  for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) flush = s;
  if (flush >= 0) {
    const sh = straightHigh(suitMask[flush]);
    if (sh >= 0) return val(8, sh);
  }
  let quad = -1; let trip1 = -1; let trip2 = -1; let pair1 = -1; let pair2 = -1; let pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = cnt[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
    else if (k === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r; }
  }
  if (quad >= 0) return val(7, quad, topBits(rankMask & ~(1 << quad), 1)[0]);
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return val(6, trip1, Math.max(trip2, pair1));
  if (flush >= 0) { const t = topBits(suitMask[flush], 5); return val(5, t[0], t[1], t[2], t[3], t[4]); }
  const st = straightHigh(rankMask);
  if (st >= 0) return val(4, st);
  if (trip1 >= 0) { const k = topBits(rankMask & ~(1 << trip1), 2); return val(3, trip1, k[0], k[1]); }
  if (pair2 >= 0) { const k = topBits(rankMask & ~(1 << pair1) & ~(1 << pair2), 1); return val(2, pair1, pair2, k[0]); }
  if (pair1 >= 0) { const k = topBits(rankMask & ~(1 << pair1), 3); return val(1, pair1, k[0], k[1], k[2]); }
  const k = topBits(rankMask, 5);
  return val(0, k[0], k[1], k[2], k[3], k[4]);
}

// Chen formula: quick pre-flop hand strength (-1 … 20). Used to guess opponents' ranges.
export function chen(a, b) {
  const ra = a >> 2; const rb = b >> 2;
  const hi = Math.max(ra, rb); const lo = Math.min(ra, rb);
  const pts = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10]; // 2 … A
  let s = pts[hi];
  if (ra === rb) return Math.max(5, s * 2);
  if ((a & 3) === (b & 3)) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1; // connected below a queen
  return Math.ceil(s);
}

// Monte Carlo equity: share of the pot we'd win on average against `ranges.length` opponents.
// ranges[i] = minimum Chen score we assume opponent i holds (0 = any two cards).
export function equity(hole, board, ranges, iters, rng = Math.random) {
  const known = new Set([...hole, ...board]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  const need = 5 - board.length;
  const me = new Array(7); const opp = new Array(7);
  let score = 0;
  const nOpp = ranges.length;
  for (let it = 0; it < iters; it++) {
    let top = deck.length;
    const draw = () => { const j = Math.floor(rng() * top); const c = deck[j]; deck[j] = deck[--top]; deck[top] = c; return c; };
    const oppHands = [];
    for (let o = 0; o < nOpp; o++) {
      let x = draw(); let y = draw();
      // Resample hands that don't fit what this opponent has shown (a few tries, then accept).
      for (let t = 0; t < 12 && ranges[o] > 0 && chen(x, y) < ranges[o]; t++) {
        top += 2; // put both back and draw again
        x = draw(); y = draw();
      }
      oppHands.push(x, y);
    }
    const full = board.slice();
    for (let i = 0; i < need; i++) full.push(draw());
    me[0] = hole[0]; me[1] = hole[1];
    for (let i = 0; i < 5; i++) { me[2 + i] = full[i]; opp[2 + i] = full[i]; }
    const mine = rank7(me, 7);
    let best = -1; let ties = 0;
    for (let o = 0; o < nOpp; o++) {
      opp[0] = oppHands[o * 2]; opp[1] = oppHands[o * 2 + 1];
      const v = rank7(opp, 7);
      if (v > best) { best = v; ties = 0; }
      if (v === best) ties++;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 1 / (ties + 1);
  }
  return score / iters;
}

// How tight an opponent's range probably is, from what they did this hand.
function rangeFor(p, table, read) {
  if (!read) return 0;
  const bb = table.bb;
  let r = 0;
  if (['raise', 'bet', 'allin'].includes(p.lastAction)) r = 9;
  else if (p.totalBet >= bb * 8) r = 8;
  else if (p.totalBet >= bb * 3) r = 6;
  else if (p.lastAction === 'call') r = 4;
  else if (p.totalBet > bb) r = 3;
  return r * read;
}

// ---------------- the decision ----------------
export function decide(table, seat, profile, rng = Math.random) {
  const legal = table.legalActions(seat);
  if (!legal) return null;
  const p = table.seats[seat];
  const P = profile;
  const opps = table.seats.filter((q, i) => q && i !== seat && q.inHand && !q.folded);
  const nOpp = Math.max(1, opps.length);
  const pot = table.seats.reduce((s, q) => s + (q ? q.totalBet : 0), 0);
  const toCall = legal.toCall;
  const bb = table.bb;
  const preflop = table.street === 'preflop';
  const river = table.street === 'river';

  const hole = p.hole.map(cardInt);
  const board = table.board.map(cardInt);
  const ranges = opps.map((q) => rangeFor(q, table, P.readOpponents)).slice(0, 5);
  let eq = equity(hole, board, ranges.length ? ranges : [0], P.iters, rng);
  if (P.mistakes && rng() < P.mistakes) eq = Math.min(1, Math.max(0, eq + (rng() - 0.5) * 0.4)); // misreads the spot
  const rel = eq * (nOpp + 1); // 1.0 = an average hand in this spot

  // Position: act last after this street's betting = seats between us and the button.
  const inPosition = isLastToAct(table, seat);
  const potOdds = toCall / (pot + toCall);
  const stackAfter = p.stack - toCall;

  const size = (frac) => {
    // "Raise to" amount for a bet of frac × pot (after calling).
    const base = legal.isBet ? 0 : table.currentBet;
    let to = Math.round(base + (pot + toCall) * frac);
    if (preflop && legal.isBet === false && table.currentBet === bb) {
      // Opening pre-flop: 2.5–3.5 BB plus one per limper.
      const limpers = table.seats.filter((q, i) => q && i !== seat && q.inHand && q.bet === bb && i !== table.bbSeat).length;
      to = Math.round(bb * (2.5 + rng()) + limpers * bb);
    }
    to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
    if (to > legal.maxRaiseTo * 0.7) to = legal.maxRaiseTo; // that much in: just go all-in
    return to;
  };
  const pickSize = (bias = 0) => {
    const s = P.sizes;
    const i = Math.max(0, Math.min(s.length - 1, Math.floor(rng() * s.length + bias)));
    return s[i] * P.aggression;
  };
  const raise = (frac) => (legal.canRaise ? { action: 'raise', amount: size(frac) } : null);
  const passive = () => (legal.canCheck ? { action: 'check' } : { action: 'call' });
  const giveUp = () => (legal.canCheck ? { action: 'check' } : { action: 'fold' });

  // ---- nothing to call ----
  if (legal.canCheck) {
    if (rel >= P.raiseRel) {
      if (!preflop && !river && rng() < P.slowplay) return { action: 'check' }; // trap
      return raise(pickSize(1)) || passive();
    }
    if (preflop) {
      // Big blind option (or everyone limped).
      if (rel >= P.preflopOpenRel + 0.2 && rng() < 0.6 * P.aggression) return raise(0) || passive();
      return { action: 'check' };
    }
    if (rel >= P.valueRel && (nOpp <= 2 || rel >= P.valueRel + 0.3)) return raise(pickSize(0)) || passive();
    const drawy = !river && eq >= 0.3 / Math.sqrt(nOpp) && rel < P.valueRel;
    if (drawy && rng() < P.semi) return raise(pickSize(0)) || passive();
    const bluffChance = P.bluff * (inPosition ? 1.6 : 0.8) * (nOpp === 1 ? 1.5 : nOpp === 2 ? 0.8 : 0.3);
    if (rng() < bluffChance) return raise(pickSize(-0.5)) || passive();
    return { action: 'check' };
  }

  // ---- facing a bet ----
  const bigCall = toCall > p.stack * 0.4;
  // Implied odds with a draw: more to win later if we hit.
  const implied = !river && !preflop && stackAfter > toCall * 3 ? 0.04 : 0;
  const need = potOdds - P.callSlack - implied;

  if (rel >= P.raiseRel + (preflop ? 0.1 : 0) && legal.canRaise) {
    if (!preflop && rng() < P.trapCall) return { action: 'call' }; // disguise a monster
    return raise(pickSize(1)) || { action: 'call' };
  }
  if (preflop && table.currentBet === bb) {
    // Unraised pot: open-raise good hands, limp playable ones.
    if (rel >= P.preflopOpenRel && legal.canRaise && rng() < 0.75 * P.aggression) return raise(0) || { action: 'call' };
    if (eq >= need || rng() < P.sticky) return { action: 'call' };
    return { action: 'fold' };
  }
  if (bigCall && rel < 1.3 && P.level !== 'easy' && eq < potOdds + 0.05) return { action: 'fold' }; // don't stack off light
  if (eq >= need) return { action: 'call' };
  if (P.sticky && toCall <= bb * 3 && rng() < P.sticky) return { action: 'call' }; // calling station
  // Occasional bluff-raise heads-up against a small bet.
  if (P.level === 'hard' && nOpp === 1 && toCall < pot * 0.4 && !river && rng() < P.bluff * 0.5) return raise(0.8) || giveUp();
  return giveUp();
}

function isLastToAct(table, seat) {
  // No live player between us and the button (inclusive) still to act after us.
  for (let i = 1; i < table.maxSeats; i++) {
    const s = (seat + i) % table.maxSeats;
    const q = table.seats[s];
    if (q && q.inHand && !q.folded && !q.allIn) {
      // Someone acts after us this street if they sit between us and the button.
      const distBtn = (table.button - seat + table.maxSeats) % table.maxSeats;
      const distQ = (s - seat + table.maxSeats) % table.maxSeats;
      if (distQ <= distBtn) return false;
    }
  }
  return true;
}

// How long the bot "thinks" before acting (ms): quicker for easy, longer for big decisions.
export function thinkTime(table, seat, profile, rng = Math.random) {
  const legal = table.legalActions(seat);
  const pot = table.seats.reduce((s, q) => s + (q ? q.totalBet : 0), 0);
  const base = { easy: 700, medium: 1000, hard: 1200 }[profile.level] || 1000;
  let ms = base + rng() * 1400;
  if (legal && legal.toCall > pot * 0.5) ms += 600 + rng() * 1400;
  return Math.round(ms);
}

// A little table talk now and then.
const LINES = {
  win: ['Ship it!', 'Thanks for the chips.', 'Nice try.', 'I had a feeling.', 'Read you like a book.', 'Come to papa.'],
  bust: ['GG, I’m out.', 'Well, that’s poker.', 'Next time.'],
  rebuy: ['Back for more.', 'Reloading…'],
};
export function botLine(kind, rng = Math.random) {
  const l = LINES[kind];
  return l ? l[Math.floor(rng() * l.length)] : '';
}
