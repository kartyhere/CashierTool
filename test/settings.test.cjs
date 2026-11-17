'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers.cjs');

async function ready() {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.ledger.saveOpening({ pieces: { N500: 10, N200: 10, N100: 20, N50: 20, N20: 20, N10: 20 } });
  return a;
}
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, code);
const asCashier = (a) => { a.ledger.userSave({ username: 'asha', password: '5555', role: 'cashier' }); a.auth.signOut(); a.auth.signIn({ username: 'asha', password: '5555' }); };

test('settings: defaults, validation, saved with before and after in the audit log', async () => {
  const a = await ready();
  const f = a.ledger.settingsGet().fields;
  assert.equal(f.find((x) => x.key === 'rounding_step').value, 10);
  assert.equal(f.find((x) => x.key === 'morning_check_time').value, '09:15');
  assert.throws(() => a.ledger.settingsSave({ values: { rounding_step: 0 } }), /whole number from 1 to 100/);
  assert.throws(() => a.ledger.settingsSave({ values: { rounding_step: 1.5 } }), /whole number/);
  assert.throws(() => a.ledger.settingsSave({ values: { morning_check_time: '25:00' } }), /hours and minutes/);
  assert.throws(() => a.ledger.settingsSave({ values: { nope: 1 } }), /Unknown setting/);
  assert.equal(a.ledger.settingsSave({ values: { rounding_step: 5, balance_limit: 20, morning_check_time: '08:30' } }).changed, 3);
  assert.equal(a.ledger.settingsSave({ values: { rounding_step: 5 } }).changed, 0);
  assert.equal(a.ledger.settingsGet().fields.find((x) => x.key === 'rounding_step').value, 5);
  const log = a.repo.recentAudit(5).find((r) => r.action === 'settings_change');
  assert.deepEqual(JSON.parse(log.after_json), { rounding_step: '5', balance_limit: '20', morning_check_time: '08:30' });
});

test('a changed rounding step really changes the payout', async () => {
  const a = await ready();
  a.ledger.saveCashIn({ source: 'other', remark: 'coins', pieces: { C5: 10 } });
  const p = a.ledger.savePerson({ name: 'Ravi' }).id;
  const top = (step) => { a.ledger.settingsSave({ values: { rounding_step: step } }); return a.ledger.previewVoucher({ personId: p, amount: 244 }).candidates[0].payout; };
  assert.equal(top(10), 240);
  assert.equal(top(5), 245);
});

test('settings, users and denominations are for admins only', async () => {
  const a = await ready();
  asCashier(a);
  for (const fn of [() => a.ledger.settingsGet(), () => a.ledger.settingsSave({ values: {} }), () => a.ledger.usersList(), () => a.ledger.userSave({ username: 'x', password: '1234' }),
    () => a.ledger.denominationsList(), () => a.ledger.denominationHide({ id: 'N500', hidden: true })]) rejects(fn, 'FORBIDDEN');
  assert.ok(a.ledger.drawer().total > 0);                                // everyday work still fine
});

test('users: create, duplicate, password reset, role and active rules', async () => {
  const a = await ready();
  const { id } = a.ledger.userSave({ username: 'asha', password: '5555', role: 'cashier' });
  assert.throws(() => a.ledger.userSave({ username: 'ASHA', password: '5555' }), /taken/);
  assert.throws(() => a.ledger.userSave({ username: 'ab', password: '5555' }), /3 to 40/);
  assert.throws(() => a.ledger.userSave({ username: 'bob', password: '1' }), /4 to 128/);
  assert.throws(() => a.ledger.userSave({ username: 'bob', password: '5555', role: 'boss' }), /admin or cashier/);
  a.ledger.userSave({ id, password: '7777' });
  const karthik = a.ledger.usersList().users.find((u) => u.username === 'karthik');
  assert.throws(() => a.ledger.userSave({ id: karthik.id, role: 'cashier' }), /own role/);
  assert.throws(() => a.ledger.userSave({ id: karthik.id, active: false }), /own role/);
  a.ledger.userSave({ id, role: 'admin' });
  a.ledger.userSave({ id, active: false });
  a.auth.signOut();
  assert.throws(() => a.auth.signIn({ username: 'asha', password: '7777' }), /Wrong username or password/);
  a.auth.signIn({ username: 'karthik', password: '1234' });
  a.ledger.userSave({ id, active: true });
  a.auth.signOut();
  assert.equal(a.auth.signIn({ username: 'asha', password: '7777' }).role, 'admin');
  assert.ok(a.repo.recentAudit(20).some((r) => r.action === 'user_password_reset'));
});

test('hidden denominations are never suggested, but still counted', async () => {
  const a = await ready();
  const before = a.ledger.suggestDeposit({});
  assert.ok(before.pieces.N500 > 0);
  a.ledger.denominationHide({ id: 'N500', hidden: true });
  assert.ok(!a.ledger.suggestDeposit({}).pieces.N500);
  assert.equal(a.ledger.drawer().total, 5000 + 2000 + 2000 + 1000 + 400 + 200);   // still counted
  assert.equal(a.ledger.denominationsList().denominations.find((d) => d.id === 'N500').hidden, true);
  a.ledger.denominationHide({ id: 'N500', hidden: false });
  assert.ok(a.ledger.suggestDeposit({}).pieces.N500 > 0);
  assert.throws(() => a.ledger.denominationHide({ id: 'X9', hidden: true }), /Unknown/);
});

test('a cashier cannot reopen a closed day, restore a backup or change users', async () => {
  const a = await ready();
  const info = a.ledger.dayInfo();
  a.ledger.closeDay({ day: info.day, counted: Object.fromEntries(info.expected.map((d) => [d.id, d.expected])) });
  asCashier(a);
  rejects(() => a.ledger.reopenDay({ day: info.day, reason: 'please' }), 'FORBIDDEN');
  assert.equal(a.ledger.dayInfo({ day: info.day }).canReopen, false);
});
