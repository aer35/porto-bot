import { readdirSync } from 'node:fs';
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';

// Each file in commands/ exports this shape. Buttons and modals use custom IDs of the form
// "<command name>:<arg>:<arg>", and the router hands the args to that command's handler.
export type Command = {
  data: SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
  button?(interaction: ButtonInteraction, args: string[]): Promise<unknown>;
  modal?(interaction: ModalSubmitInteraction, args: string[]): Promise<unknown>;
};

const dir = new URL('./commands/', import.meta.url);

export async function loadCommands() {
  const commands = new Map<string, Command>();
  for (const file of readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f))) {
    const command: Command = await import(new URL(file, dir).href);
    commands.set(command.data.name, command);
  }
  return commands;
}
