'use strict';
// Service payment through the real app: party codes, the monthly file, the report, Excel and PDF export.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-12.cjs
const { _electron: electron } = require('playwright-core');
const ExcelJS = require('exceljs');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots12');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const toast = async (page, re) => { await page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re); };

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-fsc-'));
  // the party codes file
  const pw = new ExcelJS.Workbook(); const pws = pw.addWorksheet('Parties');
  pws.addRow(['Service Parent Code', 'Party Name']); [['AMMOT', 'Ammot Motors Pvt Ltd'], ['BHAR', 'Bharat Cars'], ['CITY', 'City Auto Works']].forEach((r) => pws.addRow(r));
  await pw.xlsx.writeFile(path.join(work, 'parties.xlsx'));
  // the bank's UTR file: one paid, one paid-then-returned, one return that is not ours, a missing zero for the Bharat account
  const uw = new ExcelJS.Workbook(); const us = uw.addWorksheet('Sheet1');
  us.addRow(['Bank payment file']);
  us.addRow(['Sr No', 'Bene A/c Name', 'Beneficiary Account Number', 'Amount Payable', 'UTR No', 'Status']);
  [[1, 'AMMOT MOTORS', '50100123456789', 1653, 'UTR000A', 'Paid'], [2, 'AMMOT MOTORS', '3344556677', 1160, 'UTR000B', 'Paid'], [3, 'AMMOT MOTORS', '3344556677', 1160, 'UTR000C', 'Return'],
    [4, 'BHARAT CARS', '987654321', 8120, 'UTR000D', 'Paid'], [5, 'SOMEONE ELSE', '55566677788', 500, 'UTR000E', 'Return']].forEach((r) => us.addRow(r));
  await uw.xlsx.writeFile(path.join(work, 'utr.xlsx'));
  // the monthly file: columns in the cashier's own order, a title row above the headers, hidden Tax_Amt, formulas for the file's own columns
  const mw = new ExcelJS.Workbook(); const ws = mw.addWorksheet('Sheet1');
  ws.addRow(['FSC claims November 2026']);
  ws.addRow(['Service Region Code', ' Service_parent', 'Party Name', 'Gst_Lot_Num', 'Lot_Date', ' Lot_Amt', ' Tax_Amt', 'Taxable', 'TDS', 'Payable', ' Service Dlr Account Number', 'Service Dlr Bank Name', 'Service Dlr IFSC Code', ' Status', 'Service DLR Remarks']);
  const add = (parent, inv, lot, tax, acct, bank, ifsc, remark) => { const n = ws.rowCount + 1; ws.addRow(['S3', parent, null, inv, new Date(2026, 10, 2), lot, tax, { formula: `F${n}-G${n}`, result: lot - tax }, { formula: `ROUNDUP(H${n}*2/100,0)`, result: Math.ceil((lot - tax) * 0.02 - 1e-9) }, { formula: `F${n}-I${n}`, result: lot - Math.ceil((lot - tax) * 0.02 - 1e-9) }, acct, bank, ifsc, 'Pending', remark || null]); };
  add('AMMOT', '70/FL26000081', 472, 72, '50100123456789', 'HDFC BANK', 'HDFC0001234');
  add('AMMOT', '77/FL26000038', 472, 72, '50100123456789', 'HDFC BANK', 'HDFC0001234');
  add('AMMOT', '70/FL26000085', 738, 112.5, '50100123456789', 'HDFC BANK', 'HDFC0001234');
  add('AMMOT', '70/FL26000090', 1180, 180, 3344556677, 'ICICI BANK', 'ICIC0000456');               // second account of the same party, stored as a number
  add('BHAR', '70/FL26000091', 2360, 360, '000987654321', 'STATE BANK OF INDIA', 'SBIN0000001', 'Account number is 0000987654321, one zero missing');    // leading zeros
  add('BHAR', '70/FL26000092', 5900, 900, '000987654321', 'STATE BANK OF INDIA', 'SBIN0000001');
  add('CITY', '70/FL26000093', 590, 90, '1.23457E+11', 'AXIS BANK', 'UTIB0000789');                // scientific notation: flagged
  add('CITY', '70/FL26000094', 1000, 100, null, 'AXIS BANK', 'UTIB0000789');                        // no account: shown as NOT PAID
  add('NEWC', '70/FL26000095', 826, 126, '77889900112233', 'YES BANK', 'YESB0000111');              // party code not in the codes file
  ws.getColumn(7).hidden = true;
  await mw.xlsx.writeFile(path.join(work, 'month.xlsx'));
  const exportDir = path.join(work, 'exports'); fs.mkdirSync(exportDir);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud12-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'], env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1', CASHDESK_FSC_FILE: path.join(work, 'month.xlsx'), CASHDESK_UTR_FILE: path.join(work, 'utr.xlsx'), CASHDESK_PARTY_FILE: path.join(work, 'parties.xlsx'), CASHDESK_EXPORT_DIR: exportDir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  assert.match(await page.textContent('.menu'), /Service payment/);
  await page.keyboard.press('f'); await page.waitForSelector('text=Service payment');
  assert.match(await page.textContent('.page'), /No party codes yet/);
  await page.keyboard.press('Enter');                                              // before the party codes are loaded
  await page.waitForSelector('.error:not(:empty)');
  assert.match(await page.textContent('.error'), /party codes file first/);
  await page.keyboard.press('p'); await toast(page, 'parties.xlsx: 3 added');
  assert.match(await page.textContent('.page'), /Party codes loaded: 3/);
  await page.focus('button.primary'); await page.keyboard.press('Enter');
  await page.waitForSelector('.total-line');
  const text = await page.textContent('.page');
  // 50100123456789: 472+472+738 = 1682 lot; TDS 8+8+13 = 29; to pay 1653
  assert.match(text, /50100123456789/); assert.match(text, /3344556677/); assert.match(text, /000987654321/);
  assert.doesNotMatch(await page.textContent('table'), /1\.23457E\+11/.source ? /\bUTIB0000789\b.*To pay/ : /x/);   // the damaged account is not in the pay list
  assert.match(text, /Ammot Motors Pvt Ltd/); assert.match(text, /Bharat Cars/);
  assert.match(text, /DEALER REMARK: Account number is 0000987654321/); assert.match(text, /the dealer wrote a remark/);
  assert.match(text, /NOT PAID/); assert.match(text, /scientific notation/); assert.match(text, /Party code NEWC is not in the party codes file/);
  assert.match(text, /2 invoices are NOT in the payment list/);
  const acct = await page.$$eval('table tbody tr', (rows) => rows.map((r) => [...r.children].map((c) => c.textContent)));
  const ammot = acct.find((r) => r[0] === '50100123456789');
  assert.equal(ammot[4], '3'); assert.equal(ammot[5], '1,682.00'); assert.equal(ammot[7], '29.00'); assert.equal(ammot[8], '1,653.00');   // lot, TDS, to pay
  const sbi = acct.find((r) => r[0] === '000987654321');
  assert.equal(sbi[5], '8,260.00'); assert.equal(sbi[7], '140.00'); assert.equal(sbi[8], '8,120.00');          // 2000 -> 40, 5000 -> 100
  await shot(page, 'f1-report');
  // the bank's UTR file
  assert.equal(await page.isDisabled('button:has-text("UTR file")'), false);
  await page.keyboard.press('u'); await page.waitForSelector('text=HEADS UP');
  const t2 = await page.textContent('.page');
  assert.match(t2, /HEADS UP: 2 RETURNED payments in the UTR file/); assert.match(t2, /RETURNED payments in the UTR file \(2/);
  assert.match(t2, /UTR000A/); assert.match(t2, /Ammot Motors Pvt Ltd/); assert.match(t2, /No UTR found|no row in the UTR file/);
  const rows2 = await page.$$eval('table tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.textContent)));
  const amm = rows2.find((r) => r[0] === '50100123456789' && r.includes('Paid'));
  assert.ok(amm, 'Ammot account shows Paid with its UTR'); assert.ok(amm.includes('UTR000A'));
  await shot(page, 'f2-utr');
  await page.keyboard.press('Alt+x'); await toast(page, 'Saved');
  await page.keyboard.press('Alt+p'); await toast(page, 'Saved');
  const files = fs.readdirSync(exportDir).sort();
  assert.equal(files.length, 2);
  const xl = files.find((f) => f.endsWith('.xlsx'));
  const back = new ExcelJS.Workbook(); await back.xlsx.readFile(path.join(exportDir, xl));
  assert.deepEqual(back.worksheets.map((w) => w.name), ['Pay by account', 'Invoices']);
  let acctCell = null; back.worksheets[0].eachRow((r) => { if (typeof r.getCell(1).value === 'string' && /^\d+$/.test(r.getCell(1).value)) acctCell = r.getCell(1).value; });
  assert.equal(typeof acctCell, 'string');
  const inv = back.worksheets[1]; let rowsOut = 0; inv.eachRow((r) => { if (/FL26/.test(String(r.getCell(3).value))) rowsOut++; });
  assert.equal(rowsOut, 7);                                                                                                           // 7 invoices are in the payment list; two have no usable account
  assert.ok(fs.statSync(path.join(exportDir, files.find((f) => f.endsWith('.pdf')))).size > 1500);
  await app.close();
  console.log('Service payment UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
