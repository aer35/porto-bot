import type { Position } from '../components/ledger.js';
import { db } from './db.js';

// What identifies a position to price: its type, ticker, and for an option its contract.
export type Priced = Pick<Position, 'sec_type' | 'ticker' | 'opt_right' | 'strike' | 'expiry'>;

// Every position any member holds, once each. The price job turns these into symbols to fetch.
export const heldPositions = () =>
  db.prepare('SELECT DISTINCT sec_type, ticker, opt_right, strike, expiry FROM holdings').all() as Priced[];

// Stores a symbol's latest price and previous close, replacing the previous ones and clearing any
// earlier failure.
export const savePrice = (symbol: string, price: number, prevClose: number | null, fetchedAt: number) =>
  db
    .prepare(
      `INSERT INTO prices (symbol, price, prev_close, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         price = excluded.price, prev_close = excluded.prev_close, fetched_at = excluded.fetched_at, failed_at = NULL`,
    )
    .run(symbol, price, prevClose, fetchedAt);

// Records that fetching a symbol failed, keeping any price it already has.
export const saveFailure = (symbol: string, failedAt: number) =>
  db
    .prepare(
      `INSERT INTO prices (symbol, failed_at) VALUES (?, ?)
       ON CONFLICT(symbol) DO UPDATE SET failed_at = excluded.failed_at`,
    )
    .run(symbol, failedAt);

// The job only runs while the market is open, so a price it still gets can be as old as the last
// close: Friday's close is 89.5 hours old by the Tuesday open after a holiday Monday. Anything
// older than 4 days stopped updating (an expired option, a symbol Yahoo no longer answers for, or
// one sold and bought back months later) and is treated as no price at all. A failure ages out the
// same way.
const MAX_PRICE_AGE_SECONDS = 4 * 24 * 60 * 60;

// A symbol's stored price and the previous close fetched with it, both null unless fetched within
// MAX_PRICE_AGE_SECONDS (prevClose also when Yahoo gave none). failed is true when
// there is no such price and a fetch failed within that window: the bot tried and Yahoo gave
// nothing, as opposed to a symbol that has not been fetched yet.
export function priceOf(symbol: string) {
  const row = db.prepare('SELECT price, prev_close, fetched_at, failed_at FROM prices WHERE symbol = ?').get(symbol) as
    | { price: number | null; prev_close: number | null; fetched_at: number | null; failed_at: number | null }
    | undefined;
  const since = Math.floor(Date.now() / 1000) - MAX_PRICE_AGE_SECONDS;
  const fresh = row && (row.fetched_at ?? 0) >= since ? row : null;
  const price = fresh?.price ?? null;
  return { price, prevClose: fresh?.prev_close ?? null, failed: price === null && (row?.failed_at ?? 0) >= since };
}
