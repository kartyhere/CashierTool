'use strict';
// Rupee display and number entry. Money is always whole rupees (integers); this file never does money arithmetic.
// Works in Node (require) and in the page (window.CashDeskFormat).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashDeskFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 125000 -> "1,25,000": the last three digits, then groups of two.
  function group(n) {
    const s = String(Math.abs(Math.trunc(n)));
    if (s.length <= 3) return s;
    const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return head + ',' + s.slice(-3);
  }

  // Display: inr(125000) = "₹1,25,000", inr(-4) = "−₹4". Not for input fields.
  function inr(n, { symbol = true } = {}) {
    if (!Number.isInteger(n)) throw new Error('Amount must be a whole number of rupees.');
    return (n < 0 ? '−' : '') + (symbol ? '₹' : '') + group(n);
  }

  // Number entry: "₹1,250" or " 1 250 " or "1,250" -> "1250". Anything that is not a digit is dropped.
  function digitsOnly(text) {
    return String(text == null ? '' : text).replace(/\D/g, '');
  }

  // "1,250" -> 1250. Empty -> null. More than 12 digits is refused so the number always stays exact.
  function parseAmount(text) {
    const d = digitsOnly(text);
    if (d === '') return null;
    if (d.length > 12) return NaN;
    return Number(d);
  }

  return { group, inr, digitsOnly, parseAmount };
});
