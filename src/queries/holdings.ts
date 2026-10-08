import type { History, HistoryEntry, Position, Tx } from '../components/ledger.js';
import type { Holdable } from '../components/units.js';
import { db } from './db.js';

// Reads and writes of the stored replay results (migrations/2026092703_holdings.sql).

// A tx_history row joined to its transaction, as selected by the history queries below.
type HistoryRow = Tx & { held_before: number; held_after: number; realized: number | null };
const toEntry = ({ held_before, held_after, realized, ...tx }: HistoryRow): HistoryEntry => ({
  tx,
  before: held_before,
  after: held_after,
  realized,
});

const replaceStatements = {
  deleteHoldings: db.prepare('DELETE FROM holdings WHERE user_id = ?'),
  deleteHistory: db.prepare('DELETE FROM tx_history WHERE user_id = ?'),
  holding: db.prepare(
    `INSERT INTO holdings (user_id, sec_type, ticker, opt_right, strike, expiry, shares, avg_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  entry: db.prepare('INSERT INTO tx_history (tx_id, user_id, held_before, held_after, realized) VALUES (?, ?, ?, ?, ?)'),
};

// Replaces everything stored for one member with a fresh replay's positions and history. Callers
// run it inside inTransaction, together with the ledger write it follows. The statements are
// prepared once, since the startup rebuild runs this for every member.
export function replaceUserState(userId: string, positions: Position[], history: History) {
  const { deleteHoldings, deleteHistory, holding, entry } = replaceStatements;
  deleteHoldings.run(userId);
  deleteHistory.run(userId);
  for (const p of positions) holding.run(userId, p.sec_type, p.ticker, p.opt_right, p.strike, p.expiry, p.shares, p.avgCost);
  for (const h of history) entry.run(h.tx.id, userId, h.before, h.after, h.realized);
}

// Empties both tables, before rebuilding them for every member.
export function clearAllState() {
  db.exec('DELETE FROM holdings; DELETE FROM tx_history;');
}

// A member's positions, optionally of one type: alphabetical by ticker, a ticker's shares (or coins)
// before its option contracts, as /position lists them, and those contracts by nearest expiry,
// then strike, then right. `sec_type = 'OPTION'` is 0 or 1, so it sorts options last; sorting by
// sec_type itself would put OPTION before STOCK.
export const holdingsOf = (userId: string, secType?: Holdable) =>
  db
    .prepare(
      `SELECT sec_type, ticker, opt_right, strike, expiry, shares, avg_cost AS avgCost
       FROM holdings
       WHERE user_id = ? AND (? IS NULL OR sec_type = ?)
       ORDER BY ticker, sec_type = 'OPTION', expiry, strike, opt_right`,
    )
    .all(userId, secType ?? null, secType ?? null) as Position[];

// Members who currently hold shares of a stock, for /split. A member has at most one STOCK
// holding per ticker, so each appears once.
export const holdersOf = (ticker: string) =>
  (db.prepare("SELECT user_id FROM holdings WHERE sec_type = 'STOCK' AND ticker = ?").all(ticker) as { user_id: string }[]).map(
    (r) => r.user_id,
  );

// Up to `limit` of a member's transactions, optionally for one ticker, with their stored history,
// newest first from `offset`. Replay order is trade_date, then created_at, then id, so newest
// first is that order reversed.
const historyRows = (userId: string, ticker: string | null, limit: number, offset: number) =>
  (
    db
      .prepare(
        `SELECT t.*, h.held_before, h.held_after, h.realized
         FROM transactions t JOIN tx_history h ON h.tx_id = t.id
         WHERE t.user_id = ? AND (? IS NULL OR t.ticker = ?)
         ORDER BY t.trade_date DESC, t.created_at DESC, t.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, ticker, ticker, limit, offset) as HistoryRow[]
  ).map(toEntry);

// One page of a member's transactions, for one ticker or (ticker null) every ticker, newest first,
// with how many pages there are. `page` is clamped to the pages that exist, since rows may have
// changed since a Previous or Next button was sent. pageCount is 0 when there are no rows.
export function historyPage(userId: string, ticker: string | null, pageSize: number, page: number) {
  // Counts the same rows historyRows selects, to size the page buttons.
  const { count } = db
    .prepare('SELECT count(*) AS count FROM transactions WHERE user_id = ? AND (? IS NULL OR ticker = ?)')
    .get(userId, ticker, ticker) as { count: number };
  const pageCount = Math.ceil(count / pageSize);
  page = Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
  return { rows: historyRows(userId, ticker, pageSize, page * pageSize), page, pageCount };
}

// Realized P/L stored for one transaction; null for anything but a SELL.
export const realizedOf = (txId: number) =>
  (db.prepare('SELECT realized FROM tx_history WHERE tx_id = ?').get(txId) as { realized: number | null } | undefined)
    ?.realized ?? null;
