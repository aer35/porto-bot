import { getRow } from '../queries/transactions.js';
import { messages } from '../strings/messages.js';
import { UserError } from './userError.js';

// A row the user may edit. Someone else's row gets the same error as a missing one.
export function ownRow(id: number, userId: string) {
  const row = getRow(id);
  if (!row || row.user_id !== userId) throw new UserError(messages.notYourRow(id));
  return row;
}
