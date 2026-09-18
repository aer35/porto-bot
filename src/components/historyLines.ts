import type { History } from './ledger.js';
import { messages } from '../strings/messages.js';

// One line per row, oldest first. Tracks each ticker's previous share count so split rows can show "5 → 8".
export function historyLines(history: History) {
  const previous = new Map<string, number>();
  return history.map(({ tx, shares }) => {
    const before = previous.get(tx.ticker) ?? 0;
    previous.set(tx.ticker, shares);
    return messages.txLine(tx, [before, shares]);
  });
}
