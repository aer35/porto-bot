import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { commitChange } = await import('../components/userLedger.js');
const { holdingsOf: storedHoldings, realizedOf } = await import('../queries/holdings.js');
// node:sqlite rows have a null prototype; copy them so they compare equal to plain literals.
const holdingsOf = (userId: string) => storedHoldings(userId).map((p) => ({ ...p }));
const { userRows } = await import('../queries/transactions.js');
const { UserError } = await import('../components/userError.js');

const trade = (user_id: string, side: 'BUY' | 'SELL', shares: number): NewTx => ({
  user_id, sec_type: 'STOCK', side, ticker: 'AAPL', shares, price: 10, trade_date: 86_400, split_from: null, split_to: null,
  opt_right: null, strike: null, expiry: null,
});

test('commitChange writes valid changes and returns the stored row', () => {
  const stored = commitChange('a', { insert: trade('a', 'BUY', 10) })!;
  assert.ok(stored.id > 0 && stored.created_at > 0);
  assert.equal(commitChange('a', { update: { ...stored, shares: 12 } })!.shares, 12);
  assert.deepEqual(holdingsOf('a'), [{ sec_type: 'STOCK', ticker: 'AAPL', shares: 12, avgCost: 10, opt_right: null, strike: null, expiry: null }]);
});

test('commitChange rejects a change that would go negative and writes nothing', () => {
  const buy = commitChange('b', { insert: trade('b', 'BUY', 10) })!;
  commitChange('b', { insert: trade('b', 'SELL', 10) });
  const before = userRows('b');

  assert.throws(() => commitChange('b', { insert: trade('b', 'SELL', 1) }), UserError);
  assert.throws(() => commitChange('b', { update: { ...buy, shares: 9 } }), UserError);
  assert.throws(() => commitChange('b', { delete: buy }), UserError);
  assert.deepEqual(userRows('b'), before);
});

test('ledgers are per user', () => {
  commitChange('c', { insert: trade('c', 'BUY', 1) });
  assert.throws(() => commitChange('d', { insert: trade('d', 'SELL', 1) }), UserError);
});

test('references number each transaction type, and are never reused', () => {
  // Counters are shared by the whole bot, so compare the numbers rather than fixing them.
  const seq = (ref: string) => Number(ref.slice(3));
  const buy1 = commitChange('r', { insert: trade('r', 'BUY', 10) })!;
  const buy2 = commitChange('r', { insert: trade('r', 'BUY', 10) })!;
  const sell1 = commitChange('r', { insert: trade('r', 'SELL', 1) })!;
  assert.match(buy1.ref, /^BSS\d\d+$/);
  assert.match(sell1.ref, /^SSS\d\d+$/);
  assert.equal(seq(buy2.ref), seq(buy1.ref) + 1);

  // Deleting the newest buy must not hand its reference to the next one.
  commitChange('r', { delete: buy2 });
  assert.equal(seq(commitChange('r', { insert: trade('r', 'BUY', 5) })!.ref), seq(buy2.ref) + 1);
});

test('amending a buy into a sell gives it a sell reference', () => {
  commitChange('s', { insert: trade('s', 'BUY', 10) });
  const second = commitChange('s', { insert: trade('s', 'BUY', 4) })!;
  const amended = commitChange('s', { update: { ...second, side: 'SELL' } })!;
  assert.match(amended.ref, /^SSS\d\d+$/);
  assert.equal(amended.side, 'SELL');
});

test('a split gets an XSS reference from the ref_prefixes table', () => {
  commitChange('x', { insert: trade('x', 'BUY', 10) });
  const split = commitChange('x', {
    insert: { user_id: 'x', sec_type: 'SPLIT', side: null, ticker: 'AAPL', shares: null, price: null, trade_date: 86_400, split_from: 1, split_to: 2,
      opt_right: null, strike: null, expiry: null },
  })!;
  assert.match(split.ref, /^XSS\d\d+$/);
});

test('option trades get BOC/BOP/SOC/SOP references by side and right', () => {
  const option = (side: 'BUY' | 'SELL', opt_right: 'CALL' | 'PUT'): NewTx => ({
    ...trade('o', side, 1), sec_type: 'OPTION', opt_right, strike: 150, expiry: 10 * 86_400,
  });
  const refs = [option('BUY', 'CALL'), option('BUY', 'PUT'), option('SELL', 'CALL'), option('SELL', 'PUT')].map(
    (tx) => commitChange('o', { insert: tx })!.ref.slice(0, 3),
  );
  assert.deepEqual(refs, ['BOC', 'BOP', 'SOC', 'SOP']);
});

test('realizedOf gives a stored sell its P/L, and anything else null', () => {
  const bought = commitChange('p', { insert: { ...trade('p', 'BUY', 10_000), price: 10 } })!;
  const sold = commitChange('p', { insert: { ...trade('p', 'SELL', 4000), price: 12.5 } })!;
  assert.equal(realizedOf(sold.id), 10); // 4 shares × $2.50
  assert.equal(realizedOf(bought.id), null);
});
