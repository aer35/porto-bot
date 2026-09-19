import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, replay, type Tx } from '../components/ledger.js';

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
  ...fields,
});
const buy = (shares: number, price: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ side: 'BUY', shares, price, trade_date: day * DAY, ...fields });
const sell = (shares: number, price: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ side: 'SELL', shares, price, trade_date: day * DAY, ...fields });
const split = (to: number, from: number, day = 1, fields: Partial<Tx> = {}) =>
  row({ sec_type: 'SPLIT', split_to: to, split_from: from, trade_date: day * DAY, ...fields });

function positions(rows: Tx[]) {
  const result = replay(rows);
  assert.ok(result.ok, 'expected replay to succeed');
  return result.positions;
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

test('positions are tracked per ticker and sorted by ticker', () => {
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

test('history records shares held of that ticker after each row, in replay order', () => {
  const b = buy(5, 30, 1);
  const sp = split(3, 2, 2);
  const s = sell(3, 30, 3);
  const result = replay([s, sp, b]);
  assert.ok(result.ok);
  assert.deepEqual(result.history, [
    { tx: b, shares: 5 },
    { tx: sp, shares: 8 },
    { tx: s, shares: 5 },
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
