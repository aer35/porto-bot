import { SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { historyLines } from '../components/historyLines.js';
import { withPrices } from '../components/prices.js';
import { PAGE_SIZE, portfolioView, TABS, transactionsView, type Tab } from '../components/views.js';
import { historyPage, holdingsOf } from '../queries/holdings.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('portfolio')
  .setDescription(messages.portfolio.description)
  .addUserOption((o) => o.setName('user').setDescription(messages.options.user));

function render(userId: string, tab: Tab, requested: number) {
  if (tab !== 'TX') return portfolioView(userId, tab, withPrices(holdingsOf(userId)), requested);
  const { rows, page, pageCount } = historyPage(userId, null, PAGE_SIZE, requested);
  return transactionsView(userId, historyLines(rows), page, pageCount);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = (interaction.options.getUser('user') ?? interaction.user).id;
  await interaction.reply(render(userId, 'STOCK', 0));
}

// Custom IDs are built in views.ts; a tampered tab or page falls back to the first page of Stocks.
export async function button(interaction: ButtonInteraction, [tab, page, userId]: string[]) {
  const known = TABS.find((t) => t === tab) ?? 'STOCK';
  await interaction.update(render(userId, known, Number(page) || 0));
}
