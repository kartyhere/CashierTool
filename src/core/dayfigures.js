'use strict';
// Day figures from a list of entries. Pure: no database, no clock.
// rows: [{ day, type, cash_delta }] (deleted entries already left out). day: 'YYYY-MM-DD'.
//   opening   everything before the day, plus the opening count if it was entered on the day itself
//   receipts  cash in, deposits  money to the bank, payments  vouchers (and settle-pay), as positive numbers
//   exchanges net 0 and left out. closing = opening + receipts - payments - deposits (+ count adjustments on the day)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashDeskDayFigures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function figures(rows, day) {
    let opening = 0, receipts = 0, payments = 0, deposits = 0, adjust = 0;
    for (const r of rows) {
      const d = Number(r.cash_delta);
      if (r.day < day || (r.day === day && r.type === 'opening')) opening += d;
      else if (r.day === day) {
        if (r.type === 'cash_in' || (r.type === 'settle' && d > 0)) receipts += d;
        else if (r.type === 'voucher' || (r.type === 'settle' && d < 0)) payments -= d;
        else if (r.type === 'bank_deposit') deposits -= d;
        else if (r.type === 'count_adjust') adjust += d;
      }
    }
    return { opening, receipts, payments, deposits, closing: opening + receipts - payments - deposits + adjust };
  }
  return { figures };
});
