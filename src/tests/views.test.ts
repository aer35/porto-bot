import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComponentType, MessageFlags } from 'discord.js';
import type { Position } from '../components/ledger.js';
import { portfolioView, positionView } from '../components/views.js';

const NOT_OPTION = { opt_right: null, strike: null, expiry: null };
const aapl: Position = { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'AAPL', shares: 1250, avgCost: 10 };
const btc: Position = { ...NOT_OPTION, sec_type: 'CRYPTO', ticker: 'BTC-USD', shares: 50_000_000, avgCost: 60_000 };

// The container's children as [type, text] pairs, text only for text displays.
function children(view: ReturnType<typeof portfolioView>) {
  const [container] = view.components.map((c) => c.toJSON()) as { type: number; components: { type: number; content?: string }[] }[];
  assert.equal(container.type, ComponentType.Container);
  return container.components.map((c) => [c.type, c.content ?? null] as const);
}
const texts = (view: ReturnType<typeof portfolioView>) =>
  children(view).filter(([type]) => type === ComponentType.TextDisplay).map(([, text]) => text!);

test('portfolio renders as components, never pings, and lists holdings as lines with a cost total', () => {
  const view = portfolioView('42', [aapl, btc], ['tx one', 'tx two']);
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(view.allowedMentions, { parse: [] });
  const all = texts(view).join('\n');
  assert.match(all, /Portfolio of <@42>/);
  assert.match(all, /\*\*AAPL\*\* · 12\.5 shares · avg \$10\.00 · cost \$125\.00/);
  assert.match(all, /\*\*BTC-USD\*\* · 0\.5 coins · avg \$60,000\.00 · cost \$30,000\.00/);
  assert.match(all, /\*\*Total cost basis\*\* \$30,125\.00/);
  assert.doesNotMatch(all, /```/);
});

test('each transaction is its own text display, with a separator component between entries', () => {
  const kinds = children(portfolioView('42', [aapl], ['tx one', 'tx two', 'tx three']));
  const from = kinds.findIndex(([, text]) => text === 'tx one');
  assert.deepEqual(
    kinds.slice(from).map(([type]) => type),
    [ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay],
  );
});

test('portfolio with nothing held or recorded says so', () => {
  const all = texts(portfolioView('42', [], [])).join('\n');
  assert.match(all, /No holdings\./);
  assert.match(all, /None yet\./);
  assert.doesNotMatch(all, /Total/);
});

test('position shows its holdings and a page of transactions, with page buttons only when there is more than one page', () => {
  const single = positionView('42', 'AAPL', [aapl], ['tx one'], 0, 1);
  assert.equal(single.components.length, 1);
  assert.match(texts(single).join('\n'), /## AAPL — <@42>[\s\S]*\*\*AAPL\*\* · 12\.5 shares/);

  const paged = positionView('42', 'AAPL', [], ['tx one'], 1, 3);
  assert.equal(paged.components.length, 2);
  const all = texts(paged).join('\n');
  assert.match(all, /No shares held\./);
  assert.match(all, /Page 2 of 3/);
  const buttons = paged.components[1].toJSON() as { components: { custom_id: string; disabled: boolean }[] };
  assert.deepEqual(
    buttons.components.map((b) => [b.custom_id, b.disabled]),
    [['position:0:42:AAPL', false], ['position:2:42:AAPL', false]],
  );
});

test('portfolio groups holdings into stock, crypto and option sections, hiding empty ones, with one total', () => {
  const call: Position = { sec_type: 'OPTION', ticker: 'AAPL', shares: 1, avgCost: 2, opt_right: 'CALL', strike: 150, expiry: 1_800_000_000 };
  const msft: Position = { ...aapl, ticker: 'MSFT' };
  const all = texts(portfolioView('42', [call, aapl, btc, msft], [])).join('\n');
  assert.match(all, /\*\*Stocks\*\*\n\*\*AAPL\*\*.*\n\*\*MSFT\*\*/);
  assert.ok(all.indexOf('**Stocks**') < all.indexOf('**Crypto**') && all.indexOf('**Crypto**') < all.indexOf('**Options**'));
  assert.match(all, /\*\*Options\*\*\n\*\*AAPL CALL/);
  assert.match(all, /\*\*Total cost basis\*\* \$30,450\.00/);

  const stocksOnly = texts(portfolioView('42', [aapl], [])).join('\n');
  assert.match(stocksOnly, /\*\*Stocks\*\*/);
  assert.doesNotMatch(stocksOnly, /Crypto|Options/);
});

test('the total adds current value next to cost, counting holdings without a price at cost', () => {
  const priced = texts(portfolioView('42', [{ ...aapl, price: 12 }, { ...btc, price: 70_000 }], [])).join('\n');
  assert.match(priced, /\*\*Total cost basis\*\* \$30,125\.00 · \*\*value\*\* \$35,150\.00$/m);
  const partly = texts(portfolioView('42', [{ ...aapl, price: 12 }, btc], [])).join('\n');
  assert.match(partly, /\*\*Total cost basis\*\* \$30,125\.00 · \*\*value\*\* \$30,150\.00 \(1 at cost, no price yet\)$/m);
  const none = texts(portfolioView('42', [aapl], [])).join('\n');
  assert.match(none, /\*\*Total cost basis\*\* \$125\.00$/m);
});
