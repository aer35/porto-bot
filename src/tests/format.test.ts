import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, total } from '../components/format.js';
import { historyLines } from '../components/historyLines.js';
import { replay, type Tx } from '../components/ledger.js';
import { messages } from '../strings/messages.js';

test('money keeps at least 2 and at most 4 decimals (8 below $1), totals are always cents', () => {
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(150.123456), '$150.1235');
  // Below a dollar, as coins often are, up to 8 decimals so the price does not show as $0.00.
  assert.equal(money(0.00001234), '$0.00001234');
  assert.equal(total(853.33336), '$853.33');
});

test('every transaction renders as an action line then a metadata line', () => {
  const tx = {
    id: 1, ref: 'BSS07', user_id: 'u', sec_type: 'STOCK' as const, side: 'BUY' as const, ticker: 'AAPL',
    shares: 1278, price: 150, trade_date: 1767268800, created_at: 0, split_from: null, split_to: null,
    opt_right: null, strike: null, expiry: null,
  };
  assert.equal(
    messages.txLine(tx),
    '**BUY** 12.78 × shares of **AAPL** @ $150.00\n`BSS07` · total $1,917.00 · <t:1767268800:D>',
  );
});

test('a holdings line shows decimal shares and a cost basis in dollars', () => {
  assert.equal(
    messages.holdingLine({ sec_type: 'STOCK', ticker: 'AAPL', shares: 1250, avgCost: 10, opt_right: null, strike: null, expiry: null }),
    '**AAPL** · 12.5 shares · avg $10.00 · cost $125.00',
  );
});


test('historyLines shows share counts before and after a split', () => {
  const base = {
    user_id: 'u', created_at: 0, ref: 'XX01', price: null, shares: null, side: null, split_from: null, split_to: null,
    opt_right: null, strike: null, expiry: null,
  };
  const rows: Tx[] = [
    { ...base, id: 1, sec_type: 'STOCK', side: 'BUY', ticker: 'AAPL', shares: 500, price: 10, trade_date: 1 },
    { ...base, id: 2, sec_type: 'STOCK', side: 'BUY', ticker: 'MSFT', shares: 100, price: 10, trade_date: 2 },
    { ...base, id: 3, sec_type: 'SPLIT', ticker: 'AAPL', split_to: 3, split_from: 2, trade_date: 3 },
  ];
  const result = replay(rows);
  assert.ok(result.ok);
  assert.match(historyLines(result.history)[2], /\*\*SPLIT\*\* 3:2 of \*\*AAPL\*\* — 5 → 7.5 shares\n`XX01` · <t:3:D>/);
});

test('a crypto transaction shows coins, truncated to 3 decimals, what they cost in total, and the price per coin', () => {
  const tx = {
    id: 1, ref: 'BCC01', user_id: 'u', sec_type: 'CRYPTO' as const, side: 'BUY' as const, ticker: 'BTC-USD',
    shares: 123_456_789, price: 100_000, trade_date: 1767268800, created_at: 0, split_from: null, split_to: null,
    opt_right: null, strike: null, expiry: null,
  };
  assert.equal(
    messages.txLine(tx),
    '**BUY** 1.234 × coins of **BTC-USD** for $123,456.79\n`BCC01` · $100,000.00 per coin · <t:1767268800:D>',
  );
});

const JAN_16 = Date.parse('2026-01-16T12:00:00Z') / 1000;
// Far enough ahead that the contract is never expired when the tests run.
const JAN_16_2099 = Date.parse('2099-01-16T12:00:00Z') / 1000;

test('an option transaction names the contract, and its total is 100 × contracts × price', () => {
  const tx = {
    id: 1, ref: 'BOC01', user_id: 'u', sec_type: 'OPTION' as const, side: 'BUY' as const, ticker: 'AAPL',
    shares: 2, price: 3.2, trade_date: 1767268800, created_at: 0, split_from: null, split_to: null,
    opt_right: 'CALL' as const, strike: 150, expiry: JAN_16,
  };
  assert.equal(
    messages.txLine(tx),
    '**BUY** 2 × CALL of **AAPL** $150.00 01/16/26 @ $3.20\n`BOC01` · total $640.00 · <t:1767268800:D>',
  );
});

test('an option holdings line names the contract and multiplies the cost basis by 100', () => {
  const put = { sec_type: 'OPTION' as const, ticker: 'AAPL', shares: 2, avgCost: 3.2, opt_right: 'PUT' as const, strike: 150, expiry: JAN_16_2099 };
  assert.equal(messages.holdingLine(put), '**AAPL PUT $150.00 01/16/99** · 2 contracts · avg $3.20 · cost $640.00');
});

test('an option held past its expiry stays in holdings, marked expired', () => {
  const put = { sec_type: 'OPTION' as const, ticker: 'AAPL', shares: 2, avgCost: 3.2, opt_right: 'PUT' as const, strike: 150, expiry: JAN_16 };
  assert.equal(messages.holdingLine(put), '**AAPL PUT $150.00 01/16/26** (expired) · 2 contracts · avg $3.20 · cost $640.00');
  assert.equal(messages.holdingRow(put), '**AAPL PUT $150.00 01/16/26** (expired) · 2 · $3.20 · $640.00');
});

test('a sell shows its realized P/L when known, signed', () => {
  const tx = {
    id: 1, ref: 'SSS02', user_id: 'u', sec_type: 'STOCK' as const, side: 'SELL' as const, ticker: 'AAPL',
    shares: 500, price: 180, trade_date: 1767268800, created_at: 0, split_from: null, split_to: null,
    opt_right: null, strike: null, expiry: null,
  };
  assert.equal(messages.txLine(tx, { realized: 150 }).split('\n')[1], '`SSS02` · total $900.00 · P/L +$150.00 · <t:1767268800:D>');
  assert.equal(messages.txLine(tx, { realized: -0.5 }).split('\n')[1], '`SSS02` · total $900.00 · P/L -$0.50 · <t:1767268800:D>');
  assert.equal(messages.txLine(tx).split('\n')[1], '`SSS02` · total $900.00 · <t:1767268800:D>');
});

test('a priced holdings line adds the current price, current value and unrealized P/L', () => {
  const aapl = { sec_type: 'STOCK' as const, ticker: 'AAPL', shares: 1250, avgCost: 10, opt_right: null, strike: null, expiry: null };
  assert.equal(
    messages.holdingLine({ ...aapl, price: 12 }),
    '**AAPL** · 12.5 shares · avg $10.00 · cost $125.00 · price $12.00 · value $150.00 · P/L +$25.00',
  );
  const put = { ...aapl, sec_type: 'OPTION' as const, shares: 2, avgCost: 3.2, opt_right: 'PUT' as const, strike: 150, expiry: JAN_16 };
  assert.match(messages.holdingLine({ ...put, price: 1.2 }), / · price \$1\.20 · value \$240\.00 · P\/L -\$400\.00$/);
  assert.doesNotMatch(messages.holdingLine({ ...aapl, price: null }), /price/);
});
