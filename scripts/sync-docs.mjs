// Copies the game's scene modules into docs/ so the project site's 3D hero
// uses the exact same table, card and chip code as the game.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['textures.js', 'cards.js', 'chips.js', 'tween.js', 'table.js'];
const dest = path.join(root, 'docs/js/scene');
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(path.join(root, 'public/js/scene', f), path.join(dest, f));
console.log(`Synced ${files.length} scene modules into docs/js/scene`);
