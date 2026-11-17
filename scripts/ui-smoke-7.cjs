'use strict';
// Phase 6 through the real app: settings, a cashier user, backup password, backup, restore, and the cashier's limits.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots7');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const toast = (page, re) => page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re);
const dialogType = async (page, text) => { await page.waitForSelector('.overlay input'); await page.keyboard.type(text); await page.keyboard.press('Enter'); };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ud7-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-bk-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1', CASHDESK_BACKUP_DIR: backupDir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  assert.match(await page.textContent('.gateway'), /Backups are off/);

  await page.keyboard.press('s'); await page.waitForSelector('input[data-key="rounding_step"]');
  await shot(page, 'p6-general');
  await page.fill('input[data-key="rounding_step"]', '5');
  await page.focus('input[data-key="idle_lock_minutes"]'); await page.keyboard.press('Enter');
  await toast(page, 'Saved');
  await page.fill('input[data-key="rounding_step"]', '0'); await page.keyboard.press('Control+a');
  await page.focus('input[data-key="idle_lock_minutes"]'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /whole number from 1 to 100/.test(document.querySelector('[role=alert]').textContent));
  await page.fill('input[data-key="rounding_step"]', '5');

  // Users: add a cashier
  await page.keyboard.press('Alt+3'); await page.waitForSelector('table');
  await page.keyboard.press('a'); await dialogType(page, 'asha'); await dialogType(page, '5555');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('n');
  await page.waitForFunction(() => /asha/.test(document.querySelector('.page').textContent));
  await shot(page, 'p6-users');

  // Notes and coins: hide the 200 note
  await page.keyboard.press('Alt+4'); await page.waitForSelector('tr[data-id="N200"]');
  await page.focus('tr[data-id="N200"]'); await page.keyboard.press('Space');
  await page.waitForFunction(() => /Hidden/.test(document.querySelector('tr[data-id="N200"]').textContent));

  // Backup: password, folder, back up now
  await page.keyboard.press('Alt+5'); await page.waitForSelector('text=Backups are OFF');
  await page.keyboard.press('p'); await dialogType(page, 'correct horse'); await dialogType(page, 'correct horse');
  await page.waitForSelector('text=Backups are on');
  await page.keyboard.press('f'); await page.waitForFunction((d) => document.querySelector('.page').textContent.includes(d), backupDir);
  await page.keyboard.press('b'); await toast(page, 'Backed up');
  await page.waitForSelector('tr[data-name]');
  assert.equal(fs.readdirSync(backupDir).filter((n) => n.endsWith('.cdbak')).length, 1);
  await shot(page, 'p6-backup');

  // Change something, then restore the backup: the change must disappear and we must sign in again
  await page.keyboard.press('Alt+1'); await page.waitForSelector('input[data-key="rounding_step"]');
  await page.fill('input[data-key="rounding_step"]', '7');
  await page.focus('input[data-key="idle_lock_minutes"]'); await page.keyboard.press('Enter'); await toast(page, 'Saved');
  await page.keyboard.press('Alt+5'); await page.waitForSelector('tr[data-name]');
  await page.focus('tr[data-name]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay input'); await page.keyboard.type('wrong password'); await page.keyboard.press('Enter');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await toast(page, 'Wrong backup password');
  await page.focus('tr[data-name]'); await page.keyboard.press('Enter');
  await dialogType(page, 'correct horse');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('#u');                                      // back at the sign-in screen
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('s'); await page.waitForSelector('input[data-key="rounding_step"]');
  assert.equal(await page.inputValue('input[data-key="rounding_step"]'), '5');
  assert.ok(fs.readdirSync(backupDir).some((n) => n.includes('before-restore')));

  // The cashier cannot open Settings
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('Escape'); await page.waitForSelector('.overlay h2'); await page.keyboard.press('y');
  await page.waitForSelector('#u');
  await page.fill('#u', 'asha'); await page.fill('#p', '5555'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('s');
  await toast(page, 'Only an admin');
  assert.equal(await page.locator('input[data-key="rounding_step"]').count(), 0);
  await app.close();
  console.log('Phase 6 UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
