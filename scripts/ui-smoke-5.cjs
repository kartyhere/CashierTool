'use strict';
// Phase 4 through the real app: Tally check (Ctrl+T), day close with a difference, then the next morning's check.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots5');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const text = (page, sel) => page.textContent(sel);
const toast = (page, re) => page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re);

async function launch(userData, offset = 0) {
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1', CASHDESK_CLOCK_OFFSET_MS: String(offset) } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  return { app, page };
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud5-'));
  let { app, page } = await launch(userData);
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('o'); await page.waitForSelector('table.grid');
  for (const [d, n] of Object.entries({ N500: 10, N100: 20, C1: 5 })) await page.fill(`input[data-denom="${d}"]`, String(n));
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');
  await page.keyboard.press('F6'); await page.waitForSelector('table.grid');
  await page.fill('input[data-denom="N500"]', '2');
  await page.focus('input[data-denom="C1"]'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y'); await page.waitForSelector('.menu');

  // Tally check with Ctrl+T: Tally is ₹100 lower than the app
  await page.keyboard.press('Control+t');
  await page.waitForSelector('input[aria-label="Tally balance"]');
  await page.keyboard.type('7905'); await page.keyboard.press('Enter');
  await page.keyboard.type('noon check'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /100 more than Tally/.test(document.querySelector('.live.result').textContent));
  await shot(page, 'p4-tally');
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');

  // Day close: one ₹100 note short
  await page.keyboard.press('c');
  await page.waitForSelector('table.grid');
  await page.fill('input[aria-label="₹500 note counted"]', '12');
  await page.fill('input[aria-label="₹100 note counted"]', '19');
  await page.fill('input[aria-label="₹1 coin counted"]', '5');
  await page.fill('input[aria-label="Tally balance"]', '7905');
  await page.waitForFunction(() => /100 less/.test(document.querySelector('.live').textContent));
  await shot(page, 'p4-dayclose');
  await page.click('button.primary');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForFunction(() => /differences/i.test(document.querySelector('.overlay h2')?.textContent || ''));
  await shot(page, 'p4-close-differences');
  await page.keyboard.press('y');
  await page.waitForSelector('.menu'); await toast(page, 'shortage');
  await page.waitForFunction(() => document.querySelector('.dash').textContent.includes('7,905'));
  await app.close();

  // Next morning 09:20: sign in, the morning check appears
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 20, 0, 0);
  ({ app, page } = await launch(userData, t.getTime() - Date.now()));
  await page.waitForSelector('input#u');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2');
  assert.match(await text(page, '.overlay'), /Morning check/);
  assert.match(await text(page, '.overlay'), /7,905/);
  await shot(page, 'p4-morning');
  await page.keyboard.type('7900'); await page.keyboard.press('Enter');
  await toast(page, '₹5 more than Tally');
  assert.equal(await page.locator('.overlay').count(), 0);
  assert.equal(await page.locator('.banner.bad').count(), 0, 'yesterday is closed, so no warning');
  await shot(page, 'p4-gateway-next-day');
  await app.close();
  console.log('Phase 4 UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
