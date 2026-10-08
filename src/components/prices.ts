import { heldPositions, priceOf, saveFailure, savePrice, type Priced } from '../queries/prices.js';
import type { Position } from './ledger.js';
import { toDateString } from './validate.js';

// Price data from Yahoo Finance's chart endpoint; see "Price data" in CLAUDE.md for why this
// source, its limits, and the symbol formats. Everything provider-specific is in priceSymbol and
// getPrice, so swapping providers means rewriting those two.

// Yahoo's symbol for a position. Share classes use a dash (BRK.B → BRK-B). An option is the OCC
// symbol without padding: root, expiry as YYMMDD, C or P, then the strike × 1000 in 8 digits,
// so AAPL CALL $150 2026-01-16 is AAPL260116C00150000.
export function priceSymbol(p: Priced) {
  if (p.sec_type === 'CRYPTO') return p.ticker;
  if (p.sec_type === 'STOCK') return p.ticker.replaceAll('.', '-');
  const yymmdd = toDateString(p.expiry!).slice(2).replaceAll('-', '');
  const strike = String(Math.round(p.strike! * 1000)).padStart(8, '0');
  return `${p.ticker}${yymmdd}${p.opt_right![0]}${strike}`;
}

// A position with its latest stored price and the previous close fetched with it, null until the
// price job has them. priceFailed is true when the job tried and got nothing (see priceOf), so
// views can say so instead of showing nothing.
export type Holding = Position & { price?: number | null; prevClose?: number | null; priceFailed?: boolean };

// Totals of some holdings: cost basis, value at current prices with holdings that have no price
// counted at cost (null when none has a price), and how many have no price.
export type Totals = { cost: number; current: number | null; unpriced: number };

export const withPrices = (positions: Position[]): Holding[] =>
  positions.map((p) => {
    const { price, prevClose, failed } = priceOf(priceSymbol(p));
    return { ...p, price, prevClose, priceFailed: failed };
  });

// Every symbol some member holds, once each.
export const heldSymbols = () => [...new Set(heldPositions().map(priceSymbol))];

// Yahoo answers HTTP 429 when it throttles; the job stops on this and leaves the rest to its next run.
export class RateLimited extends Error {}

// The latest price of one symbol and the previous session's close (null if Yahoo gives none), or
// null if Yahoo has no price (unknown symbol, delisted, or a contract it does not list). The
// User-Agent matters: Yahoo throttles requests that send none.
// Throws a TimeoutError if Yahoo has not answered within timeoutMs, so a hung request cannot stall the job.
export async function getPrice(symbol: string, fetchFn: typeof fetch = fetch, timeoutMs = 10_000) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; porto-bot)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new RateLimited(`Yahoo rate-limited ${symbol}`);
  if (!res.ok) {
    // 404 is Yahoo's answer for a symbol it does not know. Anything else (a block, an outage) is
    // logged, so a host can tell why prices stopped arriving.
    if (res.status !== 404) console.error(`price ${symbol}: HTTP ${res.status} from Yahoo`);
    return null;
  }
  type Meta = { regularMarketPrice?: number; chartPreviousClose?: number };
  const body = (await res.json()) as { chart?: { result?: { meta?: Meta }[] | null } };
  const meta = body.chart?.result?.[0]?.meta;
  const valid = (n: unknown) => (typeof n === 'number' && n > 0 ? n : null);
  const price = valid(meta?.regularMarketPrice);
  return price === null ? null : { price, prevClose: valid(meta?.chartPreviousClose) };
}

// Whether Yahoo is answering, for the bot's status: asks for SPY, which always trades. False on
// anything but a price (a timeout, an HTTP error, a 429, no data); never throws.
export const apiUp = (get = getPrice) =>
  get('SPY').then(
    (quote) => quote !== null,
    () => false,
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches every held symbol one at a time, `gapMs` apart, storing each price (or failure) as it
// arrives, so a crash halfway keeps what was fetched. A 429 ends the run without marking anything
// failed, since throttling is not the symbol's fault; the next run, 10 minutes later, starts over.
// Returns how many were stored and which had no price.
export async function fetchPrices(get = getPrice, wait = sleep, gapMs = 1_000) {
  const missing: string[] = [];
  let fetched = 0;
  for (const symbol of heldSymbols()) {
    let quote: Awaited<ReturnType<typeof getPrice>> = null;
    try {
      quote = await get(symbol);
    } catch (err) {
      console.error(`price ${symbol}:`, err);
      if (err instanceof RateLimited) break;
    }
    if (quote === null) {
      missing.push(symbol);
      saveFailure(symbol, Math.floor(Date.now() / 1000));
    } else {
      savePrice(symbol, quote.price, quote.prevClose, Math.floor(Date.now() / 1000));
      fetched++;
    }
    await wait(gapMs);
  }
  console.log(`${new Date().toISOString()} prices fetched=${fetched} missing=${missing.join(',') || 'none'}`);
  return { fetched, missing };
}

// Whether prices are worth fetching: Monday to Friday from the 9:30 open to 16:10 in New York. The
// ten minutes after the 16:00 close let one more fetch store the closing price. Crypto trades all
// week but is only fetched in these hours too. Read off the New York clock rather than fixed UTC
// hours, because daylight saving moves the market's UTC hours: 13:30-20:00 UTC in summer,
// 14:30-21:00 UTC in winter. Deliberately not the configured TZ, which only decides what "today"
// means for trade dates.
// ponytail: market holidays are not modelled, so the job also runs on them; prices just do not move.
export function marketOpen(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return part('weekday') !== 'Sat' && part('weekday') !== 'Sun' && minutes >= 9 * 60 + 30 && minutes <= 16 * 60 + 10;
}

// Fetches once at startup, then every 10 minutes while the market is open (see marketOpen). It runs
// in the background: no command waits on it, a run still going when the next is due is not
// doubled up, and nothing it throws reaches the bot.
export function schedulePrices() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await fetchPrices();
    } catch (err) {
      console.error('price job:', err);
    } finally {
      running = false;
    }
  };
  setInterval(() => marketOpen(new Date()) && void run(), 10 * 60 * 1000);
  void run();
}
