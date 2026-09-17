import { MessageFlags, type Interaction } from 'discord.js';
import { UserError } from './components/userError.js';
import type { Command } from './loadCommands.js';
import { messages } from './strings/messages.js';

export const route = (commands: Map<string, Command>) => async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isAutocomplete()) {
      await commands.get(interaction.commandName)?.autocomplete?.(interaction);
    } else if (interaction.isButton() || interaction.isModalSubmit()) {
      const [name, ...args] = interaction.customId.split(':');
      const command = commands.get(name);
      if (interaction.isButton()) await command?.button?.(interaction, args);
      else await command?.modal?.(interaction, args);
    }
  } catch (err) {
    if (!(err instanceof UserError)) console.error(err);
    if (!interaction.isRepliable()) return;
    const reply = {
      content: err instanceof UserError ? err.message : messages.unexpectedError,
      flags: MessageFlags.Ephemeral,
    } as const;
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch (replyErr) {
      console.error(replyErr);
    }
  }
};
