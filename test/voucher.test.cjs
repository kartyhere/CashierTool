'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApp, getSQL, tmp, fakeSafeStorage } = require('./helpers.cjs');

async function ready(stock = { N500: 10, N200: 10, N100: 20, N50: 20, N20: 20, N10: 20, C10: 10, C5: 10, C2: 10, C1: 10 }) {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.ledger.saveOpening({ pieces: stock });
  a.expense = a.ledger.lists().expenseTypes[0].id;
  a.person = (name, department, openingBalance) => a.ledger.savePerson({ name, department, openingBalance }).id;
  a.pay = (personId, amount, give, extra = {}) => a.ledger.saveVoucher({ personId, amount, give, lines: [{ expenseTypeId: a.expense, amount }], ...extra });
  return a;
}

test('voucher 244 paid 240 leaves +4; the next 258 includes the balance', async () => {
  const a = await ready();
  const ravi = a.person('Ravi Kumar', 'Sales');
  const before = a.ledger.dashboard().drawer.total;
  const p = a.ledger.previewVoucher({ personId: ravi, amount: 244 });
  assert.equal(p.candidates[0].payout, 240);
  assert.equal(p.candidates[0].newBalance, 4);
  const r = a.pay(ravi, 244, p.candidates[0].breakups[0]);
  assert.equal(r.paid, 240);
  assert.equal(r.newBalance, 4);
  assert.equal(a.ledger.dashboard().drawer.total, before - 240);
  assert.equal(a.ledger.searchPeople({ q: 'ravi' }).people[0].balance, 4);
  const p2 = a.ledger.previewVoucher({ personId: ravi, amount: 258 });   // 258 + 4 = 262 -> 260, balance +2
  assert.equal(p2.candidates[0].payout, 260);
  assert.equal(p2.candidates[0].newBalance, 2);
});

test('voucher is one cash book entry with its lines; drawer pieces move exactly', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const fuel = a.ledger.lists().expenseTypes.find((t) => t.name === 'Fuel').id;
  a.ledger.saveVoucher({ personId: ravi, amount: 240, give: { N200: 1, N20: 2 },
    lines: [{ expenseTypeId: a.expense, amount: 100, note: 'tea' }, { expenseTypeId: fuel, amount: 140 }], remark: 'trip' });
  const e = a.ledger.entries().entries.find((x) => x.type === 'voucher');
  assert.equal(e.cashDelta, -240);
  assert.equal(e.person, 'Ravi');
  assert.equal(e.lines.length, 2);
  assert.equal(e.pieces.N200, -1);
  assert.equal(a.ledger.dashboard().figures.payments, 240);
  assert.equal(a.ledger.drawer().rows.find((r) => r.id === 'N200').qty, 9);
});

test('change received back reduces what is paid', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const r = a.pay(ravi, 230, { N500: 1 }, { back: { N200: 1, N50: 1, N20: 1 } });   // gives 500, takes back 270 -> paid 230
  assert.equal(r.paid, 230);
  assert.equal(r.newBalance, 0);
  assert.equal(a.ledger.drawer().rows.find((x) => x.id === 'N200').qty, 11);
  assert.throws(() => a.pay(ravi, 100, { N100: 1 }, { back: { N500: 1 } }), /more than/);
});

test('voucher rules', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 100, give: { N100: 1 }, lines: [] }), /expense line/);
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 100, give: { N100: 1 }, lines: [{ expenseTypeId: a.expense, amount: 90 }] }), /add up/);
  assert.throws(() => a.pay(ravi, 100, { N500: 99 }), (e) => e.code === 'DRAWER_NEGATIVE');
  assert.throws(() => a.pay(9999, 100, { N100: 1 }), /person/);
  assert.throws(() => a.pay(ravi, 0, {}), /amount/);
  assert.throws(() => a.pay(ravi, 1.5, {}), /amount/);
  const offItem = a.ledger.lists().expenseTypes[1];
  const off = offItem.id;
  a.ledger.saveListItem({ list: 'expenseTypes', id: off, name: offItem.name, active: false });
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 100, give: { N100: 1 }, lines: [{ expenseTypeId: off, amount: 100 }] }), /not available/);
  a.ledger.savePerson({ id: ravi, name: 'Ravi', active: false });
  assert.throws(() => a.pay(ravi, 100, { N100: 1 }), /person/);
});

test('a balance outside the limit needs a second yes and is flagged', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  assert.throws(() => a.pay(ravi, 100, { N50: 1 }), (e) => e.code === 'CONFIRM_LIMIT' && e.newBalance === 50);
  const r = a.pay(ravi, 100, { N50: 1 }, { confirmLimit: true });
  assert.equal(r.newBalance, 50);
  assert.equal(a.ledger.entries().entries.find((x) => x.type === 'voucher').flag, 'outside_limit');
});

test('a payout of 0 is allowed when the balance covers the voucher', async () => {
  const a = await ready();
  const ravi = a.person('Ravi', null, -10);               // Ravi owes us 10
  const p = a.ledger.previewVoucher({ personId: ravi, amount: 10 });
  assert.equal(p.candidates[0].payout, 0);
  const r = a.pay(ravi, 10, {});
  assert.equal(r.paid, 0);
  assert.equal(r.newBalance, 0);
});

test('custom payout is evaluated and shown first', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const p = a.ledger.previewVoucher({ personId: ravi, amount: 244, payout: 244 });
  assert.equal(p.candidates[0].payout, 244);
  assert.equal(p.candidates[0].custom, true);
  assert.equal(p.candidates[0].newBalance, 0);
  assert.ok(p.candidates[0].payable);
});

test('people: unique per department, opening balance, search, history', async () => {
  const a = await ready();
  const k = a.person('K. Ravi', 'Stores', 5);
  assert.throws(() => a.person('k. ravi', 'Stores'), /already/);
  a.person('K. Ravi', 'Sales');                                       // same name, other department: fine
  assert.deepEqual(a.ledger.searchPeople({ q: 'k ravi' }).people.map((p) => p.department).sort(), ['Sales', 'Stores']);
  assert.equal(a.ledger.personHistory({ id: k }).person.balance, 5);
  a.pay(k, 100, { N100: 1 });
  const h = a.ledger.personHistory({ id: k });
  assert.equal(h.entries.length, 1);
  assert.equal(h.person.balance, 5);   // 5 + (100 - 100)
});

test('settle works both ways and moves the drawer', async () => {
  const a = await ready();
  const ravi = a.person('Ravi', null, 30);                // we owe Ravi 30
  const before = a.ledger.dashboard().drawer.total;
  a.ledger.saveSettle({ personId: ravi, direction: 'pay', pieces: { N20: 1, N10: 1 } });
  assert.equal(a.ledger.personHistory({ id: ravi }).person.balance, 0);
  assert.equal(a.ledger.dashboard().drawer.total, before - 30);
  a.ledger.saveSettle({ personId: ravi, direction: 'collect', pieces: { N50: 1 } });
  assert.equal(a.ledger.personHistory({ id: ravi }).person.balance, 50);
  assert.equal(a.ledger.dashboard().figures.receipts, 50);
  assert.equal(a.ledger.dashboard().figures.payments, 30);
  assert.throws(() => a.ledger.saveSettle({ personId: ravi, direction: 'pay', pieces: { N500: 99 } }), (e) => e.code === 'DRAWER_NEGATIVE');
});

test('deleting a voucher gives the notes and the balance back; blocked if it would break the drawer', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const total = a.ledger.dashboard().drawer.total;
  const r = a.pay(ravi, 240, { N200: 1, N20: 2 });
  a.ledger.deleteEntry({ id: r.id });
  assert.equal(a.ledger.dashboard().drawer.total, total);
  assert.equal(a.ledger.personHistory({ id: ravi }).person.balance, 0);
  // a change-back voucher whose notes were then paid out cannot be deleted
  const b = await ready({ N500: 1, N100: 1 });
  const p = b.person('Sita');
  const v = b.pay(p, 300, { N500: 1 }, { back: { N200: 1 } });         // paid 300, drawer gains one N200
  b.ledger.saveSettle({ personId: p, direction: 'pay', pieces: { N200: 1 } });
  assert.throws(() => b.ledger.deleteEntry({ id: v.id }), (e) => e.code === 'DRAWER_NEGATIVE');
});

test('upgrade from version 2: the data stays and the flag column appears', async () => {
  const SQL = await getSQL();
  const dir = tmp();
  const { createVault } = require('../src/security/vault');
  const vault = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  const db = new SQL.Database();
  db.exec(fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_seed_lists.sql'), 'utf8'));
  db.run("INSERT INTO migrations (version, applied_at) VALUES (1, 'x'), (2, 'x')");
  db.run("INSERT INTO users (username, pass_hash, role, created_at) VALUES ('karthik', 'h', 'admin', 'x')");
  db.run("INSERT INTO entries (day, created_at, user_id, type, cash_delta) VALUES ('2026-11-16', 'x', 1, 'opening', 500)");
  vault.write('cashdesk.db', Buffer.from(db.export()));
  const { Store } = require('../src/db/store');
  const store = Store.open({ SQL, vault });
  assert.equal(store.get('SELECT MAX(version) AS v FROM migrations').v, 5);
  assert.equal(store.get('SELECT cash_delta, flag, parts_json FROM entries').cash_delta, 500);
  assert.equal(store.get('SELECT can_edit FROM users').can_edit, 1);
  assert.equal(store.all('SELECT * FROM expense_types').length, 7);
});

test('brought cash: third card pays voucher + brought, receiver hands the brought cash back, balance unchanged', async () => {
  const a = await ready();
  const ravi = a.person('Ravi', 'Sales', 4);                          // we owe Ravi 4 already
  const before = a.ledger.dashboard().drawer.total;
  const p = a.ledger.previewVoucher({ personId: ravi, amount: 263, brought: 7 });
  assert.equal(p.candidates.length, 3);
  const c = p.candidates[2];
  assert.equal(c.exact, true);
  assert.equal(c.gross, 270);
  assert.equal(c.brought, 7);
  assert.equal(c.payout, 263);
  assert.equal(c.newBalance, 4);                                      // balance does not move
  assert.ok(c.payable);
  assert.ok(c.breakups[0] && Object.entries(c.breakups[0]).reduce((t, [id, n]) => t + n * { N500: 500, N200: 200, N100: 100, N50: 50, N20: 20, N10: 10, C10: 10, C5: 5, C2: 2, C1: 1 }[id], 0) === 270);
  const r = a.pay(ravi, 263, c.breakups[0], { back: { C5: 1, C2: 1 } });   // receiver gives back 5 + 2
  assert.equal(r.paid, 263);
  assert.equal(r.newBalance, 4);
  assert.equal(a.ledger.dashboard().drawer.total, before - 263);
});

test('brought cash empty: third card is the exact voucher amount; bad brought value is refused', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const c = a.ledger.previewVoucher({ personId: ravi, amount: 244 }).candidates[2];
  assert.equal(c.exact, true);
  assert.equal(c.gross, 244);
  assert.equal(c.brought, 0);
  assert.throws(() => a.ledger.previewVoucher({ personId: ravi, amount: 244, brought: -1 }), /not valid/);
  assert.throws(() => a.ledger.previewVoucher({ personId: ravi, amount: 244, brought: 1.5 }), /not valid/);
  const typed = a.ledger.previewVoucher({ personId: ravi, amount: 244, payout: 240, brought: 6 });
  assert.equal(typed.candidates[0].custom, true);
  assert.ok(typed.candidates.some((x) => x.exact && x.gross === 250));
});

test('several vouchers: one payout, each voucher split on its own', async () => {
  const a = await ready();
  const ravi = a.person('Ravi', 'Sales');
  const types = a.ledger.lists().expenseTypes;
  const [t1, t2] = [types[0].id, types[1].id];
  const p = a.ledger.previewVoucher({ personId: ravi, amount: 263 });         // 120 + 143 together
  const lines = [{ voucherNo: 1, expenseTypeId: t1, amount: 100 }, { voucherNo: 1, expenseTypeId: t2, amount: 20 }, { voucherNo: 2, expenseTypeId: t1, amount: 143 }];
  const r = a.ledger.saveVoucher({ personId: ravi, amount: 263, parts: [120, 143], give: p.candidates[0].breakups[0], lines, remark: 'tea' });
  assert.equal(r.paid, 260);
  const e = a.ledger.entries().entries.find((x) => x.type === 'voucher');
  assert.deepEqual(e.parts, [120, 143]);
  assert.equal(e.voucherAmount, 263);
  assert.equal(e.remark, 'tea');
  assert.deepEqual(e.lines.map((l) => [l.voucherNo, l.amount]), [[1, 100], [1, 20], [2, 143]]);
  // each voucher must add up on its own
  const bad = [{ voucherNo: 1, expenseTypeId: t1, amount: 110 }, { voucherNo: 2, expenseTypeId: t1, amount: 143 }];
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 263, parts: [120, 143], give: { N200: 1, N50: 1, N10: 1 }, lines: bad }), /voucher 1 must add up to ₹120/);
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 263, parts: [120, 143], give: { N200: 1, N50: 1, N10: 1 }, lines: [{ expenseTypeId: t1, amount: 263 }] }), /not linked to a voucher/);
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 263, parts: [120, 100], give: {}, lines }), /add up to the total/);
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 263, parts: [263, 0], give: {}, lines }), /not valid/);
});

test('many vouchers at once (no small limit)', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const parts = Array.from({ length: 20 }, (_, i) => 10 + i);              // 20 vouchers
  const total = parts.reduce((t, n) => t + n, 0);
  const lines = parts.map((n, i) => ({ voucherNo: i + 1, expenseTypeId: a.expense, amount: n }));
  const r = a.ledger.saveVoucher({ personId: ravi, amount: total, parts, give: { N200: 1, N100: 1, N50: 1, N20: 2 }, back: {}, lines });
  assert.ok(r.paid > 0);
  assert.equal(a.ledger.entries().entries.find((x) => x.type === 'voucher').parts.length, 20);
});

test('a single voucher needs no voucherNo and stores none of the parts', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  a.pay(ravi, 50, { N50: 1 });
  const e = a.ledger.entries().entries.find((x) => x.type === 'voucher');
  assert.equal(e.parts, null);
  assert.equal(e.lines[0].voucherNo, 1);
});

test('split later, then add the split afterwards; permission and closed day rules', async () => {
  const a = await ready();
  const ravi = a.person('Ravi');
  const r = a.ledger.saveVoucher({ personId: ravi, amount: 120, parts: [70, 50], give: { N100: 1, C10: 2 }, lines: [], splitLater: true });
  assert.equal(r.paid, 120);
  assert.equal(a.ledger.dashboard().unsplit, 1);
  assert.throws(() => a.ledger.saveVoucher({ personId: ravi, amount: 10, give: { C10: 1 }, lines: [] }), /Add at least one expense line/);   // not allowed without splitLater
  const id = a.ledger.entries().entries.find((x) => x.type === 'voucher').id;
  const split = [{ voucherNo: 1, expenseTypeId: a.expense, amount: 70 }, { voucherNo: 2, expenseTypeId: a.expense, amount: 50 }];
  assert.throws(() => a.ledger.editVoucherSplit({ id, lines: [{ voucherNo: 1, expenseTypeId: a.expense, amount: 70 }] }), /voucher 2 must add up/);
  a.ledger.editVoucherSplit({ id, lines: split, remark: 'fixed later' });
  assert.equal(a.ledger.dashboard().unsplit, 0);
  const e = a.ledger.entries().entries.find((x) => x.id === id);
  assert.equal(e.lines.length, 2);
  assert.equal(e.remark, 'fixed later');
  // a cashier without the right cannot edit; with the right can; a closed day cannot be edited by anyone
  a.ledger.userSave({ username: 'meena', password: 'abcd', role: 'cashier' });
  const meena = a.ledger.usersList().users.find((u) => u.username === 'meena');
  assert.equal(meena.canEdit, true);                                    // default: allowed
  a.ledger.userSave({ id: meena.id, canEdit: false });
  assert.equal(a.ledger.usersList().users.find((u) => u.username === 'meena').canEdit, false);
  a.auth.signOut(); a.auth.signIn({ username: 'meena', password: 'abcd' });
  assert.equal(a.ledger.entries().mayEdit, false);
  assert.throws(() => a.ledger.editVoucherSplit({ id, lines: split }), /permission/);
  a.auth.signOut(); a.auth.signIn({ username: 'karthik', password: '1234' });
  a.ledger.userSave({ id: meena.id, canEdit: true });
  a.auth.signOut(); a.auth.signIn({ username: 'meena', password: 'abcd' });
  a.ledger.editVoucherSplit({ id, lines: split });
  a.auth.signOut(); a.auth.signIn({ username: 'karthik', password: '1234' });
  const day = a.ledger.today();
  a.ledger.closeDay({ day, counted: a.ledger.drawer().rows.reduce((o, r) => ({ ...o, [r.id]: r.qty }), {}), confirm: true });
  assert.throws(() => a.ledger.editVoucherSplit({ id, lines: split }), /closed/);
});
