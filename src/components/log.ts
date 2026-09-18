import type { Tx } from './ledger.js';
import { toDateString } from './validate.js';

// One line per stored change, so `docker compose logs bot` is a record of every transaction and
// the first place to look when a number looks wrong. Plain text, not JSON: it is read by a person.
export function logTx(event: string, userId: string, detail: string) {
  console.log(`${new Date().toISOString()} tx.${event} user=${userId} ${detail}`);
}

export const txDetail = (tx: Tx) =>
  tx.sec_type === 'SPLIT'
    ? `${tx.ref} SPLIT ${tx.split_to}:${tx.split_from} ${tx.ticker} date=${toDateString(tx.trade_date)}`
    : `${tx.ref} ${tx.side} ${tx.shares} ${tx.ticker} @ ${tx.price} total=${(tx.shares! * tx.price!).toFixed(2)} date=${toDateString(tx.trade_date)}`;
