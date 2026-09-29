import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { migrate } from './migrate.js';

// One synchronous connection for the whole process. Because every call blocks, a command's
// read → replay → write sequence cannot interleave with another interaction's.
// The timeout covers a second process on the same file, like `node dist/fetchPrices.js` run while
// the bot is up: a statement waits up to 5 s for the other's write instead of failing as locked.
export const db = new DatabaseSync(config.dbPath, { timeout: 5_000 });
migrate(db);

// Runs fn inside BEGIN/COMMIT, rolling back if it throws, so a multi-table write lands whole or not at all.
export function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
