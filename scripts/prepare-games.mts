// Prepares the files in public/games/ for static serving.
//
// Local games used to be rewritten on every request by
// server/middleware/gameAssetInterceptor.ts. That middleware is gone, so the
// same rewrites (popup shim, storage polyfill, dead CDN commit hashes) are
// written into the files once, here. Run this after adding or replacing a game:
//
//   npm run prepare:games

import fs from 'node:fs';
import path from 'node:path';
import { rewriteGameHtml } from '../src/games/htmlRewrite';

const gamesDir = path.join(process.cwd(), 'public', 'games');

if (!fs.existsSync(gamesDir)) {
  console.error(`No games directory at ${gamesDir}`);
  process.exit(1);
}

const ids = fs
  .readdirSync(gamesDir)
  .filter((name) => fs.existsSync(path.join(gamesDir, name, 'index.html')));

let written = 0;
let skipped = 0;

for (const id of ids) {
  const file = path.join(gamesDir, id, 'index.html');
  const html = fs.readFileSync(file, 'utf8');

  const alreadyPrepared =
    html.includes('window.confirm = function() { return false; }') && html.includes('__probe__');

  if (alreadyPrepared) {
    skipped += 1;
    continue;
  }

  const prepared = rewriteGameHtml(html, { baseHref: `/games/${id}/`, stripWidgets: false });
  if (prepared !== html) {
    fs.writeFileSync(file, prepared);
    written += 1;
  }
}

console.log(`prepare:games - ${written} written, ${skipped} already prepared, ${ids.length} games total`);
