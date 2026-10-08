import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { messages } from '../strings/messages.js';
import type { Holding, Totals } from './prices.js';
import { pageButtons } from './pageButtons.js';
import { value, type Holdable } from './units.js';

// /portfolio and /position replies, built from Discord's message components (Container,
// TextDisplay, Separator) instead of an embed with code-block tables. With the IsComponentsV2 flag
// a message may not also carry content or embeds, and all its text displays share one 4000
// character budget. Mentions inside text displays would ping, so allowedMentions turns that off.

type View = {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
};

const view = (components: View['components']): View => ({
  components,
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
});

const text = (content: string) => new TextDisplayBuilder().setContent(content);

// Adds transaction lines as separate text displays with a separator component between entries.
function addTransactions(container: ContainerBuilder, lines: string[]) {
  lines.forEach((line, i) => {
    if (i > 0) container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(text(line));
  });
}

// What some holdings cost, and what they are worth at current prices with any holding that has no
// price yet counted at cost. current is null when none of them has a price.
function totals(holdings: Holding[]): Totals {
  const sum = (amount: (h: Holding) => number) => holdings.reduce((total, h) => total + amount(h), 0);
  const cost = (h: Holding) => value(h.sec_type, h.shares, h.avgCost);
  const unpriced = holdings.filter((h) => h.price == null).length;
  const current =
    unpriced === holdings.length ? null : sum((h) => (h.price == null ? cost(h) : value(h.sec_type, h.shares, h.price)));
  return { cost: sum(cost), current, unpriced };
}
const totalLine = (holdings: Holding[]) => messages.portfolio.total(totals(holdings));

// One line per holding, then the total cost basis across all of them.
const holdingsText = (positions: Holding[], empty: string) =>
  positions.length ? [...positions.map(messages.holdingLine), totalLine(positions)].join('\n') : empty;

// /portfolio is one tab at a time: a holdings tab per security type, then every transaction.
export type Tab = Holdable | 'TX';
export const TABS: Tab[] = ['STOCK', 'CRYPTO', 'OPTION', 'TX'];
const ACCENT: Record<Tab, number> = { STOCK: Colors.Green, CRYPTO: Colors.Blue, OPTION: Colors.Red, TX: Colors.Yellow };
export const PAGE_SIZE = 10;

// Button custom IDs are portfolio:TAB:PAGE:USER. A tab button adds ":tab" because Discord rejects a
// message where two components share a custom ID, and on page 2 "Previous" also points at page 0.
function tabButtons(userId: string, open: Tab) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    TABS.map((tab) =>
      new ButtonBuilder()
        .setCustomId(`portfolio:${tab}:0:${userId}:tab`)
        .setLabel(messages.portfolio.tabs[tab])
        .setStyle(tab === open ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

// The frame every tab shares: the tab's colour, title and heading, the caller's body, then the page
// count, the tab buttons, and Previous/Next only when there is more than one page.
function portfolioFrame(userId: string, tab: Tab, body: (c: ContainerBuilder) => void, page: number, pageCount: number) {
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT[tab])
    .addTextDisplayComponents(text(`${messages.portfolio.title(userId)}\n### ${messages.portfolio.tabs[tab]}`));
  body(container);
  if (pageCount > 1) container.addTextDisplayComponents(text(messages.page(page, pageCount)));
  const rows = [tabButtons(userId, tab)];
  if (pageCount > 1) rows.push(pageButtons((p) => `portfolio:${tab}:${p}:${userId}`, page, pageCount));
  return view([container, ...rows]);
}

// A holdings tab: a table of one page of that type's holdings, then the tab's cost basis
// beside the total of every holding. `positions` is every holding, sorted by ticker; `page` is
// clamped, since holdings may have changed since a button was sent.
export function portfolioView(userId: string, tab: Holdable, positions: Holding[], page: number) {
  const held = positions.filter((p) => p.sec_type === tab);
  const pageCount = Math.max(1, Math.ceil(held.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 0), pageCount - 1);
  const shown = held.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return portfolioFrame(
    userId,
    tab,
    (c) =>
      c.addTextDisplayComponents(
        text(
          held.length
            ? [messages.holdingsTable(tab, shown), '', messages.portfolio.tabTotal(totals(held), totals(positions))].join('\n')
            : messages.portfolio.empty[tab],
        ),
      ),
    page,
    pageCount,
  );
}

// The transactions tab: one page of every transaction, newest first, already cut by historyPage.
export function transactionsView(userId: string, lines: string[], page: number, pageCount: number) {
  return portfolioFrame(
    userId,
    'TX',
    (c) => (lines.length ? addTransactions(c, lines) : c.addTextDisplayComponents(text(messages.portfolio.noTransactions))),
    page,
    pageCount,
  );
}

// One page of a ticker's transactions (already cut to the page), under the holdings for that ticker.
export function positionView(userId: string, ticker: string, held: Holding[], lines: string[], page: number, pageCount: number) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(messages.position.title(userId, ticker)),
      text(holdingsText(held, messages.position.nothingHeld)),
    )
    .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text(messages.position.transactions));
  addTransactions(container, lines);
  if (pageCount === 1) return view([container]);
  container.addTextDisplayComponents(text(messages.page(page, pageCount)));
  return view([container, pageButtons((p) => `position:${p}:${userId}:${ticker}`, page, pageCount)]);
}
