'use strict';
// Cash in: money received into the drawer. Source, who, the count, a remark, then a confirmation.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, piecesText, page } = window.CashDeskShared;

  const SOURCES = [
    ['customer', 'Customer'], ['branch', 'Branch'], ['department', 'Department'], ['bank_withdrawal', 'Bank withdrawal'], ['other', 'Other'],
  ];
  const NEW = '__new';
  let lastSource = 'customer'; // remembered between entries

  async function open() {
    let lists;
    try { lists = await api.lists.get(); } catch (e) { A.toast(e.message); return; }

    const sourceSel = h('select', { 'aria-label': 'Source', data: { field: '1' } }, SOURCES.map(([v, l]) => h('option', { value: v }, l)));
    sourceSel.value = lastSource;
    const targetSel = h('select', { 'aria-label': 'From', data: { field: '1' } });
    const targetLabel = h('span', {}, '');
    const targetField = h('label', { class: 'field' }, targetLabel, targetSel);
    const newName = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Type the new name', data: { field: '1' } });
    const newField = h('label', { class: 'field' }, h('span', {}, 'New name'), newName);
    const partyName = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const partyLabel = h('span', {}, 'Name (optional)');
    const remark = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const remarkLabel = h('span', {}, 'Remark (optional)');
    const grid = countGrid();
    const error = h('div', { class: 'error', role: 'alert' });

    const listFor = (src) => ({ branch: ['branches', 'Branch'], department: ['departments', 'Department'], bank_withdrawal: ['banks', 'Bank'] }[src]);

    function syncSource() {
      const src = sourceSel.value;
      const l = listFor(src);
      targetField.hidden = !l;
      newField.hidden = true;
      if (l) {
        targetLabel.textContent = l[1];
        const items = lists[l[0]].filter((x) => x.active);
        targetSel.replaceChildren(
          ...items.map((x) => h('option', { value: String(x.id) }, x.name)),
          ...(l[0] === 'banks' ? [] : [h('option', { value: NEW }, '+ New…')]));
        if (!targetSel.value && items.length) targetSel.value = String(items[0].id);
      }
      partyLabel.textContent = src === 'customer' ? 'Customer name (optional)' : src === 'other' ? 'Received from (optional)' : 'Name (optional)';
      remarkLabel.textContent = src === 'other' ? 'Remark (required)' : 'Remark (optional)';
    }
    function syncNew() { newField.hidden = targetField.hidden || targetSel.value !== NEW; }
    sourceSel.addEventListener('change', () => { lastSource = sourceSel.value; syncSource(); });
    targetSel.addEventListener('change', syncNew);
    syncSource(); syncNew();

    let busy = false;
    async function submit() {
      if (busy) return;
      error.textContent = '';
      const src = sourceSel.value;
      const total = grid.total();
      if (total < 1) { error.textContent = 'Enter the notes and coins received.'; return; }
      busy = true;
      try {
        const data = { source: src, pieces: grid.pieces(), partyName: partyName.value, remark: remark.value };
        const l = listFor(src);
        let where = '';
        if (l) {
          if (targetSel.value === NEW) {
            const name = newName.value.trim();
            if (!name) { error.textContent = `Type the new ${l[1].toLowerCase()} name.`; return; }
            where = name;
          } else {
            where = targetSel.selectedOptions[0] ? targetSel.selectedOptions[0].textContent : '';
            data[{ branch: 'branchId', department: 'departmentId', bank_withdrawal: 'bankAccountId' }[src]] = Number(targetSel.value);
          }
        }
        const lines = [['Source', SOURCES.find(([v]) => v === src)[1] + (where ? ` · ${where}` : '')]];
        if (partyName.value.trim()) lines.push(['Name', partyName.value.trim()]);
        lines.push(['Total', F.inr(total)], ['Notes and coins', piecesText(grid.pieces())]);
        if (remark.value.trim()) lines.push(['Remark', remark.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this cash in?', lines, yesLabel: 'Save' })) return;

        if (l && targetSel.value === NEW) { // a new name joins the list as it is used
          const added = await api.lists.save({ list: l[0], name: newName.value });
          data[{ branch: 'branchId', department: 'departmentId' }[src]] = added.id;
        }
        try {
          await api.cashIn.save(data);
        } catch (e) {
          if (e.code !== 'CONFIRM_BANK') throw e;
          if (!await A.confirmDialog({ title: 'Bank balance below zero', text: e.message, yesLabel: 'Save anyway' })) return;
          await api.cashIn.save({ ...data, confirmNegativeBank: true });
        }
        A.toast(`Cash in saved: ${F.inr(total)}`);
        A.gateway();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }

    const node = page({
      title: 'Cash in',
      hints: ['↑ ↓ change a choice', 'Enter next', 'Enter on the last: save', 'Backspace on an empty box: back'],
      body: h('div', { class: 'cols' },
        h('div', { class: 'block panel' }, h('h3', {}, 'Details'),
          h('label', { class: 'field' }, h('span', {}, 'Source'), sourceSel), targetField, newField,
          h('label', { class: 'field' }, partyLabel, partyName)),
        h('div', { class: 'block panel' }, h('h3', {}, 'Notes and coins received'), grid.node,
          h('label', { class: 'field', style: 'margin-top:16px' }, remarkLabel, remark), error,
          h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Save cash in')))),
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => A.gateway() });
    Keys.focusFirst(node);
  }

  window.CashDeskScreens.cashin = { open };
})();
