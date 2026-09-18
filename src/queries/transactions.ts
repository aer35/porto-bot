import type { NewTx, Tx } from '../components/ledger.js';
import { formatRef, refPrefix } from '../components/ref.js';
import { db } from './db.js';

// node:sqlite returns null-prototype objects whose columns match Tx exactly, so the casts are safe.

// Every row for one user, unordered: replay() does the ordering.
export const userRows = (userId: string) =>
  db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(userId) as Tx[];

// One row by its user-facing reference, regardless of owner; callers check ownership.
export const getRow = (ref: string) =>
  db.prepare('SELECT * FROM transactions WHERE ref = ?').get(ref) as Tx | undefined;

// Reserves the next number for a transaction type, e.g. BS01. Counters only ever go up, so a
// deleted transaction's reference is never handed to a later one.
function nextRef(prefix: string) {
  const { next } = db
    .prepare(
      `INSERT INTO ref_counters (prefix, next) VALUES (?, 2)
       ON CONFLICT(prefix) DO UPDATE SET next = next + 1
       RETURNING next`,
    )
    .get(prefix) as { next: number };
  return formatRef(prefix, next - 1);
}

// Inserts a row and returns it as stored, including the database-assigned id and created_at.
export const insertRow = (tx: NewTx) =>
  db
    .prepare(
      `INSERT INTO transactions (user_id, sec_type, side, ticker, shares, price, trade_date, split_from, split_to, ref)
       VALUES (:user_id, :sec_type, :side, :ticker, :shares, :price, :trade_date, :split_from, :split_to, :ref)
       RETURNING *`,
    )
    .get({ ...tx, ref: nextRef(refPrefix(tx)) }) as Tx;

// Overwrites the user-editable fields of a row and returns it as stored. user_id, sec_type and
// created_at are never changed, so an amended row keeps its place among same-day rows.
// An amend that flips BUY to SELL gets a new reference, so a BS row is never really a sell.
export function updateRow({ user_id, created_at, ...row }: Tx) {
  const prefix = refPrefix(row);
  const fields = { ...row, ref: row.ref.startsWith(prefix) ? row.ref : nextRef(prefix) };
  return db
    .prepare(
      `UPDATE transactions
       SET side = :side, sec_type = :sec_type, ticker = :ticker, shares = :shares, price = :price, trade_date = :trade_date,
           split_from = :split_from, split_to = :split_to, ref = :ref
       WHERE id = :id
       RETURNING *`,
    )
    .get(fields) as Tx;
}

export const deleteRow = (id: number) => db.prepare('DELETE FROM transactions WHERE id = ?').run(id);

// Removes every row for a user, splits included. Returns how many rows were deleted.
export const deleteUserRows = (userId: string) =>
  Number(db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId).changes);

// Removes every row a user has for one ticker, splits included. Returns how many rows were deleted.
export const deleteUserTickerRows = (userId: string, ticker: string) =>
  Number(db.prepare('DELETE FROM transactions WHERE user_id = ? AND ticker = ?').run(userId, ticker).changes);

// Users with any row for a ticker. Some may have sold out; callers replay to find current holders.
export const usersWithTicker = (ticker: string) =>
  (db.prepare('SELECT DISTINCT user_id FROM transactions WHERE ticker = ?').all(ticker) as { user_id: string }[]).map(
    (r) => r.user_id,
  );
