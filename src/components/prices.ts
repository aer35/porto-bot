import { heldPositions, lastFetchedAt, priceOf, savePrice } from '../queries/prices.js';
import type { Position } from './ledger.js';
import { toDateString } from './validate.js';

// Price data from Yahoo Finance's chart endpoint; see "Price data" in CLAUDE.md for why this
// source, its limits, and the symbol formats. Everything provider-specific is in priceSymbol and
// getPrice, so swapping providers means rewriting those two.

type Priced = Pick<Position, 'sec_type' | 'ticker' | 'opt_right' | 'strike' | 'expiry'>;

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

// A position with its latest stored price, null until the nightly job has one.
export type Holding = Position & { price?: number | null };

// Totals of some holdings: cost basis, value at current prices with holdings that have no price
// counted at cost (null when none has a price), and how many have no price.
export type Totals = { cost: number; current: number | null; unpriced: number };

export const withPrices = (positions: Position[]): Holding[] =>
  positions.map((p) => ({ ...p, price: priceOf(priceSymbol(p)) }));

// Every symbol some member holds, once each.
export const heldSymbols = () => [...new Set(heldPositions().map(priceSymbol))];

// Yahoo answers HTTP 429 when it throttles; the job backs off and retries on this.
export class RateLimited extends Error {}

// The latest price of one symbol, or null if Yahoo has none (unknown symbol, delisted, or a
// contract it does not list). The User-Agent matters: Yahoo throttles requests that send none.
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
  const body = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] | null } };
  const price = body.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof price === 'number' && price > 0 ? price : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits after a 429 before retrying the same symbol: 30 s, then 60 s, then 120 s, then give up on it.
const BACKOFF_MS = [30_000, 60_000, 120_000];

// Fetches every held symbol one at a time, `gapMs` apart, storing each price as it arrives, so a
// crash halfway keeps what was fetched. Returns how many were stored and which had no price.
export async function fetchPrices(get = getPrice, wait = sleep, gapMs = 1_000) {
  const missing: string[] = [];
  let fetched = 0;
  for (const symbol of heldSymbols()) {
    let price: number | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        price = await get(symbol);
        break;
      } catch (err) {
        if (!(err instanceof RateLimited) || attempt === BACKOFF_MS.length) {
          console.error(`price ${symbol}:`, err);
          break;
        }
        await wait(BACKOFF_MS[attempt]);
      }
    }
    if (price === null) missing.push(symbol);
    else {
      savePrice(symbol, price, Math.floor(Date.now() / 1000));
      fetched++;
    }
    await wait(gapMs);
  }
  console.log(`${new Date().toISOString()} prices fetched=${fetched} missing=${missing.join(',') || 'none'}`);
  return { fetched, missing };
}

// Date and hour in New York, where the US market closes at 16:00. Deliberately not the configured
// TZ, which only decides what "today" means for trade dates.
function newYork(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

// Prices are fetched once a day, after 17:00 in New York, so stock prices are that day's close.
// `lastRun` is unix seconds of the previous run, or null.
export function dueForPrices(now: Date, lastRun: number | null) {
  const today = newYork(now);
  if (today.hour < 17) return false;
  if (lastRun === null) return true;
  const last = newYork(new Date(lastRun * 1000));
  return !(last.day === today.day && last.hour >= 17);
}

// Checks every hour whether the nightly fetch is due, so a restart catches up the same evening.
// The last run lives in memory, seeded from the newest stored price.
export function schedulePrices() {
  let lastRun = lastFetchedAt();
  let running = false;
  const tick = async () => {
    if (running || !dueForPrices(new Date(), lastRun)) return;
    running = true;
    try {
      await fetchPrices();
    } catch (err) {
      console.error(err);
    } finally {
      lastRun = Math.floor(Date.now() / 1000);
      running = false;
    }
  };
  setInterval(tick, 60 * 60 * 1000);
  void tick();
}
