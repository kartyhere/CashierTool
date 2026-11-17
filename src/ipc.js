'use strict';
// Every call the page can make into the main process, in one place.
//
// Each handler answers with an envelope, never a thrown error, so the page gets clean messages and codes:
//   { ok: true, data }   or   { ok: false, code, message, ...extra }
// The preload turns the envelope back into a resolved value or a rejected Error.
//
// access: 'open'    no sign-in needed (sign-in screen, theme)
//         'session' signed in, may be locked (unlock, sign out, activity)
//         'unlocked' signed in and not locked (everything else)
const { assertPlain } = require('./security/guard');
const { UserError } = require('./errors');

const THEMES = ['dark', 'light'];

function describe(error, log) {
  if (error instanceof UserError) {
    const out = { ok: false, code: error.code, message: error.message };
    if (error.until) out.until = error.until;
    if (error.triesLeft !== undefined) out.triesLeft = error.triesLeft;
    return out;
  }
  log(error); // a bug or an attack: details stay in the log, the page gets nothing it could use
  return { ok: false, code: 'ERROR', message: 'Something went wrong. Nothing was changed.' };
}

function registerIpc({ ipcMain, guard, auth, ledger, repo, store, appInfo, onThemeChange = () => {}, chooseSavePath = async () => null, chooseFolder = async () => null, chooseBackupFile = async () => null, backups = null, afterRestore = () => {}, log = (e) => console.error(e) }) {
  function handle(channel, access, fn) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        guard.assertSender(event);
        assertPlain(payload);
        if (access === 'session') auth.requireSession({ allowLocked: true });
        else if (access === 'unlocked') auth.requireSession();
        return { ok: true, data: await fn(payload === undefined || payload === null ? {} : payload) };
      } catch (error) {
        return describe(error, log);
      }
    });
  }

  handle('app.info', 'open', () => ({ name: appInfo.name, version: appInfo.version }));

  handle('appearance.get', 'open', () => ({ theme: repo.getSetting('theme', 'dark') }));
  handle('appearance.set', 'open', ({ theme }) => {
    if (!THEMES.includes(theme)) throw new UserError('Unknown theme.');
    store.transaction(() => repo.setSetting('theme', theme), { defer: true });
    onThemeChange(theme);
    return { theme };
  });

  handle('auth.status', 'open', () => auth.status());
  handle('auth.setup', 'open', (p) => ({ user: auth.setup(p) }));
  handle('auth.signIn', 'open', (p) => ({ user: auth.signIn(p) }));
  handle('auth.signOut', 'session', () => { auth.signOut(); return {}; });
  handle('auth.lock', 'unlocked', () => { auth.lock('manual'); return {}; });
  handle('auth.unlock', 'session', (p) => { auth.unlock(p); return {}; });
  handle('auth.changePassword', 'unlocked', (p) => { auth.changePassword(p); return {}; });
  handle('auth.touch', 'session', () => { auth.touch(); return {}; });

  handle('dashboard.get', 'unlocked', () => ledger.dashboard());
  handle('opening.save', 'unlocked', (p) => ledger.saveOpening(p));
  handle('cashin.save', 'unlocked', (p) => ledger.saveCashIn(p));
  handle('entries.list', 'unlocked', (p) => ledger.entries(p));
  handle('entry.delete', 'unlocked', (p) => ledger.deleteEntry(p));
  handle('entry.editVoucher', 'unlocked', (p) => ledger.editVoucherSplit(p));
  handle('people.search', 'unlocked', (p) => ledger.searchPeople(p));
  handle('people.save', 'unlocked', (p) => ledger.savePerson(p));
  handle('people.history', 'unlocked', (p) => ledger.personHistory(p));
  handle('voucher.preview', 'unlocked', (p) => ledger.previewVoucher(p));
  handle('voucher.save', 'unlocked', (p) => ledger.saveVoucher(p));
  handle('settle.save', 'unlocked', (p) => ledger.saveSettle(p));
  handle('deposit.suggest', 'unlocked', () => ledger.suggestDeposit());
  handle('deposit.save', 'unlocked', (p) => ledger.saveDeposit(p));
  handle('exchange.save', 'unlocked', (p) => ledger.saveExchange(p));
  handle('tally.check', 'unlocked', (p) => ledger.tallyCheck(p));
  handle('tally.list', 'unlocked', (p) => ledger.tallyList(p));
  handle('day.info', 'unlocked', (p) => ledger.dayInfo(p));
  handle('day.close', 'unlocked', (p) => {
    const r = ledger.closeDay(p);
    // The backup is made after the close is saved. If it fails the day stays closed and the page is told.
    return backups ? { ...r, backup: backups.auto('day close') } : r;
  });
  handle('day.reopen', 'unlocked', (p) => ledger.reopenDay(p));
  handle('morning.status', 'unlocked', () => ledger.morningStatus());
  handle('morning.done', 'unlocked', (p) => ledger.morningDone(p));
  handle('morning.snooze', 'unlocked', () => ledger.morningSnooze());
  handle('report.list', 'unlocked', () => ledger.reportList());
  handle('report.run', 'unlocked', (p) => ledger.runReport(p));
  // Export: the report is built again here (never trusting what the page shows), then the person picks where it goes.
  handle('report.export', 'unlocked', async (p) => {
    const format = p.format;
    if (format !== 'pdf' && format !== 'xlsx') throw new UserError('Choose PDF or Excel.');
    const report = ledger.runReport(p);
    const target = await chooseSavePath({ defaultName: `${report.fileName}.${format}`, format, folder: repo.getSetting('export_folder', null) });
    if (!target) return { cancelled: true };
    const bytes = format === 'pdf' ? require('./export/pdf').toPdf(report) : await require('./export/xlsx').toXlsx(report);
    require('node:fs').writeFileSync(target, bytes);
    store.transaction(() => repo.setSetting('export_folder', require('node:path').dirname(target)), { defer: true });
    return { path: target };
  });
  handle('settings.get', 'unlocked', () => ledger.settingsGet());
  handle('settings.save', 'unlocked', (p) => ledger.settingsSave(p));
  handle('users.list', 'unlocked', () => ledger.usersList());
  handle('users.save', 'unlocked', (p) => ledger.userSave(p));
  handle('denominations.list', 'unlocked', () => ledger.denominationsList());
  handle('denominations.hide', 'unlocked', (p) => ledger.denominationHide(p));
  const needBackups = () => { if (!backups) throw new UserError('Backups are not available.'); return backups; };
  handle('backup.status', 'unlocked', () => { auth.requireRole('admin'); return needBackups().status(); });
  handle('backup.setPassword', 'unlocked', (p) => { auth.requireRole('admin'); needBackups().setPassword(p.password); return needBackups().status(); });
  handle('backup.now', 'unlocked', () => { auth.requireRole('admin'); return needBackups().create('manual'); });
  handle('backup.chooseFolder', 'unlocked', async () => {
    auth.requireRole('admin');
    const dir = await chooseFolder({ current: needBackups().folder() });
    if (!dir) return { cancelled: true };
    needBackups().setFolder(dir);
    return { folder: dir };
  });
  handle('backup.restore', 'unlocked', (p) => {
    auth.requireRole('admin');
    const r = needBackups().restore({ name: p.name, password: p.password });
    auth.signOut();
    afterRestore();
    return r;
  });
  // Restore from a backup file. Allowed for a signed-in admin, or on a fresh install with no users yet (a new PC).
  const restoreAllowed = () => { if (repo.countUsers() > 0) auth.requireRole('admin'); };
  handle('restore.chooseFile', 'open', async () => {
    restoreAllowed();
    const file = await chooseBackupFile({ folder: needBackups().folder() });
    if (!file) return { cancelled: true };
    return needBackups().pick(file);
  });
  handle('restore.run', 'open', (p) => {
    restoreAllowed();
    const r = needBackups().restoreFile({ password: p.password });
    if (auth.session) auth.signOut();
    afterRestore();
    return r;
  });
  handle('lists.get', 'unlocked', () => ledger.lists());
  handle('lists.save', 'unlocked', (p) => ledger.saveListItem(p));
}

module.exports = { registerIpc, THEMES };
