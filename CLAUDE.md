# porto-bot

## Overview

porto-bot is a Discord bot, distributed as a Docker container, that stores and serves a mock stock portfolio for each member of a Discord server.

It is **paper trading only**. No real money, no real orders, no brokerage connections. Users type in the trades they made elsewhere, and the bot keeps the ledger. The goal is to make it easy for a group of friends to track and share their positions and trade history in one place, without anyone logging into a brokerage or screenshotting an app.

The bot is **single tenant**: each Discord server owner runs their own instance. There is no cross-server data, no shared database, and no hosted version. Everything a user enters is visible to everyone else with access to the bot — this is a public, shared tracker, not a private account.

Design bias throughout: the bot tracks what users tell it. It does not validate against reality, does not enforce financial accuracy, and does not model cash. If a user enters something wrong, they fix it with `/amend` or `/delete`.

## V1 Features

### Accounting model

- **Average cost.** A buy blends the position's average cost; a sell reduces share count and leaves average cost unchanged.
- **Whole shares only.** Share quantities are integers. Prices are decimals.
- **Immutable-ish ledger.** Every action is a row in a single `transactions` table. Positions are *derived* by replaying the ledger — there is no stored position table that can drift out of sync.
- **Replay validation.** `/buy`, `/sell`, `/amend`, `/delete`, and `/split` all apply their change to a hypothetical ledger first. If the result would leave any ticker with negative shares, the action is rejected. A user can never sell more than they own, and can never edit history into an invalid state.

### Commands

| Command | Arguments | Visibility |
|---|---|---|
| `/portfolio` | `user` (optional, defaults to caller) | Public |
| `/position` | `ticker` (required), `user` (optional) | Public |
| `/buy` | `ticker`, `shares`, `price`, `date` (optional) | Public on success |
| `/sell` | `ticker`, `shares`, `price`, `date` (optional) | Public on success |
| `/amend` | `id` (transaction reference, e.g. `BS01`) → opens prefilled modal | Ephemeral while editing, public on success |
| `/delete` | `id` (transaction reference, e.g. `BS01`) → Confirm/Cancel buttons | Ephemeral |
| `/clear` | `ticker` (required) → modal, type ticker to confirm | Ephemeral |
| `/reset` | `user` (required) → modal confirm | Ephemeral |
| `/split` | `ticker`, `ratio` as `X:Y` | Public |

**`/portfolio`** — Renders two tables: current holdings (ticker, shares, average cost) and the user's last ~10 transactions. The transaction cap keeps the bot from flooding a channel; `/position` is how a user sees more.

**`/position`** — All transactions for one ticker, each row showing its transaction reference so it can be amended or deleted, above a one-row table of the current holding. Paginated.

**`/buy` / `/sell`** — Price is per share. `date` accepts `YYYY-MM-DD`, past dates only, defaults to today. On success the bot posts a public confirmation showing the transaction exactly as recorded in the database.

**`/amend`** — Takes a transaction ID and opens a Discord modal prefilled with that transaction's current values. Whatever the user submits overwrites the row, subject to replay validation.

**`/delete`** — Ephemeral message showing the transaction with Confirm/Cancel buttons.

**`/clear`** — Deletes every transaction for one ticker for the calling user. Requires typing the ticker into a modal to confirm.

**`/reset`** — Deletes every transaction for the specified user. Restricted to Manage Server via `default_member_permissions`, same as `/split`, so one member cannot wipe another's history. Modal confirmation. Build this before `/clear`; it has no ticker filtering and gives you a working destructive-confirmation pattern to reuse.

**`/split`** — Restricted to users with Manage Server via Discord's native `default_member_permissions` (no custom permission code). Accepts forward and reverse splits as `X:Y`. Logged as a `SPLIT` row in the ledger and applied during replay to everything dated before it, so `/position` history can show "3:2 split — 5 → 8 shares" and a user can still see they originally bought 5. Half-up rounding; the fractional remainder is discarded. Deleting the split row undoes it.

### Behavior

- **Errors are always ephemeral.** Only the user who made the mistake sees it.
- **Every write is logged.** One line per stored change goes to stdout, so `docker compose logs bot` is a record of every transaction and the first place to look when a number is disputed.
- **Ticker validation** is a format check only (`^[A-Z.]{1,6}$`, uppercased). The bot does not know which tickers are real. Use Discord's native autocomplete on `/sell` and `/position` to suggest from the user's existing holdings.
- **Dates** are stored as UTC. Display uses Discord's `<t:unix:D>` timestamp markup so each viewer sees their own local date. Ordering within a single day comes from the row's insert timestamp.
- **Pagination** uses Discord message components. The 15-minute interaction token expiry is accepted — a stale page means the user re-runs the command.

### Transaction references

Users never see the database's integer id. Every transaction has a reference: two letters for its
type, then how many of that type the bot has recorded, padded to at least two digits — `BS01`,
`SS02`, `BS133`. This is what `/amend` and `/delete` take, and what `/position` shows.

Prefixes are one shared namespace. **Do not reuse one**, and add new types here:

| Prefix | Transaction |
|---|---|
| `BS` | Buy shares |
| `SS` | Sell shares |
| `SL` | Split (not `SP`, which V2 needs for a sold put) |
| `BC` / `SC` | V2: buy / sell call |
| `BP` / `SP` | V2: buy / sell put |

Numbers come from a `ref_counters` table, one row per prefix, and only ever go up. A deleted
transaction's reference is never handed to a later one. Counters are global, not per user, so a
reference identifies exactly one transaction across the whole bot. An `/amend` that changes a
transaction's type (BUY to SELL) issues a new reference, so a `BS` row is never really a sell.

### Display paradigm

Every transaction renders the same way, everywhere it appears, in two lines:

```
**ACTION** QUANTITY × UNIT of **TICKER** @ UNIT_PRICE
`REF` · total TOTAL · DATE
```

```
**BUY** 10 × shares of **AAPL** @ $150.00
`BS01` · total $1,500.00 · <t:1767268800:D>
```

- The first line is what happened, the second is the bookkeeping. Nothing else goes on either line.
- A type with no unit price, like a split, keeps its detail on the first line and drops the total:
  `**SPLIT** 3:2 of **AAPL** — 5 → 8 shares`.
- New types fill the same slots rather than inventing a layout. A V2 option is
  `**BUY** 2 × CALL of **AAPL** $150 2026-01-16 @ $3.20`.
- Public confirmations add a bold header and the user: `**Trade recorded**` then `<@id> ` before
  the action line.
- Lists (`/portfolio`, `/position`) separate entries with a thin rule, never run them together.
- Per-share prices show up to 4 decimals (`money`), amounts of actual money show exactly 2
  (`total`). Dates are always `<t:unix:D>`, which is why transaction lists cannot be code blocks.
- Holdings are a code-block table: ticker, shares, average cost, cost basis.

### Infrastructure

- **SQLite**, single file on a mounted Docker volume.
- **Schema migrations** run on boot: `PRAGMA user_version` plus numbered `.sql` files. No ORM.
- **Docker Compose** with a `dev` profile that bind-mounts `./src` and runs `tsx watch` for live reload; production runs the built image.
- **GitHub Actions** builds and pushes to GHCR on every merge to `main`. A `VERSION` file at the repo root holds `MAJOR.MINOR.PATCH`, and a `-beta` suffix publishes a GitHub pre-release. Only a new `MAJOR.MINOR` creates a release; a patch is appended to the release it fixes as a "Patches" bullet, and still ships `latest`, `sha-<short>` and its exact version tag. Change `VERSION` in the same PR as the work it releases.

## Future Versions & Notes

### V2 — Options

Basic calls and puts, expected relatively soon after V1.

- Add to the existing `transactions` table via `ALTER TABLE ADD COLUMN` — `strike`, `expiry`, `right`. Do **not** add these columns in V1.
- `sec_type` already exists as the discriminator (`STOCK`, `SPLIT`); options add `OPTION`.
- One table, not two. `/amend <id>` and `/delete <id>` take a bare ID, so a second table would mean a second ID namespace and ambiguous lookups.
- 1 contract = 100 shares. This multiplier will touch every quantity calculation — expect it to be the messiest part of V2.

### Price tracking and unrealized P/L

Deliberately cut from V1. When it lands:

- Put it behind a single `getPrice(ticker)` function so the provider is swappable.
- **Massive** (`massive.com`) is the leading candidate — free tier covers both stocks *and* options at end-of-day with 5 calls/min, paid tiers add 15-minute delayed and real-time. Stocks and options are separate subscriptions.
- **Wisesheets** has a better free tier (5,000 req/month, 15-min delayed) but **no options data** — it is listed as "Soon" and cannot be relied on for V2.
- **yfinance** is Python-only. The TypeScript equivalent is `yahoo-finance2` on npm. Same unofficial-scraper caveat either way.
- Free tiers are the binding constraint. Plan on a nightly job that fetches every distinct held ticker into a `prices` table, so commands read the DB and never block on the network.

### Realized P/L

Not displayed in V1, which is why V1 uses average cost rather than FIFO lot tracking. The ledger already stores everything needed: realized gain is `(sell_price - avg_cost) × qty`. If per-lot accuracy is ever wanted, FIFO can be added on top of the same ledger without a migration.

### Other deferred ideas

- **Dividends** — a second ledger and a second P/L concept (total return vs price return). Low value for paper trading.
- **Cash tracking / buying power** — out of scope. The bot tracks positions, not accounts.
- **Brokerage field** — cut from V1. If added, decide whether average cost is tracked per brokerage (correct, doubles the math) or the field is a display-only label (cheap).
- **CSV import** — only if a real user complains about entering many positions by hand. `/buy` with an optional past date already covers onboarding.
- **Per-user access control** — everything is public by design. Add only if someone asks.
- **Per-user timezones** — Discord does not expose user timezone and there is no plan to add a `/timezone` command. Server-wide `TZ` in `.env` is sufficient.

## Engineering

### Approach

**Test-driven development.** Write the failing test first, then the code that makes it pass. This matters most for replay validation, average-cost math, and split application — the places where a silent bug produces a plausible-looking wrong number.

**Keep it simple.** Prefer the shortest thing that works. Prefer the standard library over a dependency, and a native Discord feature over custom code. Do not add abstraction for a second use case that does not exist yet.

**Small commits.** Commit after each logical unit of work, not at the end of a feature.

**One pull request per version.** Each version (V1, V2, …) is built on its own branch and opened as a single PR against `main` for manual review. Keep commits inside that PR small. **Never push to or merge into `main` unless explicitly told to.** Pushing the version branch is fine.

**Periodic ponytail reviews.** Run a ponytail review (`/ponytail-review` on a diff, `/ponytail-audit` on the repo) at the end of each major piece of work and before opening the PR, to catch over-engineering while it is still cheap to delete.

### Structure

Monorepo with separate top-level folders:

```
src/
  commands/     one file per slash command
  components/   reusable UI and logic — buttons, modals, embed builders, table rendering
  queries/      all SQL, one file per domain area
  strings/      all user-facing text
  tests/
migrations/     numbered .sql files
public/         static resources: the bot avatar, images, anything not code
```

`public/` is where resources live. Nothing in it is loaded at runtime — the avatar is uploaded by
hand in the Discord Developer Portal — but it is the one place to look for them.

Anything that gets reused belongs in its own file. Keep functions and components separate and abstract enough that they can be lifted and used elsewhere without dragging context along. No user-facing string should be written inline in a command file — it goes in `strings/`.

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
