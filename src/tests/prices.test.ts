import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewTx } from '../components/ledger.js';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { apiUp, fetchPrices, getPrice, heldSymbols, marketOpen, priceSymbol, RateLimited } = await import('../components/prices.js');
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

test('getPrice reads the price and the previous close from the chart endpoint', async () => {
  const { fn, calls } = fakeFetch(200, { chart: { result: [{ meta: { regularMarketPrice: 187.44, chartPreviousClose: 185 } }], error: null } });
  assert.deepEqual(await getPrice('BRK-B', fn), { price: 187.44, prevClose: 185 });
  assert.equal(calls[0].url, 'https://query1.finance.yahoo.com/v8/finance/chart/BRK-B?range=1d&interval=1d');
  assert.ok(calls[0].headers['User-Agent'], 'sends a User-Agent, which Yahoo expects');
});

test('getPrice keeps a price that comes without a previous close', async () => {
  assert.deepEqual(await getPrice('NEW', fakeFetch(200, { chart: { result: [{ meta: { regularMarketPrice: 3 } }] } }).fn), { price: 3, prevClose: null });
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
    return symbol === 'BRK-B' ? null : { price: 100 + asked.length, prevClose: 99 };
  };
  const result = await fetchPrices(fakeGetPrice, async (ms) => void pauses.push(ms), 1_000);

  assert.deepEqual(asked.toSorted(), ['AAPL', 'BRK-B', 'BTC-USD', 'BTC-USD']);
  assert.deepEqual(result, { fetched: 2, missing: ['BRK-B'] });
  assert.ok(priceOf('AAPL').price! > 100 && priceOf('BTC-USD').price! > 100);
  assert.equal(priceOf('AAPL').prevClose, 99);
  assert.deepEqual(priceOf('BRK-B'), { price: null, prevClose: null, failed: true }, 'no data from Yahoo is remembered as a failure');
  assert.ok(pauses.some((ms) => ms >= 30_000), 'backs off after a 429');
});

test('prices are fetched while the US market is open, by New York time, plus one fetch just after the close', () => {
  const at = (iso: string) => marketOpen(new Date(iso));
  // 9:30 to 16:00 in New York is 13:30 to 20:00 UTC in summer (EDT, UTC-4)...
  assert.equal(at('2026-03-10T13:29:00Z'), false, 'Tuesday 09:29 EDT');
  assert.equal(at('2026-03-10T13:30:00Z'), true, 'Tuesday 09:30 EDT, the open');
  assert.equal(at('2026-03-10T20:10:00Z'), true, '16:10 EDT, the fetch that stores the close');
  assert.equal(at('2026-03-10T20:11:00Z'), false, '16:11 EDT');
  // ...and 14:30 to 21:00 UTC in winter (EST, UTC-5), so a fixed UTC window would be an hour off.
  assert.equal(at('2026-01-13T13:45:00Z'), false, 'Tuesday 08:45 EST');
  assert.equal(at('2026-01-13T14:30:00Z'), true, 'Tuesday 09:30 EST');
  assert.equal(at('2026-01-13T21:05:00Z'), true, '16:05 EST');
  assert.equal(at('2026-03-14T15:00:00Z'), false, 'Saturday');
  assert.equal(at('2026-03-15T15:00:00Z'), false, 'Sunday');
});

test('withPrices attaches each holding its stored price, or null', async () => {
  const { withPrices } = await import('../components/prices.js');
  const { savePrice } = await import('../queries/prices.js');
  savePrice('BRK-B', 500, 490, Math.floor(Date.now() / 1000));
  const priced = withPrices([
    { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'BRK.B', shares: 100, avgCost: 400 },
    { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'ZZZZ', shares: 100, avgCost: 1 },
  ]);
  assert.deepEqual(priced.map((p) => [p.price, p.prevClose, p.priceFailed]), [[500, 490, false], [null, null, false]]);
});

test('a price older than 4 days counts as no price, so a stale one is never shown as current', async () => {
  const { savePrice } = await import('../queries/prices.js');
  const now = Math.floor(Date.now() / 1000);
  // Friday's close is still shown on Tuesday morning after a holiday Monday, 89.5 hours later.
  savePrice('FRESH', 10, 9, now - 90 * 3600);
  savePrice('STALE', 10, 9, now - 97 * 3600);
  assert.equal(priceOf('FRESH').price, 10);
  assert.equal(priceOf('STALE').price, null);
});

test('a failed fetch counts until a fetch succeeds, but never hides a price that is still fresh', async () => {
  const { savePrice, saveFailure } = await import('../queries/prices.js');
  const now = Math.floor(Date.now() / 1000);
  saveFailure('DOWN', now);
  assert.deepEqual(priceOf('DOWN'), { price: null, prevClose: null, failed: true });
  savePrice('DOWN', 5, 4, now);
  assert.deepEqual(priceOf('DOWN'), { price: 5, prevClose: 4, failed: false });

  savePrice('BLIP', 5, 4, now - 36 * 3600);
  saveFailure('BLIP', now);
  assert.deepEqual(priceOf('BLIP'), { price: 5, prevClose: 4, failed: false }, "yesterday's price outlasts one failed night");

  saveFailure('OLD', now - 97 * 3600);
  assert.deepEqual(priceOf('OLD'), { price: null, prevClose: null, failed: false }, 'a failure older than 4 days is forgotten, like a price');
});

test('apiUp is true only when Yahoo answers with a price, and never throws', async () => {
  assert.equal(await apiUp(async () => ({ price: 580.12, prevClose: 579 })), true);
  assert.equal(await apiUp(async () => null), false);
  assert.equal(await apiUp(async () => { throw new RateLimited(); }), false);
  assert.equal(await apiUp(async () => { throw new DOMException('timed out', 'TimeoutError'); }), false);
});
