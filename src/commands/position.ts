import {
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { table } from '../components/format.js';
import { historyLines } from '../components/historyLines.js';
import { pageButtons } from '../components/pageButtons.js';
import { tickerAutocomplete } from '../components/tickerAutocomplete.js';
import { ledgerOf } from '../components/userLedger.js';
import { UserError } from '../components/userError.js';
import { parseTicker } from '../components/validate.js';
import { holdingRow, messages } from '../strings/messages.js';

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('position')
  .setDescription(messages.position.description)
  .addStringOption((o) =>
    o.setName('ticker').setDescription(messages.options.ticker).setRequired(true).setAutocomplete(true),
  )
  .addUserOption((o) => o.setName('user').setDescription(messages.options.user));

// Page `page` (clamped, since rows may have changed since the buttons were sent), newest first.
function render(userId: string, ticker: string, page: number) {
  const { positions, history } = ledgerOf(userId);
  const lines = historyLines(history.filter(({ tx }) => tx.ticker === ticker)).reverse();
  if (!lines.length) throw new UserError(messages.position.none(userId, ticker));

  // The current holding as a one-row table, matching the holdings table in /portfolio.
  const held = positions.find((p) => p.ticker === ticker);
  const summary = held ? table([messages.portfolio.columns, holdingRow(held)]) : messages.position.noShares;

  const pageCount = Math.ceil(lines.length / PAGE_SIZE);
  page = Math.min(Math.max(page, 0), pageCount - 1);
  const embed = new EmbedBuilder().setDescription(
    messages.position.body(userId, ticker, summary, lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)),
  );
  if (pageCount === 1) return { embeds: [embed], components: [] };
  embed.setFooter({ text: messages.page(page, pageCount) });
  return { embeds: [embed], components: [pageButtons((p) => `position:${p}:${userId}:${ticker}`, page, pageCount)] };
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const ticker = parseTicker(interaction.options.getString('ticker', true));
  if (!ticker) throw new UserError(messages.invalidTicker);
  const userId = (interaction.options.getUser('user') ?? interaction.user).id;
  await interaction.reply(render(userId, ticker, 0));
}

export async function button(interaction: ButtonInteraction, [page, userId, ticker]: string[]) {
  await interaction.update(render(userId, ticker, Number(page)));
}

// Suggests from the holdings of whichever user is selected, which arrives as a raw ID string.
export const autocomplete = (interaction: AutocompleteInteraction) =>
  tickerAutocomplete(interaction, (interaction.options.get('user')?.value as string) ?? interaction.user.id);
