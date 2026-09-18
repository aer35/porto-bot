import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRef, parseRef, refPrefix } from '../components/ref.js';
import type { Tx } from '../components/ledger.js';

const tx = (fields: Partial<Tx>) => ({ sec_type: 'STOCK', side: 'BUY', ...fields }) as Tx;

test('refPrefix names the transaction type', () => {
  assert.equal(refPrefix(tx({})), 'BS');
  assert.equal(refPrefix(tx({ side: 'SELL' })), 'SS');
  assert.equal(refPrefix(tx({ sec_type: 'SPLIT', side: null })), 'SL');
});

test('formatRef pads to at least two digits and grows past them', () => {
  assert.equal(formatRef('BS', 1), 'BS01');
  assert.equal(formatRef('SS', 2), 'SS02');
  assert.equal(formatRef('BS', 99), 'BS99');
  assert.equal(formatRef('BS', 133), 'BS133');
});

test('parseRef uppercases and pads what the user typed', () => {
  assert.equal(parseRef('bs01'), 'BS01');
  assert.equal(parseRef(' BS1 '), 'BS01');
  assert.equal(parseRef('SS133'), 'SS133');
  for (const bad of ['', 'BS', '01', 'B01', 'BSS01', 'BS-1', '#1']) assert.equal(parseRef(bad), null, bad);
});
