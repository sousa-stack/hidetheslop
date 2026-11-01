// Builds dist/ for hidetheslop.com: the pages in public/, plus the shared look and
// logo from the extension, so the site and extension can't drift apart.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
mkdirSync('dist/icons');
cpSync('../extension/src/poster.css', 'dist/poster.css');
for (const file of ['logo-480.png', 'icon-32.png', 'NOTICE.txt']) {
  cpSync(`../extension/src/icons/${file}`, `dist/icons/${file}`);
}
console.log('built site/dist');
