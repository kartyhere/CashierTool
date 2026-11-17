'use strict';
// Shared by the PDF and Excel writers. Indian digit grouping: 12,34,567.
const group = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
function cell(col, value) {
  if (value === null || value === undefined || value === '') return '';
  if (col.kind === 'money' || col.kind === 'int') return group(value);
  return String(value);
}
// The Total row: the word Total in the first column that has no total of its own.
function totalsRow(section) {
  if (!section.totals) return null;
  const row = {}; let labelled = false;
  for (const c of section.columns) {
    if (section.totals[c.key] !== undefined) row[c.key] = section.totals[c.key];
    else if (!labelled) { row[c.key] = 'Total'; labelled = true; } else row[c.key] = '';
  }
  return row;
}
module.exports = { group, cell, totalsRow };
