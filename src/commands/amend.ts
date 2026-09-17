import {
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { ownRow } from '../components/ownRow.js';
import { commitChange } from '../components/userLedger.js';
import { UserError } from '../components/userError.js';
import { parseDate, parsePrice, parseShares, parseTicker, toDateString } from '../components/validate.js';
import { messages } from '../strings/messages.js';

export const data = new SlashCommandBuilder()
  .setName('amend')
  .setDescription(messages.amend.description)
  .addIntegerOption((o) => o.setName('id').setDescription(messages.options.id).setRequired(true).setMinValue(1));

const field = (id: string, label: string, value: string) =>
  new LabelBuilder()
    .setLabel(label)
    .setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setValue(value));

export async function execute(interaction: ChatInputCommandInteraction) {
  const row = ownRow(interaction.options.getInteger('id', true), interaction.user.id);
  // Split rows are undone with /delete; amending a ratio has no clear meaning for one holder.
  if (row.sec_type === 'SPLIT') throw new UserError(messages.amend.split);

  const labels = messages.amend.fields;
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`amend:${row.id}`)
      .setTitle(messages.amend.title(row.id))
      .addLabelComponents(
        field('ticker', labels.ticker, row.ticker),
        field('side', labels.side, row.side!),
        field('shares', labels.shares, String(row.shares)),
        field('price', labels.price, String(row.price)),
        field('date', labels.date, toDateString(row.trade_date)),
      ),
  );
}

export async function modal(interaction: ModalSubmitInteraction, [id]: string[]) {
  const value = (name: string) => interaction.fields.getTextInputValue(name);
  const ticker = parseTicker(value('ticker'));
  if (!ticker) throw new UserError(messages.invalidTicker);
  const side = value('side').trim().toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') throw new UserError(messages.amend.invalidSide);
  const shares = parseShares(value('shares'));
  if (shares === null) throw new UserError(messages.invalidShares);
  const price = parsePrice(value('price'));
  if (price === null) throw new UserError(messages.invalidPrice);
  const trade_date = parseDate(value('date'), config.tz);
  if (trade_date === null) throw new UserError(messages.invalidDate);

  // Re-check: the row may have been deleted while the modal was open.
  const row = ownRow(Number(id), interaction.user.id);
  const stored = commitChange(interaction.user.id, { update: { ...row, ticker, side, shares, price, trade_date } })!;
  await interaction.reply({ embeds: [new EmbedBuilder().setDescription(messages.amend.done(interaction.user.id, stored))] });
}
