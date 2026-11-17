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

function registerIpc({ ipcMain, guard, auth, ledger, repo, store, appInfo, onThemeChange = () => {}, log = (e) => console.error(e) }) {
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
  handle('people.search', 'unlocked', (p) => ledger.searchPeople(p));
  handle('people.save', 'unlocked', (p) => ledger.savePerson(p));
  handle('people.history', 'unlocked', (p) => ledger.personHistory(p));
  handle('voucher.preview', 'unlocked', (p) => ledger.previewVoucher(p));
  handle('voucher.save', 'unlocked', (p) => ledger.saveVoucher(p));
  handle('settle.save', 'unlocked', (p) => ledger.saveSettle(p));
  handle('lists.get', 'unlocked', () => ledger.lists());
  handle('lists.save', 'unlocked', (p) => ledger.saveListItem(p));
}

module.exports = { registerIpc, THEMES };
