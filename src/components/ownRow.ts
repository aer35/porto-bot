import { getRow } from '../queries/transactions.js';
import { messages } from '../strings/messages.js';
import { UserError } from './userError.js';

// A row the user may edit, found by its reference. Someone else's row gets the same error as a missing one.
export function ownRow(ref: string, userId: string) {
  const row = getRow(ref);
  if (!row || row.user_id !== userId) throw new UserError(messages.notYourRow(ref));
  return row;
}
