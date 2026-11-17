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

  // 120, Enter -> a second box appears; 143, Enter -> a third; Backspace removes the empty third; total is always visible
  await page.keyboard.type('120');
  assert.match(await page.textContent('.total-line'), /Total ₹120/);
  await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 1);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Voucher 2 amount');
  await page.keyboard.type('143'); await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 2);
  await shot(page, 'm1-three-boxes');
  await page.keyboard.press('Backspace');
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 1);
  assert.match(await page.textContent('.total-line'), /Total ₹263\s+·\s+2 vouchers: 120 \+ 143/);
  await page.keyboard.press('Enter');                        // add a third box again
  await page.keyboard.type('0'); await page.keyboard.press('Enter');   // 0 ends the list
  await page.waitForSelector('.card-opt');
  assert.match(await page.textContent('.card-opt.on'), /₹260/);
  await shot(page, 'm2-cards');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('.live.ok'));
  await page.keyboard.press('Enter');
  // split: voucher 1 of 2 (₹120), then voucher 2 of 2 (₹143)
  await page.waitForSelector('.split-section');
  assert.equal(await page.$$eval('.split-section:not([hidden])', (n) => n.length), 1, 'only voucher 1 is shown first');
  assert.match(await page.textContent('.split-section:not([hidden]) .field'), /Voucher 1 of 2 · ₹120/);
  await page.selectOption('.split-section:not([hidden]) select', { label: 'Food' }); await page.focus('.split-section:not([hidden]) select'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('.split-section:not([hidden]) input.amt'), '120', 'amount starts from the voucher');
  await page.keyboard.type('90'); await page.keyboard.press('Enter');          // 90 of 120: more to split
  await page.keyboard.type('first'); await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.split-section:not([hidden]) tbody tr', (n) => n.length), 2, 'a second line for voucher 1 because 30 is left');
  await page.selectOption('.split-section:not([hidden]) tbody tr:nth-child(2) select', { label: 'Travel' }); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.value), '30');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');       // amount, note -> voucher 2
  await page.waitForFunction(() => document.querySelectorAll('.split-section:not([hidden])').length === 2);
  assert.match(await page.evaluate(() => [...document.querySelectorAll('.split-section:not([hidden]) .field')].pop().textContent), /Voucher 2 of 2 · ₹143/);
  await page.selectOption('.split-section:nth-child(2) select', { label: 'Food' }); await page.focus('.split-section:nth-child(2) select'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('.split-section:nth-child(2) input.amt'), '143');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');   // amount, note: finishes the last voucher
  await page.waitForSelector('input[aria-label="Remark"]:focus');
  await shot(page, 'm3-split');
  await page.keyboard.type('tea'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  const confirm = await page.textContent('.overlay');
  assert.match(confirm, /₹120 \+ ₹143 = ₹263/); assert.match(confirm, /V1 · Food/); assert.match(confirm, /V2 · Food/);
  await shot(page, 'm4-confirm');
  await page.keyboard.press('y');
  await toast(page, 'Voucher saved: ₹260 paid to Meena');

  // Second visit: 15 vouchers of 10, no limit; split later with F8
  await page.keyboard.type('meena'); await page.waitForFunction(() => document.querySelector('.pick div.on')); await page.keyboard.press('Enter');
  for (let i = 0; i < 15; i++) { await page.keyboard.type('10'); await page.keyboard.press('Enter'); }
  assert.equal(await page.$$eval('.more-vouchers input', (n) => n.length), 15);
  assert.match(await page.textContent('.total-line'), /Total ₹150\s+·\s+15 vouchers/);
  await page.keyboard.press('Enter');                        // empty 16th box: carry on
  await page.waitForSelector('.card-opt');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('.live.ok'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.split-section');
  await page.keyboard.press('F8');                           // no time to split now
  await page.waitForSelector('input[aria-label="Remark"]:focus');
  await page.keyboard.press('Enter');
  assert.match(await page.textContent('.overlay'), /later \(not split yet\)/);
  await page.keyboard.press('y');
  await toast(page, 'Voucher saved: ₹150 paid to Meena');
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  assert.match(await page.textContent('.dash'), /1 voucher is not split into expenses yet/);
  await shot(page, 'm5-banner');

  // Entries: E on the voucher edits the split; the 15 vouchers each need ₹10
  await page.keyboard.press('e'); await page.waitForSelector('table');
  await page.waitForFunction(() => /NOT SPLIT YET/.test(document.body.textContent));
  await page.focus('tr[data-menu-item]:nth-child(2)');
  const rowTexts = await page.$$eval('tr[data-menu-item]', (n) => n.map((x) => x.textContent));
  const idx = rowTexts.findIndex((t) => /NOT SPLIT YET/.test(t));
  await page.focus(`tr[data-menu-item]:nth-child(${idx + 1})`);
  await page.keyboard.press('e');
  await page.waitForSelector('.split-section');
  assert.equal(await page.$$eval('.split-section', (n) => n.length), 15);
  assert.equal(await page.$$eval('.split-section:not([hidden])', (n) => n.length), 15, 'all vouchers are shown when editing');
  for (let k = 0; k < 15; k++) {
    await page.selectOption(`.split-section:nth-child(${k + 1}) select`, { label: 'Food' }); await page.focus(`.split-section:nth-child(${k + 1}) select`);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');   // type, amount, note
  }
  await page.waitForSelector('input[aria-label="Remark"]:focus');
  await shot(page, 'm6-edit-split');
  await page.keyboard.type('split afterwards'); await page.keyboard.press('Enter');
  await toast(page, 'Expense split saved');
  await page.waitForFunction(() => !/NOT SPLIT YET/.test(document.body.textContent));
  assert.match(await page.textContent('body'), /15 vouchers/);
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  assert.doesNotMatch(await page.textContent('.dash'), /not split into expenses/);
  await app.close(); console.log('Several-vouchers UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
