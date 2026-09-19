# porto-bot

A Discord bot that keeps a shared stock portfolio for your server. Members type in the trades they made elsewhere, and
the bot keeps the running tally: who holds what, at what average cost, with a full history.

It is **paper trading only**. There is no real money, no real orders, and no connection to any brokerage. The bot tracks
whatever people tell it.

You run your own copy, and everything recorded in it is visible to everyone in your server.

---

## Before you start

You need three things:

- **A Discord server you manage.** If you do not have one, click the **+** at the bottom of your server list in Discord
  and choose **Create My Own**.
- **Somewhere to run Docker.** A spare computer, a home server or NAS, or a cloud VPS all work.
  Install [Docker](https://docs.docker.com/get-started/get-docker/) if you do not have it. Anything that can run Docker
  containers can run this bot.
- **About 15 minutes.**

You do not need to download this project's code. The bot ships as a prebuilt image. There is a single image you can
download and use for the avatar but it is not necessary. Feel free to use your own.

---

## Step 1 — Create your bot in Discord

Discord requires every bot to be registered as an "application". This gives you a **token**, which is the password your
copy of the bot uses to log in.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and sign in with your normal
   Discord account.
2. Click **New Application**, give it a name (this is the name members will see, for example `porto-bot`), accept the
   terms, and click **Create**.
3. On the **General Information** page, find **Application ID** and copy it somewhere safe. You will need it in Step 2.
    - Click the avatar image to upload a profile picture. This project includes one you can use
      at [`public/avatar.png`](public/avatar.png). You don't need to use this picture, in fact you don't need an avatar
      at all. The bot cannot set its own picture, so this is the only place to change it. You can also set the avatar
      later.
4. Click **Bot** in the left sidebar.
    - Click **Reset Token**, confirm, then **Copy**. Save it somewhere safe.
    - **Treat this token like a password.** Anyone who has it can control your bot. Never post it anywhere. If it leaks,
      come back here and click **Reset Token** to invalidate the old one.
    - Leave every switch under **Privileged Gateway Intents** turned off. This bot does not need them.
5. Invite the bot to your server:
    - Click **OAuth2** in the sidebar, and find **OAuth2 URL Generator**.
    - Under **Scopes**, tick **bot** and **applications.commands**. You will need both.zzzzzzzzzzzzzzzzzz
    - Under **Bot Permissions**, tick **Send Messages** and **Embed Links**.
    - Copy the link that appears at the bottom, open it in a new browser tab, pick your server, and click **Authorize**.
6. Get your server's ID:
    - In Discord, open **User Settings** (the gear icon) → **Advanced**, and turn on **Developer Mode**.
    - Right-click your server's icon in the server list and choose **Copy Server ID**.

You should now have three values saved: an **application ID**, a **bot token**, and a **server ID**.

---

## Step 2 — Create two files

Make a new folder anywhere on the machine that runs Docker, for example `porto-bot`. Create these two files inside it.

**`compose.yaml`** — tells Docker how to run the bot:

```yaml
services:
  porto-bot:
    image: ghcr.io/aer35/porto-bot:latest
    container_name: porto-bot
    env_file: .env
    volumes:
      - data:/data
    restart: unless-stopped

volumes:
  data:
```

**`.env`** — your settings. Replace the three placeholders with the values from Step 1:

```sh
# The bot token from the Developer Portal. Keep this secret.
DISCORD_TOKEN=paste-your-token-here

# The Application ID from the Developer Portal.
DISCORD_CLIENT_ID=paste-your-application-id-here

# The ID of the server the bot will serve.
DISCORD_GUILD_ID=paste-your-server-id-here

# Where the bot keeps its data inside the container. Leave this alone.
DB_PATH=/data/porto.db

# Your time zone, which decides what "today" means when someone records a trade.
# Find yours here: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
TZ=America/New_York
```

The `container_name` line gives the container a predictable name, so commands like `docker logs porto-bot` work no matter what you called the folder. That name has to be unique on the machine, so to run a second copy alongside the first, use a separate folder and change both the service name and `container_name` to something else, such as `porto-bot-2`.

Do not put quotes around the values, and do not leave spaces around the `=`.

> **Using a Docker interface instead of a terminal?** If you manage Docker through something like Portainer, Unraid or a
> NAS app, paste the `compose.yaml` above into its stack or compose editor. If it gives you fields for environment
> variables, enter the settings there and delete the `env_file: .env` line. Additional configuration may be required. Refer to your interface's documentation for details.

---

## Step 3 — Start the bot

>If you are running the bot through a different docker interface, skip this step.

From inside that folder, run:

```sh
docker compose up -d
```

The first run downloads the bot, which takes a moment. To check that it worked:

```sh
docker compose logs porto-bot
```

Look for a line starting with `Logged in as`. Your bot should now show as online in your server's member list.

---

## Step 4 — Turn on the commands

Commands must be registered with Discord once before they appear:

```sh
docker compose run --rm porto-bot node dist/register.js
```

You should see `Registered 9 commands to guild ...`. In Discord, reload the app (**Ctrl+R**, or **Cmd+R** on a Mac),
then type `/` in any channel to see them.

**Run this again after every update**, in case commands changed.

That's it. The bot is ready to use.

---

## Using the bot

| Command | What it does | Required | Optional |
|---|---|---|---|
| `/buy` | Record shares you bought | `ticker`, `shares`, `price` | `date` |
| `/sell` | Record shares you sold | `ticker`, `shares`, `price` | `date` |
| `/portfolio` | Show holdings and recent transactions | — | `user` |
| `/position` | Show every transaction for one ticker | `ticker` | `user` |
| `/amend` | Fix a transaction you entered wrong | `id` | — |
| `/delete` | Remove a transaction | `id` | — |
| `/clear` | Remove all of your transactions for one ticker | `ticker` | — |
| `/reset` | Erase a member's entire history | `user` | — |
| `/split` | Apply a stock split to everyone holding a ticker | `ticker`, `ratio` | — |

What the options mean: `ticker` is the symbol, like `AAPL`. `shares` is a whole number. `price` is the price per share. `date` is `YYYY-MM-DD` and cannot be in the future; leave it out for today. `user` picks whose transactions to show, and defaults to you. `id` is a transaction ID such as `BS01`. `ratio` is the split, written as new:old, such as `3:2` or `1:10`.

A few things worth knowing:

- Every transaction gets a short ID like `BS01` (buy), `SS01` (sell) or `SL01` (split), shown beside it. That is what
  you type into `/amend` and `/delete`.
- Mistakes are private. If you get something wrong, only you see the error message.
- The bot never lets you sell more shares than you own, or edit your history into an impossible state.
- `/reset` and `/split` are limited to members with the **Manage Server** permission. You can change who may use them in
  **Server Settings → Integrations**.

---

## Updating

```sh
docker compose pull
docker compose up -d
docker compose run --rm porto-bot node dist/register.js
```

Your data is kept, and any changes to how it is stored are applied automatically.

To stay on a specific version instead of the newest, change the `image:` line in `compose.yaml` to a version from
the [releases page](https://github.com/aer35/porto-bot/releases), for example:

```yaml
    image: ghcr.io/aer35/porto-bot:1.0.0
```

Releases marked **Pre-release** are test builds. Small fixes do not get their own release; they are listed under *
*Patches** inside the release they fix.

---

## Backing up your data

Everything lives in a single file called `porto.db`, kept in a Docker volume so it survives updates.

To make a backup, stop the bot first so nothing is written mid-copy:

```sh
docker compose stop porto-bot
docker compose cp porto-bot:/data/porto.db ./porto-backup.db
docker compose start porto-bot
```

To restore that backup:

```sh
docker compose stop porto-bot
docker compose cp ./porto-backup.db porto-bot:/data/porto.db
docker compose run --rm --user root porto-bot chown node:node /data/porto.db
docker compose start porto-bot
```

The third line gives the file back to the bot's user, which it needs in order to write to it.

---

## If something goes wrong

Start with `docker compose logs porto-bot`, which usually says exactly what is wrong.

| Problem                           | Fix                                                                                                       |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------|
| Log says a variable is missing    | A line in `.env` is empty or misspelled, or `.env` is not in the same folder as `compose.yaml`            |
| Log says the token is invalid     | The token is wrong. Reset it in the Developer Portal, update `.env`, and run `docker compose up -d` again |
| No commands when you type `/`     | Run Step 4 again, check the server ID in `.env`, then reload Discord                                      |
| "The application did not respond" | The bot is not running. Check `docker compose ps` and the logs                                            |
| Commands answered twice           | You have two copies running with the same token. Stop one                                                 |

The bot also writes a line to its log for every transaction, so `docker compose logs porto-bot` is a record of everything that
has been entered.

---

## Building the image yourself

Optional. If you would rather build from source than use the prebuilt image:

```sh
git clone https://github.com/aer35/porto-bot.git
cd porto-bot
docker build -t porto-bot:local .
```

Then set `image: porto-bot:local` in your `compose.yaml` and start it as usual. The repository also includes its
own `compose.yaml` with a `dev` profile for working on the code.
