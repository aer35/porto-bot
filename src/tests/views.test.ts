import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle, Colors, ComponentType, MessageFlags } from 'discord.js';
import type { Position } from '../components/ledger.js';
import { portfolioView, positionView, transactionsView } from '../components/views.js';

const NOT_OPTION = { opt_right: null, strike: null, expiry: null };
const aapl: Position = { ...NOT_OPTION, sec_type: 'STOCK', ticker: 'AAPL', shares: 12_500, avgCost: 10 };
const btc: Position = { ...NOT_OPTION, sec_type: 'CRYPTO', ticker: 'BTC-USD', shares: 50_000_000, avgCost: 60_000 };

// The container's children as [type, text] pairs, text only for text displays.
type View = ReturnType<typeof portfolioView>;
type Json = { type: number; accent_color?: number; components: { type: number; content?: string; custom_id?: string; style?: number; disabled?: boolean; label?: string }[] };
const json = (view: View) => view.components.map((c) => c.toJSON()) as Json[];

function children(view: View) {
  const [container] = json(view);
  assert.equal(container.type, ComponentType.Container);
  return container.components.map((c) => [c.type, c.content ?? null] as const);
}
const texts = (view: View) =>
  children(view).filter(([type]) => type === ComponentType.TextDisplay).map(([, text]) => text!);
// The lines of a holdings tab's table, from inside its code block.
const table = (view: View) => texts(view).join('\n').match(/```\n([\s\S]*?)\n```/)![1].split('\n');


// The buttons of every action row after the container, as [custom_id, label, style, disabled].
const buttons = (view: View) =>
  json(view)
    .slice(1)
    .flatMap((row) => row.components.map((b) => [b.custom_id, b.label, b.style, b.disabled ?? false] as const));

const call: Position = { sec_type: 'OPTION', ticker: 'AAPL', shares: 1, avgCost: 2, opt_right: 'CALL', strike: 150, expiry: 1_800_000_000 };
const msft: Position = { ...aapl, ticker: 'MSFT' };

test('portfolio renders one tab as components, never pings, with a table of holdings, and tab and overall cost', () => {
  const view = portfolioView('42', 'STOCK', [call, aapl, btc, msft], 0);
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(view.allowedMentions, { parse: [] });
  assert.equal(json(view)[0].accent_color, Colors.Green);
  const all = texts(view).join('\n');
  assert.match(all, /## Portfolio of <@42>\n### Stocks/);
  // Discord has no tables, so it is a monospaced code block: each column as wide as its widest
  // cell, text left-aligned, numbers right-aligned.
  // With no price yet, a holding shows "-" for its price and value and for the day figures under them.
  assert.deepEqual(table(view), [
    'Ticker  Shares  Price  Value',
    '──────  ──────  ─────  ─────',
    'AAPL      12.5      -      -',
    `${' '.repeat(20)}-      -`,
    'MSFT      12.5      -      -',
    `${' '.repeat(20)}-      -`,
  ]);
  assert.match(all, /```\n\n\*\*Cost basis\*\* \$250\.00 · \*\*Total, all holdings\*\* \$30,450\.00/);
  assert.doesNotMatch(all, /BTC-USD|CALL/);
});

test('each holdings tab has its own colour and table columns, and an empty tab says so', () => {
  const crypto = portfolioView('42', 'CRYPTO', [call, aapl, btc], 0);
  assert.equal(json(crypto)[0].accent_color, Colors.Blue);
  assert.match(texts(crypto).join('\n'), /### Crypto\n```/);
  assert.deepEqual(table(crypto), [
    'Coin     Coins  Price  Value',
    '───────  ─────  ─────  ─────',
    'BTC-USD    0.5      -      -',
    `${' '.repeat(20)}-      -`,
  ]);

  const options = portfolioView('42', 'OPTION', [call, aapl, btc], 0);
  assert.equal(json(options)[0].accent_color, Colors.Red);
  assert.deepEqual(table(options), [
    'Contract                    #  Price  Value',
    '──────────────────────────  ─  ─────  ─────',
    'AAPL CALL $150.00 01/15/27  1      -      -',
    `${' '.repeat(35)}-      -`,
  ]);

  const empty = texts(portfolioView('42', 'CRYPTO', [aapl], 0)).join('\n');
  assert.match(empty, /No crypto holdings\./);
  assert.doesNotMatch(empty, /-# Coin/);
  assert.match(texts(portfolioView('42', 'STOCK', [], 0)).join('\n'), /No stock holdings\./);
});

test('the tab buttons switch tabs, the open tab is highlighted, and no two buttons share a custom ID', () => {
  const view = portfolioView('42', 'CRYPTO', [aapl, btc], 0);
  assert.deepEqual(buttons(view), [
    ['portfolio:STOCK:0:42:tab', 'Stocks', ButtonStyle.Secondary, false],
    ['portfolio:CRYPTO:0:42:tab', 'Crypto', ButtonStyle.Primary, false],
    ['portfolio:OPTION:0:42:tab', 'Options', ButtonStyle.Secondary, false],
    ['portfolio:TX:0:42:tab', 'Transactions', ButtonStyle.Secondary, false],
  ]);
});

test('a holdings tab shows 10 rows a page, with page buttons only when there is more than one page', () => {
  const stocks = Array.from({ length: 12 }, (_, i): Position => ({ ...aapl, ticker: `T${String(i).padStart(2, '0')}` }));
  const first = portfolioView('42', 'STOCK', stocks, 0);
  // The ticker of each holding, from the first of its two lines, after the heading and rule lines.
  const rows = (view: View) => table(view).slice(2).filter((line) => !line.startsWith(' ')).map((line) => line.split(' ')[0]);
  assert.equal(rows(first).length, 10);
  assert.match(texts(first).join('\n'), /Page 1 of 2/);
  const ids = buttons(first).map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(buttons(first).slice(4).map(([id, , , disabled]) => [id, disabled]), [['portfolio:STOCK:-1:42', true], ['portfolio:STOCK:1:42', false]]);

  const pastTheEnd = portfolioView('42', 'STOCK', stocks, 9);
  assert.deepEqual(rows(pastTheEnd), ['T10', 'T11']);
  assert.match(texts(pastTheEnd).join('\n'), /Page 2 of 2/);

  assert.equal(buttons(portfolioView('42', 'STOCK', stocks.slice(0, 10), 0)).length, 4);
});

test('the transactions tab is yellow, with each transaction its own text display between separators, and pages', () => {
  const view = transactionsView('42', ['tx one', 'tx two', 'tx three'], 1, 3);
  assert.equal(json(view)[0].accent_color, Colors.Yellow);
  const kinds = children(view);
  const from = kinds.findIndex(([, text]) => text === 'tx one');
  assert.deepEqual(
    kinds.slice(from, from + 5).map(([type]) => type),
    [ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay],
  );
  assert.match(texts(view).join('\n'), /### Transactions[\s\S]*Page 2 of 3/);
  assert.equal(buttons(view)[3][2], ButtonStyle.Primary);
  assert.deepEqual(buttons(view).slice(4).map(([id]) => id), ['portfolio:TX:0:42', 'portfolio:TX:2:42']);

  const none = transactionsView('42', [], 0, 0);
  assert.match(texts(none).join('\n'), /No transactions yet\./);
  assert.equal(buttons(none).length, 4);
});

test('position shows its holdings and a page of transactions, with page buttons only when there is more than one page', () => {
  const single = positionView('42', 'AAPL', [aapl], ['tx one'], 0, 1);
  assert.equal(single.components.length, 1);
  assert.match(texts(single).join('\n'), /## AAPL — <@42>[\s\S]*\*\*AAPL\*\* · 12\.5 SHARES/);

  const paged = positionView('42', 'AAPL', [], ['tx one'], 1, 3);
  assert.equal(paged.components.length, 2);
  const all = texts(paged).join('\n');
  assert.match(all, /Nothing held\./);
  assert.match(all, /Page 2 of 3/);
  const buttons = paged.components[1].toJSON() as { components: { custom_id: string; disabled: boolean }[] };
  assert.deepEqual(
    buttons.components.map((b) => [b.custom_id, b.disabled]),
    [['position:0:42:AAPL', false], ['position:2:42:AAPL', false]],
  );
});


test('a priced holding adds price, value and P/L to its row, and the totals add value, counting unpriced holdings at cost', () => {
  const priced = texts(portfolioView('42', 'STOCK', [{ ...aapl, price: 12 }, { ...btc, price: 70_000 }], 0)).join('\n');
  // Each priced holding takes two lines, so no line carries every column: under the price, its move
  // today, and under the value, what that move gained or lost on the whole holding (12.5 × $0.50),
  // coloured by the day, not the overall P/L. Only Price and Value are headed. The dot rides at the
  // very end, where its double width can't misalign anything.
  const pastNameAndShares = ' '.repeat(6 + 2 + 6 + 2);
  assert.deepEqual(table(portfolioView('42', 'STOCK', [{ ...aapl, price: 12, prevClose: 11.5 }], 0)), [
    'Ticker  Shares   Price    Value',
    '──────  ──────  ──────  ───────',
    'AAPL      12.5  $12.00  $150.00',
    `${pastNameAndShares}+$0.50   +$6.25🟢`,
  ]);
  const down = table(portfolioView('42', 'STOCK', [{ ...aapl, price: 12, prevClose: 13 }], 0));
  assert.equal(down[3], `${pastNameAndShares}-$1.00  -$12.50🔴`, 'a down day is red, though the holding is up overall');
  const noClose = table(portfolioView('42', 'STOCK', [{ ...aapl, price: 12, prevClose: null }], 0));
  assert.equal(noClose[3], `${pastNameAndShares}     -        -`, 'no previous close: no day figures, no dot');
  assert.match(priced, /\*\*Cost basis\*\* \$125\.00 · \*\*Value\*\* \$150\.00 · \*\*Total, all holdings\*\* \$30,125\.00 cost, \$35,150\.00 value$/m);

  const partly = texts(portfolioView('42', 'STOCK', [{ ...aapl, price: 12 }, msft, btc], 0)).join('\n');
  assert.deepEqual(
    table(portfolioView('42', 'STOCK', [{ ...aapl, price: 12 }, msft], 0)).slice(4),
    ['MSFT      12.5       -        -', `${' '.repeat(21)}-        -`],
    'not fetched yet: "-" on both lines, like a failed fetch',
  );
  assert.match(partly, /\*\*Value\*\* \$275\.00 \(1 at cost, no price\)/);
  assert.match(partly, /\$30,250\.00 cost, \$30,275\.00 value \(2 at cost, no price\)$/m);

  assert.deepEqual(table(portfolioView('42', 'STOCK', [{ ...aapl, price: null, priceFailed: true }], 0)), [
    'Ticker  Shares  Price  Value',
    '──────  ──────  ─────  ─────',
    'AAPL      12.5      -      -',
    `${' '.repeat(20)}-      -`,
  ]);

  const position = texts(positionView('42', 'AAPL', [{ ...aapl, price: 12, prevClose: 11.5 }], ['tx'], 0, 1)).join('\n');
  assert.match(position, /price \$12\.00 · day \+\$0\.50 · value \$150\.00 · Total P\/L 🟢 \+\$25\.00/);
  assert.match(position, /\*\*Total cost basis\*\* \$125\.00 · \*\*value\*\* \$150\.00$/m);
});
