'use strict';
// Gateway is one vertical list; Settings opens on the tab bar; hint bar is bold.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-9.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots9');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const focusedText = (page) => page.evaluate(() => (document.activeElement.textContent || document.activeElement.getAttribute('aria-label') || '').trim());

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud9-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'], env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');

  // one column: every tile has the same left edge, each below the last
  const boxes = await page.$$eval('.menu button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
  assert.equal(boxes.length, 10);
  assert.equal(new Set(boxes.map((b) => b.x)).size, 1, 'all tiles share one left edge');
  assert.ok(boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y), 'each tile is below the one before');
  assert.match(await focusedText(page), /VOUCHER|Voucher/i);
  await page.keyboard.press('ArrowDown'); assert.match(await focusedText(page), /Cash in/i);
  await page.keyboard.press('ArrowDown'); assert.match(await focusedText(page), /Bank deposit/i);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.match(await focusedText(page), /Settings/i, 'Up from the first tile wraps to the last');
  await shot(page, 'g1-gateway');

  // hint bar is bold
  assert.equal(await page.$eval('.statusbar', (e) => getComputedStyle(e).fontWeight), '700');

  // Settings opens on the tab bar, not in a text box
  await page.keyboard.press('s');
  await page.waitForSelector('.tabs');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.tabs') !== null), true, 'focus is on the tab bar');
  assert.match(await focusedText(page), /General/);
  await shot(page, 'g2-settings-tabs');
  // Left wraps to Backup (a page with a list), still on the tab bar; Left again: Notes and coins
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => /Backup/.test(document.querySelector('.tabs button.on').textContent));
  assert.equal(await page.evaluate(() => document.activeElement.closest('.tabs') !== null), true);
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => /Notes and coins/.test(document.querySelector('.tabs button.on').textContent));
  await page.keyboard.press('ArrowDown');                    // into the page: first row
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TR');
  await shot(page, 'g3-settings-notes');
  await page.keyboard.press('Alt+ArrowUp');                  // back to the tab bar
  assert.equal(await page.evaluate(() => document.activeElement.closest('.tabs') !== null), true);
  await page.keyboard.press('Alt+1'); await page.waitForSelector('input[data-field]');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.tabs') !== null), true, 'General opens on the tab bar too');
  await page.keyboard.press('ArrowDown');                    // into the first box
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'INPUT');
  await app.close(); console.log('Gateway and Settings navigation UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
