import type { Position } from '../components/ledger.js';
import { db } from './db.js';

// Every position any member holds, once each. The price job turns these into symbols to fetch.
export const heldPositions = () =>
  db.prepare('SELECT DISTINCT sec_type, ticker, opt_right, strike, expiry FROM holdings').all() as Pick<
    Position,
    'sec_type' | 'ticker' | 'opt_right' | 'strike' | 'expiry'
  >[];

// Stores a symbol's latest price, replacing the previous one.
export const savePrice = (symbol: string, price: number, fetchedAt: number) =>
  db
    .prepare(
      `INSERT INTO prices (symbol, price, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at`,
    )
    .run(symbol, price, fetchedAt);

// The job runs every day, weekends included, so a price it still gets is never much more than a
// day old. Anything older stopped updating (an expired option, a symbol Yahoo no longer answers
// for, or one sold and bought back months later) and is treated as no price at all.
const MAX_PRICE_AGE_SECONDS = 2 * 24 * 60 * 60;

// The stored price of a symbol, or null if it has none fetched within MAX_PRICE_AGE_SECONDS.
export const priceOf = (symbol: string) =>
  (
    db
      .prepare('SELECT price FROM prices WHERE symbol = ? AND fetched_at >= ?')
      .get(symbol, Math.floor(Date.now() / 1000) - MAX_PRICE_AGE_SECONDS) as { price: number } | undefined
  )?.price ?? null;

// When any price was last stored, as unix seconds, or null if never. Seeds the job's schedule at startup.
export const lastFetchedAt = () =>
  (db.prepare('SELECT MAX(fetched_at) AS at FROM prices').get() as { at: number | null }).at;
