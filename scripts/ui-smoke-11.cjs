'use strict';
// Restore on a "new PC" through the real app: make a backup in one app, then restore that file on the first-run screen of a
// brand new app. Also the Restore button in Settings, and the "May edit entries" right in Users.
//   NODE_PATH=/path/to/node_modules SHOTS=/tmp/shots xvfb-run -a node scripts/ui-smoke-11.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'cashdesk-shots11');
fs.mkdirSync(out, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(out, n + '.png') });
const toast = async (page, re) => { await page.waitForFunction((s) => !document.getElementById('toast').hidden && new RegExp(s).test(document.getElementById('toast').textContent), re); };
const dialogType = async (page, text) => { await page.waitForSelector('.overlay input'); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
const launch = (env) => electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'], env: { ...process.env, CASHDESK_TEST_KEYSTORE: '1', ...env } });

(async () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-bk11-'));
  // ---- the old PC ----
  let app = await launch({ CASHDESK_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'cd-old-')), CASHDESK_BACKUP_DIR: backupDir });
  let page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.fill('#p2', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('p'); await page.waitForSelector('input[aria-label="Search"], input[type="text"]');
  await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('s'); await page.waitForSelector('.tabs');
  // Users: the new right is shown and can be switched (the first user is an admin: always allowed)
  await page.keyboard.press('Alt+3'); await page.waitForSelector('tr[data-id]');
  assert.match(await page.textContent('.page'), /May edit entries/);
  await page.keyboard.press('a'); await dialogType(page, 'meena'); await dialogType(page, 'abcd1234');
  await page.waitForSelector('.overlay h2'); await page.keyboard.press('n');                       // cashier
  await page.waitForFunction(() => /meena/.test(document.body.textContent));
  const meenaRow = await page.evaluate(() => [...document.querySelectorAll('tr[data-id]')].findIndex((r) => /meena/.test(r.textContent)) + 1);
  await page.focus(`tbody tr:nth-child(${meenaRow})`);
  assert.match(await page.textContent(`tbody tr:nth-child(${meenaRow})`), /Yes/);
  await page.keyboard.press('e');                                                                   // switch the right off
  await page.waitForFunction(() => /No\s*$/.test([...document.querySelectorAll('tr[data-id]')].find((r) => /meena/.test(r.textContent)).textContent));
  await shot(page, 'r1-users');
  await page.keyboard.press('Alt+5'); await page.waitForSelector('text=Backups are OFF');
  await page.keyboard.press('p'); await dialogType(page, 'correct horse'); await dialogType(page, 'correct horse');
  await page.waitForSelector('text=Backups are on');
  await page.keyboard.press('f'); await page.waitForFunction((d) => document.querySelector('.page').textContent.includes(d), backupDir);
  await page.keyboard.press('b'); await toast(page, 'Backed up');
  assert.match(await page.textContent('.page'), /Restore from a backup file \(O\)/);
  await shot(page, 'r2-backup-tab');
  const file = fs.readdirSync(backupDir).find((n) => n.endsWith('.cdbak'));
  assert.ok(file);
  await app.close();

  // ---- the new PC: empty, no users, no backup key; the backup file arrives on a USB stick ----
  const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-usb-'));
  fs.copyFileSync(path.join(backupDir, file), path.join(usb, 'from-old-pc.cdbak'));
  app = await launch({ CASHDESK_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'cd-new-')), CASHDESK_RESTORE_FILE: path.join(usb, 'from-old-pc.cdbak') });
  page = await app.firstWindow();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  await page.waitForSelector('.screen');
  assert.match(await page.textContent('.screen'), /Create the admin login/);
  assert.match(await page.textContent('.screen'), /Restore from a backup file/);
  await shot(page, 'r3-first-run');
  await page.keyboard.press('F9');
  await page.waitForSelector('.overlay input');                                                     // asks for the backup password
  assert.match(await page.textContent('.overlay'), /from-old-pc\.cdbak/);
  await page.keyboard.type('wrong password'); await page.keyboard.press('Enter');
  await toast(page, 'Wrong backup password');
  assert.match(await page.textContent('.screen'), /Create the admin login/);                        // nothing changed
  await page.keyboard.press('F9'); await dialogType(page, 'correct horse');
  await page.waitForFunction(() => { const h = document.querySelector('.entry h2'); return h && h.textContent === 'Sign in'; });                                                    // page reloads: the old users exist now
  await page.waitForSelector('#u'); await page.fill('#u', 'karthik'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  await page.keyboard.press('s'); await page.waitForSelector('.tabs');
  await page.keyboard.press('Alt+3'); await page.waitForSelector('tr[data-id]');
  assert.match(await page.textContent('.page'), /meena/);
  await page.keyboard.press('Alt+5');
  await page.waitForSelector('text=Backups are on');                                               // this PC makes backups with the same password straight away
  await shot(page, 'r4-restored');
  await app.close();
  console.log('Restore and permission UI smoke OK. Screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
