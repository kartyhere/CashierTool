'use strict';
// Cash Desk page: setup, sign in, lock screen and the Gateway menu (Phase 1).
(function () {
  const { h } = window.CashDeskDom;
  const Keys = window.CashDeskKeys;
  const api = window.cashdesk;
  const root = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  let session = null;     // { username, role } once signed in
  let locked = false;
  let toastTimer = null;
  let lastPing = 0;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
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
  function entryScreen({ title, hint, fields, submitLabel, onSubmit }) {
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
        h('div', { class: 'row' }, submit)));
    show(node);
    Keys.setScreen({ root: node, onSubmit: go });
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

  const withWait = (e) => e; // the main process already words the wait ("Locked for 1 minute")

  // ---- Gateway ----------------------------------------------------------------------------------------------
  const MENU = [
    ['V', 'Voucher', 'F5', 2], ['I', 'Cash in', 'F6', 2], ['D', 'Bank deposit', 'F4', 3], ['X', 'Exchange', '', 3],
    ['T', 'Tally check', 'Ctrl+T', 4], ['E', 'Entries', '', 2], ['P', 'People', '', 2], ['C', 'Day close', '', 4],
    ['R', 'Reports', '', 5], ['S', 'Settings', '', 6],
  ];

  function enterGateway(user) {
    session = user; locked = false;
    gateway();
  }

  function gateway() {
    const menu = h('div', { class: 'menu', role: 'menu' },
      MENU.map(([key, label, fkey, phase], i) => h('button', {
        type: 'button', class: 'soon', role: 'menuitem', data: { menuItem: '1', key },
        on: { click: () => toast(`${label} arrives in a later phase`) },
      }, h('span', { class: 'num' }, String(i + 1).padStart(2, '0')), label, h('span', { class: 'key' }, fkey || key))));
    const node = h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('span', { class: 'who' }, `Signed in: ${session.username}`),
        h('div', { class: 'tools' },
          h('button', { type: 'button', on: { click: lockNow } }, 'Lock'),
          themeButton(),
          h('button', { type: 'button', on: { click: askSignOut } }, 'Sign out'))),
      h('div', { class: 'gateway' }, h('h1', {}, 'Gateway'), menu),
      h('div', { class: 'statusbar' }, h('span', {}, 'Enter open'), h('span', {}, 'Letter jump'), h('span', {}, 'Esc sign out'), h('span', {}, 'Ctrl+L lock')));
    show(node);
    Keys.setScreen({
      root: node, menu: { root: node },
      onEsc: askSignOut,
      hotkeys: { 'Ctrl+L': lockNow, 'F5': () => toast('Voucher arrives in a later phase'), 'F6': () => toast('Cash in arrives in a later phase'), 'F4': () => toast('Bank deposit arrives in a later phase') },
    });
    node.querySelector('[data-menu-item]').focus();
  }

  function askSignOut() {
    const yes = h('button', { class: 'primary', type: 'button', on: { click: close } }, 'Yes');
    const no = h('button', { type: 'button', on: { click: () => closeModal() } }, 'No');
    const overlay = h('div', { class: 'overlay dim' }, h('div', { class: 'block dialog' }, h('h2', {}, 'Sign out?'), h('p', {}, 'Press Y to sign out, N to stay.'), h('div', { class: 'row card' }, yes, no)));
    const previous = document.activeElement;
    document.body.append(overlay);
    yes.focus();
    function closeModal() { Keys.setModal(null); overlay.remove(); if (previous && previous.focus) previous.focus(); }
    async function close() {
      Keys.setModal(null); overlay.remove();
      try { await api.auth.signOut(); } catch (e) { /* already signed out */ }
      session = null; signInScreen();
    }
    Keys.setModal({
      onKey(name) {
        if (name === 'Y') { close(); return true; }
        if (name === 'N' || name === 'Escape') { closeModal(); return true; }
        if (name === 'ArrowLeft' || name === 'ArrowRight') { (document.activeElement === yes ? no : yes).focus(); return true; }
        return false; // Enter/Tab fall through to the focused button
      },
    });
  }

  // ---- Lock screen ------------------------------------------------------------------------------------------
  let lockOverlay = null;
  async function lockNow() { try { await api.auth.lock(); } catch (e) { toast(e.message); return; } showLock(); }

  function showLock() {
    if (locked || !session) return;
    locked = true;
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
