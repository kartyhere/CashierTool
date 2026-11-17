'use strict';
// Voucher with cash brought by the receiver, through the real app.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-8.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots8');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const toast = async (page, re) => { await page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re); };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud8-'));
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
  // voucher 263, Tab to the brought field, 7
  await page.keyboard.type('263'); await page.keyboard.press('Tab'); await page.keyboard.type('7');
  await shot(page, 'b1-fields');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');   // second Enter: no second voucher
  await page.waitForSelector('.card-opt');
  const cards = await page.$$eval('.card-opt', (n) => n.map((x) => x.textContent));
  assert.equal(cards.length, 3);
  assert.match(cards[2], /Custom/); assert.match(cards[2], /₹270/); assert.match(cards[2], /brings back ₹7/); assert.match(cards[2], /balance settled/);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await shot(page, 'b2-cards');
  await page.keyboard.press('Enter');
  await page.waitForSelector('table.grid');
  // back is pre-filled with the brought cash: 5 + 2
  assert.equal(await page.inputValue('input[data-col="back"][data-denom="C5"]'), '1');
  assert.equal(await page.inputValue('input[data-col="back"][data-denom="C2"]'), '1');
  await page.waitForFunction(() => document.querySelector('.live.ok'));
  await shot(page, 'b3-breakup');
  await page.keyboard.press('Enter');
  await page.selectOption('.lines-grid select', { label: 'Food' }); await page.focus('.lines-grid select'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  assert.match(await page.textContent('.overlay'), /Brought by receiver/);
  await shot(page, 'b4-confirm');
  await page.keyboard.press('y');
  await toast(page, 'Voucher saved: ₹263 paid to Meena');
  // empty brought field still goes straight on with Enter in the amount box
  await page.keyboard.type('meena'); await page.waitForFunction(() => document.querySelector('.pick div.on')); await page.keyboard.press('Enter');
  await page.keyboard.type('100'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.card-opt');
  assert.match(await page.textContent('.card-opt:nth-child(3)'), /exact voucher amount/);
  await app.close();
  console.log('Brought-cash UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
