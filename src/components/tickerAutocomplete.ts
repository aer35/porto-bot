import type { AutocompleteInteraction } from 'discord.js';
import { ledgerOf } from './userLedger.js';

// Suggests tickers the user currently holds. Suggestions only: any ticker can still be typed.
export async function tickerAutocomplete(interaction: AutocompleteInteraction, userId: string) {
  const typed = interaction.options.getFocused().toUpperCase();
  const tickers = ledgerOf(userId).positions.map((p) => p.ticker).filter((t) => t.startsWith(typed));
  // Discord allows at most 25 choices.
  await interaction.respond(tickers.slice(0, 25).map((t) => ({ name: t, value: t })));
}
