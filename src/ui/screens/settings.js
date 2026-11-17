'use strict';
// Settings (admin only): General, Lists, Users, Denominations, Backup. Alt+Left / Alt+Right (or Alt+1 to 5) switch tab.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page } = window.CashDeskShared;

  const TABS = [['general', 'General'], ['lists', 'Lists'], ['users', 'Users'], ['denoms', 'Notes and coins'], ['backup', 'Backup']];
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

  // where: 'tabs' puts the cursor on the tab bar (so Left / Right change tab); 'content' puts it in the page itself
  // (used after an action inside a tab, e.g. adding a user).
  async function open(tabKey = 'general', where = 'tabs') {
    if (tabKey === 'lists') { window.CashDeskScreens.lists.open(); return; }
    const index = TABS.findIndex(([k]) => k === tabKey);
    const go = (i) => { open(TABS[(i + TABS.length) % TABS.length][0]); return true; };
    const hotkeys = { 'Alt+ArrowLeft': () => go(index - 1), 'Alt+ArrowRight': () => go(index + 1), 'Alt+ArrowUp': () => { focusTab(); return true; } };
    TABS.forEach(([k], i) => { hotkeys[`Alt+${i + 1}`] = () => go(i); });
    const tabs = h('div', { class: 'tabs' }, TABS.map(([k, label], i) => h('button', { type: 'button', class: k === tabKey ? 'on' : '', on: { click: () => go(i) } }, `${i + 1} ${label}`)));
    const focusTab = () => tabs.querySelector('.on').focus();
    let body = null;
    // On the tab bar: Left / Right change tab, Down or Enter go into the page.
    tabs.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); if (body) Keys.focusFirst(body); }
    });
    const done = (node, hints, extra = {}) => {
      body = node;
      A.show(page({ title: `Settings · ${TABS[index][1]}`, hints: [...hints, 'Tabs: ← → switch, ↓ in, Alt+↑ back', 'Esc back'], body: [tabs, node] }));
      Keys.setScreen({ root: document.querySelector('.screen'), onEsc: () => A.gateway(), hotkeys: { ...hotkeys, ...(extra.hotkeys || {}) }, ...(extra.screen || {}), menu: extra.menu ? { root: document.querySelector('.screen') } : undefined });
      if (where === 'content') Keys.focusFirst(node); else focusTab();
    };

    try {
      if (tabKey === 'general') await general(done);
      else if (tabKey === 'users') await users(done, open);
      else if (tabKey === 'denoms') await denoms(done, open);
      else await backup(done, open);
    } catch (e) { A.toast(e.message); A.gateway(); }
  }

  async function general(done) {
    const { fields } = await api.settings.get();
    const inputs = fields.map((f) => {
      const input = h('input', { type: 'text', autocomplete: 'off', value: String(f.value), 'aria-label': f.label, data: { field: '1', key: f.key } });
      if (f.kind === 'int') input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, 10); });
      else input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9:]/g, '').slice(0, 5); });
      return input;
    });
    const error = h('div', { class: 'error', role: 'alert' });
    async function save() {
      error.textContent = '';
      const values = {};
      fields.forEach((f, i) => { values[f.key] = f.kind === 'int' ? Number(inputs[i].value) : inputs[i].value; });
      try {
        const r = await api.settings.save(values);
        A.toast(r.changed ? `Saved (${r.changed} changed)` : 'Nothing changed');
      } catch (e) { error.textContent = e.message; }
    }
    done(h('div', { class: 'block panel', style: 'max-width:720px' },
      h('p', { class: 'lede', style: 'margin-bottom:12px' }, 'Changes apply to new entries straight away. The rounding step and balance limit change how payouts are suggested.'),
      fields.map((f, i) => h('label', { class: 'field' }, h('span', {}, f.label), inputs[i])), error,
      h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: save } }, 'Save'))),
    ['Enter next', 'Enter on the last: save'], { screen: { onSubmit: save } });
  }

  async function users(done, reopen) {
    const { users: list } = await api.users.list();
    const selected = () => { const r = document.activeElement; return r && r.dataset && r.dataset.id ? list.find((u) => String(u.id) === r.dataset.id) : null; };
    const rows = list.map((u) => h('tr', { tabindex: '0', class: u.active ? '' : 'gone', data: { menuItem: '1', id: String(u.id) } },
      h('td', {}, u.username, u.active ? null : h('span', { class: 'tag' }, 'off')), h('td', {}, u.role === 'admin' ? 'Admin' : 'Cashier')));
    const act = async (fn) => { try { await fn(); reopen('users', 'content'); } catch (e) { A.toast(e.message); } };
    async function add() {
      const username = await A.promptDialog({ title: 'New user', label: 'Username (3 to 40 characters)' }); if (username === null) return;
      const password = await A.promptDialog({ title: 'New user', label: 'Password or PIN (4 or more characters)', secret: true }); if (password === null) return;
      const admin = await A.confirmDialog({ title: 'Make this user an admin?', text: 'Yes: admin (settings, users, reopen). No: cashier.', yesLabel: 'Admin' });
      await act(async () => { await api.users.save({ username, password, role: admin ? 'admin' : 'cashier' }); A.toast(`${username} added`); });
    }
    async function reset() {
      const u = selected(); if (!u) return;
      const password = await A.promptDialog({ title: `New password for ${u.username}`, label: 'Password or PIN', secret: true }); if (password === null) return;
      await act(async () => { await api.users.save({ id: u.id, password }); A.toast('Password changed'); });
    }
    const role = () => { const u = selected(); if (u) act(() => api.users.save({ id: u.id, role: u.role === 'admin' ? 'cashier' : 'admin' })); return true; };
    const toggle = () => { const u = selected(); if (u) act(() => api.users.save({ id: u.id, active: !u.active })); return true; };
    done(h('div', { class: 'block panel', style: 'max-width:640px' },
      h('p', { class: 'lede', style: 'margin-bottom:12px' }, 'A cashier can do the daily work but cannot open Settings, change users or reopen a closed day. Users are switched off, never deleted, so the log keeps their name.'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Username'), h('th', {}, 'Role'))), h('tbody', {}, rows))),
    ['↑ ↓ choose', 'A add', 'P new password', 'R admin / cashier', 'Space on / off'], { menu: true, hotkeys: { a: () => { add(); return true; }, A: () => { add(); return true; }, p: () => { reset(); return true; }, P: () => { reset(); return true; }, r: role, R: role, ' ': toggle, Space: toggle } });
  }

  async function denoms(done, reopen) {
    const { denominations: list } = await api.denominations.list();
    const selected = () => { const r = document.activeElement; return r && r.dataset && r.dataset.id ? list.find((d) => d.id === r.dataset.id) : null; };
    const toggle = async () => {
      const d = selected(); if (!d) return true;
      try { await api.denominations.hide(d.id, !d.hidden); reopen('denoms', 'content'); } catch (e) { A.toast(e.message); }
      return true;
    };
    const rows = list.map((d) => h('tr', { tabindex: '0', class: d.hidden ? 'gone' : '', data: { menuItem: '1', id: d.id } },
      h('td', {}, `₹${d.value} ${d.kind}`), h('td', { class: 'n' }, String(d.inDrawer)), h('td', {}, d.hidden ? 'Hidden' : 'In use')));
    done(h('div', { class: 'block panel', style: 'max-width:640px' },
      h('p', { class: 'lede', style: 'margin-bottom:12px' }, 'A hidden note or coin is never suggested for payouts or deposits. Any pieces still in the drawer are still counted.'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'In drawer'), h('th', {}, 'Status'))), h('tbody', {}, rows))),
    ['↑ ↓ choose', 'Space hide / show'], { menu: true, hotkeys: { ' ': toggle, Space: toggle } });
  }

  async function backup(done, reopen) {
    const st = await api.backup.status();
    const selected = () => { const r = document.activeElement; return r && r.dataset && r.dataset.name ? st.files.find((f) => f.name === r.dataset.name) : null; };
    const act = async (fn) => { try { await fn(); } catch (e) { A.toast(e.message); } };
    const setPass = async () => {
      const a1 = await A.promptDialog({ title: 'Backup password', label: 'New backup password (8 or more characters). You need it to restore. Write it down.', secret: true }); if (a1 === null) return;
      const a2 = await A.promptDialog({ title: 'Backup password', label: 'Type it again', secret: true }); if (a2 === null) return;
      if (a1 !== a2) { A.toast('The two passwords are not the same'); return; }
      await act(async () => { await api.backup.setPassword(a1); A.toast('Backup password set'); reopen('backup', 'content'); });
    };
    const now = () => act(async () => { const r = await api.backup.now(); A.toast(`Backed up: ${r.name}`); reopen('backup', 'content'); });
    const folder = () => act(async () => { const r = await api.backup.chooseFolder(); if (!r.cancelled) { A.toast('Backup folder changed'); reopen('backup', 'content'); } });
    async function restore() {
      const f = selected(); if (!f) { A.toast('Choose a backup first'); return; }
      const password = await A.promptDialog({ title: `Restore ${f.name}`, label: 'Backup password', secret: true }); if (password === null) return;
      if (!await A.confirmDialog({ title: 'Replace ALL current data?', text: 'Everything now in Cash Desk is replaced by this backup. A safety copy of the current data is made first. You will sign in again.', yesLabel: 'Restore' })) return;
      await act(async () => { const r = await api.backup.restore(f.name, password); A.toast(r.safetyCopy ? `Restored. Safety copy: ${r.safetyCopy}` : 'Restored'); });
    }
    const rows = st.files.map((f) => h('tr', { tabindex: '0', data: { menuItem: '1', name: f.name } }, h('td', {}, when(f.at)), h('td', {}, f.safety ? 'Before a restore' : 'Backup'), h('td', { class: 'n' }, kb(f.size)), h('td', {}, f.name)));
    done(h('div', { class: 'dash' },
      h('div', { class: 'block panel' },
        h('p', {}, st.configured ? `Backups are on. Last: ${when(st.lastAt)}. Newest ${st.keep} are kept.` : 'Backups are OFF. Set a backup password (P).'),
        h('p', { class: 'lede' }, `Folder: ${st.folder}${st.customFolder ? '' : ' (default)'}`),
        h('p', { class: 'lede' }, 'A backup is made when you close a day and when you quit. It is sealed with the backup password, so it can be restored on any PC with that password.')),
      h('div', { class: 'block panel' }, rows.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Kind'), h('th', { class: 'n' }, 'Size'), h('th', {}, 'File'))), h('tbody', {}, rows)) : h('p', { class: 'lede' }, 'No backups yet.'))),
    ['P backup password', 'B back up now', 'F folder', '↑ ↓ choose, Enter restore'], { menu: true,
      hotkeys: { p: () => { setPass(); return true; }, P: () => { setPass(); return true; }, b: () => { now(); return true; }, B: () => { now(); return true; }, f: () => { folder(); return true; }, F: () => { folder(); return true; }, Enter: () => { if (!selected()) return false; restore(); return true; } } });
  }

  window.CashDeskScreens.settings = { open };
})();
