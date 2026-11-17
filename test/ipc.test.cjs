'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc } = require('../src/ipc');
const { createGuard, assertPlain } = require('../src/security/guard');
const { openApp } = require('./helpers.cjs');
const path = require('node:path');

async function setup() {
  const a = await openApp();
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const logged = [];
  const root = path.resolve('/app/src');
  const guard = createGuard({ appRoot: root });
  registerIpc({ ipcMain, guard, auth: a.auth, repo: a.repo, store: a.store, appInfo: { name: 'Cash Desk', version: '0.1.0' }, log: (e) => logged.push(e) });
  const frame = { url: 'file:///app/src/ui/index.html' };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const good = { sender, senderFrame: frame };
  return { a, handlers, logged, good, sender, call: (ch, p, ev = good) => handlers[ch](ev, p) };
}

test('envelopes, and sign-in required for guarded channels', async () => {
  const t = await setup();
  assert.deepEqual(await t.call('app.info'), { ok: true, data: { name: 'Cash Desk', version: '0.1.0' } });
  assert.equal((await t.call('auth.lock')).code, 'NOT_SIGNED_IN');
  const r = await t.call('auth.setup', { username: 'karthik', password: '1234' });
  assert.equal(r.ok, true);
  assert.equal((await t.call('auth.lock')).ok, true);
  assert.equal((await t.call('auth.changePassword', { current: '1234', next: 'abcd' })).code, 'LOCKED');
  assert.equal((await t.call('auth.unlock', { password: 'bad' })).code, 'BAD_CREDENTIALS');
  assert.equal((await t.call('auth.unlock', { password: '1234' })).ok, true);
});
test('a foreign frame or page is refused', async () => {
  const t = await setup();
  const otherFrame = { url: 'file:///app/src/ui/other.html' };
  const r = await t.call('app.info', undefined, { sender: { mainFrame: otherFrame, isDestroyed: () => false }, senderFrame: otherFrame });
  assert.equal(r.ok, false);
  const sub = { url: 'file:///app/src/ui/index.html' };
  const r2 = await t.call('app.info', undefined, { sender: { mainFrame: {}, isDestroyed: () => false }, senderFrame: sub });
  assert.equal(r2.ok, false);
  const r3 = await t.call('app.info', undefined, { sender: { mainFrame: { url: 'https://evil.test/' }, isDestroyed: () => false }, senderFrame: { url: 'https://evil.test/' } });
  assert.equal(r3.ok, false);
});
test('bugs are logged and not leaked; theme is validated', async () => {
  const t = await setup();
  assert.equal((await t.call('appearance.set', { theme: 'pink' })).ok, false);
  assert.equal((await t.call('appearance.set', { theme: 'light' })).ok, true);
  assert.equal((await t.call('appearance.get')).data.theme, 'light');
  t.a.store.close();
  const r = await t.call('appearance.set', { theme: 'dark' });
  assert.equal(r.ok, false);
  assert.ok(!/at |\/home|sql/i.test(r.message));
});
test('payload rules', () => {
  assert.throws(() => assertPlain(JSON.parse('{"__proto__": {"x":1}}')));
  assert.throws(() => assertPlain({ a: 'x'.repeat(2 * 1024 * 1024) }));
  assert.throws(() => assertPlain(new Date()));
  assert.doesNotThrow(() => assertPlain({ a: [1, 'b', null, { c: true }] }));
});
