import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

// A real file, since locking only happens between connections to the same file.
const path = join(mkdtempSync(join(tmpdir(), 'porto-db-')), 'porto.db');
Object.assign(process.env, { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', DISCORD_GUILD_ID: 'g', DB_PATH: path });
const { db } = await import('../queries/db.js');

test('a write waits for another process holding the database, instead of failing as locked', async () => {
  // Stands in for `node dist/fetchPrices.js` run in a second container: it takes the write lock,
  // then commits 200 ms later.
  const other = new Worker(
    `const { DatabaseSync } = require('node:sqlite');
     const { parentPort, workerData } = require('node:worker_threads');
     const db = new DatabaseSync(workerData);
     db.exec('BEGIN IMMEDIATE');
     db.prepare('INSERT INTO prices VALUES (?, ?, ?)').run('AAPL', 1, 0);
     parentPort.postMessage('locked');
     setTimeout(() => { db.exec('COMMIT'); db.close(); }, 200);`,
    { eval: true, workerData: path },
  );
  await new Promise((resolve) => other.once('message', resolve));

  db.prepare('INSERT INTO prices VALUES (?, ?, ?)').run('MSFT', 1, 0);

  assert.equal(db.prepare('SELECT count(*) AS n FROM prices').get()!.n, 2);
});
