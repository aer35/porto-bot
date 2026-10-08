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
    - Under **Scopes**, tick **bot** and **applications.commands**. You will need both.
    - Under **Bot Permissions**, tick **Send Messages** and **Embed Links**.
    - Copy the link that appears at the bottom, open it in a new browser tab, pick your server, and click **Authorize**.
6. Get your server's ID:
    - In Discord, open **User Settings** (the gear icon) → **Advanced**, and turn on **Developer Mode**.
    - Right-click your server's icon in the server list and choose **Copy Server ID**.

You should now have three values saved: an **application ID**, a **bot token**, and a **server ID**.

---

## Step 2 — Create two files

> **On TrueNAS?** Skip Steps 2 to 4 and follow [Installing on TrueNAS](#installing-on-truenas) instead.

Make a new folder anywhere on the machine that runs Docker, for example `porto-bot`. Create these two files inside it.

**`compose.yaml`** — tells Docker how to run the bot:

```yaml
services:
  porto-bot:
    image: ghcr.io/aer35/porto-bot:latest
    container_name: porto-bot
    env_file: .env
    volumes:
      # Keeps the bot's data between restarts and updates (see "Where the data lives" below).
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

**Where the data lives.** Everything the bot records is in one file, `porto.db`, in the folder `/data` inside the
container. The `volumes:` line `- data:/data` keeps that folder in a Docker volume named `data`, so it survives
restarts and updates. To keep it in a folder you choose instead (for example on a NAS), replace `data` on the left with
that folder's path, such as `- /mnt/tank/apps/porto-bot:/data`, and remove the `volumes:` block at the bottom. The bot
runs as user ID 1000 inside the container, so that folder must be writable by user ID 1000.

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

Look for a line starting with `Logged in as`. Your bot should now show as online in your server's member list, with
its version and price-feed status as its status, like `v2.5.0 · API: 🟢` (see [Price data](#price-data)). The `API`
part appears a few seconds after the bot starts.

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

## Installing on TrueNAS

These steps use the **Custom App** screen of TrueNAS SCALE 24.10 ("Electric Eel") or later, which runs apps with
Docker. They replace Steps 2 to 4. Have the three values from Step 1 ready.

1. Make a dataset for the bot's data:
    - Go to **Datasets**, select the pool or parent dataset to put it in, and click **Add Dataset**.
    - Set **Name** to `porto-bot` and **Dataset Preset** to **Apps**, then click **Save**.
    - The **Apps** preset gives the built-in `apps` user (user ID 568) access. The bot runs as that user (step 3).
    - Note the dataset's path, for example `/mnt/tank/porto-bot`.
2. Go to **Apps**, click **Discover Apps**, then **Custom App**.
3. Fill in the form. Leave everything not listed here as it is.
    - **Application Name**: `porto-bot`
    - **Image Configuration**: **Repository** `ghcr.io/aer35/porto-bot`, **Tag** `latest`. Set **Pull Policy** to
      always pull the image, so that restarting the app picks up updates.
    - **Container Configuration**: under **Environment Variables**, add one entry for each line of the `.env` file in
      Step 2: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` with your values, `DB_PATH` set to
      `/data/porto.db`, and `TZ` set to your time zone. Set **Restart Policy** to **Unless Stopped**.
    - **Security Context Configuration**: turn on **Custom User** and set both **User ID** and **Group ID** to `568`.
    - **Storage Configuration**: click **Add**, choose **Host Path**, set **Mount Path** to `/data` and **Host Path** to
      the dataset from step 1. This is where `porto.db` is kept.
    - **Network Configuration**: add nothing. The bot needs no ports; it only connects out to Discord.
    - Click **Install**.
4. When the app shows **Running**, open its logs (**Apps** → **porto-bot** → **Workloads** → the logs icon) and look
   for a line starting with `Logged in as`.
5. Turn on the commands. Open **System** → **Shell** and run:

   ```sh
   sudo docker ps --format '{{.Names}}' | grep porto-bot
   ```

   This prints the container's name, for example `ix-porto-bot-porto-bot-1`. Use it in:

   ```sh
   sudo docker exec ix-porto-bot-porto-bot-1 node dist/register.js
   ```

   Then reload Discord as in Step 4.

Wherever this README shows a `docker compose run --rm porto-bot node dist/...` command, the TrueNAS equivalent is
`sudo docker exec <container name> node dist/...` in the TrueNAS shell, with the app running.

- **Updating**: stop the app and start it again, which pulls the newest image, then run step 5 again.
- **Backing up**: `porto.db` is a normal file in the dataset from step 1. Snapshot the dataset (**Data Protection** →
  **Periodic Snapshot Tasks**), or stop the app and copy the file.

---

## Using the bot

| Command               | What it does                                     | Required                    | Optional |
|-----------------------|--------------------------------------------------|-----------------------------|----------|
| `/buy stock`          | Record shares you bought                         | `ticker`, `shares`, `price` | `date`   |
| `/sell stock`         | Record shares you sold                           | `ticker`, `shares`, `price` | `date`   |
| `/buy crypto`         | Record crypto you bought                         | `ticker`, `amount`, `total` | `date`   |
| `/sell crypto`        | Record crypto you sold                           | `ticker`, `amount`, `total` | `date`   |
| `/buy option`         | Record option contracts you bought               | `ticker`, `type`, `strike`, `expiry`, `contracts`, `price` | `date` |
| `/sell option`        | Record option contracts you sold                 | `ticker`, `type`, `strike`, `expiry`, `contracts`, `price` | `date` |
| `/portfolio`          | Show holdings and transactions, one tab per type | —                           | `user`   |
| `/position`           | Show your holdings and transactions for one ticker, options included | `ticker`                    | `user`   |
| `/amend`              | Fix a transaction you entered wrong              | `id`                        | —        |
| `/delete`             | Remove a transaction                             | `id`                        | —        |
| `/clear`              | Remove all of your transactions for one ticker   | `ticker`                    | —        |
| `/reset` (Admin Only) | Erase a member's entire history                  | `user`                      | —        |
| `/split` (Admin Only) | Apply a stock split to everyone holding a ticker | `ticker`, `ratio`           | —        |

What the options mean:

| Field    | Meaning                                                                                 |
|----------|-----------------------------------------------------------------------------------------|
| `ticker` | Symbol as on Yahoo Finance, like `AAPL`, but with a dot for share classes (`BRK.B`). For crypto, the coin and currency, like `BTC-USD`. Prices come from Yahoo, so a ticker it does not know gets no price |
| `shares` | Number of shares, like `10.555`. Fractional shares are supported, up to 3 decimal places |
| `amount` | Number of coins, like `0.00034`, up to 6 decimal places                                 |
| `total`  | Crypto only: what you paid or received in total, in USD, like `100`. `amount:0.00001 total:100` means 0.00001 coins for $100, and the bot works out the price per coin. A sale can be `0` |
| `type`   | Options only: `Call` or `Put`, in any case (`call` works too)                           |
| `strike` | Options only: the strike price per share, like `150`                                    |
| `expiry` | Options only: the expiry date as `MM/DD/YY`, or `MM/DD` for this year, like `12/24`. When buying, today or later. `/sell option` suggests the strikes and expiries you hold |
| `contracts` | Options only: number of contracts, a whole number                                    |
| `price`  | Price per share in USD, above 0 (a sale can be `0`), up to 8 decimals. A leading `$` is optional. For options, the price per share as quoted: a contract costs 100 times this |
| `date`   | Trade date as `YYYY-MM-DD`, cannot be in the future. Defaults to today                  |
| `user`   | Whose transactions to show. Defaults to you                                             |
| `id`     | A transaction reference, like `BSS01`                                                   |
| `ratio`  | The split, written as new:old, like `3:2` or `1:10`                                     |


A few things worth knowing:

- Every dollar amount, including prices and average costs, is shown rounded to the cent; prices are stored with up to 8 decimals.
- Each option contract (ticker, call or put, strike and expiry) is its own holding. Contracts are never exercised or removed; to
  close one, record a `/sell option` for the same contract, which also works after it has expired. A contract past its
  expiry stays in your holdings, marked `(expired)`, until you record the sale; one that expired worthless is sold for
  `0`. An expired contract cannot be bought. `/amend` can change an option's contracts, price and date, but not the contract itself.
- Every transaction gets a short ID like `BSS01` (buy), `SSS01` (sell) or `XSS01` (split), shown beside it. Crypto
  uses `BCC01` and `SCC01`, and options `BOC01`, `BOP01`, `SOC01` and `SOP01` (call or put). That is what you type into `/amend` and `/delete`. IDs from before version 2 gained a letter: `BS01` is now `BSS01`, `SS01`
  is `SSS01` and `SL01` is `XSS01`.
- Every sale shows its realized profit or loss (`P/L`), against the average cost at the time of that sale: 🟢 for a gain,
  🔴 for a loss.
- `/portfolio` shows each holding's price and value, with the day's price move and the day's gain or loss (🟢/🔴)
  under them. `/position` also shows average cost, cost basis and `Total P/L`, the profit or loss since buying.
- A holding with no price shows `-` (in `/position`, only its cost until the first fetch) and counts at cost in the
  totals. Option values are for the whole contract, 100 times the quoted price. See [Price data](#price-data).
- Deleting or amending a transaction will **not** change or remove the message already in the channel.
- The bot never lets you sell more shares than you own, or edit your history into an impossible state.
- `/reset` and `/split` are limited to members with the **Manage Server** permission (generally moderators). You can change who may use them in
  **Server Settings → Integrations**.

---

## Price data

Prices come from [Yahoo Finance](https://finance.yahoo.com/), through the public address its own charts use,
`query1.finance.yahoo.com`. It needs no account or key, but the machine running the bot must be able to reach that
address over the internet.

The bot fetches prices when it starts, then every 10 minutes while the US stock market is open: Monday to Friday,
9:30 to 16:00 New York time (13:30 to 20:00 UTC in summer, 14:30 to 21:00 UTC in winter), plus once just after the
close. Crypto follows the same hours. Commands only read stored prices, so they never wait on Yahoo, and the bot keeps
working if Yahoo is down. Its status shows `API: 🟢` while Yahoo answers and `API: 🔴` when it does not, checked every
10 minutes.

> **porto-bot is not affiliated with Yahoo**, and is not endorsed or supported by it. Yahoo does not offer this as an
> official service and can change or block it at any time. porto-bot is not responsible for whether the prices are
> accurate, or for the price feed working at all.

---

## Updating

```sh
docker compose pull
docker compose up -d
docker compose run --rm porto-bot node dist/register.js
```

Your data is kept, and any changes to how it is stored are applied automatically. To check which version is running,
look at the bot's status in your server's member list.

### Moving crypto recorded before version 2

Before version 2 the bot had no crypto support, so members may have recorded coins with `/buy` as if they were stocks
(for example `BTC`). After updating to version 2, you can turn those entries into real crypto entries, for every member
at once. Run this once per coin, with the ticker they used:

```sh
docker compose stop porto-bot
docker compose run --rm porto-bot node dist/convertCrypto.js BTC
docker compose start porto-bot
```

The entries become `BTC-USD` crypto entries with new IDs like `BCC01`. To store the coin under another name, add it
at the end, for example `node dist/convertCrypto.js XBT BTC-USD`.

To stay on a specific version instead of the newest, change the `image:` line in `compose.yaml` to a version from
the [releases page](https://github.com/aer35/porto-bot/releases), for example:

```yaml
    image: ghcr.io/aer35/porto-bot:1.0.0
```

Releases marked **Pre-release** are test builds. Small fixes do not get their own release; they are listed under *Patches* inside the release they fix.

---

## Backing up your data

Everything lives in a single file called `porto.db`, kept in a Docker volume so it survives updates.

To make a backup, stop the bot first so nothing is written mid-copy:

```sh
docker compose stop porto-bot
docker compose cp porto-bot:/data/porto.db ./porto-backup.db
docker compose start porto-bot
```

The bot also backs up the database by itself whenever an update changes its layout, just before applying the change. These copies sit next to `porto.db` in the volume, named like `porto.db.v2026092800-backup-2026-09-26T13-45-00.db`, and are never deleted automatically. Remove old ones when you no longer need them.

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
| Status shows `API: 🔴`            | The bot cannot get prices from Yahoo Finance. Check the machine can reach `query1.finance.yahoo.com`. Yahoo may also be down or limiting requests; the bot keeps working and tries again by itself |

The bot also writes a line to its log for every transaction, so `docker compose logs porto-bot` is a record of everything that
has been entered.

---

## Reporting issues and requesting features

Found a bug, or want to see something added? Open an issue on the [GitHub Issues tab](https://github.com/aer35/porto-bot/issues).

- **Bugs**: include reproduction steps, screenshots, and the relevant lines from `docker compose logs porto-bot`.
- **Feature requests**: describe what you want and why — the more specific, the better.
- Tag the issue appropriately (e.g. `bug` or `enhancement`) so it's easy to triage.

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
