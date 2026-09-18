import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, table, total } from '../components/format.js';
import { historyLines } from '../components/historyLines.js';
import { replay, type Tx } from '../components/ledger.js';
import { messages } from '../strings/messages.js';

test('table left-aligns the first column and right-aligns the rest', () => {
  assert.equal(
    table([
      ['Ticker', 'Shares'],
      ['BRK.B', '5'],
    ]),
    '```\nTicker  Shares\nBRK.B        5\n```',
  );
});

test('money keeps at least 2 and at most 4 decimals, totals are always cents', () => {
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(0.00123), '$0.0012');
  assert.equal(total(853.33336), '$853.33');
});

test('every transaction renders as an action line then a metadata line', () => {
  const tx = {
    id: 1, ref: 'BS07', user_id: 'u', sec_type: 'STOCK' as const, side: 'BUY' as const, ticker: 'AAPL',
    shares: 10, price: 150, trade_date: 1767268800, created_at: 0, split_from: null, split_to: null,
  };
  assert.equal(
    messages.txLine(tx),
    '**BUY** 10 × shares of **AAPL** @ $150.00\n`BS07` · total $1,500.00 · <t:1767268800:D>',
  );
});

test('a transaction list puts a separator between entries', () => {
  assert.match(messages.txList(['a', 'b']), /^a\n─+\nb$/);
});

test('historyLines shows share counts before and after a split', () => {
  const base = { user_id: 'u', created_at: 0, ref: 'XX01', price: null, shares: null, side: null, split_from: null, split_to: null };
  const rows: Tx[] = [
    { ...base, id: 1, sec_type: 'STOCK', side: 'BUY', ticker: 'AAPL', shares: 5, price: 10, trade_date: 1 },
    { ...base, id: 2, sec_type: 'STOCK', side: 'BUY', ticker: 'MSFT', shares: 1, price: 10, trade_date: 2 },
    { ...base, id: 3, sec_type: 'SPLIT', ticker: 'AAPL', split_to: 3, split_from: 2, trade_date: 3 },
  ];
  const result = replay(rows);
  assert.ok(result.ok);
  assert.match(historyLines(result.history)[2], /\*\*SPLIT\*\* 3:2 of \*\*AAPL\*\* — 5 → 8 shares\n`XX01` · <t:3:D>/);
});
