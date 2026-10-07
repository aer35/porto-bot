import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { migrate } from '../queries/migrate.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const backups = (dir: string) => readdirSync(dir).filter((f) => f.includes('-backup-'));

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

test('backs up an existing database file before applying pending migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'porto-backup-'));
  const path = join(dir, 'porto.db');
  const db = new DatabaseSync(path);
  migrate(db, dirWith({ '001_create.sql': 'CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1);' }));
  assert.deepEqual(backups(dir), [], 'a fresh database has nothing to back up');

  const next = dirWith({
    '001_create.sql': 'CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1);',
    '002_double.sql': 'UPDATE t SET n = n * 100;',
  });
  migrate(db, next);
  const [backup] = backups(dir);
  assert.match(backup, /^porto\.db\.v1-backup-.+\.db$/);
  const old = new DatabaseSync(join(dir, backup), { readOnly: true });
  assert.equal(version(old), 1);
  assert.equal(old.prepare('SELECT n FROM t').get()!.n, 1);

  migrate(db, next);
  assert.equal(backups(dir).length, 1, 'nothing pending means no new backup');
});

test('the real migrations apply to a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(version(db) >= 1);
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('transactions').map((r) => r.name);
  assert.deepEqual(columns, [
    'id', 'user_id', 'sec_type', 'side', 'ticker', 'shares', 'price', 'trade_date', 'created_at', 'split_from',
    'split_to', 'ref', 'opt_right', 'strike', 'expiry',
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

  const upTo002 = ['001_transactions.sql', '002_transaction_refs.sql'];
  migrate(db, dirWith(Object.fromEntries(upTo002.map((f) => [f, readFileSync(join(migrationsDir, f), 'utf8')]))));

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

test('ref_prefixes renames 2-letter references and counters to 3 letters', () => {
  const db = new DatabaseSync(':memory:');
  // Migrate to just before ref_prefixes, write rows the 2-letter way, then apply the rest.
  const before = readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f) && parseInt(f, 10) < 2026092700);
  migrate(db, dirWith(Object.fromEntries(before.map((f) => [f, readFileSync(join(migrationsDir, f), 'utf8')]))));
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, sec_type, side, ticker, shares, price, trade_date, split_from, split_to, ref)
     VALUES ('u', ?, ?, 'AAPL', ?, ?, 1, ?, ?, ?)`,
  );
  insert.run('STOCK', 'BUY', 100, 1, null, null, 'BS01');
  insert.run('STOCK', 'SELL', 100, 1, null, null, 'SS01');
  insert.run('STOCK', 'BUY', 100, 1, null, null, 'BS02');
  insert.run('SPLIT', null, null, null, 2, 3, 'SL01');
  db.exec("INSERT INTO ref_counters VALUES ('BS', 3), ('SS', 2), ('SL', 2)");

  migrate(db);

  assert.deepEqual(
    db.prepare('SELECT ref FROM transactions ORDER BY id').all().map((r) => r.ref),
    ['BSS01', 'SSS01', 'BSS02', 'XSS01'],
  );
  const counters = db.prepare('SELECT prefix, next FROM ref_counters ORDER BY prefix').all();
  assert.deepEqual(counters.map(({ prefix, next }) => ({ prefix, next })), [
    { prefix: 'BSS', next: 3 },
    { prefix: 'SSS', next: 2 },
    { prefix: 'XSS', next: 2 },
  ]);
});

test('stock quantities move from hundredths to thousandths; crypto, options and splits are untouched', () => {
  const db = new DatabaseSync(':memory:');
  const before = readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f) && parseInt(f, 10) < 2026092800);
  migrate(db, dirWith(Object.fromEntries(before.map((f) => [f, readFileSync(join(migrationsDir, f), 'utf8')]))));
  const insert = db.prepare(
    `INSERT INTO transactions (user_id, sec_type, side, ticker, shares, price, trade_date, split_from, split_to, ref)
     VALUES ('u', ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  insert.run('STOCK', 'BUY', 'AAPL', 1278, 1, null, null, 'BSS01');
  insert.run('CRYPTO', 'BUY', 'BTC-USD', 34_000, 1, null, null, 'BCC01');
  insert.run('OPTION', 'BUY', 'AAPL', 2, 1, null, null, 'BOC01');
  insert.run('SPLIT', null, 'AAPL', null, null, 2, 3, 'XSS01');

  migrate(db);

  assert.deepEqual(db.prepare('SELECT shares FROM transactions ORDER BY id').all().map((r) => r.shares), [12_780, 34_000, 2, null]);
});

test('a database with the first prices table gains its previous-close column', () => {
  const db = new DatabaseSync(':memory:');
  const upToPrices = readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f) && parseInt(f, 10) <= 2026092900);
  migrate(db, dirWith(Object.fromEntries(upToPrices.map((f) => [f, readFileSync(join(migrationsDir, f), 'utf8')]))));
  migrate(db);
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('prices').map((r) => r.name);
  assert.deepEqual(columns, ['symbol', 'price', 'fetched_at', 'failed_at', 'prev_close']);
});

test('a database already migrated by 2.0 gains the prices table', () => {
  const db = new DatabaseSync(':memory:');
  // Exactly the migrations 2.0.x shipped. A later file numbered below the last of these would never
  // run on a live install, since migrate only applies files above PRAGMA user_version.
  const released = [
    '001_transactions.sql', '002_transaction_refs.sql', '2026092615_alter_shares_values.sql', '2026092700_ref_prefixes.sql',
    '2026092701_crypto_prefixes.sql', '2026092702_options.sql', '2026092703_holdings.sql', '2026092800_stock_thousandths.sql',
  ];
  migrate(db, dirWith(Object.fromEntries(released.map((f) => [f, readFileSync(join(migrationsDir, f), 'utf8')]))));
  assert.equal(version(db), 2026092800);

  migrate(db);

  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prices'").get());
});
