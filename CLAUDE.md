### Infrastructure

- **SQLite**, single file on a mounted Docker volume.
- **Schema migrations** run on boot: `PRAGMA user_version` plus numbered `.sql` files. No ORM.
- **Docker Compose** with a `dev` profile that bind-mounts `./src` and runs `tsx watch` for live reload; production runs the built image.
- **GitHub Actions** builds and pushes to GHCR on every merge to `main`. A `VERSION` file at the repo root holds `MAJOR.MINOR.PATCH`, and a `-beta` suffix publishes a GitHub pre-release. Only a new `MAJOR.MINOR` creates a release; a patch is appended to the release it fixes as a "Patches" bullet, and still ships `latest`, `sha-<short>` and its exact version tag. Change `VERSION` in the same PR as the work it releases.

## Engineering

### Approach

**Test-driven development.** Write the failing test first, then the code that makes it pass. This matters most for replay validation, average-cost math, and split application — the places where a silent bug produces a plausible-looking wrong number.

**Keep it simple.** Prefer the shortest thing that works. Prefer the standard library over a dependency, and a native Discord feature over custom code. Do not add abstraction for a second use case that does not exist yet.

**Small commits.** Commit after each logical unit of work, not at the end of a feature.

**One pull request per version.** Each version (V1, V2, …) is built on its own branch and opened as a single PR against `main` for manual review. Keep commits inside that PR small. **Never push to or merge into `main` unless explicitly told to.** Pushing the version branch is fine.

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