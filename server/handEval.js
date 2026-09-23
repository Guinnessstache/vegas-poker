// Texas Hold'em hand evaluator.
// Cards are 2-char strings: rank "23456789TJQKA" + suit "shdc", e.g. "As", "Td".

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

const RANK_NAMES = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const PLURAL = (r) => (r === 6 ? 'Sixes' : RANK_NAMES[r] + 's');

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

export function rankValue(card) {
  return RANKS.indexOf(card[0]) + 2;
}

// Score exactly 5 cards. Returns { cat, kick: number[] } where kick is the
// ordered tiebreak ranks for that category.
function score5(cards) {
  const ranks = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);

  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) straightHigh = 5; // wheel
  }

  if (straightHigh && flush) return { cat: 8, kick: [straightHigh] };

  // Group by count, then rank.
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);

  if (groups[0][1] === 4) return { cat: 7, kick: byGroup };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { cat: 6, kick: byGroup };
  if (flush) return { cat: 5, kick: ranks };
  if (straightHigh) return { cat: 4, kick: [straightHigh] };
  if (groups[0][1] === 3) return { cat: 3, kick: byGroup };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { cat: 2, kick: byGroup };
  if (groups[0][1] === 2) return { cat: 1, kick: byGroup };
  return { cat: 0, kick: ranks };
}

function toNumber(s) {
  let n = s.cat;
  for (let i = 0; i < 5; i++) n = n * 15 + (s.kick[i] || 0);
  return n;
}

function describe(s) {
  const k = s.kick;
  switch (s.cat) {
    case 8: return k[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[k[0]]} high`;
    case 7: return `Four of a Kind, ${PLURAL(k[0])}`;
    case 6: return `Full House, ${PLURAL(k[0])} full of ${PLURAL(k[1])}`;
    case 5: return `Flush, ${RANK_NAMES[k[0]]} high`;
    case 4: return `Straight, ${RANK_NAMES[k[0]]} high`;
    case 3: return `Three of a Kind, ${PLURAL(k[0])}`;
    case 2: return `Two Pair, ${PLURAL(k[0])} and ${PLURAL(k[1])}`;
    case 1: return `Pair of ${PLURAL(k[0])}`;
    default: return `${RANK_NAMES[k[0]]} High`;
  }
}

function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) {
    cur.push(arr[i]);
    combos(arr, k, i + 1, cur, out);
    cur.pop();
  }
  return out;
}

// Evaluate the best 5-card hand from 5-7 cards.
// Returns { value, cat, name, best } — higher value wins.
export function evaluate(cards) {
  if (cards.length < 5) {
    // Partial board (used for the "your hand" hint before the flop/turn).
    const ranks = cards.map(rankValue).sort((a, b) => b - a);
    const counts = new Map();
    for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    let s;
    if (groups[0][1] === 4) s = { cat: 7, kick: groups.map((g) => g[0]) };
    else if (groups[0][1] === 3) s = { cat: 3, kick: groups.map((g) => g[0]) };
    else if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) s = { cat: 2, kick: groups.map((g) => g[0]) };
    else if (groups[0][1] === 2) s = { cat: 1, kick: groups.map((g) => g[0]) };
    else s = { cat: 0, kick: ranks };
    return { value: toNumber(s), cat: s.cat, name: describe(s), best: cards.slice() };
  }
  let best = null;
  let bestCards = null;
  for (const c of combos(cards, 5)) {
    const s = score5(c);
    const v = toNumber(s);
    if (!best || v > best.value) { best = { ...s, value: v }; bestCards = c; }
  }
  return { value: best.value, cat: best.cat, name: describe(best), best: bestCards };
}

export function freshDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

export function shuffle(deck, rng) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
