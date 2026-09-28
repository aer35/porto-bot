import { inTransaction } from '../queries/db.js';
import { stockRowsForTicker, updateRow } from '../queries/transactions.js';
import { logRow } from './log.js';
import { units } from './units.js';
import { syncUser } from './userLedger.js';

// One-time fix for installs that ran V1, which had no crypto: members recorded coins with /buy as
// if they were stock (in hundredths then, thousandths since 2026092800). This turns every such row, for every member, into a CRYPTO
// row under `to` at the crypto scale, with a crypto reference. Run by the host (src/convertCrypto.ts).
// Returns how many rows changed.
//
// No replay check is needed: every member's stock rows and crypto rows already replay on their own,
// and merging two ledgers that never go negative cannot go negative.
export function convertToCrypto(from: string, to: string) {
  const rows = stockRowsForTicker(from);
  // A split recorded on a coin has no crypto meaning; the host decides what to do with it first.
  if (rows.some((row) => row.sec_type === 'SPLIT')) {
    throw new Error(`${from} has split rows. Delete them with /delete, then run this again.`);
  }
  const converted = inTransaction(() => {
    const updated = rows.map((row) =>
      updateRow({ ...row, sec_type: 'CRYPTO', ticker: to, shares: row.shares! * (units.CRYPTO.scale / units.STOCK.scale) }),
    );
    for (const userId of new Set(rows.map((row) => row.user_id))) syncUser(userId);
    return updated;
  });
  // Logged only once committed, so the log never records a change that was rolled back.
  for (const row of converted) logRow('convert', row);
  return converted.length;
}
