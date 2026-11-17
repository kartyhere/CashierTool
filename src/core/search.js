'use strict';
// Name search for the person box. Case, spaces and dots do not matter: "k.ravi" finds "K Ravi".
// Order: names that start with the text, then names containing it, then near spellings (up to 2 edits).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashDeskSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s.\-_,'’]+/g, '');

  function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  // 0 starts with, 1 contains, 2 near spelling, -1 no match.
  function rank(query, name) {
    const q = norm(query), n = norm(name);
    if (!q) return 0;
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (q.length >= 3 && (distance(q, n.slice(0, q.length)) <= 2 || distance(q, n) <= 2)) return 2;
    return -1;
  }

  function search(query, people, limit = 8) {
    return people
      .map((p) => ({ p, r: rank(query, p.name) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name, undefined, { sensitivity: 'base' }))
      .slice(0, limit)
      .map((x) => x.p);
  }

  return { norm, rank, search };
});
