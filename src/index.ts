import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './loadCommands.js';
import { schedulePrices } from './components/prices.js';
import { rebuildAll } from './components/userLedger.js';
import { route } from './router.js';
import { version } from './version.js';

// Recompute stored holdings from the ledger, which fills them on the first boot after an upgrade.
rebuildAll();
const commands = await loadCommands();
// The version shows as the bot's custom status in the member list, because hosts like TrueNAS do
// not show which image tag is running. Sent on every (re)connect, so it survives gateway resumes.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: { activities: [{ type: ActivityType.Custom, name: 'version', state: `v${version}` }] },
});

client.once(Events.ClientReady, (ready) => {
  console.log(`Logged in as ${ready.user.tag}, v${version}`);
  schedulePrices();
});
client.on(Events.InteractionCreate, route(commands));

// Docker stops containers with SIGTERM, which Node ignores as PID 1. Database writes are
// synchronous, so nothing is half-written by the time this handler runs.
process.on('SIGTERM', () => process.exit(0));

await client.login(config.token);
