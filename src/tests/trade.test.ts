import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.ts validates env at import, so set it before loading anything that opens the database.
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: ':memory:' });
const { contractChoices, trade, tradeRow } = await import('../components/trade.js');
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
      options: { name: string; choices?: { value: string }[]; autocomplete?: boolean }[];
    };
    assert.deepEqual(option.options.map((o) => o.name), ['ticker', 'type', 'strike', 'expiry', 'contracts', 'price', 'date']);
    assert.deepEqual(option.options[1].choices!.map((c) => c.value), ['CALL', 'PUT']);
    // /sell suggests the strikes and expiries of contracts held; /buy has nothing to suggest.
    assert.deepEqual([option.options[2].autocomplete ?? false, option.options[3].autocomplete ?? false], [side === 'SELL', side === 'SELL']);
  }
});

test('an option trade reads into an OPTION row with whole contracts and an expiry date', () => {
  const values = { ticker: 'aapl', type: 'CALL', strike: 150, expiry: '06/19', contracts: 2, price: 3.2 };
  const row = tradeRow('u', 'BUY', 'option', typed(values), 'UTC', NOW);
  assert.deepEqual(
    [row.sec_type, row.ticker, row.opt_right, row.strike, row.expiry, row.shares, row.price],
    ['OPTION', 'AAPL', 'CALL', 150, Date.parse('2026-06-19T12:00:00Z') / 1000, 2, 3.2],
  );
});

test('invalid option input is a UserError', () => {
  const base = { ticker: 'AAPL', type: 'PUT', strike: 150, expiry: '06/19/26', contracts: 1, price: 1 };
  const bads: Record<string, string | number>[] = [
    { ticker: 'BTC-USD' }, { type: 'STRADDLE' }, { strike: 0 }, { expiry: '03/09' }, { expiry: '2026-06-19' }, { contracts: 0 },
    { contracts: 1.5 }, { price: 0 },
  ];
  for (const bad of bads) {
    assert.throws(() => tradeRow('u', 'BUY', 'option', typed({ ...base, ...bad }), 'UTC', NOW), UserError, JSON.stringify(bad));
  }
});

test('an option can be sold after its expiry, closing a position bought before it, but not bought', () => {
  const values = { ticker: 'AAPL', type: 'CALL', strike: 150, expiry: '03/06', contracts: 1, price: 0.01 };
  const row = tradeRow('u', 'SELL', 'option', typed(values), 'UTC', NOW);
  assert.equal(row.expiry, Date.parse('2026-03-06T12:00:00Z') / 1000);
  assert.throws(() => tradeRow('u', 'BUY', 'option', typed(values), 'UTC', NOW), UserError);
  assert.throws(() => tradeRow('u', 'SELL', 'option', typed({ ...values, expiry: '02/30' }), 'UTC', NOW), UserError);
});

test('a sale may be recorded at $0 for every type, but a buy may not', () => {
  const zero = {
    stock: { ticker: 'AAPL', shares: 1, price: 0 },
    crypto: { ticker: 'BTC', amount: 1, total: 0 },
    option: { ticker: 'AAPL', type: 'CALL', strike: 150, expiry: '03/06', contracts: 1, price: 0 },
  };
  for (const [type, values] of Object.entries(zero)) {
    assert.equal(tradeRow('u', 'SELL', type, typed(values), 'UTC', NOW).price, 0, type);
    assert.throws(() => tradeRow('u', 'BUY', type, typed({ ...values, expiry: '06/19' }), 'UTC', NOW), UserError, type);
  }
  // Discord enforces the same floor before the bot sees the value.
  const minOf = (side: 'BUY' | 'SELL', sub: string, name: string) =>
    (trade(side).data.toJSON().options as { name: string; options: { name: string; min_value?: number }[] }[])
      .find((o) => o.name === sub)!.options.find((o) => o.name === name)!.min_value;
  assert.deepEqual([minOf('SELL', 'stock', 'price'), minOf('SELL', 'crypto', 'total'), minOf('SELL', 'option', 'price')], [0, 0, 0]);
  assert.ok(minOf('BUY', 'stock', 'price')! > 0);
  assert.ok(minOf('SELL', 'option', 'strike')! > 0);
});

const contract = (opt_right: 'CALL' | 'PUT', strike: number, expiry: string, ticker = 'AAPL') => ({
  sec_type: 'OPTION' as const, ticker, opt_right, strike, expiry: Date.parse(`${expiry}T12:00:00Z`) / 1000, shares: 1, avgCost: 1,
});
const held = [
  contract('CALL', 150, '2026-06-19'),
  contract('CALL', 150, '2026-09-18'),
  contract('CALL', 160, '2026-06-19'),
  contract('PUT', 140, '2026-01-16'),
  contract('CALL', 50, '2026-06-19', 'MSFT'),
];
const none = { ticker: null, type: null, strike: null };

test('/sell option suggests the strikes held, narrowed by the ticker and type already chosen', () => {
  assert.deepEqual(contractChoices(held, 'strike', '', { ...none, ticker: 'aapl' }, NOW), [
    { name: '$140.00', value: 140 },
    { name: '$150.00', value: 150 },
    { name: '$160.00', value: 160 },
  ]);
  assert.deepEqual(contractChoices(held, 'strike', '', { ...none, ticker: 'AAPL', type: 'CALL' }, NOW).map((c) => c.value), [150, 160]);
  assert.deepEqual(contractChoices(held, 'strike', '16', { ...none, ticker: 'AAPL' }, NOW).map((c) => c.value), [160]);
});

test('/sell option suggests the expiries held as MM/DD/YY, marking any that have passed', () => {
  assert.deepEqual(contractChoices(held, 'expiry', '', { ticker: 'AAPL', type: 'CALL', strike: 150 }, NOW), [
    { name: '06/19/26', value: '06/19/26' },
    { name: '09/18/26', value: '09/18/26' },
  ]);
  assert.deepEqual(contractChoices(held, 'expiry', '', { ...none, ticker: 'AAPL', type: 'PUT' }, NOW), [
    { name: '01/16/26 (expired)', value: '01/16/26' },
  ]);
  assert.deepEqual(contractChoices(held, 'expiry', '09', { ...none, ticker: 'AAPL' }, NOW).map((c) => c.value), ['09/18/26']);
  // With no ticker typed yet, every held contract is a candidate, each listed once.
  assert.deepEqual(contractChoices(held, 'expiry', '', none, NOW).map((c) => c.value), ['01/16/26', '06/19/26', '09/18/26']);
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
