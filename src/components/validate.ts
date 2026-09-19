// Parsers for user input. Each returns the normalized value, or null if the input is invalid.

export function parseTicker(input: string) {
  const ticker = input.trim().toUpperCase();
  return /^[A-Z.]{1,6}$/.test(ticker) ? ticker : null;
}

// Today's calendar date as YYYY-MM-DD in the given IANA time zone (en-CA formats as YYYY-MM-DD).
const todayIn = (tz: string, now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

// YYYY-MM-DD, today or earlier in `tz`, to unix seconds at 12:00 UTC (see trade_date in the schema).
export function parseDate(input: string | undefined, tz: string, now = new Date()) {
  const date = input?.trim() ?? todayIn(tz, now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIn(tz, now)) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  // Date.parse rolls impossible dates like 2025-02-29 forward, so check it round-trips.
  if (Number.isNaN(ms) || toDateString(ms / 1000) !== date) return null;
  return ms / 1000;
}

export const toDateString = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

// "X:Y" means X new shares for every Y old: 3:2 forward, 1:10 reverse.
export function parseRatio(input: string) {
  const match = input.trim().match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const [split_to, split_from] = [Number(match[1]), Number(match[2])];
  return split_to > 0 && split_from > 0 && split_to !== split_from ? { split_to, split_from } : null;
}

export function parseShares(input: string) {
  const trimmed = input.trim();
  const shares = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  return Number.isSafeInteger(shares) && shares > 0 ? shares : null;
}

export function parsePrice(input: string) {
  const cleaned = input.trim().replace(/[$,]/g, '');
  return /^\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : null;
}
