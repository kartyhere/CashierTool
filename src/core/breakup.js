'use strict';
// Which notes and coins to hand over for an amount, given what is in the drawer. Pure: no database, no UI.
//
// A bounded knapsack over the amounts 0..P that finds the cheapest exact way to pay P. A note costs 1 and a coin 4,
// so coins are avoided where a note of the same value exists. Ties go to the answer with more high-value pieces.
// Works in Node (require) and in the page (window.CashDeskBreakup).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./denoms'));
  else root.CashDeskBreakup = factory(root.CashDeskDenoms);
})(typeof self !== 'undefined' ? self : this, function (Denoms) {
  const { DENOMS } = Denoms;
  const RANK = Object.fromEntries(DENOMS.map((d, i) => [d.id, i]));   // 0 = largest
  const SCALE = 1e7;                                                   // cost counts first, the rank tie-break second
  const BIG = 50000;                                                   // above this, set ₹500 notes aside first

  const PROFILES = {
    base: (d) => (d.kind === 'coin' ? 4 : 1),
    fewCoins: (d) => (d.kind === 'coin' ? 20 : 1),
    save100: (d) => (d.id === 'N100' ? 5 : d.kind === 'coin' ? 4 : 1),
  };

  function knapsack(P, stock, costOf) {
    const items = [];
    for (const d of DENOMS) {
      let left = Math.min(Math.max(0, Math.floor(stock[d.id] || 0)), Math.floor(P / d.value));
      const per = costOf(d) * SCALE + RANK[d.id];
      for (let k = 1; left > 0; k *= 2) {
        const n = Math.min(k, left);
        items.push({ id: d.id, n, val: n * d.value, w: n * per });
        left -= n;
      }
    }
    const dp = new Float64Array(P + 1).fill(Infinity);
    dp[0] = 0;
    const take = items.map(() => new Uint8Array(P + 1));
    items.forEach((it, i) => {
      for (let v = P; v >= it.val; v--) {
        const next = dp[v - it.val] + it.w;
        if (next < dp[v]) { dp[v] = next; take[i][v] = 1; }
      }
    });
    if (dp[P] === Infinity) return null;
    const pieces = {};
    let v = P;
    for (let i = items.length - 1; i >= 0; i--) {
      if (take[i][v]) { pieces[items[i].id] = (pieces[items[i].id] || 0) + items[i].n; v -= items[i].val; }
    }
    return pieces;
  }

  // Cheapest exact breakup of P, or null when the drawer cannot make it. profile: 'base' | 'fewCoins' | 'save100'.
  function breakup(P, stock, profile = 'base') {
    if (!Number.isInteger(P) || P < 0) return null;
    if (P === 0) return {};
    const costOf = PROFILES[profile];
    if (P <= BIG) return knapsack(P, stock, costOf);
    let k = Math.min(Math.floor(stock.N500 || 0), Math.floor((P - 5000) / 500));
    for (let tries = 0; tries < 10 && k >= 0; tries++, k--) {
      const rest = knapsack(P - 500 * k, { ...stock, N500: (stock.N500 || 0) - k }, costOf);
      if (rest) { if (k > 0) rest.N500 = (rest.N500 || 0) + k; return rest; }
    }
    return null;
  }

  const same = (a, b) => DENOMS.every((d) => (a[d.id] || 0) === (b[d.id] || 0));

  // Up to 3 different ways to pay P: the cheapest, one with fewer coins, one that saves the ₹100 notes.
  function breakups(P, stock) {
    const out = [];
    for (const profile of ['base', 'fewCoins', 'save100']) {
      const b = breakup(P, stock, profile);
      if (b && !out.some((o) => same(o, b))) out.push(b);
    }
    return out;
  }

  // When P cannot be paid: the notes and coins that are missing. Found by paying P from an unlimited drawer and
  // listing what that needs more of than the drawer has. ids: the denominations allowed to be suggested.
  function shortBy(P, stock, ids = DENOMS.map((d) => d.id)) {
    const unlimited = {};
    for (const d of DENOMS) unlimited[d.id] = ids.includes(d.id) ? Math.floor(P / d.value) : 0;
    const ideal = breakup(P, unlimited);
    if (!ideal) return [];
    return DENOMS.filter((d) => (ideal[d.id] || 0) > (stock[d.id] || 0)).map((d) => d.id);
  }

  const total = (pieces) => DENOMS.reduce((s, d) => s + d.value * (pieces[d.id] || 0), 0);

  return { breakup, breakups, shortBy, total, same };
});
