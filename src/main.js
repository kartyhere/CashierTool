'use strict';
// Cash Desk main process: one window, one database, one preload.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, powerMonitor, safeStorage, session } = require('electron');

const { createVault } = require('./security/vault');
const { createGuard } = require('./security/guard');
const { Store } = require('./db/store');
const { createRepo } = require('./db/repo');
const { AuthService } = require('./auth/service');
const { LedgerService } = require('./ledger/service');
const { BackupService } = require('./backup/service');
const { registerIpc } = require('./ipc');

const APP_ID = 'com.karthik.cashdesk';
const BACKGROUND = { dark: '#121316', light: '#f2f1ee' };

// Test hooks. They only work in an unpackaged run (npm start), never in the built .exe.
if (!app.isPackaged && process.env.CASHDESK_USER_DATA) app.setPath('userData', process.env.CASHDESK_USER_DATA);
// Tests can move the app's clock (unpackaged runs only), to see a morning check without waiting for tomorrow.
const clockOffset = !app.isPackaged ? Number(process.env.CASHDESK_CLOCK_OFFSET_MS || 0) || 0 : 0;
const useTestKeystore = !app.isPackaged && process.env.CASHDESK_TEST_KEYSTORE === '1';

// Stand-in for Windows account storage, for running the app on a machine that has none (tests on Linux).
const testKeystore = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`TEST:${text}`),
  decryptString: (bytes) => bytes.toString().replace(/^TEST:/, ''),
};

let mainWindow = null;
let store = null;
let backups = null;
let idleTimer = null;

function fatal(title, error) {
  dialog.showErrorBox(title, error && error.message ? error.message : String(error));
  app.exit(1);
}

async function openStore(userDataDir) {
  const vault = createVault({ userDataDir, safeStorage: useTestKeystore ? testKeystore : safeStorage });
  const initSqlJs = require('sql.js');
  const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
  const SQL = await initSqlJs({ wasmBinary });
  return Store.open({ SQL, vault, now: () => new Date(Date.now() + clockOffset) });
}

function createWindow(repo) {
  const theme = repo.getSetting('theme', 'dark');
  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: BACKGROUND[theme] || BACKGROUND.dark,
    title: 'Cash Desk',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const reveal = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.maximize();
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', reveal);
  setTimeout(reveal, 8000).unref();
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function tellPageLocked() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cashdesk:locked');
}

async function boot() {
  Menu.setApplicationMenu(null); // no menu: no reload or developer-tools shortcuts, and the function keys stay ours
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  const guard = createGuard({ appRoot: __dirname, page: 'ui/index.html' });
  app.on('web-contents-created', (_event, contents) => guard.protectContents(contents, { isPackaged: app.isPackaged }));
  guard.protectSession(session.defaultSession);

  try {
    store = await openStore(app.getPath('userData'));
  } catch (error) {
    fatal('Cash Desk cannot open its data', error);
    return;
  }
  const repo = createRepo(store);
  const auth = new AuthService({ store, repo });
  const ledger = new LedgerService({ store, repo, auth });
  const keystore = useTestKeystore ? testKeystore : safeStorage;
  backups = new BackupService({ store, repo, safeStorage: keystore, userDataDir: app.getPath('userData'),
    defaultDir: path.join(app.getPath('userData'), 'backups'), now: () => new Date(Date.now() + clockOffset) });

  nativeTheme.themeSource = repo.getSetting('theme', 'dark');
  registerIpc({
    ipcMain, guard, auth, ledger, repo, store,
    appInfo: { name: app.getName(), version: app.getVersion() },
    onThemeChange: (theme) => { nativeTheme.themeSource = theme; },
    backups,
    chooseFolder: async ({ current }) => {
      if (!app.isPackaged && process.env.CASHDESK_BACKUP_DIR) return process.env.CASHDESK_BACKUP_DIR; // tests
      const r = await dialog.showOpenDialog(mainWindow, { title: 'Backup folder', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    },
    afterRestore: () => setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 400),
    chooseSavePath: async ({ defaultName, format, folder }) => {
      // Tests (unpackaged only) save into a folder instead of opening the Windows save box.
      if (!app.isPackaged && process.env.CASHDESK_EXPORT_DIR) return require('node:path').join(process.env.CASHDESK_EXPORT_DIR, defaultName);
      const r = await dialog.showSaveDialog(mainWindow, {
        title: 'Save report', defaultPath: require('node:path').join(folder || app.getPath('documents'), defaultName),
        filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Excel', extensions: ['xlsx'] }],
      });
      return r.canceled ? null : r.filePath;
    },
  });

  // Lock after idle time (the page reports activity), and when Windows itself is locked or goes to sleep.
  idleTimer = setInterval(() => { if (auth.checkIdle()) tellPageLocked(); }, 5000);
  const lockNow = () => { try { auth.lock('manual'); tellPageLocked(); } catch { /* nobody signed in */ } };
  powerMonitor.on('lock-screen', lockNow);
  powerMonitor.on('suspend', lockNow);

  createWindow(repo);
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would overwrite the first one's data file. The first copy comes to the front instead.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(boot).catch((error) => fatal('Cash Desk cannot start', error));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (idleTimer) clearInterval(idleTimer);
    if (backups && store) backups.auto('quit'); // a failed backup never stops the app from closing
    try { if (store) store.close(); } catch (error) { console.error('Could not save on exit:', error); }
  });
}
