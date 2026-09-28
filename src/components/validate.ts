// Parsers for user input. Each returns the normalized value, or null if the input is invalid.

// Longest ticker each parser accepts, for Discord's max_length on the matching options: a stock
// ticker (parseTicker), and anything a lookup or crypto ticker can be (BTC-USD, up to 15).
export const STOCK_TICKER_MAX = 6;
export const ANY_TICKER_MAX = 15;

export function parseTicker(input: string) {
  const ticker = input.trim().toUpperCase();
  return /^[A-Z.]{1,6}$/.test(ticker) ? ticker : null;
}

// Yahoo-style crypto pair like BTC-USD: the coin, then the currency it is priced in. A bare
// symbol like BTC means BTC-USD, so one coin is never stored under two tickers.
export function parseCryptoTicker(input: string) {
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}(-[A-Z]{3,4})?$/.test(ticker)) return null;
  return ticker.includes('-') ? ticker : `${ticker}-USD`;
}

// A ticker typed to look up existing rows (/position, /clear), in any stored shape: AAPL, BRK.B,
// BTC-USD. Not normalized, since it has to match what is stored exactly.
export function parseLookupTicker(input: string) {
  const ticker = input.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,15}$/.test(ticker) ? ticker : null;
}

// Today's calendar date as YYYY-MM-DD in the given IANA time zone (en-CA formats as YYYY-MM-DD).
const todayIn = (tz: string, now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

// Any real calendar date as YYYY-MM-DD, to unix seconds at 12:00 UTC (see trade_date in the schema).
export function parseCalendarDate(input: string) {
  const date = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  // Date.parse rolls impossible dates like 2025-02-29 forward, so check it round-trips.
  return Number.isNaN(ms) || toDateString(ms / 1000) !== date ? null : ms / 1000;
}

// A trade date: today or earlier in `tz`, today when left out.
export function parseDate(input: string | undefined, tz: string, now = new Date()) {
  const date = input?.trim() ?? todayIn(tz, now);
  return date > todayIn(tz, now) ? null : parseCalendarDate(date);
}

// A date typed as MM/DD/YY or MM/DD (this year in `tz`), like 12/24 or 1/15/27, to unix seconds at
// 12:00 UTC. Option expiries are typed this way; trade dates stay YYYY-MM-DD.
export function parseShortDate(input: string, tz: string, now = new Date()) {
  const match = input.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}))?$/);
  if (!match) return null;
  const [, month, day, yy] = match;
  const year = yy ? `20${yy}` : todayIn(tz, now).slice(0, 4);
  return parseCalendarDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
}

// An expiry for a new option position: MM/DD/YY or MM/DD, today or later in `tz`.
export function parseExpiry(input: string, tz: string, now = new Date()) {
  const expiry = parseShortDate(input, tz, now);
  return expiry === null || toDateString(expiry) < todayIn(tz, now) ? null : expiry;
}

// A stored date as MM/DD/YY, the form parseShortDate reads.
export const shortDate = (unix: number) => {
  const [year, month, day] = toDateString(unix).split('-');
  return `${month}/${day}/${year.slice(2)}`;
};

export const toDateString = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

// "X:Y" means X new shares for every Y old: 3:2 forward, 1:10 reverse.
export function parseRatio(input: string) {
  const match = input.trim().match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const [split_to, split_from] = [Number(match[1]), Number(match[2])];
  return split_to > 0 && split_from > 0 && split_to !== split_from ? { split_to, split_from } : null;
}

// Highest price per unit accepted. Well above any real share or coin, low enough to catch a typo.
export const MAX_PRICE = 10_000_000;
// Lowest, the smallest amount 8 decimals can hold.
export const MIN_PRICE = 0.00000001;

// A price per unit from a Discord number option: above 0, at most MAX_PRICE, at most 8 decimals
// (enough for a coin priced below a cent). A sale may also be at exactly 0 (`zeroOk`), for a
// position sold or expired worthless. toFixed(8) round-trips exactly when there are 8 or fewer
// decimals, and unlike String() it never switches to 1e-7 notation.
export function toPrice(price: number, zeroOk = false) {
  return (price > 0 || (zeroOk && price === 0)) && price <= MAX_PRICE && Number(price.toFixed(8)) === price ? price : null;
}

// A price as plain decimal text that parsePrice reads back: 1e-7 becomes "0.0000001".
export const priceText = (price: number) => price.toFixed(8).replace(/\.?0+$/, '');

// A typed price from the /amend modal, like "$1,234.50", by the same rules as toPrice.
export function parsePrice(input: string, zeroOk = false) {
  const cleaned = input.trim().replace(/[$,]/g, '');
  return /^\d*\.?\d+$/.test(cleaned) ? toPrice(Number(cleaned), zeroOk) : null;
}
