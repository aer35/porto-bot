import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const position = await import('../commands/position.js');
const { commitChange } = await import('../components/userLedger.js');

const NOT_OPTION = { opt_right: null, strike: null, expiry: null };
// Far enough ahead that the contracts are never expired when the tests run.
const JAN_16_2099 = Date.parse('2099-01-16T12:00:00Z') / 1000;
const trade = (fields: Partial<NewTx>): NewTx => ({
  user_id: 'm', sec_type: 'STOCK', side: 'BUY', ticker: 'AAPL', shares: 10_000, price: 100, trade_date: 86_400,
  split_from: null, split_to: null, ...NOT_OPTION, ...fields,
});
const option = (fields: Partial<NewTx>) =>
  trade({ sec_type: 'OPTION', shares: 2, price: 3, opt_right: 'CALL', strike: 150, expiry: JAN_16_2099, ...fields });

// Member m holds AAPL as shares and options, MSFT as shares only, SPY as options only, and has
// bought and sold a TSLA contract, so holds nothing there.
commitChange('m', { insert: trade({}) });
commitChange('m', { insert: option({}) });
commitChange('m', { insert: trade({ ticker: 'MSFT' }) });
commitChange('m', { insert: option({ ticker: 'SPY', opt_right: 'PUT', strike: 500 }) });
commitChange('m', { insert: option({ ticker: 'TSLA' }) });
commitChange('m', { insert: option({ ticker: 'TSLA', side: 'SELL', trade_date: 172_800 }) });

// Runs /position for `ticker` as typed, and returns the text of each text display in the reply.
async function show(ticker: string) {
  let reply: { components: { toJSON(): { components: { content?: string }[] } }[] } | undefined;
  await position.execute({
    options: { getString: () => ticker, getUser: () => null },
    user: { id: 'm' },
    reply: async (view: typeof reply) => void (reply = view),
  } as never);
  return reply!.components[0].toJSON().components.flatMap((c) => (c.content ? [c.content] : []));
}
// The holdings and total under the title.
const holdings = async (ticker: string) => (await show(ticker))[1].split('\n');

const SHARES = '**AAPL** · 10 SHARES · avg $100.00 · cost $1,000.00';
const CALL = '**AAPL CALL $150.00 01/16/99** · 2 CONTRACTS · avg $3.00 · cost $600.00';

test('/position on a ticker held as shares and options shows both, shares first, with the cost basis of each and in total', async () => {
  assert.deepEqual(await holdings('aapl'), [SHARES, CALL, '**Total cost basis** $1,600.00']);
});

test('/position on a ticker held as shares only shows the shares', async () => {
  assert.deepEqual(await holdings('MSFT'), ['**MSFT** · 10 SHARES · avg $100.00 · cost $1,000.00', '**Total cost basis** $1,000.00']);
});

test('/position on a ticker held as options only shows the contracts and their transactions', async () => {
  const texts = await show('SPY');
  assert.deepEqual(texts[1].split('\n'), ['**SPY PUT $500.00 01/16/99** · 2 CONTRACTS · avg $3.00 · cost $600.00', '**Total cost basis** $600.00']);
  assert.match(texts.join('\n'), /\*\*BUY\*\* 2 × PUT of \*\*SPY\*\*/);
});

test('/position on a ticker with nothing left held says so, not "no shares"', async () => {
  assert.deepEqual(await holdings('TSLA'), ['Nothing held.']);
});

// Runs /position's ticker autocomplete with `typed` focused, as member 'viewer', for `user` if given.
async function suggested(typed: string, user?: string) {
  let choices: { value: string }[] = [];
  await position.autocomplete({
    options: { get: (name: string) => (name === 'user' && user ? { value: user } : null), getFocused: () => typed },
    user: { id: user ? 'viewer' : 'm' },
    respond: async (c: typeof choices) => void (choices = c),
  } as never);
  return choices.map((c) => c.value);
}

test('/position suggests a ticker held only as options, for yourself and for another member', async () => {
  assert.deepEqual(await suggested('sp'), ['SPY']);
  assert.deepEqual(await suggested('SP', 'm'), ['SPY']);
  assert.deepEqual(await suggested('', 'm'), ['AAPL', 'MSFT', 'SPY'], 'each held ticker once, none sold out');
});
