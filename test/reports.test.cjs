'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { openApp } = require('./helpers.cjs');
const { toPdf } = require('../src/export/pdf');
const { toXlsx } = require('../src/export/xlsx');

const DAY = 86400000;
// Day 1 (17 Nov): opening 10,605; customer cash in 1,000; two vouchers; a deposit; an exchange; a settle; close with a ₹100 shortage.
async function seeded() {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  const exp = a.ledger.lists().expenseTypes;
  const food = exp.find((e) => e.name === 'Food').id, fuel = exp.find((e) => e.name === 'Fuel').id;
  const bank = a.ledger.lists().banks[0];
  a.ledger.saveOpening({ pieces: { N500: 10, N200: 10, N100: 20, N50: 20, N20: 20, N10: 20, C1: 5 } });
  a.ledger.saveCashIn({ source: 'customer', partyName: 'Acme', pieces: { N500: 2 } });
  const ravi = a.ledger.savePerson({ name: 'Ravi', department: 'Sales' }).id;
  const meena = a.ledger.savePerson({ name: 'Meena', department: 'Stores', openingBalance: 10 }).id;
  a.ledger.saveVoucher({ personId: ravi, amount: 240, give: { N200: 1, N20: 2 }, lines: [{ expenseTypeId: food, amount: 150 }, { expenseTypeId: fuel, amount: 90 }] });
  a.ledger.saveVoucher({ personId: meena, amount: 100, give: { N100: 1 }, lines: [{ expenseTypeId: food, amount: 100 }] });
  a.ledger.saveDeposit({ bankAccountId: bank.id, pieces: { N500: 4 }, reference: 'SL-7' });
  a.ledger.saveExchange({ out: { N500: 1 }, in: { N100: 5 } });
  a.ledger.saveSettle({ personId: ravi, direction: 'collect', pieces: { N100: 1 } });
  return { a, ravi, meena, bank };
}
const run = (a, report, extra = {}) => a.ledger.runReport({ report, from: '2026-11-17', to: '2026-11-17', ...extra });
const sec = (r, i = 0) => r.sections[i];

test('list and validation', async () => {
  const { a } = await seeded();
  assert.equal(a.ledger.reportList().length, 9);
  assert.throws(() => a.ledger.runReport({ report: 'nope', from: '2026-11-17', to: '2026-11-17' }), /Choose a report/);
  assert.throws(() => run(a, 'cashbook', { from: '2026-11-18' }), /after/);
  assert.throws(() => a.ledger.runReport({ report: 'cashbook', from: 'x', to: 'y' }), /valid dates/);
});

test('cash book: figures, sources, payments, deposits, tally', async () => {
  const { a } = await seeded();
  a.ledger.tallyCheck({ tallyBalance: 1 });
  const r = run(a, 'cashbook');
  const d = sec(r).rows[0];
  assert.equal(d.opening, 10605);
  assert.equal(d.receipts, 1000 + 100);          // customer + collected from Ravi
  assert.equal(d.payments, 240 + 100);
  assert.equal(d.deposits, 2000);
  assert.equal(d.closing, 10605 + 1100 - 340 - 2000);
  assert.equal(d.difference, d.closing - 1);
  assert.equal(sec(r, 1).totals.amount, 1100);
  assert.equal(sec(r, 3).rows[0].amount, 2000);
  assert.equal(sec(r, 4).rows.length, 1);
});

test('denomination: pieces by day, expected equals drawer, counted after close', async () => {
  const { a } = await seeded();
  const drawer = a.ledger.drawer();
  const before = run(a, 'denomination');
  assert.equal(sec(before, 1).rows[0].expected, drawer.total);
  assert.equal(sec(before, 1).rows[0].counted, null);
  const info = a.ledger.dayInfo();
  const counted = Object.fromEntries(info.expected.map((x) => [x.id, x.expected]));
  counted.N100 -= 1;
  a.ledger.closeDay({ day: '2026-11-17', counted, confirmDifferences: true });
  const r = run(a, 'denomination');
  const hundred = sec(r).rows.find((x) => x.denom === '₹100 note');
  assert.equal(hundred.counted, hundred.expected - 1);
  assert.equal(hundred.difference, -1);
  assert.equal(sec(r, 1).rows[0].difference, -100);
  assert.equal(sec(r, 1).rows[0].opening, 10605);
  assert.equal(sec(r, 2).rows.length, 2);                       // both banks
  assert.equal(sec(r, 2).totals.balance, 2000);
});

test('day entries, vouchers, payments, expenses, receipts, deposits, balances', async () => {
  const { a, ravi, bank } = await seeded();
  const e = run(a, 'entries');
  assert.equal(sec(e).rows.length, 7);
  assert.equal(sec(e).totals.cash, a.ledger.drawer().total);
  assert.ok(sec(e).rows.some((r) => r.type === 'Voucher' && r.who === 'Ravi' && /×/.test(r.breakup)));

  const v = run(a, 'vouchers');
  assert.equal(sec(v).rows.length, 3);                           // 2 lines + 1 line
  assert.equal(sec(v).totals.line, 340);
  assert.equal(sec(v).totals.paid, 340);

  const p = run(a, 'payments', { personId: ravi });
  assert.equal(sec(p).rows.length, 1);
  assert.equal(sec(p).rows[0].person, 'Ravi');
  assert.equal(sec(p).rows[0].amount, 240);
  assert.equal(sec(p).rows[0].collected, 100);
  assert.match(p.subtitle, /Ravi/);
  assert.equal(sec(run(a, 'payments')).rows.length, 2);

  const x = run(a, 'expenses');
  assert.deepEqual(sec(x).rows.map((r) => [r.type, r.amount]), [['Food', 250], ['Fuel', 90]]);
  assert.equal(sec(x, 1).totals.amount, 340);
  assert.deepEqual(sec(x, 1).rows.map((r) => r.department), ['Sales', 'Sales', 'Stores']);

  const rc = run(a, 'receipts');
  assert.deepEqual(sec(rc).rows.map((r) => [r.kind, r.name, r.amount]), [['Customer', 'Acme', 1000], ['Collected from people', 'Ravi', 100]]);

  const dp = run(a, 'deposits', { bankId: bank.id });
  assert.equal(sec(dp).rows[0].reference, 'SL-7');
  assert.equal(sec(dp).totals.amount, 2000);
  assert.equal(sec(run(a, 'deposits', { bankId: bank.id + 1 })).rows.length, 0);

  const b = run(a, 'balances');
  const owed = sec(b).rows, owes = sec(b, 1).rows;
  assert.deepEqual(owed.map((r) => [r.name, r.amount]), [['Meena', 10], ['Ravi', 100]]);
  assert.equal(owes.length, 0);
  assert.equal(sec(b).totals.amount, 110);
});

test('date ranges span days; a day with no entries gives empty reports', async () => {
  const { a } = await seeded();
  assert.equal(sec(a.ledger.runReport({ report: 'cashbook', from: '2026-11-01', to: '2026-11-30' })).rows.length, 1);
  assert.equal(sec(a.ledger.runReport({ report: 'entries', from: '2026-12-01', to: '2026-12-02' })).rows.length, 0);
  assert.match(a.ledger.runReport({ report: 'cashbook', from: '2026-11-01', to: '2026-11-30' }).fileName, /CashBook-2026-11-01_to_2026-11-30/);
});

test('Excel: opens, numbers stay numbers, totals match the report', async () => {
  const { a } = await seeded();
  const rep = run(a, 'vouchers');
  const buf = await toXlsx(rep);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A1').value, 'Voucher register');
  let lineCol = null; let header = null;
  ws.eachRow((row, n) => { if (row.getCell(1).value === 'Day') { header = n; row.eachCell((c, i) => { if (c.value === 'Line amount') lineCol = i; }); } });
  assert.ok(header && lineCol);
  let total = 0, count = 0;
  for (let r = header + 1; r <= ws.rowCount; r++) { const v = ws.getRow(r).getCell(lineCol).value; if (typeof v === 'number') { count++; if (ws.getRow(r).getCell(1).value === 'Total') total = v; } }
  assert.equal(count, 4);                                        // 3 lines + total
  assert.equal(total, 340);
});

test('PDF: valid, titled, carries the numbers; denomination PDF has sign-off lines', async () => {
  const { a } = await seeded();
  const pdf = toPdf(run(a, 'cashbook'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const text = pdf.toString('latin1');
  assert.match(text, /Cash book/); assert.match(text, /2026-11-17/); assert.match(text, /Page 1 of 1/);
  assert.match(text, /9,365/);                                    // closing 7005+1100-340-2000 = 9,365
  const den = toPdf(run(a, 'denomination')).toString('latin1');
  assert.match(den, /Cashier/); assert.match(den, /Manager/);
  assert.ok(!/Cashier/.test(text));
});

test('a long report paginates', async () => {
  const { a } = await seeded();
  for (let i = 0; i < 60; i++) a.ledger.saveCashIn({ source: 'other', remark: 'misc', pieces: { N10: 1 } });
  const pdf = toPdf(run(a, 'entries')).toString('latin1');
  assert.match(pdf, /Page 1 of [2-9]/);
});
