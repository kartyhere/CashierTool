'use strict';
// Makes the README screenshots from DUMMY data only (invented names and amounts). Run:
//   NODE_PATH=<playwright-core> xvfb-run -a node scripts/demo-shots.cjs
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screens');
fs.mkdirSync(out, { recursive: true });

const testKeystore = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`TEST:${t}`), decryptString: (b) => b.toString().replace(/^TEST:/, '') };

async function seed(dir) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) });
  const { createVault } = require('../src/security/vault'); const { Store } = require('../src/db/store'); const { createRepo } = require('../src/db/repo');
  const { AuthService } = require('../src/auth/service'); const { LedgerService } = require('../src/ledger/service');
  const vault = createVault({ userDataDir: dir, safeStorage: testKeystore });
  let shift = -86400000; // yesterday first
  const store = Store.open({ SQL, vault, now: () => new Date(Date.now() + shift) });
  const repo = createRepo(store); const auth = new AuthService({ store, repo }); const L = new LedgerService({ store, repo, auth });
  auth.setup({ username: 'demo', password: '1234' });
  L.saveOpening({ pieces: { N500: 30, N200: 20, N100: 60, N50: 40, N20: 50, N10: 60, C20: 10, C10: 20, C5: 20, C2: 20, C1: 40 } });
  const exp = Object.fromEntries(L.lists().expenseTypes.map((e) => [e.name, e.id]));
  const ravi = L.savePerson({ name: 'Ravi Kumar', department: 'Sales' }).id;
  const meena = L.savePerson({ name: 'Meena Iyer', department: 'Stores' }).id;
  L.savePerson({ name: 'Arun Das', department: 'Accounts' });
  L.saveCashIn({ source: 'customer', partyName: 'Sharma Traders', pieces: { N500: 12, N100: 10 } });
  const pay = (id, amount, lines) => { const p = L.previewVoucher({ personId: id, amount }); L.saveVoucher({ personId: id, amount, give: p.candidates[0].breakups[0], lines }); };
  pay(ravi, 1244, [{ expenseTypeId: exp.Travel, amount: 900 }, { expenseTypeId: exp.Food, amount: 344 }]);
  pay(meena, 560, [{ expenseTypeId: exp.Stationery, amount: 560 }]);
  L.saveDeposit({ bankAccountId: L.lists().banks[0].id, pieces: { N500: 10 }, reference: 'SL-1042' });
  const info = L.dayInfo();
  L.closeDay({ day: info.day, counted: Object.fromEntries(info.expected.map((d) => [d.id, d.expected])), tallyBalance: info.expectedTotal });
  shift = 0; // today
  const branch = L.saveListItem({ list: 'branches', name: 'Mysore' }).id;
  L.saveCashIn({ source: 'branch', branchId: branch, pieces: { N500: 8, N200: 5 } });
  pay(ravi, 350, [{ expenseTypeId: exp.Fuel, amount: 350 }]);
  store.close();
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-demo-'));
  await seed(userData);
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CASHDESK_USER_DATA: userData, CASHDESK_TEST_KEYSTORE: '1' } });
  const page = await app.firstWindow();
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  const settle = () => page.waitForTimeout(500);
  await page.waitForSelector('#u');
  await page.fill('#u', 'demo'); await page.fill('#p', '1234'); await page.keyboard.press('Enter');
  await page.waitForSelector('.menu');
  if (await page.locator('.overlay h2').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await settle(); await shot('gateway-dark');

  await page.keyboard.press('v'); await page.waitForSelector('input'); await page.keyboard.type('rav'); await settle(); await shot('voucher-person-dark');
  await page.keyboard.press('Enter'); await page.keyboard.type('244'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); await shot('voucher-payout-dark');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  while (!(await page.locator('.menu').count())) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); if (await page.locator('.overlay h2').count()) await page.keyboard.press('y'); }

  await page.keyboard.press('Control+t'); await page.waitForSelector('input[aria-label="Tally balance"]'); await settle(); await shot('tally-dark'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('c'); await page.waitForSelector('table.grid'); await page.keyboard.press('Alt+e'); await settle(); await shot('dayclose-dark'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('r'); await page.waitForSelector('select[aria-label="Report"]'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForSelector('.reportview table'); await settle(); await shot('reports-dark'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('s'); await page.waitForSelector('input[data-key="rounding_step"]'); await settle(); await shot('settings-dark'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');

  await page.click('button[title="Switch theme"]'); await settle(); await shot('gateway-light');
  await page.keyboard.press('c'); await page.waitForSelector('table.grid'); await page.keyboard.press('Alt+e'); await settle(); await shot('dayclose-light'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('r'); await page.waitForSelector('select[aria-label="Report"]');
  await page.selectOption('select[aria-label="Report"]', 'denomination'); await page.click('button.primary'); await page.waitForSelector('.reportview table'); await settle(); await shot('reports-light'); await page.keyboard.press('Escape'); await page.waitForSelector('.menu');
  await page.keyboard.press('s'); await page.waitForSelector('input[data-key="rounding_step"]'); await page.keyboard.press('Alt+5'); await page.waitForSelector('text=Backups are OFF'); await settle(); await shot('backup-light');
  await app.close();
  console.log('Screens in', out, fs.readdirSync(out).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
