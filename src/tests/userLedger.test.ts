import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { commitChange, ledgerOf } = await import('../components/userLedger.js');
const { userRows } = await import('../queries/transactions.js');
const { UserError } = await import('../components/userError.js');

const trade = (user_id: string, side: 'BUY' | 'SELL', shares: number): NewTx => ({
  user_id, sec_type: 'STOCK', side, ticker: 'AAPL', shares, price: 10, trade_date: 86_400, split_from: null, split_to: null,
});

test('commitChange writes valid changes and returns the stored row', () => {
  const stored = commitChange('a', { insert: trade('a', 'BUY', 10) })!;
  assert.ok(stored.id > 0 && stored.created_at > 0);
  assert.equal(commitChange('a', { update: { ...stored, shares: 12 } })!.shares, 12);
  assert.deepEqual(ledgerOf('a').positions, [{ ticker: 'AAPL', shares: 12, avgCost: 10 }]);
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
