import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './loadCommands.js';
import { route } from './router.js';

const commands = await loadCommands();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => console.log(`Logged in as ${ready.user.tag}`));
client.on(Events.InteractionCreate, route(commands));

// Docker stops containers with SIGTERM, which Node ignores as PID 1. Database writes are
// synchronous, so nothing is half-written by the time this handler runs.
process.on('SIGTERM', () => process.exit(0));

await client.login(config.token);
