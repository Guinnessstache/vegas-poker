// Writes steam/ACHIEVEMENTS.md: what to enter in Steamworks → Stats & Achievements.
//   node tools/achievements-sheet.mjs
import { writeFileSync } from 'node:fs';
import { ACHIEVEMENTS } from '../public/js/achievements.js';

const rows = ACHIEVEMENTS.map((a, i) => `| ${i + 1} | \`${a.id}\` | ${a.name} | ${a.desc} | \`${a.id}.jpg\` / \`${a.id}_locked.jpg\` |`);
writeFileSync(new URL('../steam/ACHIEVEMENTS.md', import.meta.url), `# Steam achievements

Enter these in **Steamworks → your app → Edit Steamworks Settings → Stats & Achievements → Achievements**,
then **Publish** (Steamworks changes don't go live until published).

For each row: *New Achievement* → API Name, Display Name, Description, and upload the two icons from
\`steam/achievements/\` (achieved = \`NAME.jpg\`, unachieved = \`NAME_locked.jpg\`, 64×64).
Leave "Hidden" off and "Set by" = Client. No Steam stats are needed: running totals are kept by the game.

The API Name must match exactly; the game unlocks achievements by these names
(list lives in \`public/js/achievements.js\`; regenerate this file with \`node tools/achievements-sheet.mjs\`,
icons with \`python tools/make-achievement-icons.py\`).

| # | API Name | Display Name | Description | Icons |
|---|---|---|---|---|
${rows.join('\n')}

![preview](achievements/_preview.png)
`);
console.log('wrote steam/ACHIEVEMENTS.md with', ACHIEVEMENTS.length, 'achievements');
