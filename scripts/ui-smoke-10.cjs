'use strict';
// Several vouchers from one person in one go, through the real app.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-10.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots10');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const toast = async (page, re) => { await page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re); };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud10-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'], env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('o'); await page.waitForSelector('table.grid');
  for (const [d, n] of Object.entries({ N500: 10, N200: 10, N100: 20, N50: 20, N20: 20, N10: 20, C10: 10, C5: 10, C2: 10, C1: 10 })) await page.fill(`input[data-denom="${d}"]`, String(n));
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');

  await page.keyboard.press('F5'); await page.waitForSelector('input[aria-label="Person"]');
  await page.keyboard.press('Alt+c');
  await page.waitForSelector('.overlay input'); await page.keyboard.type('Meena'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay input'); await page.keyboard.type('Stores'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay input'); await page.keyboard.press('Enter');
  await page.waitForSelector('.chip:not([hidden])');

  // 120, Enter -> a second box appears; 143, Enter -> a third; Backspace removes it (empty); Enter on empty second goes on after typing
  await page.keyboard.type('120'); await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 1);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Voucher 2 amount');
  await page.keyboard.type('143'); await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 2);
  await shot(page, 'm1-three-boxes');
  await page.keyboard.press('Backspace');                    // third box is empty: removed
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 1);
  assert.equal(await page.inputValue('.more-vouchers input'), '143');
  assert.match(await page.textContent('.step:not([hidden]) p.lede:not([hidden])'), /2 vouchers · 120 \+ 143 = ₹263/);
  await page.keyboard.press('Enter');                        // add a third again
  await page.keyboard.press('Enter');                        // empty third: carry on
  await page.waitForSelector('.card-opt');
  assert.match(await page.textContent('.card-opt.on'), /₹260/);
  await shot(page, 'm2-cards');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('.live.ok'));
  await page.keyboard.press('Enter');
  await page.selectOption('.lines-grid select', { label: 'Food' }); await page.focus('.lines-grid select'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('.lines-grid input.amt'), '263', 'lines start from the total');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  assert.match(await page.textContent('.overlay'), /₹120 \+ ₹143 = ₹263/);
  await shot(page, 'm3-confirm');
  await page.keyboard.press('y');
  await toast(page, 'Voucher saved: ₹260 paid to Meena');

  // single voucher: type it, Enter (second box), Enter again (empty) -> cards. No extra boxes left from last time.
  await page.keyboard.type('meena'); await page.waitForFunction(() => document.querySelector('.pick div.on')); await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 0);
  await page.keyboard.type('100'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.card-opt');
  await app.close(); console.log('Several-vouchers UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
