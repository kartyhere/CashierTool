'use strict';
// How much to actually pay for a voucher. Pure: no database, no UI.
//
// amount: the approved voucher total. balance: what we already owe the person (+) or they owe us (−).
// Notes are paid in tens (the rounding step R), so the payout is near amount + balance and the difference stays
// on the person's balance:  newBalance = balance + amount − payout.
// Ranking: payable first, inside the balance limit, then the smallest new balance, then the lower payout (ties).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./breakup'));
  else root.CashDeskPayout = factory(root.CashDeskBreakup);
})(typeof self !== 'undefined' ? self : this, function (Breakup) {
  // One payout figure, checked against the drawer. custom = typed by hand rather than rounded.
  function evaluate({ amount, balance, payout, stock, limit, ids, custom = false }) {
    const alternatives = Breakup.breakups(payout, stock);
    const newBalance = balance + amount - payout;
    return {
      payout, newBalance, custom,
      withinLimit: Math.abs(newBalance) <= limit,
      payable: alternatives.length > 0,
      breakups: alternatives,
      shortBy: alternatives.length ? [] : Breakup.shortBy(payout, stock, ids),
    };
  }

  const fullKey = (c) => [c.payable ? 0 : 1, c.withinLimit ? 0 : 1, Math.abs(c.newBalance), c.payout];
  const preKey = (c) => [c.withinLimit ? 0 : 1, Math.abs(c.newBalance), c.payout];
  const compare = (key) => (a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };

  // Best payouts first. Returns up to `count` evaluated candidates; the first is the recommended one.
  function payoutCandidates({ amount, balance = 0, stock, step = 10, limit = 10, ids, count = 3 }) {
    const target = amount + balance;
    const low = Math.floor(target / step) * step;
    const high = Math.ceil(target / step) * step;
    const plain = [];
    for (let p = low - 5 * step; p <= high + 5 * step; p += step) {
      if (p >= 0) plain.push({ payout: p, newBalance: balance + amount - p, withinLimit: Math.abs(balance + amount - p) <= limit });
    }
    plain.sort(compare(preKey));
    const done = [];
    let payable = 0;
    for (const c of plain) {
      const e = evaluate({ amount, balance, payout: c.payout, stock, limit, ids });
      done.push(e);
      if (e.payable && ++payable >= count) break;
    }
    return done.sort(compare(fullKey)).slice(0, count);
  }

  return { payoutCandidates, evaluate };
});
