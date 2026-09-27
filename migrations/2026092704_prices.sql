-- The latest price of every symbol any member holds, filled by the nightly price job
-- (src/components/prices.ts). Commands read prices from here and never wait on the network.
-- A symbol with no row has no price yet, and is shown at cost basis only.
CREATE TABLE prices (
  -- Yahoo Finance's symbol for the position (priceSymbol): AAPL, BRK-B, BTC-USD, AAPL260116C00150000.
  symbol TEXT PRIMARY KEY,
  -- Per share, coin, or share of an option contract, in USD, as Yahoo quotes it.
  price REAL NOT NULL,
  -- Unix seconds when it was fetched.
  fetched_at INTEGER NOT NULL
);
