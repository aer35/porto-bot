import type { AutocompleteInteraction } from 'discord.js';
import { tickerAutocomplete } from '../components/tickerAutocomplete.js';
import { trade } from '../components/trade.js';

export const { data, execute } = trade('SELL');

export const autocomplete = (interaction: AutocompleteInteraction) =>
  tickerAutocomplete(interaction, interaction.user.id);
