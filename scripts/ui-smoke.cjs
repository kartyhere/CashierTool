'use strict';
// Drives the real app (Electron) through Phase 1 and takes screenshots. Not part of `npm test`.
// Needs playwright-core installed outside the project:  NODE_PATH=/path/to/node_modules xvfb-run -a node scripts/ui-smoke.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots');
fs.mkdirSync(out, { recursive: true });

async function launch(userData) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  await page.waitForSelector('.screen');
  return { app, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud-'));
  let { app, page } = await launch(userData);

  // First run: setup screen
  assert.match(await page.textContent('h2'), /Create the admin/);
  await shot(page, '1-setup-dark');
  await page.fill('#u', 'karthik'); await page.keyboard.press('Enter');
  await page.keyboard.type('1234'); await page.keyboard.press('Enter');
  await page.keyboard.type('9999'); await page.keyboard.press('Enter');      // mismatch
  await page.waitForFunction(() => document.querySelector('.error').textContent.includes('do not match'));
  await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');

  // Gateway: keyboard
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'V');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'S');
  await page.keyboard.press('t');
  await page.waitForSelector('input[aria-label="Tally balance"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  await shot(page, '2-gateway-dark');

  // Theme toggle persists
  await page.click('button[title="Switch theme"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await shot(page, '3-gateway-light');

  // Esc -> sign out? N stays, Y signs out
  await page.keyboard.press('Escape');
  await page.waitForSelector('.overlay h2');
  await shot(page, '4-signout-dialog-light');
  await page.keyboard.press('n');
  assert.equal(await page.locator('.overlay').count(), 0);
  await page.keyboard.press('Control+l');
  await page.waitForSelector('.overlay input');
  await shot(page, '5-locked-light');
  await page.keyboard.type('wrong'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.overlay .error').textContent.includes('Wrong'));
  await page.keyboard.type('1234'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.overlay'));
  await page.keyboard.press('Escape'); await page.keyboard.press('y');
  await page.waitForSelector('input#u');

  // Sign in page, wrong x4 then 5th locks
  await shot(page, '6-signin-light');
  for (let i = 0; i < 5; i++) {
    await page.fill('#u', 'karthik'); await page.fill('#p', 'bad' + i); await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelector('.error').textContent.length > 0 && !document.querySelector('button.primary').disabled, i);
  }
  assert.match(await page.textContent('.error'), /Locked for/);
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Too many/.test(document.querySelector('.error').textContent));

  // On disk: sealed, not SQLite
  const raw = fs.readFileSync(path.join(userData, 'data', 'cashdesk.db'));
  assert.ok(!raw.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));

  // Restart: lock persists, theme persists
  await app.close();
  ({ app, page } = await launch(userData));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.waitForSelector('input#u');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Too many/.test(document.querySelector('.error').textContent));

  // Page cannot reach Node
  const leaks = await page.evaluate(() => [typeof require, typeof process, typeof window.ipcRenderer].join());
  assert.equal(leaks, 'undefined,undefined,undefined');
  await app.close();
  console.log('UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
