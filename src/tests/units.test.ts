import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantity, parseQuantity, quantityText, toScaled, unitPrice, units, value } from '../components/units.js';

test('stock is stored in thousandths and crypto in 100,000,000ths, independently', () => {
  assert.equal(units.STOCK.scale, 1000);
  assert.equal(units.CRYPTO.scale, 100_000_000);
});

test('shares take up to 3 decimals, crypto up to 6, options whole numbers only', () => {
  assert.deepEqual([units.STOCK.decimals, units.CRYPTO.decimals, units.OPTION.decimals], [3, 6, 0]);
});

test('toScaled stores a quantity as a whole number at the type scale', () => {
  assert.equal(toScaled(12.785, 'STOCK'), 12_785);
  assert.equal(toScaled(12.78, 'STOCK'), 12_780);
  assert.equal(toScaled(0.29, 'STOCK'), 290); // 0.29 * 1000 is 289.99999999999994 in floating point
  assert.equal(toScaled(0.00034, 'CRYPTO'), 34_000);
  assert.equal(toScaled(0.000001, 'CRYPTO'), 100);
  assert.equal(toScaled(1.5, 'CRYPTO'), 150_000_000);
});

test('toScaled rejects 0 or less, extra decimals, and amounts too big to store exactly', () => {
  for (const bad of [0, -1, 1.2345, 1e21]) assert.equal(toScaled(bad, 'STOCK'), null, `STOCK ${bad}`);
  for (const bad of [0, 0.0000001, 0.00000001, 1.1234567, 100_000_000]) assert.equal(toScaled(bad, 'CRYPTO'), null, `CRYPTO ${bad}`);
});

test('parseQuantity reads typed text at the type scale', () => {
  assert.equal(parseQuantity(' 12.785 ', 'STOCK'), 12_785);
  assert.equal(parseQuantity('0.00034', 'CRYPTO'), 34_000);
  assert.equal(parseQuantity('0.000001', 'CRYPTO'), 100);
  for (const bad of ['0', '0.000', '-1', '1.2345', '.5', '1.', 'ten', '', '1e3', '99999999999999999999']) {
    assert.equal(parseQuantity(bad, 'STOCK'), null, bad);
  }
  assert.equal(parseQuantity('0.0000001', 'CRYPTO'), null);
});

test('value turns a stored quantity and a per-unit price into dollars, dividing by the scale once', () => {
  assert.equal(value('STOCK', 12_780, 150), 1917);
  assert.equal(value('CRYPTO', 34_000, 100_000), 34);
});

test('formatQuantity shows stock to 3 decimals and truncates crypto to 3, never rounding up', () => {
  assert.equal(formatQuantity('STOCK', 12_785), '12.785');
  assert.equal(formatQuantity('STOCK', 12_780), '12.78');
  assert.equal(formatQuantity('STOCK', 1_234_567_000), '1,234,567');
  assert.equal(formatQuantity('CRYPTO', 123_456_789), '1.234');
  assert.equal(formatQuantity('CRYPTO', 99_999_999), '0.999');
  assert.equal(formatQuantity('CRYPTO', 150_000_000), '1.5');
});

test('quantityText writes a stored quantity as plain decimals that parseQuantity reads back', () => {
  assert.equal(quantityText(12_785, 'STOCK'), '12.785');
  assert.equal(quantityText(10_000, 'STOCK'), '10');
  assert.equal(quantityText(34_000, 'CRYPTO'), '0.00034');
  for (const q of [100, 34_000, 123_456_700]) assert.equal(parseQuantity(quantityText(q, 'CRYPTO'), 'CRYPTO'), q);
  // Crypto recorded with 8 decimals before the 6-decimal limit keeps them, rather than rounding away.
  assert.equal(quantityText(1, 'CRYPTO'), '0.00000001');
});

test('an option contract is a whole unit, and its dollar value is 100 × contracts × price', () => {
  assert.equal(toScaled(2, 'OPTION'), 2);
  for (const bad of [0, 1.5, -1]) assert.equal(toScaled(bad, 'OPTION'), null, String(bad));
  assert.equal(value('OPTION', 2, 3.2), 640);
  assert.equal(formatQuantity('OPTION', 2), '2');
});

test('whole-unit quantities (option contracts) parse and print without decimals, trailing zeros intact', () => {
  assert.equal(parseQuantity('20', 'OPTION'), 20);
  assert.equal(parseQuantity('1.5', 'OPTION'), null);
  assert.equal(quantityText(20, 'OPTION'), '20');
  assert.equal(quantityText(100, 'OPTION'), '100');
  assert.equal(quantityText(100_000, 'STOCK'), '100');
});

test('unitPrice turns a total paid for a stored quantity back into a per-unit price, the inverse of value', () => {
  // 0.00001 BTC for $100 is $10,000,000 per coin.
  assert.equal(unitPrice('CRYPTO', 1000, 100), 10_000_000);
  assert.equal(unitPrice('CRYPTO', 34_000, 34), 100_000);
  const price = unitPrice('CRYPTO', 34_000, 100);
  assert.ok(Math.abs(value('CRYPTO', 34_000, price) - 100) < 1e-9);
});
