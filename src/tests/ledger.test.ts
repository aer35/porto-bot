import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, replay, type Position, type Tx } from '../components/ledger.js';

let nextId = 1;
const DAY = 86_400;
const row = (fields: Partial<Tx>): Tx => ({
  id: nextId++,
  ref: `BS${nextId}`,
  user_id: 'u1',
  sec_type: 'STOCK',
  side: null,
  ticker: 'AAPL',
  shares: null,
  price: null,
  trade_date: DAY,
  created_at: 0,
  split_from: null,
  split_to: null,
  opt_right: null,
  strike: null,
  expiry: null,
  ...fields,
});
const buy = (shares: number, price: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ side: 'BUY', shares, price, trade_date: day * DAY, ...fields });
const sell = (shares: number, price: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ side: 'SELL', shares, price, trade_date: day * DAY, ...fields });
const split = (to: number, from: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ sec_type: 'SPLIT', split_to: to, split_from: from, trade_date: day * DAY, ...fields });

const NOT_OPTION = { opt_right: null, strike: null, expiry: null };

// replay() leaves positions unordered (holdingsOf orders them on read); sort for stable comparisons.
const sorted = (positions: Position[]) =>
  positions.toSorted((a, b) => `${a.ticker} ${a.sec_type}`.localeCompare(`${b.ticker} ${b.sec_type}`));

// Positions without sec_type, which every stock-only test here would repeat.
function positions(rows: Tx[]) {
  const result = replay(rows);
  assert.ok(result.ok, 'expected replay to succeed');
  return sorted(result.positions).map(({ ticker, shares, avgCost }) => ({ ticker, shares, avgCost }));
}

test('no rows means no positions', () => {
  assert.deepEqual(positions([]), []);
});

test('buys blend average cost', () => {
  assert.deepEqual(positions([buy(10, 100), buy(30, 120)]), [{ ticker: 'AAPL', shares: 40, avgCost: 115 }]);
});

test('sells reduce shares and leave average cost unchanged', () => {
  assert.deepEqual(positions([buy(10, 100), buy(10, 200), sell(5, 999)]), [
    { ticker: 'AAPL', shares: 15, avgCost: 150 },
  ]);
});

test('selling to zero removes the position, and a later buy starts a fresh average', () => {
  assert.deepEqual(positions([buy(10, 100), sell(10, 120)]), []);
  assert.deepEqual(positions([buy(10, 100, 1), sell(10, 120, 2), buy(5, 50, 3)]), [
    { ticker: 'AAPL', shares: 5, avgCost: 50 },
  ]);
});

test('positions are tracked per ticker', () => {
  assert.deepEqual(positions([buy(1, 10, 1, { ticker: 'MSFT' }), buy(2, 20)]), [
    { ticker: 'AAPL', shares: 2, avgCost: 20 },
    { ticker: 'MSFT', shares: 1, avgCost: 10 },
  ]);
});

test('overselling is rejected and reports the offending row', () => {
  const bad = sell(11, 100, 2);
  assert.deepEqual(replay([buy(10, 100), bad]), { ok: false, oversold: bad });
});

test('selling a ticker never held is rejected', () => {
  const bad = sell(1, 100, 1, { ticker: 'MSFT' });
  assert.deepEqual(replay([buy(10, 100), bad]), { ok: false, oversold: bad });
});

test('forward split multiplies shares and divides average cost', () => {
  assert.deepEqual(positions([buy(10, 90, 1), split(3, 1, 2)]), [{ ticker: 'AAPL', shares: 30, avgCost: 30 }]);
});

test('reverse split divides shares and multiplies average cost', () => {
  assert.deepEqual(positions([buy(100, 2, 1), split(1, 10, 2)]), [{ ticker: 'AAPL', shares: 10, avgCost: 20 }]);
});

test('split rounding is half-up and the remainder is discarded', () => {
  // 5 × 3/2 = 7.5 → 8
  assert.equal(positions([buy(5, 30, 1), split(3, 2, 2)])[0].shares, 8);
  // 7 × 3/2 = 10.5 → 11; 3 × 3/2 = 4.5 → 5; 1 × 3/2 = 1.5 → 2
  assert.equal(positions([buy(7, 30, 1), split(3, 2, 2)])[0].shares, 11);
  // 14 × 1/10 = 1.4 → 1
  assert.equal(positions([buy(14, 30, 1), split(1, 10, 2)])[0].shares, 1);
  // 4 × 1/10 = 0.4 → 0, position disappears
  assert.deepEqual(positions([buy(4, 30, 1), split(1, 10, 2)]), []);
});

test('a split only affects its own ticker and positions held before it', () => {
  assert.deepEqual(positions([buy(10, 10, 1), split(2, 1, 2), buy(5, 10, 3), buy(1, 1, 1, { ticker: 'MSFT' })]), [
    { ticker: 'AAPL', shares: 25, avgCost: 6 },
    { ticker: 'MSFT', shares: 1, avgCost: 1 },
  ]);
});

test('a split on a ticker with no position does nothing', () => {
  assert.deepEqual(positions([split(2, 1, 1)]), []);
});

test('replay orders by trade date, not input order', () => {
  // Sell dated after the buy is valid even when it appears first in the input.
  assert.deepEqual(positions([sell(5, 100, 2), buy(10, 100, 1)]), [{ ticker: 'AAPL', shares: 5, avgCost: 100 }]);
});

test('within a day, replay orders by created_at, then id', () => {
  const s = sell(5, 100, 1, { created_at: 1 });
  const b = buy(10, 100, 1, { created_at: 2 });
  assert.deepEqual(replay([b, s]), { ok: false, oversold: s });

  const early = buy(10, 100, 1, { id: 1000 });
  const late = sell(10, 100, 1, { id: 1001 });
  assert.equal(replay([late, early]).ok, true);
});

test('history records the position held before and after each row, in replay order', () => {
  const b = buy(5, 30, 1);
  const sp = split(3, 2, 2);
  const s = sell(3, 30, 3);
  const result = replay([s, sp, b]);
  assert.ok(result.ok);
  assert.deepEqual(result.history, [
    { tx: b, before: 0, after: 5, realized: null },
    { tx: sp, before: 5, after: 8, realized: null },
    { tx: s, before: 8, after: 5, realized: 3 * (30 - 20) / 1000 },
  ]);
});

test('applyChange insert appends a row that sorts after existing rows on the same date', () => {
  const b = buy(10, 100, 1, { created_at: 50 });
  const { id, created_at, ref, ...fields } = sell(10, 100, 1);
  const next = applyChange([b], { insert: fields });
  assert.equal(next.length, 2);
  assert.equal(replay(next).ok, true);
  assert.ok(next[1].id > b.id && next[1].created_at >= b.created_at);
});

test('applyChange update replaces the row with the same id', () => {
  const b = buy(10, 100);
  const s = sell(5, 100);
  const next = applyChange([b, s], { update: { ...s, shares: 11 } });
  assert.deepEqual(next, [b, { ...s, shares: 11 }]);
  assert.equal(replay(next).ok, false);
});

test('applyChange delete removes the row with that id', () => {
  const b = buy(10, 100);
  const s = sell(5, 100);
  const next = applyChange([b, s], { delete: b });
  assert.deepEqual(next, [s]);
  assert.equal(replay(next).ok, false);
});

test('crypto blends average cost at its own scale, with fractional amounts', () => {
  const coin = { sec_type: 'CRYPTO' as const, ticker: 'BTC-USD' };
  // 0.00034 BTC at $100,000, then 0.00066 BTC at $50,000: 0.001 BTC at $67,000.
  const result = replay([buy(34_000, 100_000, 1, coin), buy(66_000, 50_000, 2, coin), sell(50_000, 1, 3, coin)]);
  assert.ok(result.ok);
  assert.deepEqual(result.positions, [{ ...NOT_OPTION, sec_type: 'CRYPTO', ticker: 'BTC-USD', shares: 50_000, avgCost: 67_000 }]);
});

test('a crypto sell cannot go below zero', () => {
  const coin = { sec_type: 'CRYPTO' as const, ticker: 'BTC-USD' };
  const bad = sell(34_001, 1, 2, coin);
  assert.deepEqual(replay([buy(34_000, 1, 1, coin), bad]), { ok: false, oversold: bad });
});

test('stock and crypto positions are separate even under the same ticker, and splits only touch stock', () => {
  const result = replay([buy(100, 10, 1), buy(100, 10, 1, { sec_type: 'CRYPTO' }), split(2, 1, 2)]);
  assert.ok(result.ok);
  assert.deepEqual(sorted(result.positions), [
    { ...NOT_OPTION, sec_type: 'CRYPTO', ticker: 'AAPL', shares: 100, avgCost: 10 },
    { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'AAPL', shares: 200, avgCost: 5 },
  ]);
});

test('options are separate positions per right, strike and expiry, and blend average cost within one', () => {
  const call150 = { sec_type: 'OPTION' as const, opt_right: 'CALL' as const, strike: 150, expiry: 100 * DAY };
  const result = replay([
    buy(2, 3, 1, call150),
    buy(2, 5, 2, call150),
    buy(1, 9, 2, { ...call150, strike: 160 }),
    buy(1, 9, 2, { ...call150, expiry: 200 * DAY }),
    buy(1, 9, 2, { ...call150, opt_right: 'PUT' }),
    sell(1, 7, 3, call150),
    buy(5, 1, 3), // AAPL stock is its own position too
  ]);
  assert.ok(result.ok);
  assert.deepEqual(
    result.positions.map((p) => [p.sec_type, p.opt_right, p.strike, p.expiry, p.shares, p.avgCost]).sort(),
    [
      // .sort() compares as text, so expiry 17280000 (day 200) sorts before 8640000 (day 100).
      ['OPTION', 'CALL', 150, 200 * DAY, 1, 9],
      ['OPTION', 'CALL', 150, 100 * DAY, 3, 4],
      ['OPTION', 'CALL', 160, 100 * DAY, 1, 9],
      ['OPTION', 'PUT', 150, 100 * DAY, 1, 9],
      ['STOCK', null, null, null, 5, 1],
    ],
  );
});

test('selling an option contract you do not hold at that strike is rejected', () => {
  const call = { sec_type: 'OPTION' as const, opt_right: 'CALL' as const, strike: 150, expiry: 100 * DAY };
  const bad = sell(1, 1, 2, { ...call, strike: 155 });
  assert.deepEqual(replay([buy(1, 1, 1, call), bad]), { ok: false, oversold: bad });
});

// Realized P/L of each SELL row, in replay order.
function realized(rows: Tx[]) {
  const result = replay(rows);
  assert.ok(result.ok);
  return result.history.filter((h) => h.tx.side === 'SELL').map((h) => h.realized);
}

test('realized P/L uses the average cost at the moment of each sale', () => {
  // 10 @ $100, 10 @ $200 → avg $150; sell 5 @ $180 → +$150. Then 10 @ $50 → avg (15×150 + 10×50)/25 = $110;
  // sell 25 @ $100 → -$250.
  assert.deepEqual(
    realized([buy(10_000, 100, 1), buy(10_000, 200, 2), sell(5000, 180, 3), buy(10_000, 50, 4), sell(25_000, 100, 5)]),
    [150, -250],
  );
});

test('realized P/L for crypto divides by its own scale, and for options multiplies by 100', () => {
  const coin = { sec_type: 'CRYPTO' as const, ticker: 'BTC-USD' };
  assert.deepEqual(realized([buy(50_000_000, 40_000, 1, coin), sell(10_000_000, 50_000, 2, coin)]), [1000]);
  const call = { sec_type: 'OPTION' as const, opt_right: 'CALL' as const, strike: 150, expiry: 100 * DAY };
  assert.deepEqual(realized([buy(2, 3, 1, call), sell(1, 4.5, 2, call)]), [150]);
});
