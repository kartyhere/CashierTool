'use strict';
// Free service payment: the monthly Excel file -> what to pay each bank account.
// Pure: rows of cells in, a result out. No files, no database, no Electron (so it can move into another app as it is).
//
//   Taxable  = Lot_Amt - Tax_Amt
//   TDS      = 2% of Taxable, ALWAYS ROUNDED UP to a whole rupee (it goes to the government), worked out per lot
//   To pay   = Lot_Amt - TDS
//   Accounts are told apart by the bank account number only (the same party can have several accounts).
//
// Money is handled in paise (whole numbers) so there is no floating point drift; amounts leave this module as rupees.

const TDS_PERCENT = 2;
const norm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// What each column may be called (after norm): the file's own headers, in whatever order and spelling the cashier left them.
const COLUMNS = {
  lotAmt: { label: 'Lot_Amt', names: ['lotamt', 'lotamount'], need: true },
  taxAmt: { label: 'Tax_Amt', names: ['taxamt', 'taxamount'], need: true },
  gstLot: { label: 'Gst_Lot_Num', names: ['gstlotnum', 'gstlotnumber', 'gstlotno', 'gstlot', 'gstinvoicenumber'], need: true },
  parent: { label: 'Service_parent', names: ['serviceparent', 'serviceparentcode'], need: true },
  account: { label: 'Service Dlr Account Number', names: ['servicedlraccountnumber', 'servicedlraccountno', 'servicedlraccount', 'dealeraccountnumber'], need: true },
  ifsc: { label: 'Service Dlr IFSC Code', names: ['servicedlrifsccode', 'servicedlrifsc', 'dealerifsccode'], need: true },
  bank: { label: 'Service Dlr Bank Name', names: ['servicedlrbankname', 'dealerbankname'], need: false },
  partyName: { label: 'Party Name', names: ['partyname'], need: false },
  lotNum: { label: 'Lot_Num', names: ['lotnum', 'lotnumber', 'lotno'], need: false },
  lotDate: { label: 'Lot_Date', names: ['lotdate'], need: false },
  sheetTds: { label: 'TDS', names: ['tds'], need: false },
  sheetPayable: { label: 'Payable', names: ['payable'], need: false },
};

// Find the header row (it need not be the first row) and which column is which.
function findHeader(rows) {
  let best = { row: -1, found: -1, map: {} };
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const map = {};
    (rows[r] || []).forEach((cell, c) => {
      const n = norm(cell);
      if (!n) return;
      for (const [key, def] of Object.entries(COLUMNS)) if (map[key] === undefined && def.names.includes(n)) map[key] = c;
    });
    const found = Object.keys(map).filter((k) => COLUMNS[k].need).length;
    if (found > best.found) best = { row: r, found, map };
    if (found === Object.values(COLUMNS).filter((d) => d.need).length) break;
  }
  const missing = Object.entries(COLUMNS).filter(([k, d]) => d.need && best.map[k] === undefined).map(([, d]) => d.label);
  return { row: best.row, map: best.map, missing };
}

// Numbers can arrive as numbers, as text with commas or a rupee sign, or as empty.
function parseMoney(v) {
  if (v === null || v === undefined || v === '') return { empty: true };
  if (typeof v === 'number') return Number.isFinite(v) ? { paise: Math.round(v * 100) } : { bad: true };
  const t = String(v).replace(/[₹,\s]|^rs\.?/gi, '');
  if (t === '') return { empty: true };
  const n = Number(t);
  return Number.isFinite(n) ? { paise: Math.round(n * 100) } : { bad: true };
}

// The account number is an identifier, not a quantity: keep it as text (leading zeros matter to the bank), but clean it.
function cleanAccount(v) {
  if (v === null || v === undefined) return { value: '' };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return { value: String(v), note: v >= 1e15 ? 'long number: check that no digit was lost' : '' };
    return { value: String(v), problem: 'is a number with decimals or too long for Excel: the digits may have been lost', fatal: true };
  }
  let t = String(v).trim().replace(/^'+/, '').replace(/[\s-]/g, '');
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(t)) return { value: t, problem: 'is in scientific notation (like 1.23E+11): the real digits are lost, type the account number as text in the file', fatal: true };
  t = t.toUpperCase();
  if (t && !/^[0-9A-Z]+$/.test(t)) return { value: t, problem: 'has unusual characters' };
  return { value: t };
}
const cleanIfsc = (v) => String(v === null || v === undefined ? '' : v).replace(/\s/g, '').toUpperCase();
const ifscOk = (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s);
const cleanText = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
const codeOf = (v) => cleanText(v).toUpperCase();

// Taxable and TDS for one lot, in paise / whole rupees. TDS is rounded UP.
function lotFigures(lotPaise, taxPaise) {
  const taxable = lotPaise - taxPaise;
  const tds = taxable > 0 ? Math.floor((taxable * TDS_PERCENT + 9999) / 10000) : 0;     // ceil(taxable * 2 / 100 rupees), in integers
  return { taxable, tds, toPay: lotPaise - tds * 100 };
}

const mode = (list) => {                    // the most common value (first one wins a tie)
  const count = new Map();
  for (const v of list) count.set(v, (count.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [v, c] of count) if (c > n) { best = v; n = c; }
  return best;
};
const rupees = (p) => p / 100;

// rows: array of arrays (the sheet as it is). parties: Map(CODE -> name).
function compute(rows, parties = new Map(), { fileName = '' } = {}) {
  const head = findHeader(rows);
  if (head.missing.length) {
    return { ok: false, error: `I could not find these headers in the file: ${head.missing.join(', ')}. Check that the header row is there and spelled the same.` };
  }
  const M = head.map;
  const issues = [];
  const flag = (level, row, text) => issues.push({ level, row, text });
  const lines = [];

  for (let r = head.row + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const at = (k) => (M[k] === undefined ? undefined : cells[M[k]]);
    const keyCells = ['lotAmt', 'taxAmt', 'gstLot', 'account', 'ifsc', 'parent'].map((k) => at(k));
    if (keyCells.every((v) => v === null || v === undefined || cleanText(v) === '')) continue;      // an empty row
    const line = { row: r + 1, problems: [] };
    line.gstLot = cleanText(at('gstLot'));
    line.lotNum = cleanText(at('lotNum'));
    line.lotDate = at('lotDate') instanceof Date ? at('lotDate').toISOString().slice(0, 10) : cleanText(at('lotDate'));
    line.parentCode = codeOf(at('parent'));

    const lot = parseMoney(at('lotAmt'));
    const tax = parseMoney(at('taxAmt'));
    if (lot.empty || lot.bad) { line.problems.push(lot.bad ? 'The lot amount is not a number.' : 'The lot amount is empty.'); }
    if (tax.empty || tax.bad) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: the tax amount is ${tax.bad ? 'not a number' : 'empty'}, so it was taken as 0 and TDS is on the full lot amount.`);
    line.lotPaise = lot.paise === undefined ? 0 : lot.paise;
    line.taxPaise = tax.paise === undefined ? 0 : tax.paise;
    line.hasLot = lot.paise !== undefined;
    const f = lotFigures(line.lotPaise, line.taxPaise);
    line.taxable = f.taxable; line.tds = f.tds; line.toPay = f.toPay;
    if (line.hasLot && f.taxable <= 0) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: the taxable amount is zero or less (lot ${rupees(line.lotPaise)}, tax ${rupees(line.taxPaise)}), so no TDS was taken.`);

    const acct = cleanAccount(at('account'));
    line.account = acct.value;
    if (!acct.value) line.problems.push('There is no bank account number.');
    line.accountValue = acct.fatal ? '' : acct.value;
    if (acct.fatal) line.problems.push(`The account number ${acct.value} ${acct.problem}, so it cannot be paid from this report.`);
    else if (acct.problem) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: the account number ${acct.value} ${acct.problem}.`);
    else if (acct.value && acct.note) flag('info', line.row, `${line.gstLot || 'Row ' + line.row}: account ${acct.value}: ${acct.note}.`);
    line.ifsc = cleanIfsc(at('ifsc'));
    line.bank = cleanText(at('bank'));
    if (acct.value && !line.ifsc) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: account ${acct.value} has no IFSC code on this row.`);
    else if (line.ifsc && !ifscOk(line.ifsc)) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: IFSC ${line.ifsc} does not look right (4 letters, a zero, then 6 letters or digits).`);
    if (!line.gstLot) flag('check', line.row, `Row ${line.row}: there is no GST lot number (invoice number).`);

    // the party: looked up from the party codes file by Service_parent; the name already in the file is only a fallback
    const looked = parties.get(line.parentCode);
    const inFile = cleanText(at('partyName'));
    line.party = looked || inFile || '';
    line.partyFound = Boolean(looked);
    if (!line.party) line.partyMissing = true;

    // cross-check against the file's own TDS and Payable columns, when they have values
    const sheetTds = parseMoney(at('sheetTds'));
    if (sheetTds.paise !== undefined && Math.abs(sheetTds.paise - line.tds * 100) > 0) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: the file shows TDS ${rupees(sheetTds.paise)} but the tool works out ${line.tds}.`);
    const sheetPay = parseMoney(at('sheetPayable'));
    if (sheetPay.paise !== undefined && Math.abs(sheetPay.paise - line.toPay) > 0) flag('check', line.row, `${line.gstLot || 'Row ' + line.row}: the file shows Payable ${rupees(sheetPay.paise)} but the tool works out ${rupees(line.toPay)}.`);
    lines.push(line);
  }

  // the same invoice twice is a risk of paying twice: keep both rows (nothing is left out) and warn
  const byInvoice = new Map();
  for (const l of lines) if (l.gstLot) byInvoice.set(l.gstLot, [...(byInvoice.get(l.gstLot) || []), l]);
  for (const [inv, list] of byInvoice) if (list.length > 1) flag('check', list[1].row, `GST lot number ${inv} appears ${list.length} times (rows ${list.map((x) => x.row).join(', ')}). Both are included: make sure it is not a double entry.`);

  const missingCodes = new Map();
  for (const l of lines) if (l.partyMissing) missingCodes.set(l.parentCode, (missingCodes.get(l.parentCode) || 0) + 1);
  for (const [code, n] of missingCodes) flag('check', null, `Party code ${code || '(blank)'} is not in the party codes file (${n} lot${n === 1 ? '' : 's'}). Add it and run again.`);

  // group by account number only
  const placed = lines.filter((l) => !l.problems.length);
  const unplaced = lines.filter((l) => l.problems.length);
  const groups = new Map();
  for (const l of placed) groups.set(l.account, [...(groups.get(l.account) || []), l]);
  const accounts = [...groups].map(([account, ls]) => {
    const ifscs = [...new Set(ls.map((l) => l.ifsc).filter(Boolean))];
    const banks = [...new Set(ls.map((l) => l.bank.toLowerCase()).filter(Boolean))];
    const parties2 = [...new Set(ls.map((l) => l.party).filter(Boolean))];
    const notes = [];
    if (ifscs.length > 1) notes.push(`${ifscs.length} different IFSC codes: ${ifscs.join(', ')}`);
    if (banks.length > 1) notes.push(`${banks.length} different bank names`);
    if (parties2.length > 1) notes.push(`${parties2.length} different parties on this account`);
    if (ls.some((l) => l.partyMissing)) notes.push('party not found');
    const acc = {
      account, ifsc: mode(ls.map((l) => l.ifsc).filter(Boolean)) || '', bank: mode(ls.map((l) => l.bank).filter(Boolean)) || '',
      party: parties2.join(' / '), invoices: ls.length,
      lot: ls.reduce((t, l) => t + l.lotPaise, 0), taxable: ls.reduce((t, l) => t + l.taxable, 0),
      tds: ls.reduce((t, l) => t + l.tds, 0) * 100, toPay: ls.reduce((t, l) => t + l.toPay, 0), notes: notes.join('; '), lines: ls,
    };
    if (ifscs.length > 1) flag('check', null, `Account ${account}: ${ifscs.length} different IFSC codes in the file (${ifscs.join(', ')}). The most common one is shown: check before paying.`);
    if (banks.length > 1) flag('check', null, `Account ${account}: more than one bank name in the file. Check before paying.`);
    return acc;
  }).sort((a, b) => (a.party ? 0 : 1) - (b.party ? 0 : 1) || a.party.localeCompare(b.party) || a.account.localeCompare(b.account, 'en', { numeric: true }));

  const sum = (list, k) => list.reduce((t, l) => t + l[k], 0);
  const totals = {
    rows: lines.length, placedRows: placed.length, unplacedRows: unplaced.length, accounts: accounts.length,
    lotAll: sum(lines, 'lotPaise'), lotPlaced: sum(placed, 'lotPaise'), lotUnplaced: sum(unplaced, 'lotPaise'),
    taxable: sum(placed, 'taxable'), tds: sum(placed, 'tds') * 100, toPay: sum(placed, 'toPay'),
  };
  totals.balanced = totals.lotAll === totals.lotPlaced + totals.lotUnplaced;
  for (const l of unplaced) flag('error', l.row, `${l.gstLot || 'Row ' + l.row} is NOT in the payment list: ${l.problems.join(' ')} (lot amount ${rupees(l.lotPaise)}).`);
  issues.sort((a, b) => ({ error: 0, check: 1, info: 2 }[a.level] - { error: 0, check: 1, info: 2 }[b.level]) || (a.row || 0) - (b.row || 0));
  return { ok: true, fileName, headerRow: head.row + 1, accounts, unplaced, lines, issues, totals };
}

// ---- the party codes file: two columns, a code and the real party name ----
function parsePartyCodes(rows) {
  const codeNames = ['code', 'partycode', 'parentcode', 'serviceparent', 'parent', 'serviceparentcode'];
  const nameNames = ['name', 'partyname', 'partyfullname', 'parentname', 'servicepartyname', 'dealername', 'party'];
  let head = -1, cc = 0, nc = 1;
  for (let r = 0; r < Math.min(rows.length, 20) && head < 0; r++) {
    const cells = (rows[r] || []).map(norm);
    const a = cells.findIndex((c) => codeNames.includes(c));
    const b = cells.findIndex((c, i) => i !== a && nameNames.includes(c));
    if (a >= 0 && b >= 0) { head = r; cc = a; nc = b; }
  }
  const out = new Map(); const issues = [];
  for (let r = head + 1; r < rows.length; r++) {
    const code = codeOf((rows[r] || [])[cc]); const name = cleanText((rows[r] || [])[nc]);
    if (!code && !name) continue;
    if (!code || !name) { issues.push(`Row ${r + 1}: ${code ? 'the name' : 'the code'} is empty.`); continue; }
    if (out.has(code) && out.get(code) !== name) issues.push(`Code ${code} has two different names (${out.get(code)} and ${name}). The later one is kept.`);
    out.set(code, name);
  }
  return { parties: out, issues, usedHeader: head >= 0 };
}

// ---- the report as plain tables (screen, PDF and Excel all draw from this) ----
function buildReport(result, { generated = '' } = {}) {
  const col = (key, label, kind = 'text') => ({ key, label, kind });
  const t = result.totals;
  const summary = {
    heading: 'To pay, by bank account',
    columns: [col('account', 'Account number'), col('ifsc', 'IFSC'), col('bank', 'Bank'), col('party', 'Party'), col('invoices', 'Invoices', 'int'),
      col('lot', 'Lot amount', 'money2'), col('taxable', 'Taxable', 'money2'), col('tds', 'TDS', 'money2'), col('toPay', 'To pay', 'money2'), col('notes', 'Check')],
    rows: result.accounts.map((a) => ({ account: a.account, ifsc: a.ifsc, bank: a.bank, party: a.party, invoices: a.invoices, lot: rupees(a.lot), taxable: rupees(a.taxable), tds: rupees(a.tds), toPay: rupees(a.toPay), notes: a.notes })),
    totals: { invoices: t.placedRows, lot: rupees(t.lotPlaced), taxable: rupees(t.taxable), tds: rupees(t.tds), toPay: rupees(t.toPay) },
  };
  const detail = {
    heading: 'Every invoice, under its bank account',
    columns: [col('account', 'Account number'), col('party', 'Party'), col('gstLot', 'GST lot number (invoice)'), col('lotDate', 'Lot date'), col('lot', 'Lot amount', 'money2'),
      col('tax', 'Tax amount', 'money2'), col('taxable', 'Taxable', 'money2'), col('tds', 'TDS', 'money2'), col('toPay', 'To pay', 'money2'), col('row', 'Row in file', 'int')],
    rows: result.accounts.flatMap((a) => a.lines.map((l) => ({ account: a.account, party: l.party || `(code ${l.parentCode})`, gstLot: l.gstLot, lotDate: l.lotDate, lot: rupees(l.lotPaise), tax: rupees(l.taxPaise), taxable: rupees(l.taxable), tds: l.tds, toPay: rupees(l.toPay), row: l.row }))),
    totals: { lot: rupees(t.lotPlaced), tax: rupees(t.lotPlaced - t.taxable), taxable: rupees(t.taxable), tds: rupees(t.tds), toPay: rupees(t.toPay) },
  };
  const check = {
    heading: 'Does it add up?',
    columns: [col('what', 'Check'), col('value', 'Amount', 'money2'), col('rows', 'Rows', 'int')],
    rows: [
      { what: 'All rows in the file: lot amount', value: rupees(t.lotAll), rows: t.rows },
      { what: 'In the payment list: lot amount', value: rupees(t.lotPlaced), rows: t.placedRows },
      { what: 'NOT in the payment list (see below)', value: rupees(t.lotUnplaced), rows: t.unplacedRows },
      { what: t.balanced ? 'Difference (should be 0)' : 'Difference: DOES NOT ADD UP', value: rupees(t.lotAll - t.lotPlaced - t.lotUnplaced), rows: 0 },
    ],
  };
  const issues = {
    heading: result.issues.length ? `Things to look at (${result.issues.length})` : 'Things to look at',
    columns: [col('level', 'Type'), col('row', 'Row', 'int'), col('text', 'What')],
    rows: result.issues.filter((i) => i.level !== 'info').map((i) => ({ level: i.level === 'error' ? 'NOT PAID' : 'Check', row: i.row, text: i.text })),
  };
  const sections = [summary, check, ...(issues.rows.length ? [issues] : []), detail];
  return {
    title: 'Service payment', subtitle: `${result.fileName}${generated ? ` · ${generated}` : ''} · ${t.accounts} bank accounts · ${t.placedRows} invoices`,
    fileName: `CashDesk-ServicePayment-${generated || 'report'}`, sections,
    sheets: [
      { name: 'Pay by account', title: 'Service payment · to pay by bank account', subtitle: `${result.fileName} · ${generated}`, sections: [summary, check, ...(issues.rows.length ? [issues] : [])] },
      { name: 'Invoices', title: 'Service payment · every invoice', subtitle: `${result.fileName} · ${generated}`, sections: [detail] },
    ],
  };
}

module.exports = { compute, findHeader, parsePartyCodes, buildReport, lotFigures, cleanAccount, parseMoney, COLUMNS, TDS_PERCENT };
