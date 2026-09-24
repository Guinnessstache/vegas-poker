// Achievements, shared by the server (which detects them) and the game (which unlocks them).
// `id` is the Steamworks API name: enter these exactly in Steamworks → Stats & Achievements.
// `count` marks achievements tracked by a running total on the player's own PC.
export const ACHIEVEMENTS = [
  { id: 'FIRST_HAND', name: 'Pull Up a Chair', desc: 'Play your first hand.' },
  { id: 'FIRST_WIN', name: 'Winner Winner', desc: 'Win your first pot.' },
  { id: 'SHOWDOWN_WIN', name: 'Show Me What You Got', desc: 'Win a pot at showdown.' },
  { id: 'NERVES_OF_STEEL', name: 'Nerves of Steel', desc: 'Bet or raise on the river and make everyone fold.' },
  { id: 'ALL_IN_WIN', name: 'All the Chips', desc: 'Win an all-in showdown.' },
  { id: 'BIG_POT', name: 'High Roller', desc: 'Win a pot worth 100 big blinds or more.' },
  { id: 'DOUBLE_UP', name: 'Double Up', desc: 'Double your starting stack.' },
  { id: 'COMEBACK', name: 'Comeback Kid', desc: 'Get back to your starting stack after dropping below 5 big blinds.' },
  { id: 'QUADS', name: 'Four of a Kind', desc: 'Win a hand with four of a kind.' },
  { id: 'STRAIGHT_FLUSH', name: 'Straight to the Top', desc: 'Win a hand with a straight flush.' },
  { id: 'ROYAL_FLUSH', name: 'Royalty', desc: 'Win a hand with a royal flush.' },
  { id: 'THE_HAMMER', name: 'The Hammer', desc: 'Win at showdown holding 7-2 offsuit, the worst starting hand.' },
  { id: 'KNOCKOUT', name: 'Knockout', desc: 'Knock a player out of their chips.' },
  { id: 'KNOCKOUT_10', name: 'Table Captain', desc: 'Knock out 10 players.', count: { stat: 'knockouts', target: 10 } },
  { id: 'SHARK_HUNTER', name: 'Shark Hunter', desc: 'Knock out a Hard bot.' },
  { id: 'LAST_ONE_STANDING', name: 'Last One Standing', desc: 'Be the last player with chips at a table that started with 4 or more.' },
  { id: 'FRIENDLY_GAME', name: 'Friendly Game', desc: 'Play a hand with a friend at the table.' },
  { id: 'SAY_CHEESE', name: 'Say Cheese', desc: 'Sit at the table with your camera on.' },
  { id: 'HANDS_100', name: 'Regular', desc: 'Play 100 hands.', count: { stat: 'hands', target: 100 } },
  { id: 'HANDS_1000', name: 'Card Shark', desc: 'Play 1,000 hands.', count: { stat: 'hands', target: 1000 } },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
