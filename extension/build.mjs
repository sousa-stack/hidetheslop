// Builds dist/chrome and dist/firefox (+ zips) from src/.
// They differ only in the manifest: how the background runs (and so where the image
// model runs), and Firefox's add-on id.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = '1.3.0';

const base = {
  manifest_version: 3,
  name: 'Hide the Slop',
  version,
  description: 'Hides AI-generated images, posts and ads: site AI labels, AI hashtags, and AI metadata inside images.',
  permissions: ['storage', 'contextMenus'],
  host_permissions: ['http://*/*', 'https://*/*'],
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['common.js', 'meta.js', 'content.js'],
      css: ['content.css'],
      run_at: 'document_idle',
      all_frames: true, // ad iframes are where a lot of the slop lives
    },
  ],
  action: {
    default_title: 'Hide the Slop',
    default_popup: 'popup.html',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
  },
  options_ui: { page: 'options.html', open_in_tab: true },
  // The image model runs as WebAssembly.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
};

const targets = {
  chrome: {
    ...base,
    permissions: [...base.permissions, 'offscreen'], // runs the image model (see offscreen.html)
    background: { service_worker: 'background.js' },
  },
  firefox: {
    ...base,
    background: { scripts: ['common.js', 'meta.js', 'train.js', 'ort/ort.wasm.min.js', 'vision.js', 'background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'hidetheslop@hidetheslop.com',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

rmSync('dist', { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const dir = `dist/${name}`;
  mkdirSync(dir, { recursive: true });
  cpSync('src', dir, { recursive: true });
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('zip', ['-qr', `../hidetheslop-${name}-${version}.zip`, '.'], { cwd: dir });
  console.log(`built ${dir} and dist/hidetheslop-${name}-${version}.zip`);
}
