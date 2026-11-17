'use strict';
// Phase 2a through the real app: opening count, cash in, entries (delete), lists. Screenshots included.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-2.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots2');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const text = (page, sel) => page.textContent(sel);

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud2-'));
  const app = await electron.launch({
    executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');

  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.waitForSelector('.banner');
  assert.match(await text(page, '.banner'), /no opening count/);
  await shot(page, 'a-gateway-no-opening');

  // Opening count, mostly by keyboard
  await page.keyboard.press('o');
  await page.waitForSelector('table.grid');
  await page.fill('input[data-denom="N500"]', '10');
  await page.fill('input[data-denom="N100"]', '20');
  await page.fill('input[data-denom="C1"]', '7');
  assert.match(await text(page, 'table.grid tr.total'), /7,007/);
  await shot(page, 'b-opening-dark');
  await page.focus('input[data-denom="C1"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  await shot(page, 'c-opening-confirm');
  await page.keyboard.press('y');
  await page.waitForSelector('.menu');
  await page.waitForFunction(() => document.querySelector('.dash').textContent.includes('7,007'));
  assert.equal(await page.locator('.banner').count(), 0);
  await shot(page, 'd-gateway-dark');

  // Cash in from a new branch
  await page.keyboard.press('F6');
  await page.waitForSelector('select');
  await page.selectOption('select >> nth=0', 'branch');
  await page.selectOption('select >> nth=1', '__new');
  await page.fill('input[placeholder="Type the new name"]', 'Mysore');
  await page.fill('input[data-denom="N100"]', '5');
  await page.fill('input[data-denom="N500"]', '2');
  await shot(page, 'e-cashin-dark');
  await page.focus('input[data-denom="C1"]');
  await page.keyboard.press('Enter');          // last count box -> next field is remark
  await page.keyboard.type('Morning collection');
  await page.keyboard.press('Enter');          // remark is last -> submit
  await page.waitForSelector('.overlay h2');
  assert.match(await text(page, '.overlay'), /Mysore/);
  await page.keyboard.press('y');
  await page.waitForSelector('.menu');
  await page.waitForFunction(() => document.querySelector('.dash').textContent.includes('8,507'));

  // Entries: two rows, delete the cash in
  await page.keyboard.press('e');
  await page.waitForSelector('tr[data-id]');
  assert.equal(await page.locator('tr[data-id]').count(), 2);
  await shot(page, 'f-entries-dark');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Delete');
  await page.waitForSelector('.overlay h2');
  await page.keyboard.press('n');
  assert.equal(await page.locator('tr.gone').count(), 0);
  await page.keyboard.press('Delete'); await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('tr.gone');
  // Deleting the opening now would be fine (drawer stays >= 0) so it is allowed; do not do it.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.dash').textContent.includes('7,007'));

  // Lists: add a department with the keyboard, then see it in Settings in the Light theme
  await page.click('button[title="Switch theme"]');
  await page.keyboard.press('s');
  await page.waitForSelector('.tabs');
  await page.keyboard.press('a');
  await page.waitForSelector('.overlay input');
  await page.keyboard.type('Sales'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent.includes('Sales'));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.body.textContent.includes('Bank 1'));
  await shot(page, 'g-lists-banks-light');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  await shot(page, 'h-gateway-light');

  // Persisted and sealed
  await app.close();
  const raw = fs.readFileSync(path.join(userData, 'data', 'cashdesk.db'));
  assert.ok(!raw.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));
  console.log('Phase 2a UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
