import { date, money } from '../components/format.js';
import type { Tx } from '../components/ledger.js';
import type { Holding, Totals } from '../components/prices.js';
import { formatQuantity, value, type Holdable } from '../components/units.js';
import { shortDate, toDateString } from '../components/validate.js';

// Every transaction renders the same way, in two lines:
//
//   TYPE_MARK **ACTION** QUANTITY × UNIT of **TICKER** @ UNIT_PRICE
//   `REF` · total TOTAL · DATE
//
// Rows that have no price, like splits, put their detail on the first line and drop the total. An
// option names its contract after the ticker: "🟥 **BUY** 2 × CALL of **AAPL** $150.00 01/16/26 @ $3.20".
// Crypto shows its total on the first line and its price per coin on the second. A sell adds
// "P/L 🟢 +$12.34" before the date. In /portfolio and /position each transaction is its
// own text display, with a Separator component between entries (src/components/views.ts); elsewhere
// it is a plain message or embed. Holdings are one line each, see holdingLine.
// Quantities are stored scaled (src/components/units.ts), so formatQuantity and value do the unscaling.

// What a quantity of each type is called in a holdings line.
const quantityUnit = { STOCK: 'shares', CRYPTO: 'coins', OPTION: 'contracts' };

// What one unit is called in a transaction line: an option's unit is its right, CALL or PUT.
const unit = (tx: Tx) => (tx.sec_type === 'OPTION' ? tx.opt_right : quantityUnit[tx.sec_type as Holdable]);

type Contract = Pick<Tx, 'sec_type' | 'strike' | 'expiry'>;

// An option's strike and expiry, after its ticker: " $150.00 01/16/26". Empty for anything else.
const contract = (p: Contract) => (p.sec_type === 'OPTION' ? ` ${money(p.strike!)} ${shortDate(p.expiry!)}` : '');

// A position's name: the ticker, and for an option the contract, e.g. "AAPL CALL $150.00 01/16/26".
const positionLabel = (p: Contract & Pick<Tx, 'ticker' | 'opt_right'>) =>
  p.sec_type === 'OPTION' ? `${p.ticker} ${p.opt_right}${contract(p)}` : p.ticker;

// A held option past its expiry stays held until the member records the sale (possibly at $0), so
// it is marked instead of dropped. Shortcut: "past" is by UTC date, so the mark appears at 00:00 UTC
// after the expiry date, a few hours after the 16:00 New York close, whatever TZ is set to.
const expired = (p: Contract) =>
  p.sec_type === 'OPTION' && toDateString(p.expiry!) < toDateString(Date.now() / 1000) ? ' (expired)' : '';

// A holding's name in bold, then the expired mark if any.
const holdingLabel = (p: Holding) => `**${positionLabel(p)}**${expired(p)}`;

// Discord cannot color message text, so each transaction starts with a square in its type's tab
// colour (views.ts ACCENT). A split only ever applies to stock, so it takes the stock colour.
const typeMark = { STOCK: '🟩', CRYPTO: '🟦', OPTION: '🟥', SPLIT: '🟩' };

const action = (tx: Tx, counts?: [number, number]) =>
  `${typeMark[tx.sec_type]} ` +
  (tx.sec_type === 'SPLIT'
    ? `**SPLIT** ${tx.split_to}:${tx.split_from} of **${tx.ticker}**` +
      (counts ? ` — ${formatQuantity('STOCK', counts[0])} → ${formatQuantity('STOCK', counts[1])} shares` : '')
    : `**${tx.side}** ${formatQuantity(tx.sec_type, tx.shares!)} × ${unit(tx)} of **${tx.ticker}**${contract(tx)} ` +
      // Crypto is bought for a total ("0.5 BTC for $30,000"); the price per coin goes on the next line.
      (tx.sec_type === 'CRYPTO' ? `for ${money(value(tx.sec_type, tx.shares!, tx.price!))}` : `@ ${money(tx.price!)}`));

// P/L with a coloured dot and its sign, e.g. "🟢 +$150.00", "🔴 -$0.50", or "⚪ $0.00" when it
// rounds to nothing. Compared in cents, so a P/L of a fraction of a cent never shows "🔴 -$0.00".
function signed(n: number) {
  const cents = Math.round(n * 100);
  return cents > 0 ? `🟢 +${money(n)}` : cents < 0 ? `🔴 -${money(-n)}` : `⚪ ${money(0)}`;
}

// "(2 at cost, no price yet)" after a value that counts holdings without a price at their cost.
const atCost = (t: Totals) => (t.unpriced ? ` (${t.unpriced} at cost, no price yet)` : '');

const meta = (tx: Tx, realized?: number | null) =>
  tx.sec_type === 'SPLIT'
    ? `\`${tx.ref}\` · ${date(tx.trade_date)}`
    : `\`${tx.ref}\` · ` +
      (tx.sec_type === 'CRYPTO' ? `${money(tx.price!)} per coin · ` : `total ${money(value(tx.sec_type, tx.shares!, tx.price!))} · `) +
      (realized != null ? `P/L ${signed(realized)} · ` : '') +
      date(tx.trade_date);

// A split's `counts` are the shares held before and after it; a sell's `realized` is its P/L. Both
// come from replay (History), so a line drawn from a bare row leaves them out.
type Extra = { counts?: [number, number]; realized?: number | null };
const txLine = (tx: Tx, { counts, realized }: Extra = {}) => `${action(tx, counts)}\n${meta(tx, realized)}`;

// Every user-facing string lives here.
export const messages = {
  txLine,
  unexpectedError: 'Something went wrong. Try again, and tell the server owner if it keeps happening.',

  confirm: 'Confirm',
  cancel: 'Cancel',
  cancelled: 'Cancelled. Nothing was changed.',
  notYourRow: (ref: string) => `You have no transaction \`${ref}\`. Find your IDs with /position.`,
  previous: 'Previous',
  next: 'Next',
  page: (page: number, pageCount: number) => `Page ${page + 1} of ${pageCount}`,
  typeToConfirm: 'Type the text shown below to confirm',
  confirmMismatch: 'That did not match. Nothing was deleted.',
  notAllowed: 'You need the Manage Server permission to do that.',

  options: {
    ticker: 'Ticker symbol, e.g. AAPL',
    // /buy and /sell ticker captions name where prices come from (see Price data in CLAUDE.md), so a
    // mistyped ticker is the member's to notice: the bot only checks a ticker's format. Yahoo writes
    // share classes with a dash; the bot takes a dot and converts it.
    stockTicker: 'Ticker as on Yahoo Finance, e.g. AAPL. Write share classes with a dot: BRK.B',
    shares: 'Number of shares, up to 3 decimals, e.g. 12.785',
    price: 'Price per share',
    anyTicker: 'Ticker symbol, e.g. AAPL or BTC-USD',
    cryptoTicker: 'Coin and currency as on Yahoo Finance, e.g. BTC-USD. BTC alone means BTC-USD',
    amount: 'Number of coins, up to 6 decimals, e.g. 0.00034',
    totalPaid: 'What you paid in total, in USD, e.g. 100',
    totalReceived: 'What you received in total, in USD, e.g. 100. Can be 0',
    optionTicker: 'Underlying stock ticker as on Yahoo Finance, e.g. AAPL',
    type: 'Call or put',
    strike: 'Strike price per share, e.g. 150',
    expiry: 'Expiry as MM/DD/YY, or MM/DD for this year. For a buy, today or later',
    contracts: 'Number of contracts, a whole number',
    premium: 'Price per share of one contract as quoted, e.g. 3.20. A contract costs 100 times this',
    date: 'Trade date as YYYY-MM-DD. Defaults to today',
    user: 'Whose transactions to show. Defaults to you',
    id: 'Transaction ID, e.g. BSS01, shown next to each transaction',
  },

  invalidTicker: 'Tickers are 1–6 letters or dots, like `AAPL` or `BRK.B`.',
  invalidLookupTicker: 'Tickers are up to 15 letters, digits, dots or dashes, like `AAPL` or `BTC-USD`.',
  invalidTotal: 'Total must be above 0 (a sale can be 0) and at most $10,000,000, with at most 8 decimals, like `100`.',
  invalidOptionType: 'Choose `Call` or `Put`.',
  invalidStrike: 'Strike must be above 0 and at most $10,000,000, with at most 8 decimals, like `150`.',
  invalidExpiry: 'Expiry must be `MM/DD/YY`, or `MM/DD` for this year, like `12/24`. For a buy, today or later.',
  invalidContracts: 'Contracts must be a whole number, 1 or more.',
  invalidRef: 'Transaction IDs look like `BSS01` (buy), `SSS01` (sell) or `XSS01` (split).',
  invalidShares: 'Shares must be above 0 with at most 3 decimals, like `12.785`.',
  invalidCryptoTicker: 'Crypto tickers are a coin and a currency, like `BTC-USD`, or just the coin, like `BTC`.',
  invalidAmount: 'Amount must be above 0 and below 90,000,000, with at most 6 decimals, like `0.00034`.',
  invalidPrice: 'Price must be above 0 (a sale can be 0) and at most $10,000,000, with at most 8 decimals, like `150.25`.',
  invalidDate: 'Dates must be `YYYY-MM-DD` and not in the future.',
  oversold: (tx: Tx) =>
    `That would leave you with a negative **${positionLabel(tx)}** position as of ${date(tx.trade_date)}. Nothing was changed.`,

  // One description per /buy and /sell subcommand, keyed by the subcommand name.
  buy: {
    description: 'Record a trade you bought',
    stock: 'Record shares you bought',
    crypto: 'Record crypto you bought',
    option: 'Record option contracts you bought',
  } as Record<string, string>,
  sell: {
    description: 'Record a trade you sold',
    stock: 'Record shares you sold',
    crypto: 'Record crypto you sold',
    option: 'Record option contracts you sold',
  } as Record<string, string>,
  recorded: (userId: string, tx: Tx, realized: number | null) => `**Trade recorded**\n<@${userId}> ${txLine(tx, { realized })}`,

  portfolio: {
    description: 'Show holdings and transactions, one tab per security type',
    title: (userId: string) => `## Portfolio of <@${userId}>`,
    // Tab button labels, also the heading above the open tab.
    tabs: { STOCK: 'Stocks', CRYPTO: 'Crypto', OPTION: 'Options', TX: 'Transactions' },
    // The field label row above a holdings tab's rows, naming each field of holdingRow in order.
    columns: {
      STOCK: '-# Ticker · Shares · Avg cost · Cost basis',
      CRYPTO: '-# Coin · Coins · Avg cost · Cost basis',
      OPTION: '-# Contract · Contracts · Avg price · Cost basis',
    },
    empty: { STOCK: 'No stock holdings.', CRYPTO: 'No crypto holdings.', OPTION: 'No option holdings.' },
    // Added to a tab's label row once some holding in it has a price (see holdingRow).
    priceColumns: ' · Price · Value · P/L',
    // /position's single total; /portfolio shows the open tab's totals beside those of every holding.
    // Value appears once some holding has a price, with the rest counted at cost.
    total: (t: Totals) =>
      `**Total cost basis** ${money(t.cost)}` + (t.current === null ? '' : ` · **value** ${money(t.current)}${atCost(t)}`),
    tabTotal: (tab: Totals, all: Totals) =>
      `**Cost basis** ${money(tab.cost)}` +
      (tab.current === null ? '' : ` · **Value** ${money(tab.current)}${atCost(tab)}`) +
      ` · **Total, all holdings** ${money(all.cost)}` +
      (all.current === null ? '' : ` cost, ${money(all.current)} value${atCost(all)}`),
    noTransactions: 'No transactions yet.',
  },

  position: {
    description: 'Show every transaction for one ticker, with IDs for /amend and /delete',
    none: (userId: string, ticker: string) => `<@${userId}> has no **${ticker}** transactions.`,
    noShares: 'No shares held.',
    title: (userId: string, ticker: string) => `## ${ticker} — <@${userId}>`,
    transactions: '### Transactions',
  },

  delete: {
    description: 'Delete one of your transactions',
    prompt: (tx: Tx) => `**Delete this transaction?**\n${txLine(tx)}`,
    done: (tx: Tx) => `**Transaction deleted**\n${txLine(tx)}`,
  },

  amend: {
    description: 'Edit one of your transactions',
    title: (ref: string) => `Amend transaction ${ref}`,
    fields: {
      ticker: 'Ticker',
      side: 'Side (BUY or SELL)',
      shares: 'Shares',
      amount: 'Amount (coins)',
      contracts: 'Contracts',
      price: 'Price per share',
      total: 'Total (USD)',
      date: 'Date (YYYY-MM-DD)',
    },
    split: 'Split rows cannot be amended. Use /delete to undo a split.',
    invalidSide: 'Side must be `BUY` or `SELL`.',
    done: (userId: string, tx: Tx, realized: number | null) =>
      `**Transaction amended**\n<@${userId}> ${txLine(tx, { realized })}`,
  },

  reset: {
    description: 'Delete every transaction for one member (Manage Server only)',
    userOption: 'Member whose history to delete',
    title: 'Delete all transactions for this member?',
    done: (userId: string, count: number) => `Deleted ${count} transactions for <@${userId}>.`,
  },

  clear: {
    description: 'Delete all of your transactions for one ticker',
    title: (ticker: string) => `Delete all your ${ticker} transactions?`,
    done: (ticker: string, count: number) => `Deleted ${count} of your **${ticker}** transactions.`,
  },

  split: {
    description: 'Apply a stock split to everyone holding a ticker (Manage Server only)',
    ratioOption: 'New:old shares, e.g. 3:2 forward or 1:10 reverse',
    invalidRatio: 'Ratio must be `X:Y` with two different whole numbers above 0, like `3:2` or `1:10`.',
    done: (ticker: string, ratio: { split_to: number; split_from: number }, count: number) =>
      `Applied a ${ratio.split_to}:${ratio.split_from} split to **${ticker}** for ${count} ${count === 1 ? 'member' : 'members'}.`,
  },

  // One holding in /position: position, quantity, average cost, cost basis, and once the nightly
  // job has a price, that price, the current value and the unrealized P/L.
  holdingLine: (p: Holding) =>
    `${holdingLabel(p)} · ${formatQuantity(p.sec_type, p.shares)} ${quantityUnit[p.sec_type]} · ` +
    `avg ${money(p.avgCost)} · cost ${money(value(p.sec_type, p.shares, p.avgCost))}` +
    (p.price != null
      ? ` · price ${money(p.price)} · value ${money(value(p.sec_type, p.shares, p.price))} · ` +
        `P/L ${signed(value(p.sec_type, p.shares, p.price - p.avgCost))}`
      : ''),

  // One holding in a /portfolio tab: the same fields as holdingLine, named once by portfolio.columns
  // (and priceColumns, once priced).
  holdingRow: (p: Holding) =>
    `${holdingLabel(p)} · ${formatQuantity(p.sec_type, p.shares)} · ${money(p.avgCost)} · ${money(value(p.sec_type, p.shares, p.avgCost))}` +
    (p.price != null
      ? ` · ${money(p.price)} · ${money(value(p.sec_type, p.shares, p.price))} · ${signed(value(p.sec_type, p.shares, p.price - p.avgCost))}`
      : ''),
};
