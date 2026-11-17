'use strict';
// People: everyone with their balance (+ you owe them, − they owe you), their history, and Settle.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page, balanceText, addPerson } = window.CashDeskShared;

  async function open(keepId = null) {
    let all;
    try { all = (await api.people.search('', 500, true)).people; } catch (e) { A.toast(e.message); A.gateway(); return; }
    const S = window.CashDeskSearch;

    const input = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Search (press / to jump here)', 'aria-label': 'Search people' });
    const tbody = h('tbody', {});
    const detail = h('div', { class: 'block panel' }, h('p', { class: 'lede' }, 'Choose a person.'));
    let shown = all;

    function renderRows() {
      shown = input.value ? S.search(input.value, all, 200) : all;
      tbody.replaceChildren(...shown.map((p) => h('tr', { tabindex: '0', class: p.active ? '' : 'gone', data: { menuItem: '1', id: String(p.id) } },
        h('td', {}, p.name, p.active ? null : h('span', { class: 'tag' }, 'off')), h('td', {}, p.department || ''),
        h('td', { class: 'n' + (p.balance < 0 ? ' minus' : '') }, p.balance === 0 ? '0' : (p.balance < 0 ? '−' : '+') + F.inr(Math.abs(p.balance), { symbol: false })))));
    }
    input.addEventListener('input', renderRows);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { const first = tbody.querySelector('tr'); if (first) { e.preventDefault(); first.focus(); } }
    });

    let seq = 0;
    async function showDetail(id) {
      const my = ++seq;
      try {
        const d = await api.people.history(id, 10);
        if (my !== seq) return;
        detail.replaceChildren(
          h('h3', {}, d.person.name),
          h('p', { class: 'lede', style: 'margin-bottom:12px' }, `${d.person.department || 'No department'} · ${balanceText(d.person.balance)}`),
          d.entries.length ? h('table', { class: 'mini' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'What'), h('th', { class: 'n' }, 'Voucher'), h('th', { class: 'n' }, 'Paid'), h('th', { class: 'n' }, 'Balance'))),
            h('tbody', {}, d.entries.map((e) => h('tr', {}, h('td', {}, e.day.slice(5)),
              h('td', {}, e.type === 'settle' ? (e.paid > 0 ? 'Settle: paid' : 'Settle: collected') : e.lines.map((l) => l.type).join(', ')),
              h('td', { class: 'n' }, e.type === 'settle' ? '' : F.inr(e.voucherAmount, { symbol: false })),
              h('td', { class: 'n' }, F.inr(e.paid, { symbol: false })),
              h('td', { class: 'n' }, (e.balanceDelta > 0 ? '+' : e.balanceDelta < 0 ? '−' : '') + F.inr(Math.abs(e.balanceDelta), { symbol: false })))))) : h('p', { class: 'lede' }, 'No entries yet.'));
      } catch (e) { A.toast(e.message); }
    }

    const node = page({
      title: 'People',
      hints: ['/ search', '↑ ↓ choose', 'S settle', 'A add', 'R rename', 'Space switch on / off', 'Esc back'],
      body: h('div', { class: 'cols' },
        h('div', { class: 'block panel' }, h('label', { class: 'field' }, h('span', {}, 'Search'), input),
          h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Department'), h('th', { class: 'n' }, 'Balance ₹'))), tbody)),
        detail),
    });
    A.show(node);
    renderRows();
    node.addEventListener('focusin', (e) => { if (e.target.dataset && e.target.dataset.id) showDetail(Number(e.target.dataset.id)); });

    const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
    const current = () => { const r = document.activeElement; return r && r.dataset && r.dataset.id ? all.find((p) => String(p.id) === r.dataset.id) : null; };
    async function save(data, id) { try { await api.people.save(data); open(id); } catch (e) { A.toast(e.message); } }
    Keys.setScreen({
      root: node, menu: { root: node }, onEsc: () => A.gateway(),
      hotkeys: {
        '/': () => { if (typing()) return false; input.focus(); input.select(); return true; },
        S: () => { if (typing()) return false; const p = current(); if (p) window.CashDeskScreens.settle.open(p.id); return true; },
        A: async () => { if (typing()) return false; const id = await addPerson(); if (id) open(id); return true; },
        R: async () => {
          if (typing()) return false;
          const p = current(); if (!p) return true;
          const name = await A.promptDialog({ title: 'Rename', label: 'Name', value: p.name });
          if (name !== null) save({ id: p.id, name, department: p.department || '', active: p.active }, p.id);
          return true;
        },
        Space: () => {
          if (typing()) return false;
          const p = current(); if (!p) return true;
          save({ id: p.id, name: p.name, department: p.department || '', active: !p.active }, p.id);
          return true;
        },
      },
    });
    const target = (keepId && tbody.querySelector(`[data-id="${keepId}"]`)) || null;
    if (target) target.focus(); else input.focus();
  }

  window.CashDeskScreens.people = { open: () => open() };
  window.CashDeskScreens.peopleAt = { open };
})();
