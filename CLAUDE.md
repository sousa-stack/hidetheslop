# Hide the Slop: guide for agents

A Chrome, Firefox and Edge (Manifest V3) extension, with Safari planned for launch, that hides AI-generated posts, pictures and ads, plus a small API that pools ratings between people without collecting personal data or browsing history. Personal open-source project by Kevin Sousa (GitHub `sousa-stack`), heading for a public launch at hidetheslop.com. User-facing docs are in [README.md](README.md). This file is for whoever works on the code next.

The name is **Hide the Slop** everywhere. Older notes may say "stoptheslop"; don't use that.

Read these before changing things:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces talk to each other, storage keys, the picture classifier.
- [docs/TESTING.md](docs/TESTING.md): every test, and how to test the installed extension on real Facebook.
- [docs/ROADMAP.md](docs/ROADMAP.md): **start with "Where things stand"**: what's live, what's never been run, the order of work and open questions.
- [docs/CROWD-API.md](docs/CROWD-API.md): the privacy promises, the API design, how the project pays for itself, and going live.
- [CHANGELOG.md](CHANGELOG.md): what each version changed and why.

## Repo rules (the owner's, not suggestions)

- **Never commit `test-images/`.** It holds real people's Facebook posts. Only their 512-number embeddings ship (`extension/src/vision-examples.json`). `.gitignore` covers it; check `git status` before every commit anyway.
- **Commit and push only when Kevin asks.** So far he has chosen to work directly on `main`.
- **Use `gh` here, only as `sousa-stack`.** For this repo, this replaces the no-`gh` rule in Kevin's global `CLAUDE.md`; that rule still applies everywhere else. This Mac has other `gh` accounts signed in, so run `gh api user --jq .login` first and stop if it doesn't say `sousa-stack`. Pass `--repo sousa-stack/hidetheslop`, and never switch accounts.
- **Push with plain git over SSH.** The remote is `git@github.com:sousa-stack/hidetheslop.git`, which uses his personal key through the plain `github.com` host.
- **Commit identity is set in this repo only,** in its own git config. His global git identity is for other work, so never change the global config or commit from another checkout.
- End commit messages with the `Co-Authored-By:` line the session asks for. Commit messages here are a short summary plus a bullet list of what changed and why.
- **Ask before downloading anything** (models, npm packages, Docker images), saying the name, the source and the size.
- **The same repo holds the extension, the API and the infra.** Secrets stay out, as does `test-images/`. It's private until launch, then public.

## Layout

```
extension/          the extension
  src/              source; loaded as-is, no bundler
  build.mjs         writes dist/chrome and dist/firefox (+ zips) and dist/safari; holds the version number
  test/             unit test, fake-feed harness, live page, settings preview
  tools/            make_icons.sh (icons from brand/logo-1024.png)
api/                the server: Fastify, TypeScript, Drizzle, Postgres
  src/              routes/, db/schema.ts, jobs/aggregate.ts, config.ts, block.ts (the block list command)
  drizzle/          generated migrations, committed
  test/             tests against a real Postgres
safari/             the Mac app that carries the Safari extension: an Xcode project whose Run Script
                    (build-extension.sh) builds dist/safari into it. Shared.xcconfig holds the
                    bundle IDs and versions; the team ID is in Local.xcconfig, which isn't in git
site/               hidetheslop.com and the privacy policy
  worker.js         answers Safari's origin check at /.well-known/origin-check, and nothing else
  public/           the pages; poster.css and the logo come from extension/src at build time
  build.mjs         writes dist/; wrangler.jsonc deploys it
  tools/            optimize_images.py (small WebP files from originals/, which isn't in git)
docker-compose.yml, Caddyfile, deploy.sh, harden.sh, backup.sh, restore.sh   production
scripts/            local-stack.sh (proves the production stack on this Mac), backup-rclone.sh (shared by backup.sh and restore.sh)
.github/workflows/  tests the API and deploys it
eval/               scripts that compared detectors, train the picture classifier and measure the hash
brand/              the logo and its source, made by Kevin from two SVG Repo icons (see brand/README.md). Not under MIT. Don't replace it with generated art
test-images/        private example pictures (ai/, real/). Not in git
docs/               architecture, testing, roadmap
```

## Build and check

```bash
cd extension && node build.mjs                 # builds every browser (node build.mjs safari: just one)
cd extension && node --test test/votes.test.mjs test/crowd.test.mjs # the vote client and the crowd's list
cd extension && node --test test/meta.test.mjs test/download.test.mjs test/phash.test.mjs # detector, model download and hash tests
cd api && npm run typecheck && ./scripts/test-local.sh # API tests on a throwaway Postgres
cd site && node build.mjs && node --test worker.test.mjs # builds the website into dist/, tests the origin check
```

The extension has no linter or CI yet; that's on the roadmap. The API is tested by `.github/workflows/deploy.yml`. `dist/` is ignored. Bump `version` in `extension/build.mjs` for every user-visible change.

To load it: Chrome uses `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/chrome`. Firefox uses `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension/dist/firefox/manifest.json`. After a rebuild in Chrome, press the reload arrow on the card, then reload the page you're testing. Safari needs the app: copy `safari/Local.xcconfig.example` to `safari/Local.xcconfig` with the team ID, build the **Hide the Slop** scheme (docs/TESTING.md has the `xcodebuild` line), open the app once, and Kevin ticks it in Safari → Settings → Extensions. Agents can build, sign and `open` the app, but can't tick it on or grant site access.

## Code conventions

- Plain JavaScript, no build step, no dependencies in the extension. Shared code is a `var` global in its own file (`SLOP_API`, `SlopMeta`, `SlopTrain`, `SlopVision`, `SlopVotes`), listed in the right order in the manifest or HTML.
- The same source runs in every browser. Tell them apart with `slopIsFirefox()` and `slopIsSafari()` from `common.js`, never the user agent. Use `SLOP_API` (that's `browser`, or else `chrome`) and promise-style calls. For `onMessage` replies, call `sendResponse` and `return true`; don't return a promise.
- Comments explain *why* in a sentence or two, in the voice of the existing code. Match the surrounding density.
- Page UI we inject (bars, the hover button) lives in shadow DOM, so site CSS can't touch it. Never modify the page's own images.
- Settings defaults are in `extension/src/common.js`. A new setting needs a default there and a control in `options.html`/`options.js`. The options page wires every `input[data-key]` checkbox automatically.
- The popup, welcome and Settings pages share a printed-poster look that Kevin chose: amber, paper, ink and the logo's red `#c80000`, with big condensed words, ruled rows and flat color. No dotted, halftone or speckled textures, which Kevin ruled out as an AI slop tell. It's in `extension/src/poster.css`, with one extra stylesheet per page, and it deliberately ignores dark mode.
- User-facing copy says "you" and "your", never "we" or "our". It's open source, and people should feel they own it, not that they're customers of a service. The picture check is "your robot", and it's fine to be playful about it.
- Extension pages never load web fonts, because that would send a request nobody agreed to. The poster look uses condensed fonts people already have.

## API rules

The extension's conventions above don't apply here: `api/` is TypeScript with a build step and dependencies.

- **Privacy comes first.** The API stores perceptual hashes, votes, per-image tokens and, for pictures rated from 3 or more installs, embeddings. It never stores or logs URLs, image bytes, user identities or IP addresses. IPs stay in memory for rate limiting only. Never add a per-image lookup, a voter ID, vote timestamps, sequential ids on stored rows, or anything linking one vote to another. Never log a database error's message, because Drizzle puts query values in it. If a feature needs any of this, stop and ask Kevin.
- **Never sell votes or the dataset.** Chrome's Limited Use policy bans it, and the promise in `docs/CROWD-API.md` depends on it.
- Fastify, and every route declares a Zod schema through `fastify-type-provider-zod`. Use strict objects, so a field like `url` is rejected instead of ignored.
- Drizzle and Postgres. The schema is `api/src/db/schema.ts`. Generate migrations with `drizzle-kit generate` and commit them. Never hand-edit the database.
- Migrations only ever add things, because a rollback restores code and not the database. Removing something takes a later release.
- No raw SQL string interpolation. Use Drizzle's query builder or `sql` tagged templates.
- TypeScript strict mode stays on. No `any`, no `@ts-ignore`.
- Adding a dependency needs a reason in the commit message and Kevin's OK.
- **Use the latest stable version of everything:** packages, Node LTS, Postgres and Docker images. `npm audit --omit=dev` must stay clean.
- Public routes are rate limited. There's no CORS plugin, on purpose: the extension calls from its background, which doesn't need it. If the website ever needs the API, use an explicit allowlist, never `origin: true` or `*`.
- Postgres is never exposed on a host port. The API is only reachable through Caddy.
- Secrets live in `.env` on the server and in GitHub Actions secrets. Never in code, tests or logs.

## Production

**Live on Cloudflare:** the website and the model. **Live on the droplet:** the API and the status page, behind Cloudflare. The extension doesn't call the API yet. `docs/CROWD-API.md` has Kevin's going-live checklist.

- The domain is registered at Hostinger, where it renews, and its DNS is on Cloudflare.
- **Website:** the `hidetheslop-site` Worker. Run `node build.mjs` in `site/`, then `npx wrangler@4.156.0 deploy`. Its one script, `worker.js`, runs only for Safari's origin check, with observability off so nothing it sees is logged. Only deploy when Kevin asks. It uses his `wrangler login` on this Mac, so a logged-out session needs him to log in again.
- **Model:** the `hidetheslop-models` R2 bucket, at `models.hidetheslop.com`. A new model version needs a new key and a new hash in `vision.js`, because the file is cached forever.
- **Email:** `hello@hidetheslop.com` forwards through Cloudflare Email Routing.
- The Cloudflare connector can read the account and search the docs, but it can't change DNS, deploy, or connect domains.
- This Mac runs Docker through Colima, and `docker compose` is the Homebrew plugin. Other projects' containers run here too, so test the stack with `scripts/local-stack.sh`, and never run `deploy.sh` or `docker image prune` in this checkout.

Once the droplet exists:

- The host is the `DEPLOY_HOST` GitHub secret, the user is `deploy`, and the app directory is `~/hidetheslop`.
- Pushing API or infra changes to `main` tests them, and deploys once the `DEPLOY_ENABLED` repo variable is `true`. Don't SSH in to fix something that should be a commit.
- `~/hidetheslop/deploy.sh main` deploys, and rolls the code back if the health check fails.
- Logs: `docker compose logs --tail=200 api`. Status: `docker compose ps`, `docker stats --no-stream`, `df -h`. Database shell: `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'`.
- **Fine without asking:** reading logs, `docker compose ps`, restarting `api`, running `deploy.sh`, read-only SQL (`SELECT`), and `docker compose exec -T api node dist/block.js list`.
- **Never without Kevin's explicit OK:** `docker compose down -v`, deleting volumes, manual `DROP`/`DELETE`/`TRUNCATE`, changing the firewall or sshd config, editing `.env`, `rm -rf` anything, installing system packages, changing DNS or Cloudflare settings, or `block.js block` and `block.js unblock`, which change what every install hides (`unblock` also deletes a row). The runbook is in `docs/CROWD-API.md`.

**Weekly health check:** SSH in and report disk use, memory, container health, API errors over the last 7 days, the `fail2ban-client status sshd` ban count, pending apt updates, the newest backup and the last successful deploy. Flag anything unusual, and change nothing.

## Things that have bitten us

- **Facebook changes its markup.** Feed posts are `div[data-virtualized]`; offscreen ones are empty placeholders with `data-virtualized="true"`. The old `aria-posinset` and `role="article"` markers mostly don't match the feed any more. Feed ads say "Ad" through a hidden `aria-labelledby` target, or spell "Sponsored" as jumbled one-letter fragments. Site rules are the `SITES` list at the top of `content.js`. When a site breaks, look at its real DOM (see docs/TESTING.md) before guessing.
- **Chrome's service worker can't run the model.** It runs in `offscreen.html`, while Firefox runs it in the background page. Both paths have to be tested.
- **Firefox stops the background page after 30 idle seconds and never frees WebAssembly memory that lived in it.** That leaked 12 GB until 1.5.1. Keep `ort.env.wasm.proxy = true` in `vision.js`, so the model runs in a worker whose memory goes when the page does. Activity Monitor can hide this kind of leak, because the memory gets compressed.
- **Safari's strip rule isn't on just because it says so.** In the spike a `strip-origin` ruleset listed as enabled still let `safari-web-extension://<uuid>` through, until the rulesets were switched at runtime. So Safari re-arms it at every background start (`slopArmStrip()`) and proves it with the canary to `hidetheslop.com/.well-known/origin-check` before `allowed()` or `listAllowed()` say yes (`slopStripReady()`). Never shortcut that with `getEnabledRulesets()`, and never send the canary on waking, which would follow browsing.
- **Safari grants site access per site, and reports none at install.** Its per-site list only has sites you've visited, so in practice only "allow on all websites" works. A failed permission check counts as no on Safari (`slopCanSeeSites()`), and votes and the list need access to the API's host and the website's.
- **Firefox doesn't draw `::before` on `<input>`.** That's why the Settings switches are drawn with a gradient.
- **Phone photos can carry location data.** Run published pictures through `site/tools/optimize_images.py`, which strips metadata and keeps them small.
- **The in-app browser pane, when hidden, doesn't report what's on screen**, so IntersectionObserver never fires. The harness replaces IntersectionObserver for this reason. Treat timing numbers from a hidden pane as meaningless.
- **Browsers cache the test server's files.** Use a new port, or the cache-busting in `test/options-preview.html`, when a change "doesn't show up".
- The classifier was trained on stills, so videos need at least 90% confidence (`MIN_VIDEO_SCORE` in `content.js`).
- `content.js` reads `globalThis.__slopTestHost` so the harness can pretend to be Instagram. Content scripts run in an isolated world, so real pages can't set it.
