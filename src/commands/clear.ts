import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { confirmModal, typedMatches } from '../components/confirmModal.js';
import { logTx } from '../components/log.js';
import { UserError } from '../components/userError.js';
import { parseTicker } from '../components/validate.js';
import { deleteUserTickerRows } from '../queries/transactions.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription(messages.clear.description)
  .addStringOption((o) => o.setName('ticker').setDescription(messages.options.ticker).setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const ticker = parseTicker(interaction.options.getString('ticker', true));
  if (!ticker) throw new UserError(messages.invalidTicker);
  await interaction.showModal(confirmModal(`clear:${ticker}`, messages.clear.title(ticker), ticker));
}

// Deleting every row for a ticker cannot leave any ticker negative, so this skips replay validation.
export async function modal(interaction: ModalSubmitInteraction, [ticker]: string[]) {
  if (!typedMatches(interaction, ticker)) throw new UserError(messages.confirmMismatch);
  const count = deleteUserTickerRows(interaction.user.id, ticker);
  logTx('clear', interaction.user.id, `${ticker} rows=${count}`);
  await interaction.reply({ content: messages.clear.done(ticker, count), flags: MessageFlags.Ephemeral });
}
