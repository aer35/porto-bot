import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config.js';
import { messages } from '../strings/messages.js';
import { commitChange } from './userLedger.js';
import { UserError } from './userError.js';
import { parseDate, parseTicker } from './validate.js';

// /buy and /sell are the same command with a different side.
export function trade(side: 'BUY' | 'SELL') {
  const name = side === 'BUY' ? 'buy' : 'sell';

  const data = new SlashCommandBuilder()
    .setName(name)
    .setDescription(messages[name].description)
    .addStringOption((o) =>
      o.setName('ticker').setDescription(messages.options.ticker).setRequired(true).setAutocomplete(side === 'SELL'),
    )
    .addIntegerOption((o) => o.setName('shares').setDescription(messages.options.shares).setRequired(true).setMinValue(1))
    .addNumberOption((o) => o.setName('price').setDescription(messages.options.price).setRequired(true).setMinValue(0))
    .addStringOption((o) => o.setName('date').setDescription(messages.options.date));

  async function execute(interaction: ChatInputCommandInteraction) {
    const ticker = parseTicker(interaction.options.getString('ticker', true));
    if (!ticker) throw new UserError(messages.invalidTicker);
    const trade_date = parseDate(interaction.options.getString('date') ?? undefined, config.tz);
    if (trade_date === null) throw new UserError(messages.invalidDate);

    const userId = interaction.user.id;
    const stored = commitChange(userId, {
      insert: {
        user_id: userId,
        sec_type: 'STOCK',
        side,
        ticker,
        shares: interaction.options.getInteger('shares', true),
        price: interaction.options.getNumber('price', true),
        trade_date,
        split_from: null,
        split_to: null,
      },
    })!;
    await interaction.reply({ embeds: [new EmbedBuilder().setDescription(messages.recorded(userId, stored))] });
  }

  return { data, execute };
}
