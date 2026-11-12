# Going public, with auto-deploys

Written 2026-11-12. Kevin wants the repo public on GitHub and deploys to happen from pushes, with nothing secret or personal exposed. This follows "Going public" in `docs/ROADMAP.md`.

Every step that's hard to undo waits for Kevin's yes in the chat: the history rewrite, the force-push, making the repo public, and anything that grants access.

## What's there now

- **31 commits, all authored as Kevin's personal Gmail.**
- **Current files:** pattern searches found no secrets and none of the personal strings below.
- **Old versions of files** contain Kevin's Gmail 4 times, a Chrome profile name twice, a local path twice and his employer's name 4 times.
- **None anywhere in history:** private keys, AWS, GitHub or OpenAI-style tokens, passwords, the droplet's IP, the Cloudflare account ID or the Apple team ID.
- `.env`, `safari/Local.xcconfig`, `test-images/`, `.local/` and build output are all gitignored. The droplet's `.env` never left the droplet.
- The workflow only runs on pushes to `main` and by hand, never on pull requests, so a fork's pull request can't reach the deploy secrets.

## 1. A real secret scan

- Install `gitleaks` (Homebrew), with Kevin's OK for the download. Run `gitleaks git --redact` over the whole history and `gitleaks dir --redact` over the working tree, including ignored files, to see what would leak if one were ever committed.
- Search history again for anything personal: Kevin's emails and names, the Chrome profile name, employer names, local paths, the droplet IP, account IDs and the team ID. Report what's found, as counts and file paths, never the values.

## 2. Rewrite history, once

The repo has one contributor, so rewriting is safe now and won't be later.

- **Kevin's decision:** the address commits show. The recommendation is GitHub's private no-reply address for `sousa-stack`, `263780913+sousa-stack@users.noreply.github.com`, so the Gmail never appears.
- Install `git-filter-repo` (Homebrew), with Kevin's OK.
- Take a full backup first: `git bundle create` of all refs, outside the repo, kept until Kevin's sure the rewrite is right.
- Use `--mailmap` for the author and committer, and `--replace-text` for each personal string found in step 1, replaced with something neutral such as `[removed]`.
- Rerun step 1's searches on the rewritten history, which must find nothing.
- Set this repo's own `user.email` to the no-reply address, so new commits match. The global config isn't touched.
- **Force-push `main`, with Kevin's yes.** Old commit SHAs go away. The droplet's checkout and any other clone need re-cloning or a hard reset to the new `main`. The droplet re-clones with its existing read-only key, and its `.env` and backups are untouched.

## 3. Files a public repo needs

- `SECURITY.md`: how to report a problem privately (hello@hidetheslop.com), what's in scope (the extension, the API, the site), and that the API stores no personal data.
- **README:** the accuracy numbers can't be reproduced from a clone, because `test-images/` stays private. Say the same in `eval/README.md`.
- `vision-examples.json` stays: it ships inside the extension anyway, so it's public once the extension is. It's numbers, not pictures.
- Check that `brand/README.md` still says the logo isn't under MIT.

## 4. Make it public (Kevin)

- In GitHub, under Settings → General → Danger Zone → Change visibility. That's Kevin's click, after the force-push.

## 5. Right after it's public

Through `gh` as `sousa-stack`, with Kevin's OK, or by Kevin in Settings:

- **Protect `main`:** no force-pushes or deletion. Kevin keeps working directly on `main`, so no required pull requests.
- **Turn on secret scanning and push protection,** so a secret is refused at push time.
- **Turn on Dependabot alerts.**
- Turn off wikis and projects if they aren't wanted, and set the description and homepage.

## 6. Auto-deploys

- A new key used only by GitHub Actions, generated on this Mac. Its public half goes into the droplet's `authorized_keys` for `deploy`, restricted with `restrict,command="$HOME/hidetheslop/deploy.sh main"`, so a stolen copy can only run a deploy, not get a shell.
- **The GitHub side is Kevin's,** in Settings → Secrets and variables → Actions:
  - `DEPLOY_HOST`, the droplet's IP
  - `DEPLOY_SSH_KEY`, the private half, pasted from the clipboard and never shown in chat
  - `DEPLOY_HOST_FINGERPRINT`, the droplet's SSH host key fingerprint
  - the variable `DEPLOY_ENABLED=true`

  Granting access was refused to the assistant once before, and that refusal stands.
- Delete the private half from this Mac once it's in GitHub.
- Prove it works: run the workflow by hand from the Actions tab, and confirm the droplet deployed the same commit.
- Update `CLAUDE.md`'s Production section to say deploys now happen from pushes.

## Not in this

The store listings, the Mac App Store submission (its own plan), and any change to what the extension or API does.

## Changes after review (these override anything above)

A review on 2026-11-12 found these problems. Where this section and the parts above disagree, this section wins.

**A new repo, not a force-push.** GitHub keeps old commits reachable by SHA after a force-push, along with old Actions logs and commit pages, and purging them takes a GitHub Support request. Since there are no forks, issues or stars yet, this is cleaner:
- After the rewrite, Kevin deletes `sousa-stack/hidetheslop` on GitHub and creates a fresh, empty, private repo with the same name.
- Push the rewritten `main` to it. The SSH remote URL is unchanged, so the droplet's remote still points at the right place.
- Deleting the old repo is Kevin's yes, then Kevin's click.

**How the rewrite runs:**
- Run `git-filter-repo` in a fresh `git clone --no-local` made from the bundle, never in the working checkout.
- Use `--mailmap` for the one identity, and `--replace-text` and `--replace-message` with the same rules file, so commit messages are scrubbed too.
- Match the employer's name as a whole word, with a word-boundary regex.
- Push `main` only. A local branch from an old agent worktree carries the employer's name in its own name, so delete it and its worktree before pushing.
- The rules file and the bundle live outside the repo, in the session scratchpad, because they hold the strings.
- The `Co-Authored-By: Claude` lines in commit messages stay.

**This plan file and every committed doc** describe the personal strings without spelling them out, so the "must find nothing" check holds.

**The droplet's checkout:** `deploy.sh` does `git pull --ff-only`, which fails on rewritten history. Before the first deploy after the push, run `git fetch origin && git reset --hard origin/main` in `~/hidetheslop`. That's not a re-clone, because `.env` and the backups live there. Once the repo is public, the droplet can pull over HTTPS and the read-only deploy key can be retired.

**The deploy key:**
- `authorized_keys` uses an absolute path: `restrict,command="/home/deploy/hidetheslop/deploy.sh main" ssh-ed25519 …`. The workflow's `script:` is then ignored but must stay non-empty, so add a comment saying so.
- Put the three secrets in a GitHub Environment named `production`, limited to the `main` branch, and add `environment: production` to the deploy job.
- Test the key once from this Mac with `ssh -i <key> -o IdentitiesOnly=yes`. fail2ban bans after 3 failed tries, so test carefully.

**More GitHub settings:**
- Actions: require approval for all outside collaborators, and a read-only default `GITHUB_TOKEN`.
- Add `.github/dependabot.yml` for `github-actions` and `npm`, because alerts alone don't update pinned actions.
- Turn on private vulnerability reporting, alongside `SECURITY.md`.

**Order:**
1. Scan.
2. Rewrite.
3. Kevin deletes and recreates the repo.
4. Push.
5. Reset the droplet's checkout.
6. The deploy key and the `production` environment.
7. A manual `workflow_dispatch` deploy that succeeds.
8. Only then, `DEPLOY_ENABLED=true`.
9. `SECURITY.md`, README notes, `dependabot.yml`, then make it public.
10. In the same sitting: protect `main`, and turn on secret scanning, push protection, Dependabot and private reporting.
