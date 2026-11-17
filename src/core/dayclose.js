'use strict';
// Expected versus counted notes at day close. Pure: no database, no UI.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./denoms'));
  else root.CashDeskDayClose = factory(root.CashDeskDenoms);
})(typeof self !== 'undefined' ? self : this, function (Denoms) {
  const { DENOMS } = Denoms;

  // expected, counted: { N500: 3, ... }. diff = counted - expected (+ more than expected, - fewer).
  function compare(expected, counted) {
    const rows = DENOMS.map((d) => {
      const e = expected[d.id] || 0, c = counted[d.id] || 0;
      return { id: d.id, label: d.label, value: d.value, expected: e, counted: c, diff: c - e, diffAmount: (c - e) * d.value };
    });
    const total = (f) => rows.reduce((t, r) => t + f(r), 0);
    return {
      rows, expectedTotal: total((r) => r.expected * r.value), countedTotal: total((r) => r.counted * r.value),
      diffTotal: total((r) => r.diffAmount), hasDiff: rows.some((r) => r.diff !== 0),
    };
  }

  return { compare };
});
