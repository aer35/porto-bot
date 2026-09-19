import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { confirmModal, typedMatches } from '../components/confirmModal.js';
import { logTx } from '../components/log.js';
import { UserError } from '../components/userError.js';
import { deleteUserRows } from '../queries/transactions.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('reset')
  .setDescription(messages.reset.description)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption((o) => o.setName('user').setDescription(messages.reset.userOption).setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('user', true);
  // Usernames are lowercase letters, digits, _ and ., so they are safe inside a colon-separated custom ID.
  await interaction.showModal(confirmModal(`reset:${user.id}:${user.username}`, messages.reset.title, user.username));
}

export async function modal(interaction: ModalSubmitInteraction, [userId, username]: string[]) {
  // default_member_permissions can be overridden per channel by server admins, so check again here.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError(messages.notAllowed);
  if (!typedMatches(interaction, username)) throw new UserError(messages.confirmMismatch);
  const count = deleteUserRows(userId);
  logTx('reset', userId, `rows=${count} by=${interaction.user.id}`);
  await interaction.reply({ content: messages.reset.done(userId, count), flags: MessageFlags.Ephemeral });
}
