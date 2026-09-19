import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { migrate } from './migrate.js';

// One synchronous connection for the whole process. Because every call blocks, a command's
// read → replay → write sequence cannot interleave with another interaction's.
export const db = new DatabaseSync(config.dbPath);
migrate(db);
