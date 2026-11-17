'use strict';
// Settings (for now): the lists that grow as you work. Departments, branches, expense types and bank accounts.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page } = window.CashDeskShared;

  const TABS = [['departments', 'Departments'], ['branches', 'Branches'], ['expenseTypes', 'Expense types'], ['banks', 'Bank accounts']];

  async function open(tabKey = 'departments', focusId = null) {
    let lists;
    try { lists = await api.lists.get(); } catch (e) { A.toast(e.message); A.gateway(); return; }
    const tab = TABS.findIndex(([k]) => k === tabKey);
    const items = lists[tabKey];
    const isBank = tabKey === 'banks';

    const rows = items.map((x) => h('tr', { tabindex: '0', data: { menuItem: '1', id: String(x.id) }, class: x.active ? '' : 'gone' },
      h('td', {}, x.name, x.active ? null : h('span', { class: 'tag' }, 'off')),
      isBank ? h('td', { class: 'n' }, F.inr(x.balance)) : null));

    const node = page({
      title: 'Settings · Lists  (Esc: back to Settings)',
      hints: ['← → switch list', '↑ ↓ choose', 'A add', 'R rename', 'Space switch on / off', 'Esc back'],
      body: [
        h('div', { class: 'tabs' }, TABS.map(([k, label]) => h('button', { type: 'button', class: k === tabKey ? 'on' : '', on: { click: () => open(k) } }, label))),
        h('div', { class: 'block panel', style: 'max-width:640px' },
          h('p', { class: 'lede', style: 'margin-bottom:12px' }, 'New names also join automatically when you pick “+ New…” on a form. Switching a name off hides it from new entries; old entries keep it.'),
          items.length
            ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), isBank ? h('th', { class: 'n' }, 'Balance ₹') : null)), h('tbody', {}, rows))
            : h('p', { class: 'lede' }, 'Nothing here yet. Press A to add.')),
      ],
    });
    A.show(node);

    const current = () => {
      const row = document.activeElement;
      return row && row.dataset && row.dataset.id ? items.find((x) => String(x.id) === row.dataset.id) : null;
    };
    async function save(data, keepId) {
      try { await api.lists.save({ list: tabKey, ...data }); open(tabKey, keepId); } catch (e) { A.toast(e.message); }
    }
    async function add() {
      const name = await A.promptDialog({ title: 'Add', label: 'Name' });
      if (name === null) return;
      if (isBank) {
        const bal = await A.promptDialog({ title: 'Opening balance', label: 'Balance in the bank today (₹, whole rupees)', value: '0', digits: true });
        if (bal === null) return;
        save({ name, openingBalance: Number(bal || 0) });
      } else save({ name });
    }
    async function rename() {
      const x = current(); if (!x) return;
      const name = await A.promptDialog({ title: 'Rename', label: 'Name', value: x.name });
      if (name !== null) save({ id: x.id, name, active: x.active }, x.id);
    }
    function toggle() { const x = current(); if (x) save({ id: x.id, name: x.name, active: !x.active }, x.id); }

    const hop = (d) => open(TABS[(tab + d + TABS.length) % TABS.length][0]);
    Keys.setScreen({
      root: node, menu: { root: node }, onEsc: () => window.CashDeskScreens.settings.open('general'),
      hotkeys: { ArrowLeft: () => hop(-1), ArrowRight: () => hop(1), A: add, R: rename, Space: toggle },
    });
    const target = (focusId && node.querySelector(`[data-id="${focusId}"]`)) || node.querySelector('[data-menu-item]');
    if (target) target.focus();
  }

  window.CashDeskScreens.lists = { open: () => open() };
})();
