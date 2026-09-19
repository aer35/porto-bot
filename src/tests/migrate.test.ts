import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { migrate } from '../queries/migrate.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

function dirWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'porto-migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

test('applies pending migrations in order and bumps user_version', () => {
  const db = new DatabaseSync(':memory:');
  const dir = dirWith({
    '002_add.sql': 'INSERT INTO t VALUES (2);',
    '001_create.sql': 'CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1);',
  });
  migrate(db, dir);
  assert.equal(version(db), 2);
  assert.deepEqual(db.prepare('SELECT n FROM t').all().map((r) => r.n), [1, 2]);
});

test('skips migrations at or below user_version', () => {
  const db = new DatabaseSync(':memory:');
  const dir = dirWith({ '001_create.sql': 'CREATE TABLE t (n INTEGER);' });
  migrate(db, dir);
  migrate(db, dir);
  assert.equal(version(db), 1);
});

test('rolls back a failing migration and keeps the previous version', () => {
  const db = new DatabaseSync(':memory:');
  const dir = dirWith({
    '001_create.sql': 'CREATE TABLE t (n INTEGER);',
    '002_bad.sql': 'INSERT INTO t VALUES (1); INSERT INTO nope VALUES (1);',
  });
  assert.throws(() => migrate(db, dir));
  assert.equal(version(db), 1);
  assert.equal(db.prepare('SELECT count(*) AS c FROM t').get()!.c, 0);
});

test('the real migrations apply to a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(version(db) >= 1);
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('transactions').map((r) => r.name);
  assert.deepEqual(columns, [
    'id', 'user_id', 'sec_type', 'side', 'ticker', 'shares', 'price', 'trade_date', 'created_at', 'split_from',
    'split_to', 'ref',
  ]);
});

test('002 backfills references for rows written before it, and seeds the counters', () => {
  const db = new DatabaseSync(':memory:');
  // Migrate to 001 only, insert rows the old way, then let 002 backfill them.
  migrate(db, dirWith({ '001_transactions.sql': readFileSync(join(migrationsDir, '001_transactions.sql'), 'utf8') }));
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, sec_type, side, ticker, shares, price, trade_date)
     VALUES (?, ?, ?, 'AAPL', 1, 1, 1)`,
  );
  insert.run('u', 'STOCK', 'BUY');
  insert.run('u', 'STOCK', 'SELL');
  insert.run('u', 'STOCK', 'BUY');
  db.prepare(
    `INSERT INTO transactions (user_id, sec_type, side, ticker, trade_date, split_from, split_to)
     VALUES ('u', 'SPLIT', NULL, 'AAPL', 1, 2, 3)`,
  ).run();

  migrate(db);

  assert.deepEqual(
    db.prepare('SELECT ref FROM transactions ORDER BY id').all().map((r) => r.ref),
    ['BS01', 'SS01', 'BS02', 'SL01'],
  );
  const counters = db.prepare('SELECT prefix, next FROM ref_counters ORDER BY prefix').all();
  assert.deepEqual(counters.map(({ prefix, next }) => ({ prefix, next })), [
    { prefix: 'BS', next: 3 },
    { prefix: 'SL', next: 2 },
    { prefix: 'SS', next: 2 },
  ]);
});
