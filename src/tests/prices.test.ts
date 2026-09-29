import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { dueForPrices, fetchPrices, getPrice, heldSymbols, priceSymbol, RateLimited } = await import('../components/prices.js');
const { priceOf } = await import('../queries/prices.js');
const { commitChange } = await import('../components/userLedger.js');

const NOT_OPTION = { opt_right: null, strike: null, expiry: null };
const JAN_16 = Date.parse('2026-01-16T12:00:00Z') / 1000;

test('priceSymbol writes each position the way Yahoo names it', () => {
  assert.equal(priceSymbol({ ...NOT_OPTION, sec_type: 'STOCK', ticker: 'AAPL' }), 'AAPL');
  assert.equal(priceSymbol({ ...NOT_OPTION, sec_type: 'STOCK', ticker: 'BRK.B' }), 'BRK-B');
  assert.equal(priceSymbol({ ...NOT_OPTION, sec_type: 'CRYPTO', ticker: 'BTC-USD' }), 'BTC-USD');
  const option = { sec_type: 'OPTION' as const, ticker: 'AAPL', opt_right: 'CALL' as const, strike: 150, expiry: JAN_16 };
  assert.equal(priceSymbol(option), 'AAPL260116C00150000');
  assert.equal(priceSymbol({ ...option, opt_right: 'PUT', strike: 7.5 }), 'AAPL260116P00007500');
});

// A stand-in for fetch that records the request and answers with `status` and `body`.
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn: fn as typeof fetch, calls };
}

test('getPrice reads regularMarketPrice from the chart endpoint', async () => {
  const { fn, calls } = fakeFetch(200, { chart: { result: [{ meta: { regularMarketPrice: 187.44 } }], error: null } });
  assert.equal(await getPrice('BRK-B', fn), 187.44);
  assert.equal(calls[0].url, 'https://query1.finance.yahoo.com/v8/finance/chart/BRK-B?range=1d&interval=1d');
  assert.ok(calls[0].headers['User-Agent'], 'sends a User-Agent, which Yahoo expects');
});

test('getPrice is null when Yahoo has no price for the symbol', async () => {
  assert.equal(await getPrice('NOPE', fakeFetch(404, { chart: { result: null, error: { code: 'Not Found' } } }).fn), null);
  assert.equal(await getPrice('NOPE', fakeFetch(200, { chart: { result: [{ meta: {} }] } }).fn), null);
});

test('getPrice gives up on a request Yahoo does not answer in time', async () => {
  // Never answers; only the abort signal ends the request.
  const hangs = ((_: unknown, init?: RequestInit) =>
    new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))) as typeof fetch;
  await assert.rejects(getPrice('AAPL', hangs, 50), { name: 'TimeoutError' });
});

test('getPrice throws RateLimited on HTTP 429', async () => {
  await assert.rejects(getPrice('AAPL', fakeFetch(429, {}).fn), RateLimited);
});

const buy = (user_id: string, fields: Partial<NewTx>): NewTx => ({
  user_id, sec_type: 'STOCK', side: 'BUY', ticker: 'AAPL', shares: 100, price: 1, trade_date: 86_400,
  split_from: null, split_to: null, ...NOT_OPTION, ...fields,
});

test('the price job fetches every distinct held symbol once, one at a time, and stores what it gets', async () => {
  commitChange('p1', { insert: buy('p1', {}) });
  commitChange('p2', { insert: buy('p2', {}) });
  commitChange('p2', { insert: buy('p2', { ticker: 'BRK.B' }) });
  commitChange('p2', { insert: buy('p2', { sec_type: 'CRYPTO', ticker: 'BTC-USD' }) });
  assert.deepEqual(heldSymbols().toSorted(), ['AAPL', 'BRK-B', 'BTC-USD']);

  const asked: string[] = [];
  const pauses: number[] = [];
  let limited = false;
  const fakeGetPrice = async (symbol: string) => {
    asked.push(symbol);
    // BTC-USD is throttled once, then answers; BRK-B has no data.
    if (symbol === 'BTC-USD' && !limited) {
      limited = true;
      throw new RateLimited();
    }
    return symbol === 'BRK-B' ? null : 100 + asked.length;
  };
  const result = await fetchPrices(fakeGetPrice, async (ms) => void pauses.push(ms), 1_000);

  assert.deepEqual(asked.toSorted(), ['AAPL', 'BRK-B', 'BTC-USD', 'BTC-USD']);
  assert.deepEqual(result, { fetched: 2, missing: ['BRK-B'] });
  assert.ok(priceOf('AAPL')! > 100 && priceOf('BTC-USD')! > 100);
  assert.equal(priceOf('BRK-B'), null);
  assert.ok(pauses.some((ms) => ms >= 30_000), 'backs off after a 429');
});

test('the price job is due once a day, after 17:00 in New York', () => {
  const at = (iso: string) => new Date(iso);
  // 2026-03-10 21:30 UTC is 17:30 in New York (EDT).
  assert.equal(dueForPrices(at('2026-03-10T21:30:00Z'), null), true);
  assert.equal(dueForPrices(at('2026-03-10T20:30:00Z'), null), false, 'before 17:00');
  const earlierToday = Date.parse('2026-03-10T21:05:00Z') / 1000;
  assert.equal(dueForPrices(at('2026-03-10T23:00:00Z'), earlierToday), false, 'already ran today');
  const yesterday = Date.parse('2026-03-09T22:00:00Z') / 1000;
  assert.equal(dueForPrices(at('2026-03-10T21:30:00Z'), yesterday), true);
});

test('withPrices attaches each holding its stored price, or null', async () => {
  const { withPrices } = await import('../components/prices.js');
  const { savePrice } = await import('../queries/prices.js');
  savePrice('BRK-B', 500, Math.floor(Date.now() / 1000));
  const priced = withPrices([
    { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'BRK.B', shares: 100, avgCost: 400 },
    { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'ZZZZ', shares: 100, avgCost: 1 },
  ]);
  assert.deepEqual(priced.map((p) => p.price), [500, null]);
});

test('a price older than 2 days counts as no price, so a stale one is never shown as current', async () => {
  const { savePrice } = await import('../queries/prices.js');
  const now = Math.floor(Date.now() / 1000);
  savePrice('FRESH', 10, now - 36 * 3600);
  savePrice('STALE', 10, now - 49 * 3600);
  assert.equal(priceOf('FRESH'), 10);
  assert.equal(priceOf('STALE'), null);
});
