import {
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { messages } from '../strings/messages.js';
import type { NewTx, Position } from './ledger.js';
import { tickerAutocomplete } from './tickerAutocomplete.js';
import { holdingsOf, realizedOf } from '../queries/holdings.js';
import { money } from './format.js';
import { commitChange } from './userLedger.js';
import { UserError } from './userError.js';
import { toScaled, unitPrice, units, type Holdable } from './units.js';
import {
  ANY_TICKER_MAX,
  MAX_PRICE,
  MIN_PRICE,
  parseCryptoTicker,
  parseDate,
  parseExpiry,
  parseShortDate,
  parseTicker,
  shortDate,
  STOCK_TICKER_MAX,
  toDateString,
  toPrice,
} from './validate.js';

type Side = 'BUY' | 'SELL';

// The part of interaction.options a security type reads its fields from.
export type TradeOptions = Pick<ChatInputCommandInteraction['options'], 'getString' | 'getNumber' | 'getInteger'>;

// The fields of a row that differ by security type. user_id, side and trade_date are shared.
type TypeFields = Omit<NewTx, 'user_id' | 'side' | 'trade_date'>;

// One entry per /buy and /sell subcommand. `options` adds that type's required fields (the shared,
// optional date is added after them, since Discord lists required options first); `read`
// validates what was typed, throwing a UserError for anything invalid.
type SecurityType = {
  sec_type: Holdable;
  options(sub: SlashCommandSubcommandBuilder, side: Side): SlashCommandSubcommandBuilder;
  read(options: TradeOptions, side: Side, tz: string, now: Date): TypeFields;
};

// The columns only splits and options use.
const NOT_SPLIT_OR_OPTION = { split_from: null, split_to: null, opt_right: null, strike: null, expiry: null };

// How each type's ticker and quantity are checked, shared by /buy, /sell and /amend.
export const rules = {
  STOCK: {
    parseTicker,
    tickerMax: STOCK_TICKER_MAX,
    invalidTicker: messages.invalidTicker,
    invalidQuantity: messages.invalidShares,
  },
  CRYPTO: {
    parseTicker: parseCryptoTicker,
    tickerMax: ANY_TICKER_MAX,
    invalidTicker: messages.invalidCryptoTicker,
    invalidQuantity: messages.invalidAmount,
  },
  OPTION: {
    parseTicker,
    tickerMax: STOCK_TICKER_MAX,
    invalidTicker: messages.invalidTicker,
    invalidQuantity: messages.invalidContracts,
  },
};

// Only /sell autocompletes the ticker, from what the user already holds.
const tickerOption = (sub: SlashCommandSubcommandBuilder, side: Side, type: Holdable, description: string) =>
  sub.addStringOption((o) =>
    o
      .setName('ticker')
      .setDescription(description)
      .setRequired(true)
      .setMaxLength(rules[type].tickerMax)
      .setAutocomplete(side === 'SELL'),
  );

// A price-per-unit option, with the limits toPrice checks. `min` is 0 where a sale may be for nothing.
const priceOption = (sub: SlashCommandSubcommandBuilder, name: string, description: string, min = MIN_PRICE, autocomplete = false) =>
  sub.addNumberOption((o) =>
    o.setName(name).setDescription(description).setRequired(true).setMinValue(min).setMaxValue(MAX_PRICE).setAutocomplete(autocomplete),
  );

// The lowest price or total a trade may be: a sale may be for nothing, a buy may not.
const minPrice = (side: Side) => (side === 'SELL' ? 0 : MIN_PRICE);

// Discord number options cannot limit decimal places, so the quantity and price rules are checked here.
function readTicker(options: TradeOptions, type: Holdable) {
  const ticker = rules[type].parseTicker(options.getString('ticker', true));
  if (!ticker) throw new UserError(rules[type].invalidTicker);
  return ticker;
}

function readQuantity(amount: number, type: Holdable) {
  const scaled = toScaled(amount, type);
  if (scaled === null) throw new UserError(rules[type].invalidQuantity);
  return scaled;
}

function readPrice(options: TradeOptions, name: string, invalid: string, zeroOk = false) {
  const price = toPrice(options.getNumber(name, true), zeroOk);
  if (price === null) throw new UserError(invalid);
  return price;
}

const types: Record<string, SecurityType> = {
  stock: {
    sec_type: 'STOCK',
    options: (sub, side) =>
      priceOption(
        tickerOption(sub, side, 'STOCK', messages.options.stockTicker).addNumberOption((o) =>
          o.setName('shares').setDescription(messages.options.shares).setRequired(true).setMinValue(0.01),
        ),
        'price',
        messages.options.price,
        minPrice(side),
      ),
    read: (options, side) => ({
      sec_type: 'STOCK',
      ticker: readTicker(options, 'STOCK'),
      shares: readQuantity(options.getNumber('shares', true), 'STOCK'),
      price: readPrice(options, 'price', messages.invalidPrice, side === 'SELL'),
      ...NOT_SPLIT_OR_OPTION,
    }),
  },
  crypto: {
    sec_type: 'CRYPTO',
    options: (sub, side) =>
      priceOption(
        tickerOption(sub, side, 'CRYPTO', messages.options.cryptoTicker).addNumberOption((o) =>
          o.setName('amount').setDescription(messages.options.amount).setRequired(true).setMinValue(1 / units.CRYPTO.scale),
        ),
        'total',
        side === 'BUY' ? messages.options.totalPaid : messages.options.totalReceived,
        minPrice(side),
      ),
    read(options, side) {
      const shares = readQuantity(options.getNumber('amount', true), 'CRYPTO');
      const total = readPrice(options, 'total', messages.invalidTotal, side === 'SELL');
      return {
        sec_type: 'CRYPTO',
        ticker: readTicker(options, 'CRYPTO'),
        shares,
        price: unitPrice('CRYPTO', shares, total),
        ...NOT_SPLIT_OR_OPTION,
      };
    },
  },
  option: {
    sec_type: 'OPTION',
    options: (sub, side) =>
      priceOption(
        priceOption(
          tickerOption(sub, side, 'OPTION', messages.options.optionTicker).addStringOption((o) =>
            o
              .setName('type')
              .setDescription(messages.options.type)
              .setRequired(true)
              .addChoices({ name: 'Call', value: 'CALL' }, { name: 'Put', value: 'PUT' }),
          ),
          'strike',
          messages.options.strike,
          MIN_PRICE,
          side === 'SELL',
        )
          // Lengths of MM/DD/YY at its shortest ("1/5") and longest ("12/24/26").
          .addStringOption((o) =>
            o
              .setName('expiry')
              .setDescription(messages.options.expiry)
              .setRequired(true)
              .setMinLength(3)
              .setMaxLength(8)
              .setAutocomplete(side === 'SELL'),
          )
          .addIntegerOption((o) =>
            o.setName('contracts').setDescription(messages.options.contracts).setRequired(true).setMinValue(1),
          ),
        'price',
        messages.options.premium,
        minPrice(side),
      ),
    read(options, side, tz, now) {
      const ticker = readTicker(options, 'OPTION');
      // Discord only offers the two choices, but a stale client could still send anything.
      const opt_right = options.getString('type', true);
      if (opt_right !== 'CALL' && opt_right !== 'PUT') throw new UserError(messages.invalidOptionType);
      const strike = readPrice(options, 'strike', messages.invalidStrike);
      // Only a buy opens a position, so only a buy needs a contract that has not expired. A sell must
      // match a contract already held (replay rejects anything else), and may close one after expiry.
      const typed = options.getString('expiry', true);
      const expiry = side === 'BUY' ? parseExpiry(typed, tz, now) : parseShortDate(typed, tz, now);
      if (expiry === null) throw new UserError(messages.invalidExpiry);
      const shares = readQuantity(options.getInteger('contracts', true), 'OPTION');
      const price = readPrice(options, 'price', messages.invalidPrice, side === 'SELL');
      return { sec_type: 'OPTION', ticker, shares, price, ...NOT_SPLIT_OR_OPTION, opt_right, strike, expiry };
    },
  },
};

// /sell option's suggestions for the focused strike or expiry: those of the option contracts held,
// narrowed by the ticker, type and strike already picked (each ignored while empty or invalid) and by
// what has been typed so far. An expiry that has passed is still offered, marked, since it may
// still be held. `now` is only overridden by tests.
export function contractChoices(
  held: Position[],
  field: 'strike' | 'expiry',
  typed: string,
  picked: { ticker: string | null; type: string | null; strike: number | null },
  now = new Date(),
) {
  const ticker = picked.ticker && parseTicker(picked.ticker);
  const matching = held.filter(
    (p) => (!ticker || p.ticker === ticker) && (!picked.type || p.opt_right === picked.type) && (picked.strike == null || p.strike === picked.strike),
  );
  const today = toDateString(now.getTime() / 1000);
  const choices =
    field === 'strike'
      ? [...new Set(matching.map((p) => p.strike!))].sort((a, b) => a - b).map((strike) => ({ name: money(strike), value: strike }))
      : [...new Set(matching.map((p) => p.expiry!))]
          .sort((a, b) => a - b)
          .map((expiry) => ({
            name: shortDate(expiry) + (toDateString(expiry) < today ? ' (expired)' : ''),
            value: shortDate(expiry),
          }));
  // Discord allows at most 25 choices.
  return choices.filter((c) => String(c.value).startsWith(typed.trim())).slice(0, 25);
}

// The row a /buy or /sell subcommand would insert, validated. `now` is only overridden by tests.
export function tradeRow(user_id: string, side: Side, type: string, options: TradeOptions, tz: string, now = new Date()): NewTx {
  const fields = types[type].read(options, side, tz, now);
  const trade_date = parseDate(options.getString('date') ?? undefined, tz, now);
  if (trade_date === null) throw new UserError(messages.invalidDate);
  return { user_id, side, trade_date, ...fields };
}

// /buy and /sell are the same command with a different side, and one subcommand per security type.
export function trade(side: Side) {
  const name = side === 'BUY' ? 'buy' : 'sell';

  const data = new SlashCommandBuilder().setName(name).setDescription(messages[name].description);
  for (const [type, { options }] of Object.entries(types)) {
    data.addSubcommand((sub) =>
      options(sub.setName(type).setDescription(messages[name][type]), side).addStringOption((o) =>
        o.setName('date').setDescription(messages.options.date).setMaxLength(10),
      ),
    );
  }

  async function execute(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const row = tradeRow(userId, side, interaction.options.getSubcommand(), interaction.options, config.tz);
    const stored = commitChange(userId, { insert: row })!;
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription(messages.recorded(userId, stored, realizedOf(stored.id)))],
    });
  }

  // Only /sell autocompletes, from what the user holds of that subcommand's type: the ticker, and
  // for an option also the strike and expiry of the contracts held.
  async function autocomplete(interaction: AutocompleteInteraction) {
    const userId = interaction.user.id;
    const { name, value } = interaction.options.getFocused(true);
    if (name !== 'strike' && name !== 'expiry') {
      return tickerAutocomplete(interaction, userId, types[interaction.options.getSubcommand()].sec_type);
    }
    const picked = {
      ticker: interaction.options.getString('ticker'),
      type: interaction.options.getString('type'),
      strike: name === 'expiry' ? interaction.options.getNumber('strike') : null,
    };
    await interaction.respond(contractChoices(holdingsOf(userId, 'OPTION'), name, String(value), picked));
  }

  return { data, execute, autocomplete };
}
