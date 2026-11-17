'use strict';
// Parts every screen uses: the denomination count grid.
(function () {
  const { h } = window.CashDeskDom;
  const F = window.CashDeskFormat;
  const { DENOMS } = window.CashDeskDenoms;

  // A table of the 11 notes and coins with a count box each, an amount per row and a running total.
  function countGrid({ onChange = () => {} } = {}) {
    const inputs = {};
    const amounts = {};
    const totalCell = h('td', { class: 'n' }, F.inr(0));
    const pieces = () => {
      const out = {};
      for (const d of DENOMS) out[d.id] = Number(inputs[d.id].value || 0);
      return out;
    };
    const total = () => DENOMS.reduce((s, d) => s + d.value * Number(inputs[d.id].value || 0), 0);
    const refresh = () => {
      for (const d of DENOMS) amounts[d.id].textContent = F.inr(d.value * Number(inputs[d.id].value || 0));
      totalCell.textContent = F.inr(total());
      onChange(total());
    };
    const rows = DENOMS.map((d) => {
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': d.label, data: { field: '1', denom: d.id } });
      input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, 6); refresh(); });
      inputs[d.id] = input;
      amounts[d.id] = h('td', { class: 'n amt' }, F.inr(0));
      return h('tr', {}, h('td', {}, d.label), h('td', { class: 'n' }, input), amounts[d.id]);
    });
    const node = h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'Count'), h('th', { class: 'n' }, 'Amount'))),
      h('tbody', {}, rows, h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', {}), totalCell)));
    return { node, pieces, total };
  }

  function piecesText(pieces) {
    return DENOMS.filter((d) => pieces[d.id]).map((d) => `${pieces[d.id]} × ${d.label}`).join(', ');
  }

  // The frame every screen sits in: a top bar with the title, the content, and a bar of key hints.
  function page({ title, body, hints = [] }) {
    return h('div', { class: 'screen' },
      h('div', { class: 'topbar' }, h('span', { class: 'who' }, title), h('span', { class: 'who' }, 'Esc back')),
      h('div', { class: 'page' }, body),
      h('div', { class: 'statusbar' }, hints.map((x) => h('span', {}, x))));
  }

  const balanceText = (n) => (n > 0 ? `you owe ${F.inr(n)}` : n < 0 ? `owes you ${F.inr(-n)}` : 'settled');

  // Add a person with three short questions. Returns the new person's id, or null if cancelled.
  async function addPerson(initialName = '') {
    const A = window.CashDeskApp;
    const name = await A.promptDialog({ title: 'New person', label: 'Name', value: initialName });
    if (name === null) return null;
    const department = await A.promptDialog({ title: 'New person', label: 'Department (leave empty for none)' });
    if (department === null) return null;
    const balance = await A.promptDialog({ title: 'New person', label: 'Balance today (₹). + if you owe them, − if they owe you. 0 if none', value: '0', digits: true, signed: true });
    if (balance === null) return null;
    try {
      const { id } = await A.api.people.save({ name, department, openingBalance: Number(balance || 0) });
      A.toast(`${name.trim()} added`);
      return id;
    } catch (e) { A.toast(e.message); return null; }
  }

  window.CashDeskShared = { countGrid, piecesText, page, balanceText, addPerson };
})();
