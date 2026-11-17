'use strict';
// Schema versions. Migration 1 is the baseline (schema.sql). Every later change is a NEW file in
// src/db/migrations/ added to the list below, applied in order, each inside one transaction.
// Never edit a migration that has shipped. A database written by a newer app is refused, not opened.
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = [
  { version: 1, name: 'baseline schema', file: 'schema.sql' },
  { version: 2, name: 'starter lists', file: 'migrations/002_seed_lists.sql' },
];

const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;

function currentVersion(db) {
  const table = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'");
  if (!table.length) return 0;
  const rows = db.exec('SELECT MAX(version) FROM migrations');
  const value = rows.length ? rows[0].values[0][0] : 0;
  return Number(value) || 0;
}

function sqlFor(migration) {
  return fs.readFileSync(path.join(__dirname, migration.file), 'utf8');
}

// Returns the list of versions that were applied (empty when the database was already current).
function migrate(db, { now = () => new Date() } = {}) {
  const from = currentVersion(db);
  if (from > LATEST) {
    throw new Error('This data was written by a newer version of Cash Desk. Update the app. Nothing was changed.');
  }
  const applied = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    db.run('BEGIN');
    try {
      db.exec(sqlFor(migration));
      db.run('INSERT INTO migrations (version, applied_at) VALUES (?, ?)', [migration.version, now().toISOString()]);
      db.run('COMMIT');
    } catch (error) {
      try { db.run('ROLLBACK'); } catch { /* nothing open */ }
      throw new Error(`Database upgrade to version ${migration.version} failed: ${error.message}`);
    }
    applied.push(migration.version);
  }
  return applied;
}

module.exports = { migrate, currentVersion, LATEST, MIGRATIONS };
