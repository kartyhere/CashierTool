'use strict';
// Phase 5 through the real app: open Reports, run the cash book and others, export PDF and Excel to a real file.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots6');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud6-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-exp-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1', CASHDESK_EXPORT_DIR: exportDir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('o'); await page.waitForSelector('table.grid');
  for (const [d, n] of Object.entries({ N500: 10, N100: 20, N20: 10, C1: 5 })) await page.fill(`input[data-denom="${d}"]`, String(n));
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');
  await page.keyboard.press('F6'); await page.waitForSelector('table.grid');
  await page.fill('input[data-denom="N500"]', '2');
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');

  await page.keyboard.press('r');
  await page.waitForSelector('select[aria-label="Report"]');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); // report, from, to -> show
  await page.waitForSelector('.reportview table');
  assert.match(await page.textContent('.reportview'), /Cash book/);
  assert.match(await page.textContent('.reportview'), /1,000/);
  await shot(page, 'p5-cashbook');

  await page.selectOption('select[aria-label="Report"]', 'denomination');
  await page.click('button.primary');
  await page.waitForFunction(() => /Note \/ coin|Bank balances/.test(document.querySelector('.reportview').textContent));
  await shot(page, 'p5-denomination');

  await page.selectOption('select[aria-label="Report"]', 'payments');
  assert.equal(await page.isVisible('select[aria-label="Person"]'), true);
  await page.selectOption('select[aria-label="Report"]', 'deposits');
  assert.equal(await page.isVisible('select[aria-label="Bank"]'), true);
  await page.selectOption('select[aria-label="Report"]', 'cashbook');

  // Export: the test build saves to CASHDESK_EXPORT_DIR instead of opening the Windows save box
  await page.keyboard.press('Alt+p');
  await page.waitForFunction(() => /Saved /.test(document.getElementById('toast').textContent));
  await page.keyboard.press('Alt+x');
  await page.waitForFunction(() => /\.xlsx/.test(document.getElementById('toast').textContent));
  const files = fs.readdirSync(exportDir).sort();
  assert.equal(files.length, 2, files.join());
  assert.ok(files.some((f) => /^CashDesk-CashBook-\d{4}-\d{2}-\d{2}\.pdf$/.test(f)));
  const pdf = fs.readFileSync(path.join(exportDir, files.find((f) => f.endsWith('.pdf'))));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(fs.statSync(path.join(exportDir, files.find((f) => f.endsWith('.xlsx')))).size > 2000);

  await page.fill('input[aria-label="From date"]', '2026-13-45');
  await page.click('button.primary');
  await page.waitForFunction(() => /valid dates/.test(document.querySelector('[role=alert]').textContent));
  await app.close();
  console.log('Phase 5 UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
