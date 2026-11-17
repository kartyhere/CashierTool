'use strict';
// Cash Desk page: setup, sign in, lock screen and the Gateway menu (Phase 1).
(function () {
  const { h } = window.CashDeskDom;
  const Keys = window.CashDeskKeys;
  const raw = window.cashdesk;
  // Saving on a new day while an earlier day is still open: an admin can go on by giving a reason, anyone else is told to close it.
  const guarded = (fn) => async (data) => {
    try { return await fn(data); } catch (e) {
      if (e.code !== 'EARLIER_OPEN' || !session || session.role !== 'admin') throw e;
      const reason = await promptDialog({ title: 'An earlier day is not closed', label: `${e.message} Reason to go on anyway (admin only):` });
      if (!reason || reason.trim().length < 3) throw e;
      return fn({ ...data, skipEarlierReason: reason });
    }
  };
  const api = {
    ...raw,
    cashIn: { ...raw.cashIn, save: guarded(raw.cashIn.save) }, voucher: { ...raw.voucher, save: guarded(raw.voucher.save) },
    deposit: { ...raw.deposit, save: guarded(raw.deposit.save) }, exchange: { ...raw.exchange, save: guarded(raw.exchange.save) },
    settle: { ...raw.settle, save: guarded(raw.settle.save) },
  };
  const root = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  const F = window.CashDeskFormat;
  const Screens = window.CashDeskScreens = {};
  const dialogs = new Set();   // open dialogs; the lock screen closes them
  let session = null;     // { username, role } once signed in
  let locked = false;
  let toastTimer = null;
  let lastPing = 0;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, Math.min(9000, 2500 + message.length * 40));
  }

  function setTheme(theme) { document.documentElement.dataset.theme = theme; }
  async function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { await api.appearance.set(next); } catch (e) { toast(e.message); }
  }

  const SUN = () => svg('M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z');
  const MOON = () => svg('M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z');
  function svg(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    el.append(p);
    return el;
  }
  const themeButton = () => h('button', { class: 'icon', type: 'button', title: 'Switch theme', 'aria-label': 'Switch theme', on: { click: toggleTheme } },
    document.documentElement.dataset.theme === 'dark' ? SUN() : MOON());

  function show(node) { root.replaceChildren(node); }

  // ---- Setup and sign in -------------------------------------------------------------------------------------
  function entryScreen({ title, hint, fields, submitLabel, onSubmit, extra = null }) {
    const error = h('div', { class: 'error', role: 'alert' });
    const inputs = fields.map((f) => h('input', { type: f.type, id: f.id, autocomplete: f.type === 'password' ? 'off' : 'username', spellcheck: 'false', data: { field: '1' } }));
    const submit = h('button', { class: 'primary', type: 'button' }, submitLabel);
    let busy = false;
    async function go() {
      if (busy) return;
      busy = true; submit.disabled = true; error.textContent = '';
      try { await onSubmit(inputs.map((i) => i.value)); }
      catch (e) {
        error.textContent = e.message;
        inputs.filter((i) => i.type === 'password').forEach((i) => { i.value = ''; });
        const first = inputs.find((i) => i.type === 'password') || inputs[0];
        first.focus();
      } finally { busy = false; submit.disabled = false; }
    }
    submit.addEventListener('click', go);
    const node = h('div', { class: 'screen entry' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'CASH DESK'), h('h1', {}, 'Cash Desk'), h('p', {}, 'Head-office cashier. Drawer, vouchers, deposits and day close in one place.')),
      h('form', { class: 'block card', on: { submit: (e) => e.preventDefault() } },
        h('h2', {}, title),
        hint ? h('p', { class: 'hint' }, hint) : null,
        fields.map((f, i) => h('label', { class: 'field' }, h('span', {}, f.label), inputs[i])),
        error,
        h('div', { class: 'row' }, submit),
        extra ? h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { type: 'button', on: { click: extra.onClick } }, `${extra.label} (${extra.key})`)) : null));
    show(node);
    Keys.setScreen({ root: node, onSubmit: go, hotkeys: extra ? { [extra.key]: () => { extra.onClick(); return true; } } : undefined });
    Keys.focusFirst(node);
  }

  function setupScreen() {
    entryScreen({
      title: 'Create the admin login',
      hint: 'First run. This login manages the app and other users. Use a PIN or password you will remember: there is no recovery.',
      fields: [
        { id: 'u', type: 'text', label: 'Username' },
        { id: 'p', type: 'password', label: 'Password or PIN' },
        { id: 'p2', type: 'password', label: 'Repeat password' },
      ],
      submitLabel: 'Create and sign in',
      extra: { label: 'New PC? Restore from a backup file', key: 'F9', onClick: () => restoreFromFile(false) },
      onSubmit: async ([u, p, p2]) => {
        if (p !== p2) throw new Error('The two passwords do not match.');
        const { user } = await api.auth.setup(u, p);
        enterGateway(user);
      },
    });
  }

  function signInScreen() {
    entryScreen({
      title: 'Sign in',
      fields: [
        { id: 'u', type: 'text', label: 'Username' },
        { id: 'p', type: 'password', label: 'Password or PIN' },
      ],
      submitLabel: 'Sign in',
      onSubmit: async ([u, p]) => {
        try {
          const { user } = await api.auth.signIn(u, p);
          enterGateway(user);
        } catch (e) { throw withWait(e); }
      },
    });
  }

  // Restore everything from a backup file (a new PC, a USB stick). Needs only the backup password.
  // On a fresh install (setup screen) there is nothing to replace, so no warning is shown.
  async function restoreFromFile(warn) {
    let pick;
    try { pick = await api.restore.chooseFile(); } catch (e) { toast(e.message); return; }
    if (pick.cancelled) return;
    if (warn && !await confirmDialog({ title: 'Replace ALL current data?', text: `Everything now in Cash Desk is replaced by ${pick.name}. A safety copy of the current data is made first. You will sign in again.`, yesLabel: 'Continue' })) return;
    const password = await promptDialog({ title: `Restore ${pick.name}`, label: 'Backup password', secret: true });
    if (password === null) return;
    try { await api.restore.run(password); toast('Restored. Opening again…'); } catch (e) { toast(e.message); }
  }

  const withWait = (e) => e; // the main process already words the wait ("Locked for 1 minute")

  // ---- Dialogs ----------------------------------------------------------------------------------------------
  // Yes / No box. lines: [[label, value], ...] shown under the title. Y or Enter on Yes, N or Esc to cancel.
  function confirmDialog({ title, text, lines = [], yesLabel = 'Yes' }) {
    return new Promise((resolve) => {
      const yes = h('button', { class: 'primary', type: 'button' }, yesLabel);
      const no = h('button', { type: 'button' }, 'No');
      const overlay = h('div', { class: 'overlay dim' }, h('div', { class: 'block dialog' },
        h('h2', {}, title), text ? h('p', {}, text) : null,
        lines.length ? h('div', { class: 'lines' }, lines.map(([k, v]) => h('div', {}, h('span', {}, k), h('span', {}, v)))) : null,
        h('div', { class: 'row card' }, yes, no)));
      const previous = document.activeElement;
      let done = false;
      function finish(answer) {
        if (done) return;
        done = true;
        dialogs.delete(cancel);
        Keys.setModal(null);
        overlay.remove();
        if (previous && previous.focus && document.contains(previous)) previous.focus();
        resolve(answer);
      }
      const cancel = () => finish(false);
      dialogs.add(cancel);
      yes.addEventListener('click', () => finish(true));
      no.addEventListener('click', () => finish(false));
      document.body.append(overlay);
      yes.focus();
      Keys.setModal({
        onKey(name) {
          if (name === 'Y') { finish(true); return true; }
          if (name === 'N' || name === 'Escape') { finish(false); return true; }
          if (name === 'ArrowLeft' || name === 'ArrowRight') { (document.activeElement === yes ? no : yes).focus(); return true; }
          return false; // Enter and Tab act on the focused button
        },
      });
    });
  }

  // One-line text box. Resolves with the text, or null when cancelled.
  function promptDialog({ title, label, value = '', digits = false, signed = false, secret = false }) {
    return new Promise((resolve) => {
      const input = h('input', { type: secret ? 'password' : 'text', autocomplete: 'off', value, inputmode: digits ? 'numeric' : null });
      if (digits) input.addEventListener('input', () => { const neg = signed && input.value.trim().startsWith('-'); input.value = (neg ? '-' : '') + F.digitsOnly(input.value).slice(0, 12); });
      const ok = h('button', { class: 'primary', type: 'button' }, 'Save');
      const no = h('button', { type: 'button' }, 'Cancel');
      const overlay = h('div', { class: 'overlay dim' }, h('div', { class: 'block dialog' }, h('h2', {}, title),
        h('label', { class: 'field' }, h('span', {}, label), input), h('div', { class: 'row card' }, ok, no)));
      const previous = document.activeElement;
      let done = false;
      function finish(answer) {
        if (done) return;
        done = true;
        dialogs.delete(cancel);
        Keys.setModal(null);
        overlay.remove();
        if (previous && previous.focus && document.contains(previous)) previous.focus();
        resolve(answer);
      }
      const cancel = () => finish(null);
      dialogs.add(cancel);
      ok.addEventListener('click', () => finish(input.value));
      no.addEventListener('click', () => finish(null));
      document.body.append(overlay);
      input.focus(); input.select();
      Keys.setModal({
        onKey(name) {
          if (name === 'Escape') { finish(null); return true; }
          if (name === 'Enter' && document.activeElement === input) { finish(input.value); return true; }
          return false;
        },
      });
    });
  }

  // ---- Gateway ----------------------------------------------------------------------------------------------
  // [key, label, function key, screen name or null (arrives in a later phase)]
  const MENU = [
    ['V', 'Voucher', 'F5', 'voucher'], ['I', 'Cash in', 'F6', 'cashin'], ['D', 'Bank deposit', 'F4', 'deposit'], ['X', 'Exchange', '', 'exchange'],
    ['T', 'Tally check', 'Ctrl+T', 'tally'], ['E', 'Entries', '', 'entries'], ['P', 'People', '', 'people'], ['C', 'Day close', '', 'dayclose'],
    ['R', 'Reports', '', 'reports'], ['S', 'Settings', '', 'settings'],
  ];

  function enterGateway(user) {
    session = user; locked = false;
    gateway();
    setTimeout(checkMorning, 600);
  }

  function open(screen) {
    if (screen === 'settings' && (!session || session.role !== 'admin')) { toast('Only an admin can open Settings'); return; }
    Screens[screen].open();
  }

  async function gateway() {
    let dash = null;
    try { dash = await api.dashboard.get(); } catch (e) { toast(e.message); }
    const menu = h('div', { class: 'menu', role: 'menu' },
      MENU.map(([key, label, fkey, screen], i) => h('button', {
        type: 'button', class: screen ? '' : 'soon', role: 'menuitem', data: { menuItem: '1', key },
        on: { click: () => (screen ? open(screen) : toast(`${label} arrives in a later phase`)) },
      }, h('span', { class: 'num' }, String(i + 1).padStart(2, '0')), label, h('span', { class: 'key' }, fkey || key))));

    const side = h('div', { class: 'dash' });
    if (dash) {
      if (dash.clockBehind) side.append(h('div', { class: 'banner bad' }, "This PC's date is earlier than the last entry. Fix the Windows date and time before adding entries."));
      if (dash.backupOff && session && session.role === 'admin') {
        side.append(h('div', { class: 'banner' }, h('span', {}, 'Backups are off. Set a backup password so the data can be restored.'),
          h('button', { type: 'button', on: { click: () => Screens.settings.open('backup') } }, 'Settings (S)')));
      }
      if (dash.earlierOpen) {
        side.append(h('div', { class: 'banner bad' }, h('span', {}, `${dash.earlierOpen} is not closed yet. Close it before new entries.`),
          h('button', { type: 'button', on: { click: () => open('dayclose') } }, 'Day close (C)')));
      }
      if (dash.unsplit) {
        side.append(h('div', { class: 'banner' }, h('span', {}, `${dash.unsplit} voucher${dash.unsplit === 1 ? ' is' : 's are'} not split into expenses yet.`),
          h('button', { type: 'button', on: { click: () => open('entries') } }, 'Entries (E)')));
      }
      if (dash.depositDue) {
        side.append(h('div', { class: 'banner' }, h('span', {}, `Cash is ${F.inr(dash.drawer.total)}. A bank deposit of about ${F.inr(dash.depositDue)} is due.`),
          h('button', { type: 'button', on: { click: () => open('deposit') } }, 'Deposit (D)')));
      }
      if (!dash.hasOpening) {
        side.append(h('div', { class: 'banner' }, h('span', {}, 'The drawer has no opening count yet.'),
          h('button', { type: 'button', on: { click: () => open('opening') } }, 'Enter it (O)')));
      }
      const f = dash.figures;
      side.append(
        h('div', { class: 'block panel' }, h('h3', {}, `Drawer now · ${dash.day}`),
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'Count'), h('th', { class: 'n' }, 'Amount'))),
            h('tbody', {}, dash.drawer.rows.map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: 'n' }, String(r.qty)), h('td', { class: 'n' }, F.inr(r.amount)))),
              h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', {}), h('td', { class: 'n' }, F.inr(dash.drawer.total)))))),
        h('div', { class: 'figures' },
          [['Opening', f.opening], ['Receipts', f.receipts], ['Payments', f.payments], ['Deposits', f.deposits], ['Closing', f.closing]]
            .map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, F.inr(v))))),
        dash.banks.length ? h('div', { class: 'figures' }, dash.banks.map((b) => h('div', {}, h('span', {}, b.name), h('b', {}, F.inr(b.balance))))) : null);
    }

    const node = h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('span', { class: 'who' }, `Signed in: ${session.username}`),
        h('div', { class: 'tools' },
          h('button', { type: 'button', on: { click: lockNow } }, 'Lock'),
          themeButton(),
          h('button', { type: 'button', on: { click: askSignOut } }, 'Sign out'))),
      h('div', { class: 'gateway' }, h('h1', {}, 'Gateway'), menu, side),
      h('div', { class: 'statusbar' }, h('span', {}, 'Enter open'), h('span', {}, 'Letter jump'), h('span', {}, 'F6 cash in'), h('span', {}, 'Esc sign out'), h('span', {}, 'Ctrl+L lock')));
    show(node);
    const hotkeys = {
      'Ctrl+L': lockNow,
      F5: () => open('voucher'),
      F4: () => open('deposit'),
      F6: () => open('cashin'),
    };
    if (dash && !dash.hasOpening) hotkeys.O = () => open('opening');
    Keys.setScreen({ root: node, menu: { root: node }, onEsc: askSignOut, hotkeys });
    node.querySelector('[data-menu-item]').focus();
  }

  async function askSignOut() {
    if (!await confirmDialog({ title: 'Sign out?', text: 'Press Y to sign out, N to stay.' })) return;
    try { await api.auth.signOut(); } catch (e) { /* already signed out */ }
    session = null; signInScreen();
  }

  // ---- Morning check: from 9:15 the app asks for Tally's balance for the last working day, and again every 30 minutes ----
  let morningOpen = false;
  function morningDialog(st) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Tally closing balance' });
      input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, 12); });
      const save = h('button', { class: 'primary', type: 'button' }, 'Save');
      const later = h('button', { type: 'button' }, 'Later');
      const error = h('div', { class: 'error', role: 'alert' });
      const overlay = h('div', { class: 'overlay dim' }, h('div', { class: 'block dialog' },
        h('h2', {}, 'Morning check'), h('p', {}, `Last working day: ${st.lastDay}${st.closedDay ? ' (closed, counted)' : ' (not closed)'}. Compare with Tally.`),
        h('div', { class: 'lines' }, [['Opening', st.opening], ['Receipts', st.receipts], ['Payments and deposits', st.outgo], ['Closing cash', st.closing]].map(([k, v]) => h('div', {}, h('span', {}, k), h('span', {}, F.inr(v))))),
        h('label', { class: 'field' }, h('span', {}, 'Tally closing balance (₹)'), input), error, h('div', { class: 'row card' }, save, later)));
      const previous = document.activeElement;
      let done = false;
      function finish() { if (done) return; done = true; dialogs.delete(cancel); Keys.setModal(null); overlay.remove(); if (previous && previous.focus && document.contains(previous)) previous.focus(); resolve(); }
      const cancel = () => { api.morning.snooze().catch(() => {}); finish(); };
      dialogs.add(cancel);
      async function submit() {
        if (!input.value) { error.textContent = 'Enter the Tally balance.'; return; }
        try {
          const r = await api.morning.done({ tallyBalance: Number(input.value) });
          toast(r.difference === 0 ? 'Matches Tally' : `App is ${F.inr(Math.abs(r.difference))} ${r.difference > 0 ? 'more' : 'less'} than Tally`);
          finish();
        } catch (e) { error.textContent = e.message; }
      }
      save.addEventListener('click', submit);
      later.addEventListener('click', () => { api.morning.snooze().catch(() => {}); finish(); });
      document.body.append(overlay);
      input.focus();
      Keys.setModal({ onKey(name) {
        if (name === 'Enter' && document.activeElement === input) { submit(); return true; }
        if (name === 'Escape') { api.morning.snooze().catch(() => {}); finish(); return true; }
        return false;
      } });
    });
  }
  async function checkMorning() {
    if (!session || locked || morningOpen || dialogs.size) return;
    let st;
    try { st = await api.morning.status(); } catch (e) { return; }
    if (!st.due) return;
    morningOpen = true;
    try { await morningDialog(st); } finally { morningOpen = false; }
  }
  setInterval(checkMorning, 30000);

  // Tally check from anywhere with Ctrl+T (not in the middle of a voucher).
  Keys.setGlobals({
    'Ctrl+T': () => {
      if (!session || locked) return false;
      if (Keys.isDirty()) { toast('Finish or leave this entry first (Esc), then press Ctrl+T'); return true; }
      open('tally');
      return true;
    },
  });

  window.CashDeskApp = {
    api, h, Keys, F, show, toast, gateway, confirmDialog, promptDialog, themeButton, restoreFromFile,
    session: () => session,
  };

  // ---- Lock screen ------------------------------------------------------------------------------------------
  let lockOverlay = null;
  async function lockNow() { try { await api.auth.lock(); } catch (e) { toast(e.message); return; } showLock(); }

  function showLock() {
    if (locked || !session) return;
    locked = true;
    for (const cancel of [...dialogs]) cancel();
    const error = h('div', { class: 'error', role: 'alert' });
    const input = h('input', { type: 'password', autocomplete: 'off', data: { field: '1' } });
    const unlockBtn = h('button', { class: 'primary', type: 'button' }, 'Unlock');
    const outBtn = h('button', { type: 'button' }, 'Sign out');
    async function unlock() {
      unlockBtn.disabled = true; error.textContent = '';
      try { await api.auth.unlock(input.value); Keys.setModal(null); lockOverlay.remove(); lockOverlay = null; locked = false; }
      catch (e) { error.textContent = withWait(e).message; input.value = ''; input.focus(); }
      finally { unlockBtn.disabled = false; }
    }
    async function out() {
      Keys.setModal(null); lockOverlay.remove(); lockOverlay = null; locked = false;
      try { await api.auth.signOut(); } catch (e) { /* ignore */ }
      session = null; signInScreen();
    }
    unlockBtn.addEventListener('click', unlock);
    outBtn.addEventListener('click', out);
    lockOverlay = h('div', { class: 'overlay' },
      h('div', { class: 'block dialog' }, h('h2', {}, 'Locked'), h('p', {}, `${session.username}, enter your password to continue.`),
        h('label', { class: 'field' }, h('span', {}, 'Password or PIN'), input), error, h('div', { class: 'row card' }, unlockBtn, outBtn)));
    document.body.append(lockOverlay);
    input.focus();
    Keys.setModal({
      onKey(name) {
        if (name === 'Enter' && document.activeElement === input) { unlock(); return true; }
        return false;
      },
    });
  }

  // ---- Activity reporting for auto-lock ---------------------------------------------------------------------
  function ping() {
    if (!session || locked) return;
    const now = Date.now();
    if (now - lastPing < 5000) return;
    lastPing = now;
    api.auth.touch().catch(() => {});
  }
  ['keydown', 'mousedown', 'mousemove', 'wheel'].forEach((t) => document.addEventListener(t, ping, true));
  api.onLocked(() => showLock());

  // ---- Start ------------------------------------------------------------------------------------------------
  (async function start() {
    try {
      const { theme } = await api.appearance.get();
      setTheme(theme);
      const status = await api.auth.status();
      if (status.setupRequired) setupScreen();
      else if (status.signedIn) { session = status.user; gateway(); if (status.locked) showLock(); }
      else signInScreen();
    } catch (e) {
      show(h('div', { class: 'screen entry' }, h('div', { class: 'block card' }, h('h2', {}, 'Cash Desk cannot start'), h('p', { class: 'error' }, e.message))));
    }
  })();
})();
