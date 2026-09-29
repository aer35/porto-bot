-- The latest price of every symbol any member holds, filled by the nightly price job
-- (src/components/prices.ts). Commands read prices from here and never wait on the network.
-- A symbol with no row has not been fetched yet, and is shown at cost basis only.
CREATE TABLE prices (
  -- Yahoo Finance's symbol for the position (priceSymbol): AAPL, BRK-B, BTC-USD, AAPL260116C00150000.
  symbol TEXT PRIMARY KEY,
  -- Per share, coin, or share of an option contract, in USD, as Yahoo quotes it. NULL until Yahoo
  -- has given one.
  price REAL,
  -- Unix seconds when price was fetched; NULL with it.
  fetched_at INTEGER,
  -- Unix seconds of the latest failed fetch (a timeout, an HTTP error, or no price from Yahoo),
  -- so the bot can say "price unavailable" instead of showing nothing. A successful fetch clears it.
  failed_at INTEGER
);
