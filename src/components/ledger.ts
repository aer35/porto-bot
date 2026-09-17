// A row of the transactions table (migrations/001_transactions.sql).
export type Tx = {
  id: number;
  user_id: string;
  sec_type: 'STOCK' | 'SPLIT';
  side: 'BUY' | 'SELL' | null;
  ticker: string;
  shares: number | null;
  price: number | null;
  trade_date: number;
  created_at: number;
  split_from: number | null;
  split_to: number | null;
};

export type Position = { ticker: string; shares: number; avgCost: number };

export type Replay =
  | { ok: true; positions: Position[]; history: { tx: Tx; shares: number }[] }
  | { ok: false; oversold: Tx };

// Replays one user's rows, in any order, into current positions using average cost.
// `history` holds shares of that row's ticker after each row, for rendering split rows as "5 → 8".
export function replay(rows: Tx[]): Replay {
  const held = new Map<string, { shares: number; avgCost: number }>();
  const history: { tx: Tx; shares: number }[] = [];

  const ordered = rows.toSorted((a, b) => a.trade_date - b.trade_date || a.created_at - b.created_at || a.id - b.id);
  for (const tx of ordered) {
    const pos = held.get(tx.ticker) ?? { shares: 0, avgCost: 0 };

    if (tx.sec_type === 'SPLIT') {
      // Half-up; the fractional share is discarded along with its cost.
      pos.shares = Math.round((pos.shares * tx.split_to!) / tx.split_from!);
      pos.avgCost = (pos.avgCost * tx.split_from!) / tx.split_to!;
    } else if (tx.side === 'BUY') {
      pos.avgCost = (pos.shares * pos.avgCost + tx.shares! * tx.price!) / (pos.shares + tx.shares!);
      pos.shares += tx.shares!;
    } else {
      if (tx.shares! > pos.shares) return { ok: false, oversold: tx };
      pos.shares -= tx.shares!;
    }

    if (pos.shares > 0) held.set(tx.ticker, pos);
    else held.delete(tx.ticker);
    history.push({ tx, shares: pos.shares });
  }

  const positions = [...held]
    .map(([ticker, { shares, avgCost }]) => ({ ticker, shares, avgCost }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { ok: true, positions, history };
}
