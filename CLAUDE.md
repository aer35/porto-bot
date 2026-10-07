### Infrastructure

- **SQLite**, single file on a mounted Docker volume.
- **Schema migrations** run on boot: `PRAGMA user_version` plus numbered `.sql` files. No ORM. Only files numbered above a database's `user_version` run, so number a new file above every migration on `main` when you merge, not just when you branch; one numbered lower never runs on a live install.
- **Docker Compose** with a `dev` profile that bind-mounts `./src` and runs `tsx watch` for live reload; production runs the built image.
- **Price data** comes from Yahoo Finance's public chart endpoint, `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>`, called with the built-in `fetch`; the price is `chart.result[0].meta.regularMarketPrice`, and the day's move is that minus `meta.chartPreviousClose`. It needs no key or account, and no library, but it is unofficial and undocumented: Yahoo publishes no rate limit, answers HTTP 429 when it throttles, and can change or block it without notice. So prices are fetched after each 17:00 New York close (and at startup if that one was missed), one symbol at a time with a 10 s timeout, into a `prices` table that commands read; nothing blocks on the network, and nothing the fetch throws reaches the bot. A failed fetch is recorded so views show `-` for its price, value and P/L rather than nothing, and the bot's status shows `API: 🟢`/`🔴` from a check every 10 minutes. Everything runs in the bot's own process: one container, no sidecar or cron. Symbols are Yahoo's: stocks as listed but with `-` for a share class (`BRK.B` → `BRK-B`), crypto as `BTC-USD`, and options in OCC form without padding (`AAPL260116C00150000`: root, `YYMMDD`, `C`/`P`, strike × 1000 in 8 digits). Stocks and crypto are required to price; options are best effort, and a contract Yahoo has no data for shows `-` and is counted at cost.
- **GitHub Actions** builds and pushes to GHCR on every merge to `main`. A `VERSION` file at the repo root holds `MAJOR.MINOR.PATCH`, and a `-beta` suffix publishes a GitHub pre-release. Only a new `MAJOR.MINOR` creates a release; a patch is appended to the release it fixes as a "Patches" bullet, and still ships `latest`, `sha-<short>` and its exact version tag. Change `VERSION` in the same PR as the work it releases.

## Engineering

### Approach

**Test-driven development.** Write the failing test first, then the code that makes it pass. This matters most for replay validation, average-cost math, and split application — the places where a silent bug produces a plausible-looking wrong number.

**Keep it simple.** Prefer the shortest thing that works. Prefer the standard library over a dependency, and a native Discord feature over custom code. Do not add abstraction for a second use case that does not exist yet.

**Small commits.** Commit after each logical unit of work, not at the end of a feature.

**One pull request per version.** Each version (V1, V2, …) is built on its own branch and opened as a single PR against `main` for manual review. Keep commits inside that PR small. **Never push to or merge into `main` unless explicitly told to.** Pushing the version branch is fine.

**Issues are atomic.** One issue is one reviewable, mergeable unit of work. When several issues share groundwork or one only makes sense after another, file a parent issue and link the others under it as sub-issues (GitHub's native parent/sub-issue and blocked-by relations, not just a text mention) rather than writing one large issue that bundles them. A parent issue that turns out large enough to be its own reviewable unit gets its own PR regardless of which version milestone it's tagged with — it does not have to wait for the rest of that milestone.

**Periodic ponytail reviews.** Run a ponytail review (`/ponytail-review` on a diff, `/ponytail-audit` on the repo) at the end of each major piece of work and before opening the PR, to catch over-engineering while it is still cheap to delete.

### Comments

Most code needs no comments. Write comments where code is strange, non-obvious, or non-standard, and explain *why*, not *what*.

Always comment:
- **SQL queries** — what the query returns and why it is shaped that way.
- **Large or non-obvious variables** — what they hold and where they came from.
- **Deliberate shortcuts** — note the limitation and what would replace it.

Someone who has never opened this codebase should be able to read a file and modify it safely.

### Configuration

All secrets and configuration live in a `.env` file at the repo root, never committed. A `.env.example` **is** committed and is the documentation for it: every line commented with what the value is, why it is needed, and where to obtain it.

### Documentation

`README.md` is for the person hosting the container and contains only what they need: how to get an image, what to put in `.env`, how to start it, where the data lives, and how to back it up. It is not a wiki. Implementation detail belongs in the code, or in this file.

`CLAUDE.md` is for development information that every agent needs to know. Descriptions, plans, and situation information can be found elsewhere like the `README.md`, Repo, and issues.