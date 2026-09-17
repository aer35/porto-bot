import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ModalSubmitInteraction } from 'discord.js';
import { messages } from '../strings/messages.js';

// A modal that asks the user to type `expected` before a destructive action.
export const confirmModal = (customId: string, title: string, expected: string) =>
  new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(messages.typeToConfirm)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('confirm').setStyle(TextInputStyle.Short).setPlaceholder(expected),
        ),
    );

export const typedMatches = (interaction: ModalSubmitInteraction, expected: string) =>
  interaction.fields.getTextInputValue('confirm').trim().toLowerCase() === expected.toLowerCase();
