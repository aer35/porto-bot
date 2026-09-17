import { date, money } from '../components/format.js';
import type { Tx } from '../components/ledger.js';

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
  unexpectedError: 'Something went wrong. Try again, and tell the server owner if it keeps happening.',

  options: {
    ticker: 'Ticker symbol, e.g. AAPL',
    shares: 'Number of whole shares',
    price: 'Price per share',
    date: 'Trade date as YYYY-MM-DD. Defaults to today',
    user: 'Whose portfolio to show. Defaults to you',
  },

  invalidTicker: 'Tickers are 1–6 letters or dots, like `AAPL` or `BRK.B`.',
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
};
