'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApp } = require('./helpers.cjs');
const { LATEST } = require('../src/db/migrations');

test('schema, seeded denominations and settings', async () => {
  const a = await openApp();
  assert.equal(a.store.all('SELECT * FROM denominations').length, 11);
  assert.equal(a.repo.getSetting('theme'), 'dark');
  assert.equal(a.repo.getSetting('rounding_step'), '10');
});
test('writes outside a transaction are refused; foreign keys stay on after flush', async () => {
  const a = await openApp();
  assert.throws(() => a.store.run("UPDATE settings SET value='x'"), /transaction/);
  a.store.transaction(() => a.repo.setSetting('theme', 'light'));
  assert.equal(a.store.get('PRAGMA foreign_keys')['foreign_keys'], 1);
});
test('a failed transaction rolls back', async () => {
  const a = await openApp();
  assert.throws(() => a.store.transaction(() => { a.repo.setSetting('theme', 'light'); throw new Error('boom'); }), /boom/);
  assert.equal(a.repo.getSetting('theme'), 'dark');
});
test('committed data persists across reopen; deferred theme is flushed on close', async () => {
  const a = await openApp();
  a.store.transaction(() => a.repo.setSetting('theme', 'light'), { defer: true });
  a.store.close();
  const b = await a.reopen();
  assert.equal(b.repo.getSetting('theme'), 'light');
});
test('refuses a database from a newer version, and leaves a damaged file untouched', async () => {
  const a = await openApp();
  a.store.transaction(() => a.store.run('INSERT INTO migrations(version, applied_at) VALUES (?, ?)', [LATEST + 5, 'x']));
  await assert.rejects(a.reopen(), /newer/i);
  const f = path.join(a.vault.dataDir, 'cashdesk.db');
  const bad = Buffer.from(fs.readFileSync(f)); bad[50] ^= 1; fs.writeFileSync(f, bad);
  const before = fs.readFileSync(f);
  await assert.rejects(a.reopen());
  assert.ok(fs.readFileSync(f).equals(before));
});
