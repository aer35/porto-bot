import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parsePrice, parseRatio, parseShares, parseTicker, toDateString } from '../components/validate.js';

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

test('parseShares accepts positive whole numbers only', () => {
  assert.equal(parseShares('10'), 10);
  for (const bad of ['0', '-1', '1.5', 'ten', '', '1e3', '99999999999999999999']) assert.equal(parseShares(bad), null, bad);
});

test('parsePrice accepts non-negative decimals', () => {
  assert.equal(parsePrice('150.25'), 150.25);
  assert.equal(parsePrice('0'), 0);
  assert.equal(parsePrice('$1,234.5'), 1234.5);
  for (const bad of ['-1', 'abc', '', '1.2.3']) assert.equal(parsePrice(bad), null, bad);
});
