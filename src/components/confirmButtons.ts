import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { messages } from '../strings/messages.js';

export const confirmButtons = (confirmId: string, cancelId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(messages.confirm).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel(messages.cancel).setStyle(ButtonStyle.Secondary),
  );
