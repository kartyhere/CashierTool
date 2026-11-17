'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DENOMS } = require('../src/core/denoms');
const { breakup, breakups, shortBy, total } = require('../src/core/breakup');
const { payoutCandidates } = require('../src/core/payout');
const { search, rank } = require('../src/core/search');

const full = (n = 50) => Object.fromEntries(DENOMS.map((d) => [d.id, n]));
const stockOf = (o) => Object.fromEntries(DENOMS.map((d) => [d.id, o[d.id] || 0]));
const best = (amount, balance, stock) => payoutCandidates({ amount, balance, stock })[0];

test('acceptance: rounding and balance', () => {
  const s = full();
  let c = best(244, 0, s); assert.equal(c.payout, 240); assert.equal(c.newBalance, 4);
  assert.deepEqual(c.breakups[0], { N200: 1, N20: 2 });
  c = best(258, 0, s); assert.equal(c.payout, 260); assert.equal(c.newBalance, -2);
  assert.deepEqual(c.breakups[0], { N200: 1, N50: 1, N10: 1 });
  c = best(244, 4, s); assert.equal(c.payout, 250); assert.equal(c.newBalance, -2);
  c = best(258, -2, s); assert.equal(c.payout, 260); assert.equal(c.newBalance, -4);
  c = best(245, 0, s); assert.equal(c.payout, 240); assert.equal(c.newBalance, 5);
});
test('acceptance: stock limits', () => {
  assert.deepEqual(breakup(60, stockOf({ N50: 1, N20: 5 })), { N20: 3 });
  assert.deepEqual(breakup(30, stockOf({ N20: 1, C20: 1, N10: 1, C10: 1 })), { N20: 1, N10: 1 });
  assert.equal(breakup(30, stockOf({ N50: 2 })), null);
  assert.deepEqual(shortBy(30, stockOf({ N50: 2 })), ['N20', 'N10']);
  const noBig = full(); noBig.N200 = 0; noBig.N100 = 0;
  const c = best(244, 0, noBig);
  assert.equal(c.payout, 240);
  assert.equal(total(c.breakups[0]), 240);
  assert.ok(!c.breakups[0].N200 && !c.breakups[0].N100);
});
test('an impossible payout is reported, not hidden', () => {
  const none = payoutCandidates({ amount: 30, balance: 0, stock: stockOf({ N50: 2 }) });
  assert.ok(none[0].payable, 'payable ones come first (50 or 0)');
  const empty = payoutCandidates({ amount: 30, balance: 0, stock: stockOf({}) });
  assert.ok(empty.length > 0 && empty.every((c) => !c.payable && c.payout > 0 ? c.shortBy.length > 0 : true));
  const thirty = empty.find((c) => c.payout === 30);
  assert.deepEqual(thirty.shortBy, ['N20', 'N10']);
});
test('hidden or missing notes are never suggested; alternatives differ', () => {
  const alts = breakups(240, full());
  assert.ok(alts.length >= 1 && alts.length <= 3);
  for (let i = 0; i < alts.length; i++) for (let j = i + 1; j < alts.length; j++) assert.notDeepEqual(alts[i], alts[j]);
  assert.ok(alts.every((a) => total(a) === 240));
});
test('large payout is quick and uses the big notes', () => {
  const s = full(); s.N500 = 1050;
  const t = Date.now();
  const b = breakup(475000, s);
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
  assert.equal(total(b), 475000);
  assert.equal(b.N500, 950);
});

function brute(P, stock) {
  let bestCost = Infinity;
  const ds = DENOMS.filter((d) => stock[d.id] > 0);
  (function go(i, left, cost) {
    if (left === 0) { bestCost = Math.min(bestCost, cost); return; }
    if (i === ds.length || cost >= bestCost) return;
    const d = ds[i];
    for (let q = 0; q <= Math.min(stock[d.id], Math.floor(left / d.value)); q++) go(i + 1, left - q * d.value, cost + q * (d.kind === 'coin' ? 4 : 1));
  })(0, P, 0);
  return bestCost;
}
test('2,000 random small cases match a brute-force search', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 2000; i++) {
    const s = stockOf({});
    for (let k = 0; k < 4; k++) s[DENOMS[rnd(11)].id] = rnd(4);
    const P = rnd(30) * 10 + (rnd(3) === 0 ? rnd(10) : 0);
    const want = brute(P, s);
    const got = breakup(P, s);
    if (want === Infinity) { assert.equal(got, null, `P=${P} ${JSON.stringify(s)}`); continue; }
    assert.ok(got, `P=${P} ${JSON.stringify(s)}`);
    assert.equal(total(got), P);
    const cost = DENOMS.reduce((c, d) => c + (got[d.id] || 0) * (d.kind === 'coin' ? 4 : 1), 0);
    assert.equal(cost, want, `P=${P} ${JSON.stringify(s)}`);
    for (const d of DENOMS) assert.ok((got[d.id] || 0) <= s[d.id]);
  }
});

test('name search: ignores case, spaces and dots; ranks start, contains, near', () => {
  const people = [{ name: 'Ravi Kumar' }, { name: 'K. Ravi' }, { name: 'Suresh' }, { name: 'Ravindra' }, { name: 'Ravy Shah' }];
  const names = (q) => search(q, people).map((p) => p.name);
  assert.deepEqual(names('ravi').slice(0, 3), ['Ravi Kumar', 'Ravindra', 'K. Ravi']);
  assert.ok(names('k.ravi').includes('K. Ravi'));
  assert.ok(names('K RAVI').includes('K. Ravi'));
  assert.ok(names('ravy').includes('Ravy Shah'));
  assert.ok(names('rvai').includes('Ravi Kumar'), 'near spelling');
  assert.ok(!names('zzz').length);
  assert.equal(rank('', 'x'), 0);
});
