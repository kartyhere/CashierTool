'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers.cjs');
const { compare } = require('../src/core/dayclose');

const DAY = 86400000;
async function ready(stock = { N500: 10, N100: 20, C1: 5 }) {
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' });
  a.ledger.saveOpening({ pieces: stock });
  a.ledger.saveCashIn({ source: 'customer', pieces: { N500: 2 } });          // +1000
  return a;
}
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, code);

test('compare: per-note differences and totals', () => {
  const c = compare({ N500: 2, N100: 3 }, { N500: 2, N100: 2, N50: 1 });
  assert.equal(c.expectedTotal, 1300);
  assert.equal(c.countedTotal, 1250);
  assert.equal(c.diffTotal, -50);
  assert.ok(c.hasDiff);
  assert.ok(!compare({ N500: 1 }, { N500: 1 }).hasDiff);
});

test('tally check: difference is system minus Tally; optional count; listed for the day', async () => {
  const a = await ready();
  const total = a.ledger.drawer().total;                                     // 5000+2000+5+1000
  const r = a.ledger.tallyCheck({ tallyBalance: total - 100, counted: { N500: 12, N100: 20, C1: 5 }, remark: 'noon' });
  assert.equal(r.system, total);
  assert.equal(r.difference, 100);
  assert.equal(r.countedTotal, total);
  assert.equal(r.countedDifference, 0);
  a.ledger.tallyCheck({ tallyBalance: total });
  const l = a.ledger.tallyList();
  assert.equal(l.checks.length, 2);
  assert.equal(l.checks[0].remark, 'noon');
  assert.throws(() => a.ledger.tallyCheck({}), /Tally/);
  assert.throws(() => a.ledger.tallyCheck({ tallyBalance: 1.5 }), /whole/);
});

test('day close with a matching count closes the day and blocks new entries', async () => {
  const a = await ready();
  const info = a.ledger.dayInfo();
  assert.equal(info.state, 'open');
  assert.equal(info.expectedTotal, 8005);
  const r = a.ledger.closeDay({ day: info.day, counted: { N500: 12, N100: 20, C1: 5 }, tallyBalance: 8005 });
  assert.equal(r.adjustment, 0);
  assert.equal(r.tallyDifference, 0);
  assert.equal(a.ledger.dayInfo({ day: info.day }).state, 'closed');
  rejects(() => a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 } }), 'DAY_CLOSED');
  rejects(() => a.ledger.closeDay({ day: info.day, counted: {} }), 'DAY_CLOSED');
});

test('a difference needs a confirm, becomes a count adjustment, and the next day opens on the count', async () => {
  const a = await ready();
  const day = a.ledger.today();
  const counted = { N500: 12, N100: 19, C1: 5 };                              // one N100 short
  rejects(() => a.ledger.closeDay({ day, counted }), 'CONFIRM_DIFF');
  assert.equal(a.ledger.dayInfo().state, 'open', 'nothing was saved by the refused close');
  const r = a.ledger.closeDay({ day, counted, confirmDifferences: true, tallyBalance: 7905, remark: 'short' });
  assert.equal(r.adjustment, -100);
  assert.equal(r.tallyDifference, 0);
  assert.equal(a.ledger.drawer().total, 7905);
  assert.equal(a.ledger.drawer().rows.find((x) => x.id === 'N100').qty, 19);
  const adj = a.ledger.entries({ day }).entries.find((e) => e.type === 'count_adjust');
  assert.equal(adj.cashDelta, -100);
  assert.equal(a.ledger.dashboard().figures.closing, 7905);
  a.advance(DAY);
  const d = a.ledger.dashboard();
  assert.equal(d.figures.opening, 7905);
});

test('the same total with different notes also counts as a difference', async () => {
  const a = await ready();
  rejects(() => a.ledger.closeDay({ day: a.ledger.today(), counted: { N500: 12, N100: 19, C1: 105 } }), 'CONFIRM_DIFF');
});

test('closing an empty day or a future day is refused', async () => {
  const a = await ready();
  assert.throws(() => a.ledger.closeDay({ day: '2026-11-10', counted: {} }), /nothing to close/);
  assert.throws(() => a.ledger.closeDay({ day: '2026-12-31', counted: {} }), /not come/);
});

test('a new day needs the earlier day closed; an admin can go on with a reason', async () => {
  const a = await ready();
  a.advance(DAY);
  assert.equal(a.ledger.dashboard().earlierOpen, '2026-11-17');
  rejects(() => a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 } }), 'EARLIER_OPEN');
  rejects(() => a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 }, skipEarlierReason: 'x' }), 'EARLIER_OPEN');   // too short
  a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 }, skipEarlierReason: 'closing tomorrow' });
  assert.equal(a.store.all("SELECT * FROM audit_log WHERE action = 'earlier_day_skipped'").length, 1);
  a.ledger.closeDay({ day: '2026-11-17', counted: { N500: 12, N100: 20, C1: 5 } });
  a.ledger.saveCashIn({ source: 'customer', pieces: { N100: 1 } });            // fine now, no reason needed
});

test('reopen: admin only, reason required, removes the adjustment, and the day closes again', async () => {
  const a = await ready();
  const day = a.ledger.today();
  a.ledger.closeDay({ day, counted: { N500: 12, N100: 19, C1: 5 }, confirmDifferences: true });
  assert.equal(a.ledger.drawer().total, 7905);
  assert.throws(() => a.ledger.reopenDay({ day, reason: '' }), /reason/);
  a.ledger.reopenDay({ day, reason: 'missed a voucher' });
  assert.equal(a.ledger.dayInfo({ day }).state, 'reopened');
  assert.equal(a.ledger.drawer().total, 8005, 'the adjustment is gone');
  a.ledger.saveCashIn({ source: 'customer', pieces: { N50: 2 } });             // day is open again
  a.ledger.closeDay({ day, counted: { N500: 12, N100: 20, N50: 2, C1: 5 } });
  assert.equal(a.ledger.dayInfo({ day }).state, 'closed');
  assert.equal(a.store.all("SELECT * FROM day_reopens").length, 1);
  assert.throws(() => a.ledger.reopenDay({ day: '2026-01-01', reason: 'abc' }), /not closed/);
});

test('a cashier cannot reopen', async () => {
  const a = await ready();
  a.ledger.closeDay({ day: a.ledger.today(), counted: { N500: 12, N100: 20, C1: 5 } });
  a.auth.session.role = 'cashier';
  rejects(() => a.ledger.reopenDay({ day: a.ledger.today(), reason: 'because' }), 'FORBIDDEN');
});

test('morning check: due from 9:15 on a later day, repeats every 30 minutes until done', async () => {
  const a = await ready();                                    // 10:00 on day 1
  assert.equal(a.ledger.morningStatus().due, false, 'no earlier day yet');
  a.advance(DAY - 3 * 3600000);                               // next day 07:00
  assert.equal(a.ledger.morningStatus().due, false, 'before 9:15');
  a.advance(2 * 3600000 + 20 * 60000);                        // 09:20
  const s = a.ledger.morningStatus();
  assert.equal(s.due, true);
  assert.equal(s.lastDay, '2026-11-17');
  assert.equal(s.opening, 0 + 7005 - 5 + 5, 'opening of that day');
  assert.equal(s.receipts, 1000);
  assert.equal(s.closing, 8005);
  a.ledger.morningSnooze();
  assert.equal(a.ledger.morningStatus().due, false, 'snoozed');
  a.advance(29 * 60000);
  assert.equal(a.ledger.morningStatus().due, false);
  a.advance(2 * 60000);
  assert.equal(a.ledger.morningStatus().due, true, 'repeats after 30 minutes');
  const r = a.ledger.morningDone({ tallyBalance: 8000 });
  assert.equal(r.difference, 5);
  assert.equal(a.ledger.morningStatus().due, false);
  a.advance(DAY + 1000);
  assert.equal(a.ledger.morningStatus().due, true, 'due again the next morning');
});

test('morning check uses the counted figure when the day was closed with a difference', async () => {
  const a = await ready();
  a.ledger.closeDay({ day: a.ledger.today(), counted: { N500: 12, N100: 19, C1: 5 }, confirmDifferences: true });
  a.advance(DAY);
  assert.equal(a.ledger.morningStatus().closing, 7905);
  assert.equal(a.ledger.morningStatus().closedDay, true);
});
