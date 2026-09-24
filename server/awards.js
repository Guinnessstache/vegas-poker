// Works out which achievements each seat earned in the hand that just finished.
// Called once per hand, after the pot is awarded and before the table is cleaned up.
// The game on each player's PC does the actual unlocking (on their own Steam account).
import { evaluate } from './handEval.js';

/**
 * @param {import('./poker.js').Table} table  finished hand (handOver, not yet cleaned up)
 * @param {object} ctx
 * @param {number} ctx.startingStack
 * @param {(seat: number) => boolean} ctx.isHuman
 * @param {(seat: number) => string|null} ctx.botLevel
 * @param {number} ctx.peakSeated  most players dealt into one hand at this table
 * @returns {Map<number, { ids: Set<string>, stats: { hands: number, knockouts: number } }>}
 */
export function handAwards(table, ctx) {
  const out = new Map();
  const get = (s) => {
    if (!out.has(s)) out.set(s, { ids: new Set(), stats: { hands: 0, knockouts: 0 } });
    return out.get(s);
  };
  const res = table.lastResults;
  if (!res) return out;
  const seats = table.seats;
  const inHand = seats.map((p, i) => (p && p.inHand ? i : -1)).filter((i) => i >= 0);
  const humans = inHand.filter((s) => ctx.isHuman(s)).length;

  for (const s of inHand) {
    const a = get(s);
    a.stats.hands = 1;
    a.ids.add('FIRST_HAND');
    if (humans >= 2 && ctx.isHuman(s)) a.ids.add('FRIENDLY_GAME');
  }

  const won = new Map();
  for (const w of res.winners) won.set(w.seat, (won.get(w.seat) || 0) + w.amount);
  const showdown = !res.uncontested;
  const allInShowdown = showdown && inHand.some((s) => !seats[s].folded && seats[s].allIn);

  for (const [s, amount] of won) {
    const p = seats[s];
    const a = get(s);
    a.ids.add('FIRST_WIN');
    if (amount >= table.bb * 100) a.ids.add('BIG_POT');
    if (showdown) {
      a.ids.add('SHOWDOWN_WIN');
      if (allInShowdown) a.ids.add('ALL_IN_WIN');
      const e = evaluate([...p.hole, ...table.board]);
      if (e.cat === 7) a.ids.add('QUADS');
      if (e.cat === 8) a.ids.add('STRAIGHT_FLUSH');
      if (e.name === 'Royal Flush') a.ids.add('ROYAL_FLUSH');
      const [c1, c2] = p.hole;
      if (c1 && c2 && [c1[0], c2[0]].sort().join('') === '27' && c1[1] !== c2[1]) a.ids.add('THE_HAMMER');
    } else if (table.street === 'river' && ['bet', 'raise', 'allin'].includes(p.lastAction)) {
      a.ids.add('NERVES_OF_STEEL');
    }
  }

  // Knockouts: a player lost their last chip; credit whoever won a pot they were in.
  const busted = inHand.filter((s) => seats[s].stack === 0);
  for (const b of busted) {
    const creditors = new Set();
    for (const w of res.winners) {
      if (w.seat === b) continue;
      const pot = res.pots && w.pot !== undefined ? res.pots[w.pot] : null;
      if (!pot || pot.eligible.includes(b)) creditors.add(w.seat);
    }
    for (const c of creditors) {
      const a = get(c);
      a.stats.knockouts++;
      a.ids.add('KNOCKOUT');
      if (ctx.botLevel(b) === 'hard') a.ids.add('SHARK_HUNTER');
    }
  }

  for (const s of inHand) if (seats[s].stack >= ctx.startingStack * 2) get(s).ids.add('DOUBLE_UP');

  const alive = seats.map((p, i) => (p && !p.leaving && p.stack > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1 && busted.length && ctx.peakSeated >= 4) get(alive[0]).ids.add('LAST_ONE_STANDING');

  return out;
}
