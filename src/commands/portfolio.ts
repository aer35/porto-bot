import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { money, table } from '../components/format.js';
import { historyLines } from '../components/historyLines.js';
import { ledgerOf } from '../components/userLedger.js';
import { messages } from '../strings/messages.js';

const RECENT_COUNT = 10;

export const data = new SlashCommandBuilder()
  .setName('portfolio')
  .setDescription(messages.portfolio.description)
  .addUserOption((o) => o.setName('user').setDescription(messages.options.user));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = (interaction.options.getUser('user') ?? interaction.user).id;
  const { positions, history } = ledgerOf(userId);

  // ponytail: no truncation. The embed description caps at 4096 characters, roughly 90 holdings
  // alongside the recent list; past that Discord rejects the reply. Paginate holdings if anyone gets there.
  const holdings = positions.length
    ? table([
        messages.portfolio.columns,
        ...positions.map((p) => [p.ticker, String(p.shares), money(p.avgCost)]),
      ])
    : messages.portfolio.noHoldings;
  const recent = historyLines(history).slice(-RECENT_COUNT).reverse();

  await interaction.reply({
    embeds: [new EmbedBuilder().setDescription(messages.portfolio.body(userId, holdings, recent))],
  });
}
