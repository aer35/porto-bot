import type { Tx } from './ledger.js';

// Every transaction has a reference like BS01: two letters for its type, then how many of that
// type the bot has recorded, padded to at least two digits. This is the ID users type into
// /amend and /delete. V2 option types add their own two-letter prefixes.
export const refPrefix = (tx: Pick<Tx, 'sec_type' | 'side'>) => (tx.sec_type === 'SPLIT' ? 'SP' : tx.side === 'BUY' ? 'BS' : 'SS');

export const formatRef = (prefix: string, seq: number) => prefix + String(seq).padStart(2, '0');

// Accepts what a user might type: lower case, and fewer digits than the reference is shown with.
export function parseRef(input: string) {
  const match = input.trim().toUpperCase().match(/^([A-Z]{2})(\d+)$/);
  return match ? formatRef(match[1], Number(match[2])) : null;
}
