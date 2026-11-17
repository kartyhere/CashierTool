'use strict';
// Phase 3 through the real app: bank deposit, exchange, deposit banner.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots4');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const text = (page, sel) => page.textContent(sel);
const toast = (page, re) => page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re);

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud4-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('o'); await page.waitForSelector('table.grid');
  for (const [d, n] of Object.entries({ N500: 30, N200: 10, N100: 40, N50: 20, N20: 20, N10: 20, C10: 10 })) await page.fill(`input[data-denom="${d}"]`, String(n));
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');

  // Deposit: suggestion is pre-filled, to Bank 2, with a reference
  await page.keyboard.press('F4');
  await page.waitForSelector('select');
  await page.selectOption('select', { label: 'Bank 2 · ₹0' });
  const n500 = Number(await page.inputValue('input[data-denom="N500"]'));
  assert.ok(n500 > 0);
  assert.equal(await page.inputValue('input[data-denom="N50"]'), '');
  await shot(page, 'p3-deposit');
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.keyboard.type('SLIP-1001'); await page.keyboard.press('Enter');   // reference -> remark
  await page.keyboard.press('Enter');                                         // remark is last -> save
  await page.waitForSelector('.overlay h2');
  assert.match(await text(page, '.overlay'), /SLIP-1001/);
  await page.keyboard.press('y'); await page.waitForSelector('.menu');
  await toast(page, 'Deposited');
  await page.waitForFunction(() => /BANK 2/i.test(document.querySelector('.dash').textContent) && !/Bank 2\s*₹0\b/.test(document.querySelector('.dash').textContent));

  // Exchange one 100 into two 50s (the deposit took all the 500s)
  await page.keyboard.press('x'); await page.waitForSelector('.live');
  const grids = page.locator('table.grid');
  await grids.nth(0).locator('input[data-denom="N100"]').fill('1');
  await grids.nth(1).locator('input[data-denom="N50"]').fill('1');
  await shot(page, 'p3-exchange-unequal');
  await grids.nth(1).locator('input[data-denom="N50"]').fill('2');
  await page.waitForSelector('.live.ok');
  await shot(page, 'p3-exchange');
  await grids.nth(1).locator('input[data-denom="C1"]').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('.menu', { timeout: 8000 }).catch(async (e) => { console.error('STUCK:', (await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 600)); throw e; });
  await toast(page, 'Exchanged');

  // Entries show both
  await page.keyboard.press('e'); await page.waitForSelector('tr[data-id]');
  assert.match(await text(page, 'tbody'), /SLIP-1001/);
  assert.match(await text(page, 'tbody'), /Exchange/);
  await shot(page, 'p3-entries');
  await app.close();
  console.log('Phase 3 UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
