import { applyChange, replay, type Change, type Tx } from './ledger.js';
import { logRow } from './log.js';
import { deleteRow, insertRow, updateRow, userRows } from '../queries/transactions.js';
import { messages } from '../strings/messages.js';
import { UserError } from './userError.js';

// Replays a user's stored rows. Every write goes through commitChange, so stored rows always replay cleanly.
export function ledgerOf(userId: string) {
  const result = replay(userRows(userId));
  if (!result.ok) throw new Error(`Stored ledger for ${userId} does not replay (row ${result.oversold.id})`);
  return result;
}

// The one path for changes that can affect share counts: apply to a hypothetical copy of the
// user's ledger, reject if any ticker would go negative, and only then write.
// Returns the row as stored for inserts and updates.
export function commitChange(userId: string, change: Change): Tx | undefined {
  const result = replay(applyChange(userRows(userId), change));
  if (!result.ok) throw new UserError(messages.oversold(result.oversold));
  if ('insert' in change) return logRow('insert', insertRow(change.insert));
  if ('update' in change) return logRow('update', updateRow(change.update));
  deleteRow(change.delete.id);
  logRow('delete', change.delete);
}