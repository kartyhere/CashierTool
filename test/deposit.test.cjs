'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { suggest } = require('../src/core/deposit');
const { totalValue } = require('../src/core/denoms');
const { openApp } = require('./helpers.cjs');

test('deposit suggestion: big notes first, never coins, float kept', () => {
  const s = suggest({ stock: { N500: 1000, N200: 10, N100: 50, N50: 20, N20: 20, N10: 20, C10: 30, C5: 10 }, float: 5000 });
  const stockTotal = totalValue({ N500: 1000, N200: 10, N100: 50, N50: 20, N20: 20, N10: 20, C10: 30, C5: 10 });
  assert.ok(stockTotal - s.total >= 5000);
  assert.ok(s.pieces.N500 > 0);
  assert.ok(!s.pieces.C10 && !s.pieces.N50 && !s.pieces.N20);
  assert.equal(s.total, totalValue(s.pieces));
  assert.ok(stockTotal - s.total < 5000 + 500, 'takes as much as it can while keeping the float');
});
test('deposit suggestion: nothing when the drawer is at or under the float', () => {
  assert.deepEqual(suggest({ stock: { N500: 4, N50: 10 }, float: 5000 }), { pieces: {}, total: 0 });
});

async function ready(stock) {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.ledger.saveOpening({ pieces: stock });
  return a;
}

test('bank deposit moves cash to the bank, appears in deposits, and can be deleted', async () => {
  const a = await ready({ N500: 20, N100: 10, C1: 5 });
  const bank = a.ledger.lists().banks[1];
  const r = a.ledger.saveDeposit({ bankAccountId: bank.id, pieces: { N500: 10, N100: 5 }, reference: 'SL-1' });
  assert.equal(r.amount, 5500);
  assert.equal(r.bankBalance, 5500);
  const d = a.ledger.dashboard();
  assert.equal(d.figures.deposits, 5500);
  assert.equal(d.drawer.total, 11005 - 5500);
  assert.equal(d.banks.find((b) => b.id === bank.id).balance, 5500);
  assert.throws(() => a.ledger.saveDeposit({ bankAccountId: bank.id, pieces: { N500: 99 } }), (e) => e.code === 'DRAWER_NEGATIVE');
  a.ledger.deleteEntry({ id: r.id });
  assert.equal(a.ledger.dashboard().drawer.total, 11005);
  assert.equal(a.ledger.dashboard().banks.find((b) => b.id === bank.id).balance, 0);
});

test('deposit banner: only when the drawer is at the limit and it is past 12:00', async () => {
  const a = await ready({ N500: 1000 });                 // 5,00,000 at 10:00
  assert.equal(a.ledger.dashboard().depositDue, 0);
  a.advance(2 * 3600 * 1000);                            // 12:00
  const d = a.ledger.dashboard();
  assert.ok(d.depositDue > 0);
  assert.ok(500000 - d.depositDue >= 5000);
});

test('exchange: equal values only, drawer total unchanged, pieces swap', async () => {
  const a = await ready({ N500: 2, N100: 1 });
  const total = a.ledger.dashboard().drawer.total;
  assert.throws(() => a.ledger.saveExchange({ out: { N500: 1 }, in: { N100: 4 } }), /equal/);
  assert.throws(() => a.ledger.saveExchange({ out: { N500: 1 }, in: { N500: 1 } }), /same/);
  assert.throws(() => a.ledger.saveExchange({ out: { N200: 1 }, in: { N100: 2 } }), (e) => e.code === 'DRAWER_NEGATIVE');
  const r = a.ledger.saveExchange({ out: { N500: 1 }, in: { N100: 5 } });
  assert.equal(r.amount, 500);
  const d = a.ledger.dashboard();
  assert.equal(d.drawer.total, total);
  assert.equal(d.drawer.rows.find((x) => x.id === 'N500').qty, 1);
  assert.equal(d.drawer.rows.find((x) => x.id === 'N100').qty, 6);
  assert.equal(d.figures.receipts + d.figures.payments + d.figures.deposits, 0);
  const e = a.ledger.entries().entries.find((x) => x.type === 'exchange');
  assert.equal(e.amount, 500);
  // deleting is blocked if the swapped-in notes were already spent
  a.ledger.saveSettle({ personId: a.ledger.savePerson({ name: 'X' }).id, direction: 'pay', pieces: { N100: 6 } });
  assert.throws(() => a.ledger.deleteEntry({ id: r.id }), (e2) => e2.code === 'DRAWER_NEGATIVE');
});
