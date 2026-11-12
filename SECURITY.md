# Security

If you find a security problem in Hide the Slop, please report it privately rather than in a public issue.

**How:** use GitHub's **Report a vulnerability** button on this repo's Security tab, or email hello@hidetheslop.com. Say what you found, how to reproduce it, and what it could affect. You'll get a reply within a few days.

**In scope:**
- the browser extension, in `extension/` and `safari/`
- the API at api.hidetheslop.com, in `api/`, and its server setup: `Caddyfile`, `docker-compose.yml`, `deploy.sh`, `harden.sh`, `backup.sh`, `restore.sh`
- the website at hidetheslop.com, in `site/`

**Especially welcome:** anything that would let someone link votes to a person, recover a browsing history, read stored data the [privacy policy](https://hidetheslop.com/privacy) says isn't kept, forge verdicts at scale, or get past the rate limits.

**What the API holds:** perceptual hashes, votes, per-picture vote codes, and, for pictures rated from 3 or more installs, a 512-number summary of the picture. No accounts, emails, IP addresses, URLs or pictures are stored. `docs/CROWD-API.md` explains the design and its limits.

Please don't test against other people's data, and don't run load tests against the live API. Running it yourself is covered in `docs/TESTING.md`.
