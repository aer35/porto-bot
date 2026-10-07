import { date, money } from '../components/format.js';
import type { Tx } from '../components/ledger.js';
import type { Holding, Totals } from '../components/prices.js';
import { formatQuantity, value, type Holdable } from '../components/units.js';
import { shortDate, toDateString } from '../components/validate.js';

// Every transaction renders the same way, in two lines:
//
//   **ACTION** QUANTITY × UNIT of **TICKER** @ UNIT_PRICE
//   `REF` · total TOTAL · DATE
//
// Rows that have no price, like splits, put their detail on the first line and drop the total. An
// option names its contract after the ticker: "**BUY** 2 × CALL of **AAPL** $150.00 01/16/26 @ $3.20".
// Crypto shows its total on the first line and its price per coin on the second. A sell adds
// "P/L 🟢 +$12.34" before the date. In /portfolio and /position each transaction is its
// own text display, with a Separator component between entries (src/components/views.ts); elsewhere
// it is a plain message or embed. Holdings are one line each, see holdingLine.
// Quantities are stored scaled (src/components/units.ts), so formatQuantity and value do the unscaling.

// What a quantity of each type is called, upper case to match an option's CALL or PUT.
const quantityUnit = { STOCK: 'SHARES', CRYPTO: 'COINS', OPTION: 'CONTRACTS' };

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

const action = (tx: Tx, counts?: [number, number]) =>
  tx.sec_type === 'SPLIT'
    ? `**SPLIT** ${tx.split_to}:${tx.split_from} of **${tx.ticker}**` +
      (counts ? ` — ${formatQuantity('STOCK', counts[0])} → ${formatQuantity('STOCK', counts[1])} ${quantityUnit.STOCK}` : '')
    : `**${tx.side}** ${formatQuantity(tx.sec_type, tx.shares!)} × ${unit(tx)} of **${tx.ticker}**${contract(tx)} ` +
      // Crypto is bought for a total ("0.5 BTC for $30,000"); the price per coin goes on the next line.
      (tx.sec_type === 'CRYPTO' ? `for ${money(value(tx.sec_type, tx.shares!, tx.price!))}` : `@ ${money(tx.price!)}`);

// P/L as its signed amount and coloured dot, e.g. ["+$150.00", "🟢"], ["-$0.50", "🔴"], or
// ["$0.00", "⚪"] when it rounds to nothing. Compared in cents, so a P/L of a fraction of a cent
// never shows "-$0.00".
function plParts(n: number) {
  const cents = Math.round(n * 100);
  return cents > 0 ? [`+${money(n)}`, '🟢'] : cents < 0 ? [`-${money(-n)}`, '🔴'] : [money(0), '⚪'];
}

// P/L in running text, dot first: "🟢 +$150.00".
function signed(n: number) {
  const [amount, dot] = plParts(n);
  return `${dot} ${amount}`;
}

// A holding's move today, per share, coin or option share: "+$1.23", "-$0.50" or "$0.00", or "-"
// when Yahoo gave no previous close. Only called once the holding has a price.
const dayMove = (p: Holding) => (p.prevClose == null ? NO_PRICE : plParts(p.price! - p.prevClose)[0]);

// One holding's cells in a /portfolio table, in portfolio.columns order, and with `priced` the cells
// of the line under them and the dot that ends it. A priced holding's first line adds price and
// value. The line under it holds the day's move under the price, and under the value what that move
// gained or lost on the whole holding, with the dot coloured by that day's result (the overall P/L
// is in /position). Without a previous close both day figures are "-" and there is no dot. Before
// the first fetch the price and value are blank and there is no second line; once a fetch has
// failed, all four are "-".
function holdingCells(p: Holding, priced: boolean) {
  const cells = [`${positionLabel(p)}${expired(p)}`, formatQuantity(p.sec_type, p.shares)];
  const blank = cells.map(() => '');
  if (!priced) return { cells, under: null, dot: '' };
  if (p.price == null) {
    return p.priceFailed
      ? { cells: [...cells, NO_PRICE, NO_PRICE], under: [...blank, NO_PRICE, NO_PRICE], dot: '' }
      : { cells: [...cells, '', ''], under: null, dot: '' };
  }
  const [amount, dot] = p.prevClose == null ? [NO_PRICE, ''] : plParts(value(p.sec_type, p.shares, p.price - p.prevClose));
  return {
    cells: [...cells, money(p.price), money(value(p.sec_type, p.shares, p.price))],
    under: [...blank, dayMove(p), amount],
    dot,
  };
}

// "(2 at cost, no price)" after a value that counts holdings without a price at their cost.
const atCost = (t: Totals) => (t.unpriced ? ` (${t.unpriced} at cost, no price)` : '');

// What a holding shows for each of its price, day, value and P/L once fetching its price failed (see
// priceOf), in /position and /portfolio alike. Before the first fetch they are left out instead.
const NO_PRICE = '-';

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
    // The column headings of a holdings tab's table (holdingsTable), before any price columns.
    // Average cost and cost basis are left to /position: with them the table was too wide to
    // render in Discord.
    columns: {
      STOCK: ['Ticker', 'Shares'],
      CRYPTO: ['Coin', 'Coins'],
      // "#" because "Contracts" was far wider than the counts under it.
      OPTION: ['Contract', '#'],
    },
    empty: { STOCK: 'No stock holdings.', CRYPTO: 'No crypto holdings.', OPTION: 'No option holdings.' },
    // Added to the table once some holding in it has a price or a failed fetch. What a priced holding
    // shows under them, the day's move and gain or loss, has no heading of its own.
    priceColumns: ['Price', 'Value'],
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
    description: "Show one ticker's holdings, options included, and its transactions, with IDs for /amend and /delete",
    none: (userId: string, ticker: string) => `<@${userId}> has no **${ticker}** transactions.`,
    // A ticker may be held as shares or as option contracts, so not "No shares held".
    nothingHeld: 'Nothing held.',
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

  // The bot's custom status in the member list: its version, then once checked (see apiUp in
  // index.ts) whether the price API answers.
  presence: (version: string, apiUp?: boolean) => `v${version}` + (apiUp === undefined ? '' : ` · API: ${apiUp ? '🟢' : '🔴'}`),

  // One holding in /position: position, quantity, average cost, cost basis, and once the nightly
  // job has a price, that price, today's move, the current value and the unrealized P/L, named
  // "Total P/L" so it is not taken for the day's gain or loss that /portfolio shows. If the job
  // tried and failed, each of those is "-"; before it has tried, they are left out.
  holdingLine: (p: Holding) =>
    `${holdingLabel(p)} · ${formatQuantity(p.sec_type, p.shares)} ${quantityUnit[p.sec_type]} · ` +
    `avg ${money(p.avgCost)} · cost ${money(value(p.sec_type, p.shares, p.avgCost))}` +
    (p.price != null
      ? ` · price ${money(p.price)} · day ${dayMove(p)} · value ${money(value(p.sec_type, p.shares, p.price))} · ` +
        `Total P/L ${signed(value(p.sec_type, p.shares, p.price - p.avgCost))}`
      : p.priceFailed ? ` · price ${NO_PRICE} · day ${NO_PRICE} · value ${NO_PRICE} · Total P/L ${NO_PRICE}` : ''),

  // A page of a /portfolio holdings tab as a table: holdingLine's fields but average cost and cost
  // basis (see portfolio.columns), one column each.
  // Discord has no tables and its text font is not monospaced, so it is a code block, which is.
  // Each column is as wide as its widest cell on this page (no fixed maximum), two spaces apart,
  // the first left-aligned and the numbers right-aligned. Code blocks show ** literally, so names
  // are not bold. A priced holding takes two lines, its day under its price and value (see
  // holdingCells), so no line carries every column (six in a row wrapped in Discord). The dot ends the
  // second line with no space or heading: an emoji is about two letters wide, so anywhere but the end
  // of a line it would push what comes after it out of line.
  holdingsTable: (tab: Holdable, holdings: Holding[]) => {
    const priced = holdings.some((p) => p.price != null || p.priceFailed);
    const headings = [...messages.portfolio.columns[tab], ...(priced ? messages.portfolio.priceColumns : [])];
    const rows = holdings.map((p) => holdingCells(p, priced));
    // Every line in the table, as cells; each column is as wide as its widest cell on any of them.
    const lines = [headings, ...rows.flatMap((r) => [r.cells, ...(r.under ? [r.under] : [])])];
    const widths = headings.map((_, i) => Math.max(...lines.map((cells) => cells[i].length)));
    const line = (cells: string[]) =>
      cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd();
    const rule = widths.map((w) => '─'.repeat(w)).join('  ');
    return [
      '```',
      line(headings),
      rule,
      ...rows.flatMap((r) => [line(r.cells), ...(r.under ? [line(r.under) + r.dot] : [])]),
      '```',
    ].join('\n');
  },
};
