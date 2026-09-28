import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, type NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { clearTicker, commitChange, rebuildAll, resetUser } = await import('../components/userLedger.js');
const { holdersOf, holdingsOf, historyPage } = await import('../queries/holdings.js');
const { userRows } = await import('../queries/transactions.js');
const { db } = await import('../queries/db.js');
const { UserError } = await import('../components/userError.js');

const DAY = 86_400;
const tx = (user_id: string, fields: Partial<NewTx>): NewTx => ({
  user_id, sec_type: 'STOCK', side: 'BUY', ticker: 'AAPL', shares: 1000, price: 10, trade_date: DAY,
  split_from: null, split_to: null, opt_right: null, strike: null, expiry: null, ...fields,
});
const split = (user_id: string, to: number, from: number, day: number): NewTx =>
  tx(user_id, { sec_type: 'SPLIT', side: null, shares: null, price: null, split_to: to, split_from: from, trade_date: day * DAY });

// What a full replay of the stored rows says, to compare the stored tables against.
function replayed(userId: string) {
  const result = replay(userRows(userId));
  assert.ok(result.ok);
  return result;
}

test('holdings and history match a full replay after buy, sell, amend, delete and split', () => {
  const u = 'h1';
  const first = commitChange(u, { insert: tx(u, {}) })!;
  commitChange(u, { insert: tx(u, { price: 20, trade_date: 2 * DAY }) });
  commitChange(u, { insert: tx(u, { ticker: 'MSFT', trade_date: 2 * DAY }) });
  const sold = commitChange(u, { insert: tx(u, { side: 'SELL', shares: 500, price: 30, trade_date: 3 * DAY }) })!;
  commitChange(u, { update: { ...first, price: 12 } });
  commitChange(u, { insert: split(u, 3, 2, 4) });
  commitChange(u, { delete: sold });

  const expected = replayed(u);
  // Rows read straight from node:sqlite have a null prototype; compare contents only. replay()
  // leaves positions unordered, and holdingsOf sorts by ticker.
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  const byTicker = expected.positions.toSorted((a, b) => a.ticker.localeCompare(b.ticker));
  assert.deepEqual(plain(holdingsOf(u)), plain(byTicker));
  assert.deepEqual(plain(historyPage(u, null, 100, 0).rows), plain(expected.history.toReversed()));
});

test('a failed write leaves holdings and history unchanged', () => {
  const u = 'h2';
  commitChange(u, { insert: tx(u, {}) });
  const [holdings, history] = [holdingsOf(u), historyPage(u, null, 100, 0).rows];
  assert.throws(() => commitChange(u, { insert: tx(u, { side: 'SELL', shares: 2000 }) }), UserError);
  assert.deepEqual(holdingsOf(u), holdings);
  assert.deepEqual(historyPage(u, null, 100, 0).rows, history);
});

test('a position sold to zero has no holdings row', () => {
  const u = 'h3';
  commitChange(u, { insert: tx(u, {}) });
  commitChange(u, { insert: tx(u, { side: 'SELL' }) });
  assert.deepEqual(holdingsOf(u), []);
});

test('history carries split counts and realized P/L, newest first, and pages by ticker', () => {
  const u = 'h4';
  commitChange(u, { insert: tx(u, { shares: 5000, price: 30 }) });
  commitChange(u, { insert: split(u, 3, 2, 2) });
  commitChange(u, { insert: tx(u, { side: 'SELL', shares: 3000, price: 30, trade_date: 3 * DAY }) });
  commitChange(u, { insert: tx(u, { ticker: 'MSFT', trade_date: 4 * DAY }) });

  assert.deepEqual(
    historyPage(u, null, 3, 0).rows.map(({ tx, before, after, realized }) => [tx.ticker, tx.sec_type, before, after, realized]),
    [
      ['MSFT', 'STOCK', 0, 1000, null],
      ['AAPL', 'STOCK', 7500, 4500, 30], // 3 shares × ($30 − $20 average after the split)
      ['AAPL', 'SPLIT', 5000, 7500, null],
    ],
  );
  const first = historyPage(u, 'AAPL', 2, 0);
  assert.deepEqual([first.page, first.pageCount], [0, 2]);
  assert.deepEqual(first.rows.map((h) => [h.tx.sec_type, h.tx.side]), [['STOCK', 'SELL'], ['SPLIT', null]]);
  const pastTheEnd = historyPage(u, 'AAPL', 2, 5);
  assert.equal(pastTheEnd.page, 1);
  assert.deepEqual(pastTheEnd.rows.map((h) => [h.tx.sec_type, h.tx.side]), [['STOCK', 'BUY']]);
  assert.equal(historyPage(u, 'TSLA', 2, 0).pageCount, 0);
  assert.equal(historyPage(u, null, 3, 0).pageCount, 2); // null pages across every ticker

});

test('holdersOf lists members who currently hold a stock', () => {
  commitChange('h5', { insert: tx('h5', { ticker: 'NVDA' }) });
  commitChange('h6', { insert: tx('h6', { ticker: 'NVDA' }) });
  commitChange('h6', { insert: tx('h6', { ticker: 'NVDA', side: 'SELL' }) });
  commitChange('h7', { insert: tx('h7', { ticker: 'NVDA', sec_type: 'CRYPTO' }) });
  assert.deepEqual(holdersOf('NVDA'), ['h5']);
});

test('clearTicker and resetUser keep holdings in step with the rows they delete', () => {
  const u = 'h8';
  commitChange(u, { insert: tx(u, {}) });
  commitChange(u, { insert: tx(u, { ticker: 'MSFT' }) });
  assert.equal(clearTicker(u, 'AAPL'), 1);
  assert.deepEqual(holdingsOf(u).map((p) => p.ticker), ['MSFT']);
  assert.equal(historyPage(u, null, 100, 0).rows.length, 1);
  assert.equal(resetUser(u), 1);
  assert.deepEqual(holdingsOf(u), []);
  assert.deepEqual(historyPage(u, null, 100, 0).rows, []);
});

test('rebuildAll fills holdings and history from transactions alone, as on first boot after upgrading', () => {
  const u = 'h9';
  commitChange(u, { insert: tx(u, {}) });
  commitChange(u, { insert: tx(u, { side: 'SELL', shares: 400, price: 15, trade_date: 2 * DAY }) });
  const [holdings, history] = [holdingsOf(u), historyPage(u, null, 100, 0).rows];
  db.exec('DELETE FROM holdings; DELETE FROM tx_history;');
  rebuildAll();
  assert.deepEqual(holdingsOf(u), holdings);
  assert.deepEqual(historyPage(u, null, 100, 0).rows, history);
});
