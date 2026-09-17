import { date, money } from '../components/format.js';
import type { Position, Tx } from '../components/ledger.js';

// One transaction on one line. `shares` is [before, after] for split rows, when known.
const txLine = (tx: Tx, shares?: [number, number]) =>
  tx.sec_type === 'SPLIT'
    ? `\`#${tx.id}\` **SPLIT** ${tx.split_to}:${tx.split_from} ${tx.ticker}` +
      (shares ? ` — ${shares[0]} → ${shares[1]} shares` : '') +
      ` · ${date(tx.trade_date)}`
    : `\`#${tx.id}\` **${tx.side}** ${tx.shares} ${tx.ticker} @ ${money(tx.price!)} · ${date(tx.trade_date)}`;

// Every user-facing string lives here.
export const messages = {
  txLine,
  confirm: 'Confirm',
  cancel: 'Cancel',
  typeToConfirm: 'Type the text shown below to confirm',
  confirmMismatch: 'That did not match. Nothing was deleted.',
  notAllowed: 'You need the Manage Server permission to do that.',
  cancelled: 'Cancelled. Nothing was changed.',
  notYourRow: (id: number) => `You have no transaction #${id}. Find your IDs with /position.`,
  previous: 'Previous',
  next: 'Next',
  page: (page: number, pageCount: number) => `Page ${page + 1} of ${pageCount}`,
  unexpectedError: 'Something went wrong. Try again, and tell the server owner if it keeps happening.',

  options: {
    ticker: 'Ticker symbol, e.g. AAPL',
    shares: 'Number of whole shares',
    price: 'Price per share',
    date: 'Trade date as YYYY-MM-DD. Defaults to today',
    user: 'Whose transactions to show. Defaults to you',
    id: 'Transaction ID, shown as #123 in /position',
  },

  invalidTicker: 'Tickers are 1–6 letters or dots, like `AAPL` or `BRK.B`.',
  invalidShares: 'Shares must be a whole number above 0.',
  invalidPrice: 'Price must be a number, 0 or more.',
  invalidDate: 'Dates must be `YYYY-MM-DD` and not in the future.',
  oversold: (tx: Tx) =>
    `That would leave you with negative **${tx.ticker}** shares as of ${date(tx.trade_date)}. Nothing was changed.`,

  buy: { description: 'Record shares you bought' },
  sell: { description: 'Record shares you sold' },
  recorded: (userId: string, tx: Tx) => `<@${userId}> recorded ${txLine(tx)}`,

  portfolio: {
    description: 'Show holdings and recent transactions',
    columns: ['Ticker', 'Shares', 'Avg cost'],
    noHoldings: 'No holdings.',
    body: (userId: string, holdings: string, recent: string[]) =>
      `## Portfolio of <@${userId}>\n**Holdings**\n${holdings}\n**Recent transactions**\n` +
      (recent.length ? recent.join('\n') : 'None yet.'),
  },

  position: {
    description: 'Show every transaction for one ticker, with IDs for /amend and /delete',
    none: (userId: string, ticker: string) => `<@${userId}> has no **${ticker}** transactions.`,
    body: (userId: string, ticker: string, position: Position | undefined, lines: string[]) =>
      `## ${ticker} — <@${userId}>\n` +
      (position ? `Holding ${position.shares} shares @ ${money(position.avgCost)} avg\n\n` : 'No shares held\n\n') +
      lines.join('\n'),
  },

  delete: {
    description: 'Delete one of your transactions',
    prompt: (tx: Tx) => `Delete this transaction?\n${txLine(tx)}`,
    done: (tx: Tx) => `Deleted ${txLine(tx)}`,
  },

  amend: {
    description: 'Edit one of your transactions',
    title: (id: number) => `Amend transaction #${id}`,
    fields: { ticker: 'Ticker', side: 'Side (BUY or SELL)', shares: 'Shares', price: 'Price per share', date: 'Date (YYYY-MM-DD)' },
    split: 'Split rows cannot be amended. Use /delete to undo a split.',
    invalidSide: 'Side must be `BUY` or `SELL`.',
    done: (userId: string, tx: Tx) => `<@${userId}> amended ${txLine(tx)}`,
  },

  reset: {
    description: "Delete every transaction for one member (Manage Server only)",
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
};
