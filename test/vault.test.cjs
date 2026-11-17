'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createVault } = require('../src/security/vault');
const { tmp, fakeSafeStorage } = require('./helpers.cjs');

test('round trip, and the file on disk is not readable', () => {
  const dir = tmp(); const v = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  v.write('cashdesk.db', Buffer.from('SQLite format 3\0hello'));
  assert.equal(v.read('cashdesk.db').toString(), 'SQLite format 3\0hello');
  const raw = fs.readFileSync(path.join(v.dataDir, 'cashdesk.db'));
  assert.ok(!raw.includes('SQLite format 3'));
  assert.ok(!raw.includes('hello'));
});
test('a plain (planted) file is refused, a changed file is refused', () => {
  const dir = tmp(); const v = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  v.write('cashdesk.db', Buffer.from('abc'));
  const f = path.join(v.dataDir, 'cashdesk.db');
  const good = fs.readFileSync(f);
  fs.writeFileSync(f, Buffer.from('SQLite format 3\0 plain'));
  assert.throws(() => v.read('cashdesk.db'), { code: 'UNPROTECTED' });
  const bad = Buffer.from(good); bad[bad.length - 1] ^= 1; fs.writeFileSync(f, bad);
  assert.throws(() => v.read('cashdesk.db'), { code: 'TAMPERED' });
});
test('a sealed file renamed to another role does not open', () => {
  const dir = tmp(); const v = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  v.write('a.db', Buffer.from('x'));
  fs.copyFileSync(path.join(v.dataDir, 'a.db'), path.join(v.dataDir, 'b.db'));
  assert.throws(() => v.read('b.db'), { code: 'TAMPERED' });
});
test('never creates a new key when sealed data exists', () => {
  const dir = tmp(); const v = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  v.write('cashdesk.db', Buffer.from('x'));
  fs.rmSync(path.join(dir, 'cashdesk.key'));
  assert.throws(() => createVault({ userDataDir: dir, safeStorage: fakeSafeStorage }), { code: 'KEY_MISSING' });
  assert.ok(!fs.existsSync(path.join(dir, 'cashdesk.key')), 'no replacement key was written');
});
test('refuses when secure storage is unavailable', () => {
  assert.throws(() => createVault({ userDataDir: tmp(), safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } }), { code: 'NO_SECURE_STORAGE' });
});
