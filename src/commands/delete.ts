import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { confirmButtons } from '../components/confirmButtons.js';
import { ownRow } from '../components/ownRow.js';
import { commitChange } from '../components/userLedger.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('delete')
  .setDescription(messages.delete.description)
  .addIntegerOption((o) => o.setName('id').setDescription(messages.options.id).setRequired(true).setMinValue(1));

export async function execute(interaction: ChatInputCommandInteraction) {
  const row = ownRow(interaction.options.getInteger('id', true), interaction.user.id);
  await interaction.reply({
    content: messages.delete.prompt(row),
    components: [confirmButtons(`delete:confirm:${row.id}`, 'delete:cancel')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function button(interaction: ButtonInteraction, [action, id]: string[]) {
  if (action === 'cancel') return interaction.update({ content: messages.cancelled, components: [] });
  // Re-check: the row may have been deleted or changed since the prompt was shown.
  const row = ownRow(Number(id), interaction.user.id);
  commitChange(interaction.user.id, { delete: row });
  await interaction.update({ content: messages.delete.done(row), components: [] });
}
