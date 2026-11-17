'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApp } = require('./helpers.cjs');

test('first run creates the admin once; data on disk is not SQLite', async () => {
  const a = await openApp();
  assert.equal(a.auth.status().setupRequired, true);
  a.auth.setup({ username: 'karthik', password: '1234' });
  assert.equal(a.auth.status().setupRequired, false);
  assert.throws(() => a.auth.setup({ username: 'x1x', password: '1234' }), { code: 'SETUP_DONE' });
  const raw = fs.readFileSync(path.join(a.vault.dataDir, 'cashdesk.db'));
  assert.ok(!raw.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));
});

test('data survives a reopen, and wrong password is generic', async () => {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.auth.signOut();
  const b = await a.reopen();
  assert.equal(b.auth.status().setupRequired, false);
  assert.throws(() => b.auth.signIn({ username: 'karthik', password: 'nope' }), { code: 'BAD_CREDENTIALS', message: 'Wrong username or password.' });
  assert.throws(() => b.auth.signIn({ username: 'ghost', password: 'nope' }), { message: 'Wrong username or password.' });
  assert.equal(b.auth.signIn({ username: 'KARTHIK', password: '1234' }).username, 'karthik');
});

test('5th wrong try locks, lock blocks the right password, then expires and doubles', async () => {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' }); a.auth.signOut();
  for (let i = 0; i < 4; i++) assert.throws(() => a.auth.signIn({ username: 'karthik', password: 'x' }), { code: 'BAD_CREDENTIALS' });
  assert.throws(() => a.auth.signIn({ username: 'karthik', password: 'x' }), { code: 'LOCKED_OUT' });
  assert.throws(() => a.auth.signIn({ username: 'karthik', password: '1234' }), { code: 'LOCKED_OUT' });
  a.advance(61_000);
  assert.throws(() => a.auth.signIn({ username: 'karthik', password: 'x' }), { code: 'LOCKED_OUT' }); // 6th: 2 minutes
  a.advance(61_000);
  assert.throws(() => a.auth.signIn({ username: 'karthik', password: '1234' }), { code: 'LOCKED_OUT' });
  a.advance(61_000);
  assert.equal(a.auth.signIn({ username: 'karthik', password: '1234' }).role, 'admin');
});

test('the lock survives a restart', async () => {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' }); a.auth.signOut();
  for (let i = 0; i < 5; i++) try { a.auth.signIn({ username: 'karthik', password: 'x' }); } catch {}
  const b = await a.reopen();
  assert.ok(b.auth.status().lockedUntil > 0);
});

test('idle lock, unlock, and attempted names are never stored', async () => {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.advance(9 * 60_000); assert.equal(a.auth.checkIdle(), false);
  a.auth.touch(); a.advance(9 * 60_000); assert.equal(a.auth.checkIdle(), false);
  a.advance(2 * 60_000); assert.equal(a.auth.checkIdle(), true);
  assert.equal(a.auth.status().locked, true);
  assert.throws(() => a.auth.requireSession(), { code: 'LOCKED' });
  assert.throws(() => a.auth.unlock({ password: 'bad' }), { code: 'BAD_CREDENTIALS' });
  a.auth.unlock({ password: '1234' });
  assert.equal(a.auth.status().locked, false);
  try { a.auth.signIn({ username: 'SECRET-TYPED-NAME', password: 'x' }); } catch {}
  const dump = JSON.stringify(a.store.all('SELECT * FROM audit_log')) + JSON.stringify(a.store.all('SELECT * FROM settings'));
  assert.ok(!dump.includes('SECRET-TYPED-NAME'));
  const actions = a.store.all('SELECT action FROM audit_log').map((r) => r.action);
  for (const x of ['setup', 'idle_lock', 'unlock_failed', 'unlock', 'signin_failed']) assert.ok(actions.includes(x), x);
});

test('change password', async () => {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  assert.throws(() => a.auth.changePassword({ current: 'bad', next: 'abcd' }), { code: 'BAD_CREDENTIALS' });
  assert.throws(() => a.auth.changePassword({ current: '1234', next: 'ab' }), { message: /4 to 128/ });
  a.auth.changePassword({ current: '1234', next: 'abcd' }); a.auth.signOut();
  assert.equal(a.auth.signIn({ username: 'karthik', password: 'abcd' }).username, 'karthik');
});
