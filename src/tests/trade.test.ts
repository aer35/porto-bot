import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { trade, tradeRow } = await import('../components/trade.js');
const { UserError } = await import('../components/userError.js');

// Stands in for interaction.options: the values a user typed, by option name.
const typed = (values: Record<string, string | number>) => ({
  getString: (name: string) => (values[name] as string) ?? null,
  getNumber: (name: string) => (values[name] as number) ?? null,
  getInteger: (name: string) => (values[name] as number) ?? null,
});

const NOW = new Date('2026-03-10T15:00:00Z');

test('/buy and /sell each have a stock subcommand', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    const json = trade(side).data.toJSON();
    const stock = json.options!.find((o) => o.name === 'stock') as { options: { name: string; required?: boolean }[] };
    assert.ok(stock, `${json.name} has a stock subcommand`);
    assert.deepEqual(
      stock.options.map((o) => [o.name, o.required ?? false]),
      [['ticker', true], ['shares', true], ['price', true], ['date', false]],
    );
  }
});

test('a stock trade reads into a STOCK row with shares in hundredths', () => {
  const row = tradeRow('u', 'BUY', 'stock', typed({ ticker: ' aapl ', shares: 12.78, price: 150, date: '2026-03-02' }), 'UTC', NOW);
  assert.deepEqual(row, {
    user_id: 'u',
    sec_type: 'STOCK',
    side: 'BUY',
    ticker: 'AAPL',
    shares: 1278,
    price: 150,
    trade_date: Date.parse('2026-03-02T12:00:00Z') / 1000,
    split_from: null,
    split_to: null,
    opt_right: null,
    strike: null,
    expiry: null,
  });
});

test('a stock trade without a date is dated today', () => {
  const row = tradeRow('u', 'SELL', 'stock', typed({ ticker: 'AAPL', shares: 1, price: 1 }), 'UTC', NOW);
  assert.equal(row.trade_date, Date.parse('2026-03-10T12:00:00Z') / 1000);
});

test('invalid stock input is a UserError', () => {
  const base = { ticker: 'AAPL', shares: 1, price: 1 };
  const bads: Record<string, string | number>[] = [
    { ticker: 'TOOLONGX' }, { shares: 0.001 }, { price: 0 }, { price: 1.123456789 }, { date: '2099-01-01' },
  ];
  for (const bad of bads) {
    assert.throws(() => tradeRow('u', 'BUY', 'stock', typed({ ...base, ...bad }), 'UTC', NOW), UserError);
  }
});

test('/buy and /sell each have a crypto subcommand with an amount and a total instead of shares and a price', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    const json = trade(side).data.toJSON();
    const crypto = json.options!.find((o) => o.name === 'crypto') as { options: { name: string; max_length?: number }[] };
    assert.deepEqual(crypto.options.map((o) => o.name), ['ticker', 'amount', 'total', 'date']);
    assert.equal(crypto.options[0].max_length, 15);
  }
});

test('a crypto trade reads into a CRYPTO row, at the crypto scale, priced in USD by default', () => {
  const row = tradeRow('u', 'BUY', 'crypto', typed({ ticker: 'btc', amount: 0.00034, total: 34 }), 'UTC', NOW);
  assert.equal(row.sec_type, 'CRYPTO');
  assert.equal(row.ticker, 'BTC-USD');
  assert.equal(row.shares, 34_000);
  assert.equal(row.price, 100_000);
});

test('a crypto trade takes what was paid in total and stores the price per coin', () => {
  // "Bought 0.00001 BTC for $100", not "at $100 per BTC".
  const row = tradeRow('u', 'BUY', 'crypto', typed({ ticker: 'BTC', amount: 0.00001, total: 100 }), 'UTC', NOW);
  assert.equal(row.shares, 1000);
  assert.equal(row.price, 10_000_000);
});

test('invalid crypto input is a UserError', () => {
  const base = { ticker: 'BTC-USD', amount: 1, total: 1 };
  const bads: Record<string, string | number>[] = [{ ticker: 'BTC.USD' }, { amount: 0.000000001 }, { amount: 100_000_000 }, { total: 0 }, { total: 20_000_000 }];
  for (const bad of bads) {
    assert.throws(() => tradeRow('u', 'BUY', 'crypto', typed({ ...base, ...bad }), 'UTC', NOW), UserError);
  }
});

test('/buy and /sell each have an option subcommand', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    const json = trade(side).data.toJSON();
    const option = json.options!.find((o) => o.name === 'option') as {
      options: { name: string; choices?: { value: string }[] }[];
    };
    assert.deepEqual(option.options.map((o) => o.name), ['ticker', 'right', 'strike', 'expiry', 'contracts', 'price', 'date']);
    assert.deepEqual(option.options[1].choices!.map((c) => c.value), ['CALL', 'PUT']);
  }
});

test('an option trade reads into an OPTION row with whole contracts and an expiry date', () => {
  const values = { ticker: 'aapl', right: 'CALL', strike: 150, expiry: '2026-06-19', contracts: 2, price: 3.2 };
  const row = tradeRow('u', 'BUY', 'option', typed(values), 'UTC', NOW);
  assert.deepEqual(
    [row.sec_type, row.ticker, row.opt_right, row.strike, row.expiry, row.shares, row.price],
    ['OPTION', 'AAPL', 'CALL', 150, Date.parse('2026-06-19T12:00:00Z') / 1000, 2, 3.2],
  );
});

test('invalid option input is a UserError', () => {
  const base = { ticker: 'AAPL', right: 'PUT', strike: 150, expiry: '2026-06-19', contracts: 1, price: 1 };
  const bads: Record<string, string | number>[] = [
    { ticker: 'BTC-USD' }, { right: 'STRADDLE' }, { strike: 0 }, { expiry: '2026-03-09' }, { contracts: 0 }, { contracts: 1.5 },
  ];
  for (const bad of bads) {
    assert.throws(() => tradeRow('u', 'BUY', 'option', typed({ ...base, ...bad }), 'UTC', NOW), UserError, JSON.stringify(bad));
  }
});

test('an option can be sold after its expiry, closing a position bought before it, but not bought', () => {
  const values = { ticker: 'AAPL', right: 'CALL', strike: 150, expiry: '2026-03-06', contracts: 1, price: 0.01 };
  const row = tradeRow('u', 'SELL', 'option', typed(values), 'UTC', NOW);
  assert.equal(row.expiry, Date.parse('2026-03-06T12:00:00Z') / 1000);
  assert.throws(() => tradeRow('u', 'BUY', 'option', typed(values), 'UTC', NOW), UserError);
  assert.throws(() => tradeRow('u', 'SELL', 'option', typed({ ...values, expiry: '2026-02-30' }), 'UTC', NOW), UserError);
});

test('every /buy and /sell ticker option names Yahoo Finance as the ticker source, within Discord\'s 100 characters', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    for (const sub of trade(side).data.toJSON().options as { name: string; options: { name: string; description: string }[] }[]) {
      const { description } = sub.options.find((o) => o.name === 'ticker')!;
      assert.match(description, /Yahoo Finance/, `${side} ${sub.name}`);
      assert.ok(description.length <= 100, description);
    }
  }
});
