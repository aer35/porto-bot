import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { messages } from '../strings/messages.js';

// Previous/Next buttons. `customId(page)` must encode everything needed to re-render that page,
// so the buttons keep working without any in-memory state.
export function pageButtons(customId: (page: number) => string, page: number, pageCount: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(page - 1))
      .setLabel(messages.previous)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(customId(page + 1))
      .setLabel(messages.next)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1),
  );
}
