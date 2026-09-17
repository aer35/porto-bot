import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './loadCommands.js';

// Guild commands update instantly, unlike global commands, and this bot only serves one server.
const commands = await loadCommands();
await new REST()
  .setToken(config.token)
  .put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: [...commands.values()].map((command) => command.data.toJSON()),
  });
console.log(`Registered ${commands.size} commands to guild ${config.guildId}.`);
