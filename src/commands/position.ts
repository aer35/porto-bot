import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { historyLines } from '../components/historyLines.js';
import { withPrices } from '../components/prices.js';
import { tickerAutocomplete } from '../components/tickerAutocomplete.js';
import { holdingsOf, historyPage } from '../queries/holdings.js';
import { UserError } from '../components/userError.js';
import { ANY_TICKER_MAX, parseLookupTicker } from '../components/validate.js';
import { PAGE_SIZE, positionView } from '../components/views.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('position')
  .setDescription(messages.position.description)
  .addStringOption((o) =>
    o.setName('ticker').setDescription(messages.options.anyTicker).setRequired(true).setMaxLength(ANY_TICKER_MAX).setAutocomplete(true),
  )
  .addUserOption((o) => o.setName('user').setDescription(messages.options.user));

// Page `requested` of the member's transactions for the ticker, newest first.
function render(userId: string, ticker: string, requested: number) {
  const { rows, page, pageCount } = historyPage(userId, ticker, PAGE_SIZE, requested);
  if (!pageCount) throw new UserError(messages.position.none(userId, ticker));
  const held = withPrices(holdingsOf(userId).filter((p) => p.ticker === ticker));
  return positionView(userId, ticker, held, historyLines(rows), page, pageCount);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const ticker = parseLookupTicker(interaction.options.getString('ticker', true));
  if (!ticker) throw new UserError(messages.invalidLookupTicker);
  const userId = (interaction.options.getUser('user') ?? interaction.user).id;
  await interaction.reply(render(userId, ticker, 0));
}

export async function button(interaction: ButtonInteraction, [page, userId, ticker]: string[]) {
  await interaction.update(render(userId, ticker, Number(page)));
}

// Suggests from the holdings of whichever user is selected, which arrives as a raw ID string.
export const autocomplete = (interaction: AutocompleteInteraction) =>
  tickerAutocomplete(interaction, (interaction.options.get('user')?.value as string) ?? interaction.user.id);
