import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { migrate } from './migrate.js';

// One synchronous connection for the whole process. Because every call blocks, a command's
// read → replay → write sequence cannot interleave with another interaction's.
export const db = new DatabaseSync(config.dbPath);
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
