'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ExcelJS = require('exceljs');
const { openApp, tmp } = require('./helpers.cjs');
const Fsc = require('../src/core/fsc');
const { readWorkbook } = require('../src/fsc/excel');

const HEAD = ['Service Region Code', ' Service_parent', 'Party Name', ' Lot_Amt', ' Tax_Amt', 'Gst_Lot_Num', ' Service Dlr Account Number', 'Service Dlr Bank Name', 'Service Dlr IFSC Code', 'TDS', 'Payable'];
//   region,  parent,  name, lot, tax, gst lot, account, bank, ifsc
const row = (parent, lot, tax, inv, acct, bank = 'HDFC BANK', ifsc = 'HDFC0001234', extra = []) => ['S3', parent, null, lot, tax, inv, acct, bank, ifsc, ...extra];
const parties = new Map([['AMMOT', 'Ammot Motors'], ['BHAR', 'Bharat Cars']]);

test('TDS is 2% of taxable, always rounded UP; to pay is lot amount minus TDS', () => {
  assert.deepEqual(Fsc.lotFigures(47200, 7200), { taxable: 40000, tds: 8, toPay: 47200 - 800 });         // 472 - 72 = 400 -> 8 exactly -> pay 464
  assert.deepEqual(Fsc.lotFigures(73800, 11250), { taxable: 62550, tds: 13, toPay: 73800 - 1300 });       // 625.50 -> 12.51 -> rounds up to 13 -> pay 725
  assert.equal(Fsc.lotFigures(10001, 0).tds, 3);                                                             // 100.01 -> 2.0002 -> 3
  assert.equal(Fsc.lotFigures(10000, 0).tds, 2);                                                             // exactly 2.00 stays 2
  assert.equal(Fsc.lotFigures(5000, 5000).tds, 0);                                                           // nothing taxable
  assert.equal(Fsc.lotFigures(1, 0).tds, 1);                                                                 // a paisa of taxable still rounds up to Rs 1
});

test('grouped by account number only: same party, two accounts stay two lines; same account on many rows is one line', () => {
  const rows = [HEAD,
    row('AMMOT', 472, 72, '70/FL1', '111111111111'),
    row('AMMOT', 472, 72, '70/FL2', '111111111111'),
    row('AMMOT', 738, 112.5, '70/FL3', '222222222222', 'ICICI BANK', 'ICIC0000456'),
    row('BHAR', 1000, 100, '70/FL4', '222222222222', 'ICICI BANK', 'ICIC0000456')];
  const r = Fsc.compute(rows, parties, { fileName: 'm.xlsx' });
  assert.equal(r.ok, true);
  assert.equal(r.accounts.length, 2);
  const a1 = r.accounts.find((a) => a.account === '111111111111');
  assert.equal(a1.invoices, 2);
  assert.equal(a1.lot, 94400); assert.equal(a1.tds, 1600); assert.equal(a1.toPay, 94400 - 1600);          // 944 lot, 16 TDS, 928 to pay
  assert.equal(a1.ifsc, 'HDFC0001234'); assert.equal(a1.bank, 'HDFC BANK'); assert.equal(a1.party, 'Ammot Motors');
  const a2 = r.accounts.find((a) => a.account === '222222222222');
  assert.equal(a2.invoices, 2);
  assert.equal(a2.tds, (13 + 18) * 100);                                                                      // 625.5 -> 13 ; 900 -> 18 ; per lot, then added
  assert.match(a2.notes, /2 different parties/);                                                              // two parties on one account is flagged
  assert.equal(r.totals.toPay, a1.toPay + a2.toPay);
  assert.equal(r.totals.balanced, true);
});

test('header row can be anywhere, columns in any order, stray spaces and hidden Tax_Amt do not matter', () => {
  const shuffled = [['Monthly claim', null], [], [' Gst_Lot_Num', 'Service Dlr IFSC Code', ' Service_parent', ' Service Dlr Account Number', ' Tax_Amt', 'Service Dlr Bank Name', ' Lot_Amt'],
    ['70/FL1', 'HDFC0001234', 'AMMOT', '555555555555', 72, 'HDFC BANK', 472]];
  const r = Fsc.compute(shuffled, parties);
  assert.equal(r.ok, true);
  assert.equal(r.headerRow, 3);
  assert.equal(r.accounts[0].toPay, 46400);
  const bad = Fsc.compute([['Lot_Amt', 'Something']], parties);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Tax_Amt/); assert.match(bad.error, /Service Dlr Account Number/);
});

test('account numbers: text stays text (leading zeros kept), numbers become digits, 1.23E+11 and no-account are flagged, nothing is dropped', () => {
  assert.equal(Fsc.cleanAccount(' 0012 3456 7890 ').value, '001234567890');
  assert.equal(Fsc.cleanAccount(123456789012).value, '123456789012');
  assert.equal(Fsc.cleanAccount('123456789012.0').value, '123456789012');
  assert.equal(Fsc.cleanAccount("'123-456").value, '123456');
  assert.ok(Fsc.cleanAccount('1.23457E+11').problem);
  const rows = [HEAD,
    row('AMMOT', 500, 50, 'A1', '001234567890'),
    row('AMMOT', 500, 50, 'A2', 1234567890),                    // a different account
    row('AMMOT', 700, 70, 'A3', null),                          // no account: not payable, but still counted and shown
    row('AMMOT', 300, 30, 'A4', '1.23457E+11')];
  const r = Fsc.compute(rows, parties);
  assert.equal(r.accounts.length, 2);                           // 0012... and 1234567890
  assert.equal(r.unplaced.length, 2);                           // no account, and the scientific-notation one: both shown as NOT PAID, never silently dropped
  assert.equal(r.totals.lotAll, 200000);
  assert.equal(r.totals.lotPlaced + r.totals.lotUnplaced, r.totals.lotAll);
  assert.ok(r.issues.some((i) => i.level === 'error' && /A3/.test(i.text)));
  assert.ok(r.issues.some((i) => i.level === 'error' && /scientific notation/.test(i.text)));
});

test('IFSC checks, conflicting IFSC on one account, double invoice, missing tax, party not found', () => {
  const rows = [HEAD,
    row('AMMOT', 500, 50, 'D1', '333333333333', 'HDFC BANK', 'HDFC0001234'),
    row('AMMOT', 500, 50, 'D1', '333333333333', 'HDFC BANK', 'HDFC0009999'),     // same invoice again, different IFSC
    row('ZZZ', 500, null, 'D2', '444444444444', 'SBI', 'BAD1'),
    row('AMMOT', 500, 50, 'D3', '555555555555', 'SBI', '')];
  const r = Fsc.compute(rows, parties);
  const text = r.issues.map((i) => i.text).join('\n');
  assert.match(text, /2 different IFSC codes/);
  assert.match(text, /GST lot number D1 appears 2 times/);
  assert.match(text, /IFSC BAD1 does not look right/);
  assert.match(text, /tax amount is empty/);
  assert.match(text, /Party code ZZZ is not in the party codes file/);
  assert.match(text, /has no IFSC code on this row/);
  assert.equal(r.totals.rows, 4);                             // both D1 rows stay in
  assert.equal(r.totals.balanced, true);
});

test("the file's own TDS / Payable columns are compared with the tool's working", () => {
  const rows = [HEAD, row('AMMOT', 738, 112.5, 'E1', '666666666666', 'HDFC BANK', 'HDFC0001234', [12, 726])];
  const r = Fsc.compute(rows, parties);
  const text = r.issues.map((i) => i.text).join('\n');
  assert.match(text, /file shows TDS 12 but the tool works out 13/);
  assert.match(text, /file shows Payable 726 but the tool works out 725/);
});

test('party codes file: header found, codes upper-cased, later name wins and is reported', () => {
  const p = Fsc.parsePartyCodes([['Dealer list'], ['Parent Code', 'Party Name', 'City'], ['ammot', 'Ammot Motors', 'X'], ['BHAR', ' Bharat  Cars '], ['ammot', 'Ammot Motors Pvt'], [null, 'No code']]);
  assert.equal(p.parties.get('AMMOT'), 'Ammot Motors Pvt');
  assert.equal(p.parties.get('BHAR'), 'Bharat Cars');
  assert.equal(p.issues.length, 2);
  const bare = Fsc.parsePartyCodes([['AMMOT', 'Ammot Motors']]);                  // no header at all: first two columns
  assert.equal(bare.parties.get('AMMOT'), 'Ammot Motors');
});

async function makeWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Prepared by cashier']);
  ws.addRow(['Service_Region', ' Service_parent', 'Party Name', ' Lot_Amt', ' Tax_Amt', 'Gst_Lot_Num', ' Service Dlr Account Number', 'Service Dlr Bank Name', 'Service Dlr IFSC Code', 'Taxable']);
  ws.addRow(['S3', 'AMMOT', null, 472, 72, '70/FL1', '111111111111', 'HDFC BANK', 'HDFC0001234', { formula: 'D3-E3', result: 400 }]);
  ws.addRow(['S3', 'AMMOT', null, 738, 112.5, '70/FL2', 111111111111, 'HDFC BANK', 'HDFC0001234', { formula: 'D4-E4', result: 625.5 }]);   // same account typed as a number
  ws.addRow(['S3', 'BHAR', null, 1000, 100, '70/FL3', '000987654321', 'SBI', 'SBIN0000001', null]);
  ws.getColumn(5).hidden = true;                                                                                                              // Tax_Amt hidden, as the cashier sees it
  await wb.xlsx.writeFile(file);
}

test('reads a real .xlsx (formulas, hidden column, text and number accounts) and runs end to end with export', async () => {
  const dir = tmp(); const file = path.join(dir, 'month.xlsx'); await makeWorkbook(file);
  const sheets = await readWorkbook(file);
  const a = await openApp();
  a.auth.setup({ username: 'karthik', password: '1234' }); a.auth.signIn({ username: 'karthik', password: '1234' });
  assert.throws(() => a.ledger.fscRun({ rows: sheets[0].rows, fileName: 'month.xlsx' }), /party codes file first/);
  const imp = a.ledger.fscImportParties({ rows: [['Code', 'Name'], ['AMMOT', 'Ammot Motors'], ['BHAR', 'Bharat Cars']], fileName: 'parties.xlsx' });
  assert.equal(imp.added, 2);
  assert.equal(a.ledger.fscImportParties({ rows: [['Code', 'Name'], ['AMMOT', 'Ammot Motors'], ['BHAR', 'Bharat Cars Ltd']], fileName: 'p2.xlsx' }).changed, 1);
  const run = a.ledger.fscRun({ rows: sheets[0].rows, fileName: 'month.xlsx' });
  assert.equal(run.totals.accounts, 2);                                   // the text 111111111111 and the number 111111111111 are one account
  assert.equal(run.totals.rows, 3);
  const [first, second] = run.report.sheets[0].sections[0].rows;
  assert.equal(first.account, '111111111111');                            // sorted by party name: Ammot Motors first
  assert.equal(second.account, '000987654321');                           // leading zeros kept
  assert.equal(run.report.sheets.length, 2);
  const xlsx = await require('../src/export/xlsx').toXlsx(a.ledger.fscLastReport());
  const out = path.join(dir, 'out.xlsx'); fs.writeFileSync(out, xlsx);
  const back = new ExcelJS.Workbook(); await back.xlsx.readFile(out);
  assert.deepEqual(back.worksheets.map((w) => w.name), ['Pay by account', 'Invoices']);
  const sum = back.worksheets[0];
  let found = null; sum.eachRow((r) => { if (typeof r.getCell(1).value === 'string' && /^\d+$/.test(r.getCell(1).value)) found = r; });
  assert.equal(typeof found.getCell(1).value, 'string');                 // account number is text in Excel
  assert.ok(require('../src/export/pdf').toPdf(a.ledger.fscLastReport()).length > 1000);
});

test('party codes file with Selling_parent and Real Name headers', () => {
  const r = Fsc.parsePartyCodes([['Selling_parent', 'Real Name', 'Other'], ['ab01', 'Ammot Motors', 'x'], ['CD02', 'City Autos', 'y']]);
  assert.equal(r.usedHeader, true); assert.equal(r.parties.get('AB01'), 'Ammot Motors'); assert.equal(r.parties.size, 2);
});
