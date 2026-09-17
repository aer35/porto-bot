import type { NewTx, Tx } from '../components/ledger.js';
import { db } from './db.js';

// node:sqlite returns null-prototype objects whose columns match Tx exactly, so the casts are safe.

// Every row for one user, unordered: replay() does the ordering.
export const userRows = (userId: string) =>
  db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(userId) as Tx[];

// One row by id, regardless of owner; callers check ownership.
export const getRow = (id: number) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Tx | undefined;

// Inserts a row and returns it as stored, including the database-assigned id and created_at.
export const insertRow = (tx: NewTx) =>
  db
    .prepare(
      `INSERT INTO transactions (user_id, sec_type, side, ticker, shares, price, trade_date, split_from, split_to)
       VALUES (:user_id, :sec_type, :side, :ticker, :shares, :price, :trade_date, :split_from, :split_to)
       RETURNING *`,
    )
    .get(tx) as Tx;

// Overwrites the user-editable fields of a row and returns it as stored. user_id, sec_type and
// created_at are never changed, so an amended row keeps its place among same-day rows.
export const updateRow = (tx: Tx) =>
  db
    .prepare(
      `UPDATE transactions
       SET side = :side, ticker = :ticker, shares = :shares, price = :price, trade_date = :trade_date,
           split_from = :split_from, split_to = :split_to
       WHERE id = :id
       RETURNING *`,
    )
    .get({
      id: tx.id,
      side: tx.side,
      ticker: tx.ticker,
      shares: tx.shares,
      price: tx.price,
      trade_date: tx.trade_date,
      split_from: tx.split_from,
      split_to: tx.split_to,
    }) as Tx;

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
