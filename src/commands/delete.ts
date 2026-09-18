import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { confirmButtons } from '../components/confirmButtons.js';
import { ownRow } from '../components/ownRow.js';
import { parseRef } from '../components/ref.js';
import { UserError } from '../components/userError.js';
import { commitChange } from '../components/userLedger.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('delete')
  .setDescription(messages.delete.description)
  .addStringOption((o) => o.setName('id').setDescription(messages.options.id).setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const ref = parseRef(interaction.options.getString('id', true));
  if (!ref) throw new UserError(messages.invalidRef);
  const row = ownRow(ref, interaction.user.id);
  await interaction.reply({
    content: messages.delete.prompt(row),
    components: [confirmButtons(`delete:confirm:${row.ref}`, 'delete:cancel')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function button(interaction: ButtonInteraction, [action, ref]: string[]) {
  if (action === 'cancel') return interaction.update({ content: messages.cancelled, components: [] });
  // Re-check: the row may have been deleted or changed since the prompt was shown.
  const row = ownRow(ref, interaction.user.id);
  commitChange(interaction.user.id, { delete: row });
  await interaction.update({ content: messages.delete.done(row), components: [] });
}
