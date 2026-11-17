'use strict';
// Which notes to take to the bank. Pure: no database, no UI.
// Only ₹500, ₹200 and ₹100 notes are deposited, largest first, never coins or small notes.
// The drawer keeps at least `float` rupees (the small notes and coins stay, plus any big notes not taken).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./denoms'));
  else root.CashDeskDeposit = factory(root.CashDeskDenoms);
})(typeof self !== 'undefined' ? self : this, function (Denoms) {
  const { DENOMS } = Denoms;
  const BIG = ['N500', 'N200', 'N100'];

  function suggest({ stock, float = 5000 }) {
    const value = Object.fromEntries(DENOMS.map((d) => [d.id, d.value]));
    let left = DENOMS.reduce((t, d) => t + d.value * (stock[d.id] || 0), 0);
    const pieces = {};
    let total = 0;
    for (const id of BIG) {
      const k = Math.min(stock[id] || 0, Math.max(0, Math.floor((left - float) / value[id])));
      if (k > 0) { pieces[id] = k; total += k * value[id]; left -= k * value[id]; }
    }
    return { pieces, total };
  }

  return { suggest };
});
