import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCalendarDate, parseCryptoTicker, parseDate, parseExpiry, parseLookupTicker, parsePrice, parseRatio, parseShortDate, parseTicker, shortDate,
  toDateString, toPrice, priceText,
} from '../components/validate.js';

test('parseTicker uppercases and accepts 1-6 letters or dots', () => {
  assert.equal(parseTicker('aapl'), 'AAPL');
  assert.equal(parseTicker(' brk.b '), 'BRK.B');
  assert.equal(parseTicker('A'), 'A');
  assert.equal(parseTicker('ABCDEF'), 'ABCDEF');
  for (const bad of ['', 'ABCDEFG', 'AB1', 'AB-C', 'A B']) assert.equal(parseTicker(bad), null, bad);
});

// 2026-03-10 02:00 UTC is still 2026-03-09 in New York.
const now = new Date('2026-03-10T02:00:00Z');
const noonUtc = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

test('parseDate returns unix seconds at 12:00 UTC on that date', () => {
  assert.equal(parseDate('2026-01-15', 'America/New_York', now), noonUtc('2026-01-15'));
});

test('parseDate accepts today in the configured time zone and rejects tomorrow', () => {
  assert.equal(parseDate('2026-03-09', 'America/New_York', now), noonUtc('2026-03-09'));
  assert.equal(parseDate('2026-03-10', 'America/New_York', now), null);
  assert.equal(parseDate('2026-03-10', 'Europe/London', now), noonUtc('2026-03-10'));
});

test('parseDate defaults to today in the configured time zone', () => {
  assert.equal(parseDate(undefined, 'America/New_York', now), noonUtc('2026-03-09'));
});

test('parseDate rejects malformed and impossible dates', () => {
  for (const bad of ['2026-1-15', '01/15/2026', '2025-02-29', '2026-13-01', 'yesterday', '']) {
    assert.equal(parseDate(bad, 'America/New_York', now), null, bad);
  }
});

test('toDateString inverts parseDate', () => {
  assert.equal(toDateString(noonUtc('2024-02-29')), '2024-02-29');
});

test('parseRatio reads X:Y as X new shares for every Y old', () => {
  assert.deepEqual(parseRatio('3:2'), { split_to: 3, split_from: 2 });
  assert.deepEqual(parseRatio(' 1:10 '), { split_to: 1, split_from: 10 });
  for (const bad of ['3', '3:0', '0:1', '2:2', '1.5:1', '3/2', '-1:2']) assert.equal(parseRatio(bad), null, bad);
});

test('parsePrice accepts prices above 0 with up to 8 decimals, and an optional $ and commas', () => {
  assert.equal(parsePrice('150.25'), 150.25);
  assert.equal(parsePrice('$1,234.5'), 1234.5);
  assert.equal(parsePrice('0.00000001'), 0.00000001);
  assert.equal(parsePrice('10000000'), 10_000_000);
  for (const bad of ['0', '0.00', '-1', 'abc', '', '1.2.3', '0.000000001', '10000000.01', '1e3', "1; DROP TABLE x"]) {
    assert.equal(parsePrice(bad), null, bad);
  }
});

test('toPrice checks a Discord number option by the same rules as parsePrice', () => {
  assert.equal(toPrice(3.2), 3.2);
  assert.equal(toPrice(1e-7), 1e-7);
  for (const bad of [0, -5, 1.123456789, 10_000_001, Infinity, NaN]) assert.equal(toPrice(bad), null, String(bad));
});

test('a sale may be priced at $0: toPrice and parsePrice accept 0 only when asked to', () => {
  assert.equal(toPrice(0, true), 0);
  assert.equal(parsePrice('0', true), 0);
  assert.equal(parsePrice('$0.00', true), 0);
  assert.equal(toPrice(-1, true), null);
  assert.equal(parsePrice('-1', true), null);
  assert.equal(toPrice(0), null);
});

test('priceText writes a price as plain decimals that parsePrice reads back', () => {
  for (const price of [150, 150.25, 1e-7, 0.00000001, 3.2]) assert.equal(parsePrice(priceText(price)), price, String(price));
  assert.equal(priceText(1e-7), '0.0000001');
  assert.equal(priceText(150), '150');
});

test('parseCryptoTicker accepts Yahoo-style pairs and treats a bare symbol as priced in USD', () => {
  assert.equal(parseCryptoTicker(' btc-usd '), 'BTC-USD');
  assert.equal(parseCryptoTicker('eth'), 'ETH-USD');
  assert.equal(parseCryptoTicker('1INCH-USD'), '1INCH-USD');
  assert.equal(parseCryptoTicker('SOL-EUR'), 'SOL-EUR');
  for (const bad of ['', '-USD', 'BTC-', 'BTC-US', 'BTC-USDTX', 'ABCDEFGHIJK', 'BTC USD', 'BTC.USD', 'BTC-USD-X']) {
    assert.equal(parseCryptoTicker(bad), null, bad);
  }
});

test('parseLookupTicker accepts any stored ticker shape as typed, without normalizing', () => {
  assert.equal(parseLookupTicker(' brk.b '), 'BRK.B');
  assert.equal(parseLookupTicker('btc-usd'), 'BTC-USD');
  assert.equal(parseLookupTicker('BTC'), 'BTC');
  for (const bad of ['', 'A B', "A'", 'ABCDEFGHIJKLMNOP']) assert.equal(parseLookupTicker(bad), null, bad);
});

test('parseShortDate reads MM/DD/YY, and MM/DD as this year in the configured time zone', () => {
  // now is 2026-03-09 in New York.
  assert.equal(parseShortDate('12/24', 'America/New_York', now), noonUtc('2026-12-24'));
  assert.equal(parseShortDate(' 12/24/27 ', 'America/New_York', now), noonUtc('2027-12-24'));
  assert.equal(parseShortDate('1/5', 'America/New_York', now), noonUtc('2026-01-05'));
  assert.equal(parseShortDate('01/05/26', 'America/New_York', now), noonUtc('2026-01-05'));
  // Any past date is fine here; only a buy needs a future expiry (parseExpiry).
  assert.equal(parseShortDate('02/29/24', 'America/New_York', now), noonUtc('2024-02-29'));
  // On New Year's Eve in New York it is already the next year in UTC; the year comes from New York.
  assert.equal(parseShortDate('06/19', 'America/New_York', new Date('2027-01-01T02:00:00Z')), noonUtc('2026-06-19'));
  for (const bad of ['02/30', '02/29/26', '13/01', '00/10', '12/24/2026', '2026-12-24', '12-24', '', 'friday']) {
    assert.equal(parseShortDate(bad, 'America/New_York', now), null, bad);
  }
});

test('parseExpiry accepts MM/DD/YY or MM/DD, today or later in the configured time zone', () => {
  // now is 2026-03-09 in New York.
  assert.equal(parseExpiry('03/09', 'America/New_York', now), noonUtc('2026-03-09'));
  assert.equal(parseExpiry('1/15/27', 'America/New_York', now), noonUtc('2027-01-15'));
  for (const bad of ['03/08', '03/08/26', '02/30', '2027-01-15', '', 'friday']) {
    assert.equal(parseExpiry(bad, 'America/New_York', now), null, bad);
  }
});

test('shortDate formats a stored date as MM/DD/YY, which parseShortDate reads back', () => {
  assert.equal(shortDate(noonUtc('2026-12-24')), '12/24/26');
  assert.equal(shortDate(noonUtc('2027-01-05')), '01/05/27');
  assert.equal(parseShortDate(shortDate(noonUtc('2027-01-05')), 'UTC', now), noonUtc('2027-01-05'));
});

test('parseCalendarDate accepts any real date, past or future', () => {
  assert.equal(parseCalendarDate(' 1999-12-31 '), noonUtc('1999-12-31'));
  assert.equal(parseCalendarDate('2099-01-01'), noonUtc('2099-01-01'));
  for (const bad of ['2025-02-29', '2026-1-01', '']) assert.equal(parseCalendarDate(bad), null, bad);
});
