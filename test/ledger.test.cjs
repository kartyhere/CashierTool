'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers.cjs');
const { figures } = require('../src/core/dayfigures');

async function signedIn() {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  return a;
}
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code);

test('starter lists are seeded', async () => {
  const a = await signedIn();
  const l = a.ledger.lists();
  assert.equal(l.expenseTypes.length, 7);
  assert.deepEqual(l.banks.map((b) => b.name), ['Bank 1', 'Bank 2']);
});

test('opening count: totals match the drawer; only once', async () => {
  const a = await signedIn();
  assert.equal(a.ledger.dashboard().hasOpening, false);
  const r = a.ledger.saveOpening({ pieces: { N500: 10, N100: 20, C1: 7, N200: 0 } });
  assert.equal(r.amount, 5000 + 2000 + 7);
  const d = a.ledger.dashboard();
  assert.equal(d.drawer.total, 7007);
  assert.equal(d.hasOpening, true);
  assert.equal(d.figures.opening, 7007);
  assert.equal(d.figures.closing, 7007);
  assert.equal(d.drawer.rows.find((x) => x.id === 'N500').qty, 10);
  rejects(() => a.ledger.saveOpening({ pieces: { N500: 1 } }), 'OPENING_DONE');
});

test('pieces are validated', async () => {
  const a = await signedIn();
  for (const bad of [{ N500: 1.5 }, { N500: -1 }, { X9: 1 }, { N500: '2' }, null, [], {}]) {
    assert.throws(() => a.ledger.saveOpening({ pieces: bad }), /./, JSON.stringify(bad));
  }
});

test('cash in by source; amount comes from the pieces', async () => {
  const a = await signedIn();
  a.ledger.saveOpening({ pieces: { N500: 10 } });
  const branch = a.ledger.saveListItem({ list: 'branches', name: 'Mysore' }).id;
  const dept = a.ledger.saveListItem({ list: 'departments', name: 'Sales' }).id;
  a.ledger.saveCashIn({ source: 'customer', partyName: 'Ravi', pieces: { N100: 3 }, amount: 999999 });
  a.ledger.saveCashIn({ source: 'branch', branchId: branch, pieces: { N200: 2 } });
  a.ledger.saveCashIn({ source: 'department', departmentId: dept, pieces: { C5: 4 } });
  a.ledger.saveCashIn({ source: 'other', remark: 'Scrap sale', pieces: { N50: 1 } });
  const d = a.ledger.dashboard();
  assert.equal(d.figures.receipts, 300 + 400 + 20 + 50);
  assert.equal(d.drawer.total, 5000 + 770);
  assert.equal(a.ledger.entries().entries.length, 5);
});

test('cash in rules', async () => {
  const a = await signedIn();
  assert.throws(() => a.ledger.saveCashIn({ source: 'branch', pieces: { N100: 1 } }), /branch/);
  assert.throws(() => a.ledger.saveCashIn({ source: 'other', pieces: { N100: 1 } }), /remark/);
  assert.throws(() => a.ledger.saveCashIn({ source: 'customer', pieces: {} }), /notes/i);
  assert.throws(() => a.ledger.saveCashIn({ source: 'cheque', pieces: { N100: 1 } }), /where/);
  assert.throws(() => a.ledger.saveCashIn({ source: 'customer', pieces: { N500: 2001 } }), /at most/);
  const d = a.ledger.saveListItem({ list: 'departments', name: 'Old' }).id;
  a.ledger.saveListItem({ list: 'departments', id: d, name: 'Old', active: false });
  assert.throws(() => a.ledger.saveCashIn({ source: 'department', departmentId: d, pieces: { N100: 1 } }), /not available/);
});

test('bank withdrawal lowers the bank and needs a confirm to go below zero', async () => {
  const a = await signedIn();
  const bank = a.ledger.lists().banks[0];
  assert.throws(() => a.ledger.saveCashIn({ source: 'bank_withdrawal', bankAccountId: bank.id, pieces: { N500: 2 } }), (e) => e.code === 'CONFIRM_BANK');
  a.ledger.saveCashIn({ source: 'bank_withdrawal', bankAccountId: bank.id, pieces: { N500: 2 }, confirmNegativeBank: true });
  assert.equal(a.ledger.dashboard().banks[0].balance, -1000);
  assert.equal(a.ledger.dashboard().drawer.total, 1000);
});

test('delete: marks, audits, blocks when the drawer would go negative', async () => {
  const a = await signedIn();
  a.ledger.saveOpening({ pieces: { N500: 4 } });
  const c = a.ledger.saveCashIn({ source: 'customer', pieces: { N500: 2 } });
  // pay out notes later (simulating a voucher) so the cash-in cannot be removed
  a.store.transaction(() => {
    const id = a.repo.insertEntry({ day: a.ledger.today(), userId: 1, type: 'voucher', cashDelta: -2500 });
    a.repo.insertPieces(id, { N500: -5 });
  });
  rejects(() => a.ledger.deleteEntry({ id: c.id }), 'DRAWER_NEGATIVE');
  assert.equal(a.ledger.dashboard().drawer.total, 500);
});
test('delete a cash in that is untouched', async () => {
  const a = await signedIn();
  const c = a.ledger.saveCashIn({ source: 'customer', pieces: { N500: 2 } });
  a.ledger.deleteEntry({ id: c.id });
  assert.equal(a.ledger.dashboard().drawer.total, 0);
  const e = a.ledger.entries().entries[0];
  assert.equal(e.deleted, true);
  assert.equal(a.store.all("SELECT * FROM audit_log WHERE action='entry_delete'").length, 1);
  assert.equal(a.store.all('SELECT * FROM entries').length, 1, 'row is kept');
  assert.throws(() => a.ledger.deleteEntry({ id: c.id }), /not found/);
});

test('closed day and a clock set back both block new entries', async () => {
  const a = await signedIn();
  a.ledger.saveOpening({ pieces: { N500: 1 } });
  a.store.transaction(() => a.store.run("INSERT INTO day_closes (day, status, counted_json, expected_json) VALUES (?, 'closed', '{}', '{}')", [a.ledger.today()]));
  rejects(() => a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 } }), 'DAY_CLOSED');
  const b = await signedIn();
  b.ledger.saveOpening({ pieces: { N500: 1 } });
  b.advance(-3 * 86400000);
  assert.equal(b.ledger.dashboard().clockBehind, true);
  rejects(() => b.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 } }), 'CLOCK_BEHIND');
});

test('lists: unique names ignoring case, rename, switch off, bank opening balance', async () => {
  const a = await signedIn();
  a.ledger.saveListItem({ list: 'branches', name: 'Hubli' });
  assert.throws(() => a.ledger.saveListItem({ list: 'branches', name: 'hubli' }), /already/);
  const id = a.ledger.lists().branches[0].id;
  a.ledger.saveListItem({ list: 'branches', id, name: 'Hubballi' });
  assert.equal(a.ledger.lists().branches[0].name, 'Hubballi');
  const b = a.ledger.saveListItem({ list: 'banks', name: 'Bank 3', openingBalance: 2500 }).id;
  assert.equal(a.ledger.lists().banks.find((x) => x.id === b).balance, 2500);
  assert.throws(() => a.ledger.saveListItem({ list: 'nope', name: 'x' }), /Unknown/);
});

test('day figures are pure and add up', () => {
  const rows = [
    { day: '2026-11-16', type: 'opening', cash_delta: 1000 },
    { day: '2026-11-16', type: 'voucher', cash_delta: -200 },
    { day: '2026-11-17', type: 'cash_in', cash_delta: 500 },
    { day: '2026-11-17', type: 'voucher', cash_delta: -120 },
    { day: '2026-11-17', type: 'bank_deposit', cash_delta: -300 },
    { day: '2026-11-18', type: 'cash_in', cash_delta: 9999 },
  ];
  assert.deepEqual(figures(rows, '2026-11-17'), { opening: 800, receipts: 500, payments: 120, deposits: 300, closing: 880 });
});
