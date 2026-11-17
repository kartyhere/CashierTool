'use strict';
// The 11 denominations the drawer is counted in. Notes and coins of the same value are separate rows
// (N20 and C20, N10 and C10) because the drawer holds both. Order = display order, largest first.
// Works in Node (require) and in the page (window.CashDeskDenoms).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashDeskDenoms = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const list = [
    { id: 'N500', value: 500, kind: 'note' },
    { id: 'N200', value: 200, kind: 'note' },
    { id: 'N100', value: 100, kind: 'note' },
    { id: 'N50', value: 50, kind: 'note' },
    { id: 'N20', value: 20, kind: 'note' },
    { id: 'N10', value: 10, kind: 'note' },
    { id: 'C20', value: 20, kind: 'coin' },
    { id: 'C10', value: 10, kind: 'coin' },
    { id: 'C5', value: 5, kind: 'coin' },
    { id: 'C2', value: 2, kind: 'coin' },
    { id: 'C1', value: 1, kind: 'coin' },
  ].map((d, i) => Object.freeze({ ...d, sort: i + 1, label: `₹${d.value} ${d.kind}` }));

  const DENOMS = Object.freeze(list);
  const BY_ID = Object.freeze(Object.fromEntries(DENOMS.map((d) => [d.id, d])));

  // counts = { N500: 3, C1: 12, ... }  ->  total rupees. Unknown ids and non-integers are an error, never ignored.
  function totalValue(counts) {
    let total = 0;
    for (const [id, qty] of Object.entries(counts || {})) {
      const d = BY_ID[id];
      if (!d) throw new Error(`Unknown denomination: ${id}`);
      if (!Number.isInteger(qty)) throw new Error(`Piece count for ${id} must be a whole number.`);
      total += d.value * qty;
    }
    return total;
  }

  return { DENOMS, BY_ID, totalValue };
});
