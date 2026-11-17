'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApp, tmp, fakeSafeStorage } = require('./helpers.cjs');
const { BackupService, sealBackup } = require('../src/backup/service');

async function ready() {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.ledger.saveOpening({ pieces: { N500: 4, N100: 10 } });
  const folder = tmp();
  a.backups = new BackupService({ store: a.store, repo: a.repo, safeStorage: fakeSafeStorage, userDataDir: a.dir, defaultDir: folder, now: () => new Date(2026, 10, 17, 10, 0, 0) });
  a.folder = folder;
  return a;
}
const people = (a) => a.ledger.searchPeople({ q: '', limit: 50 }).people.map((p) => p.name);
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, code);

test('no password yet: manual backup refused, automatic backup reports it and never throws', async () => {
  const a = await ready();
  rejects(() => a.backups.create(), 'BACKUP_OFF');
  const r = a.backups.auto('day close');
  assert.equal(r.ok, false); assert.equal(r.code, 'BACKUP_OFF');
  assert.equal(a.backups.status().configured, false);
});

test('password rules; a backup file is sealed, not a readable database', async () => {
  const a = await ready();
  assert.throws(() => a.backups.setPassword('short'), /8 to 128/);
  a.backups.setPassword('correct horse');
  assert.equal(a.backups.status().configured, true);
  const b = a.backups.create('manual');
  const bytes = fs.readFileSync(b.path);
  assert.ok(!bytes.includes(Buffer.from('SQLite format')));
  assert.ok(!bytes.includes(Buffer.from('karthik')));
  assert.equal(a.backups.status().files.length, 1);
});

test('restore: wrong password refused, right password brings back the saved data, a safety copy is kept', async () => {
  const a = await ready();
  a.backups.setPassword('correct horse');
  a.ledger.savePerson({ name: 'Ravi' });
  const b = a.backups.create();
  a.ledger.savePerson({ name: 'Meena' });
  assert.deepEqual(people(a).sort(), ['Meena', 'Ravi']);
  rejects(() => a.backups.restore({ name: b.name, password: 'wrong password' }), 'BAD_PASSWORD');
  assert.deepEqual(people(a).sort(), ['Meena', 'Ravi']);                 // nothing changed
  const r = a.backups.restore({ name: b.name, password: 'correct horse' });
  assert.deepEqual(people(a), ['Ravi']);
  assert.match(r.safetyCopy, /before-restore/);
  assert.equal(a.ledger.drawer().total, 3000);                           // drawer comes back too
  // and it was saved to disk, not only in memory
  const again = await a.reopen();
  assert.deepEqual(again.repo.peopleAll().map((p) => p.name), ['Ravi']);
  // the safety copy holds what was there before (Meena too)
  a.backups.restore({ name: r.safetyCopy, password: 'correct horse' });
  assert.deepEqual(people(a).sort(), ['Meena', 'Ravi']);
});

test('a backup restores on a different PC (new data key) with just the password', async () => {
  const a = await ready();
  a.backups.setPassword('correct horse');
  a.ledger.savePerson({ name: 'Ravi' });
  const b = a.backups.create();
  const other = await openApp();                                         // fresh install, its own data key
  other.auth.setup({ username: 'someone', password: '9999' });
  const svc = new BackupService({ store: other.store, repo: other.repo, safeStorage: fakeSafeStorage, userDataDir: other.dir, defaultDir: a.folder });
  const r = svc.restore({ name: b.name, password: 'correct horse' });
  assert.equal(r.safetyCopy, null);
  assert.deepEqual(other.ledger.searchPeople({ q: '' }).people.map((p) => p.name), ['Ravi']);
  other.auth.signOut();
  assert.equal(other.auth.signIn({ username: 'karthik', password: '1234' }).username, 'karthik');
});

test('garbage inside a correctly sealed file is refused and the data is left alone', async () => {
  const a = await ready();
  a.backups.setPassword('correct horse');
  const salt = Buffer.from(a.repo.getSetting('backup_salt'), 'base64');
  const crypto = require('node:crypto');
  const key = crypto.scryptSync('correct horse', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  fs.writeFileSync(path.join(a.folder, 'CashDesk-backup-20260101-000000.cdbak'), sealBackup(Buffer.from('not a database at all, just text'), key, salt));
  rejects(() => a.backups.restore({ name: 'CashDesk-backup-20260101-000000.cdbak', password: 'correct horse' }), 'BAD_BACKUP');
  assert.equal(a.ledger.drawer().total, 3000);
  fs.writeFileSync(path.join(a.folder, 'CashDesk-backup-20260102-000000.cdbak'), Buffer.from('plain text'));
  rejects(() => a.backups.restore({ name: 'CashDesk-backup-20260102-000000.cdbak', password: 'x' }), 'BAD_BACKUP');
  assert.throws(() => a.backups.restore({ name: '../evil.cdbak', password: 'x' }), /Choose a backup/);
});

test('keeps the newest 30; names never collide; quit backup is skipped when nothing changed', async () => {
  const a = await ready();
  a.backups.setPassword('correct horse');
  for (let i = 0; i < 33; i++) a.backups.create();
  assert.equal(a.backups.status().files.filter((f) => !f.safety).length, 30);
  assert.equal(new Set(a.backups.status().files.map((f) => f.name)).size, 30);
  a.backups.create();
  assert.deepEqual(a.backups.auto('quit'), { ok: true, skipped: true });
  a.ledger.savePerson({ name: 'New' });
  assert.equal(a.backups.auto('quit').ok, true);
  assert.ok(!a.backups.auto('quit').name);                               // and again nothing new
});

test('custom folder is checked; a folder that cannot be written is refused', async () => {
  const a = await ready();
  const dir = path.join(tmp(), 'sub', 'backups');
  a.backups.setFolder(dir);
  assert.equal(a.backups.folder(), dir);
  assert.throws(() => a.backups.setFolder('relative/path'), /Choose a folder/);
  a.backups.setPassword('correct horse');
  assert.ok(fs.existsSync(path.join(dir, a.backups.create().name)));
});
