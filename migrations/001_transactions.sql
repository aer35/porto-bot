-- The whole ledger. Positions are never stored; they are derived by replaying a user's rows
-- (src/components/ledger.ts), so there is nothing to drift out of sync.
CREATE TABLE transactions (
  -- AUTOINCREMENT so a deleted ID is never reused: users type IDs into /amend and /delete,
  -- and a recycled ID could point them at a row they did not mean.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Discord user snowflake, stored as text because it overflows a JS number.
  user_id TEXT NOT NULL,
  -- 'STOCK' or 'SPLIT'. Deliberately no CHECK constraint: V2 adds 'OPTION', and SQLite cannot
  -- alter a CHECK without rebuilding the table.
  sec_type TEXT NOT NULL,
  -- 'BUY' or 'SELL' for STOCK rows, NULL for SPLIT rows.
  side TEXT CHECK (side IN ('BUY', 'SELL')),
  ticker TEXT NOT NULL,
  -- Whole shares and per-share price for STOCK rows, NULL for SPLIT rows.
  shares INTEGER,
  price REAL,
  -- Unix seconds, 12:00 UTC on the trade's calendar date. Noon keeps Discord's <t:unix:D>
  -- showing the same calendar date for every viewer between UTC-11 and UTC+11.
  trade_date INTEGER NOT NULL,
  -- Unix seconds at insert. Orders rows that share a trade_date; id breaks any remaining tie.
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- SPLIT rows only: split_from old shares become split_to new shares (3:2 → from 2, to 3).
  split_from INTEGER,
  split_to INTEGER
);

-- Every read is "one user's rows", sometimes narrowed to one ticker.
CREATE INDEX transactions_user_ticker ON transactions (user_id, ticker);
