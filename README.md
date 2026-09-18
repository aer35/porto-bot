# porto-bot

Self-hosted Discord bot that keeps a shared paper-trading ledger for your server. Members record the trades they made elsewhere with `/buy` and `/sell`, and anyone can view them with `/portfolio` and `/position`. No real money, no brokerage connections.

Each server runs its own instance. Everything recorded is visible to everyone in the server.

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. **Bot** → **Reset Token**, then copy the token. No privileged intents are needed.
3. Still on **Bot**, click the avatar box and upload a profile image. This repository ships one at [`public/avatar.png`](public/avatar.png). The bot does not set its own avatar, so this is the only place it can be changed, and the name next to it is what members see.
4. **OAuth2** → **URL Generator**: tick the `bot` and `applications.commands` scopes, and under bot permissions tick **Send Messages** and **Embed Links**. Open the generated URL and add the bot to your server.

## 2. Configure

You need `compose.yaml` and `.env.example` from this repository. Copy the example and fill it in:

```sh
cp .env.example .env
```

Every value is explained in `.env.example`. You need the bot token, the application ID, and your server ID.

## 3. Start

```sh
docker compose up -d
```

This pulls `ghcr.io/aer35/porto-bot:latest`. Pin a version with a tag, e.g. `ghcr.io/aer35/porto-bot:1.0.0`, by editing `image:` in `compose.yaml`.

## 4. Register the slash commands

Run this once, and again after each upgrade:

```sh
docker compose run --rm bot node dist/register.js
```

The commands appear in your server right away. `/reset` and `/split` are limited to members with **Manage Server**. You can change who sees them under Server Settings → Integrations.

## Upgrading

```sh
docker compose pull && docker compose up -d
docker compose run --rm bot node dist/register.js
```

Database migrations run automatically on startup.

## Versions

`docker compose up -d` pulls `latest`. To pin a version, set `image:` in `compose.yaml` to a tag from the [releases](https://github.com/aer35/porto-bot/releases), e.g. `ghcr.io/aer35/porto-bot:1.0.0`. Versions marked as pre-releases are `-beta` builds; use a plain version for a stable one. Patch versions have no release of their own — they are listed under **Patches** in the release they fix.

## Data and backups

All data is one SQLite file, `porto.db`, in the Docker volume `data` (mounted at `/data` in the container). Compose prefixes the volume name with your project directory, e.g. `porto-bot_data`.

To back it up, stop the bot so nothing is mid-write, then copy the file out:

```sh
docker compose stop bot
docker compose cp bot:/data/porto.db ./porto-backup.db
docker compose start bot
```

To restore, copy the backup back in and hand ownership to the container's `node` user, or the bot cannot write to it:

```sh
docker compose stop bot
docker compose cp ./porto-backup.db bot:/data/porto.db
docker compose run --rm --user root bot chown node:node /data/porto.db
docker compose start bot
```
