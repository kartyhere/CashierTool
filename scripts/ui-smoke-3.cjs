'use strict';
// Phase 2b through the real app: person, voucher by keyboard, balance carry, people, settle.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-3.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots3');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const text = (page, sel) => page.textContent(sel);
const toast = async (page, re) => { await page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re); };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud3-'));
  const app = await electron.launch({
    executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');

  // Opening count
  await page.keyboard.press('o');
  await page.waitForSelector('table.grid');
  for (const [d, n] of Object.entries({ N500: 10, N200: 10, N100: 20, N50: 20, N20: 20, N10: 20, C10: 10, C5: 10, C2: 10, C1: 10 })) await page.fill(`input[data-denom="${d}"]`, String(n));
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('.menu');
  const startTotal = await page.evaluate(() => document.querySelector('.dash tr.total td:last-child').textContent);

  // Voucher 1: new person by Alt+C, 244 -> pay 240, balance +4
  await page.keyboard.press('F5');
  await page.waitForSelector('input[aria-label="Person"]');
  await page.keyboard.press('Alt+c');
  await page.waitForSelector('.overlay input');
  await page.keyboard.type('Ravi Kumar'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay input'); await page.keyboard.type('Sales'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay input'); await page.keyboard.press('Enter');   // balance 0
  await page.waitForSelector('.chip:not([hidden])');
  assert.match(await text(page, '.chip'), /Ravi Kumar/);
  await page.keyboard.type('244'); await page.keyboard.press('Enter');
  await page.waitForSelector('.card-opt');
  assert.match(await text(page, '.card-opt.on'), /₹240/);
  assert.match(await text(page, '.card-opt.on'), /you owe ₹4/);
  await shot(page, 'v1-payout-cards');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.live.ok'));
  assert.equal(await page.inputValue('input[data-col="give"][data-denom="N200"]'), '1');
  assert.equal(await page.inputValue('input[data-col="give"][data-denom="N20"]'), '2');
  await shot(page, 'v2-breakup');
  await page.keyboard.press('Enter');
  await page.selectOption('.lines-grid select', { label: 'Food' });
  await page.focus('.lines-grid select'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('.lines-grid input.amt'), '244');
  await page.keyboard.press('Enter');                       // amount -> note
  await page.keyboard.type('tea and snacks'); await page.keyboard.press('Enter');
  await page.keyboard.type('office run'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  await shot(page, 'v3-confirm');
  await page.keyboard.press('y');
  await toast(page, 'Voucher saved: ₹240 paid to Ravi Kumar');

  // Voucher 2: found by "ravi", 258 + balance 4 -> pay 260, balance +2
  await page.keyboard.type('ravi');
  await page.waitForFunction(() => document.querySelector('.pick div.on'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('258'); await page.keyboard.press('Enter');
  await page.waitForSelector('.card-opt');
  assert.match(await text(page, '.card-opt.on'), /₹260/);
  assert.match(await text(page, '.card-opt.on'), /you owe ₹2/);
  await page.keyboard.press('o');                            // type another amount
  await page.waitForSelector('.overlay input'); await page.keyboard.type('258'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /typed by hand/.test(document.querySelector('.cards').textContent));
  await page.keyboard.press('Escape');                       // leave the voucher
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('.menu');

  // Drawer moved by exactly 240
  const after = await page.evaluate(() => document.querySelector('.dash tr.total td:last-child').textContent);
  const n = (t) => Number(t.replace(/[^\d]/g, ''));
  assert.equal(n(startTotal) - n(after), 240);

  // Entries show the voucher; People show +4; Settle pays it with 2 x ₹2 coins
  await page.keyboard.press('e'); await page.waitForSelector('tr[data-id]');
  assert.match(await text(page, 'tbody'), /Ravi Kumar/);
  assert.match(await text(page, 'tbody'), /Food/);
  await shot(page, 'v4-entries');
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('p'); await page.waitForSelector('tr[data-id]');
  await page.focus('tr[data-id]');
  await page.waitForFunction(() => /Voucher/.test(document.body.textContent) && /you owe ₹4/.test(document.body.textContent));
  await shot(page, 'v5-people');
  await page.keyboard.press('s');
  await page.waitForSelector('table.grid');
  await page.fill('input[data-denom="C2"]', '2');
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('tr[data-id]');
  await toast(page, 'Paid ₹4');
  await page.focus('tr[data-id]');
  await page.waitForFunction(() => /settled/.test(document.body.textContent));

  // Light theme look at the voucher screen
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.click('button[title="Switch theme"]');
  await page.keyboard.press('F5'); await page.waitForSelector('input[aria-label="Person"]');
  await page.keyboard.type('rav'); await page.keyboard.press('Enter');
  await page.keyboard.type('1250'); await page.keyboard.press('Enter');
  await page.waitForSelector('.card-opt');
  await page.keyboard.press('Enter');
  await page.waitForSelector('table.grid');
  await shot(page, 'v6-breakup-light');
  await app.close();
  console.log('Phase 2b UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
