'use strict';
// Bank deposit: notes taken to the bank. The count is suggested (big notes first, float kept) and can be changed.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, piecesText, page } = window.CashDeskShared;

  async function open() {
    let sug;
    try { sug = await api.deposit.suggest(); } catch (e) { A.toast(e.message); return; }
    if (!sug.banks.length) { A.toast('Add a bank account first (Settings)'); return; }

    const bank = h('select', { 'aria-label': 'Bank', data: { field: '1' } }, sug.banks.map((b) => h('option', { value: String(b.id) }, `${b.name} · ${F.inr(b.balance)}`)));
    const grid = countGrid();
    grid.set(sug.pieces);
    const reference = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const remark = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;
    async function submit() {
      if (busy) return;
      error.textContent = '';
      const total = grid.total();
      if (total < 1) { error.textContent = 'Enter the notes you are depositing.'; return; }
      busy = true;
      try {
        const name = bank.selectedOptions[0].textContent.split(' · ')[0];
        const lines = [['Bank', name], ['Deposit', F.inr(total)], ['Notes', piecesText(grid.pieces())]];
        if (reference.value.trim()) lines.push(['Reference', reference.value.trim()]);
        if (remark.value.trim()) lines.push(['Remark', remark.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this deposit?', lines, yesLabel: 'Save' })) return;
        const r = await api.deposit.save({ bankAccountId: Number(bank.value), pieces: grid.pieces(), reference: reference.value, remark: remark.value });
        A.toast(`Deposited ${F.inr(r.amount)} to ${r.bankName}`);
        A.gateway();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    const node = page({
      title: 'Bank deposit',
      hints: ['↑ ↓ change bank', 'Enter next', 'Enter on the last: save', 'Backspace on an empty box: back'],
      body: h('div', { class: 'cols' },
        h('div', { class: 'block panel' }, h('h3', {}, 'Bank'),
          h('label', { class: 'field' }, h('span', {}, 'Bank'), bank),
          h('p', { class: 'hint' }, `Suggested: ${F.inr(sug.total)}. Big notes only, and the drawer keeps at least the float. Change the counts if you take a different amount.`)),
        h('div', { class: 'block panel' }, h('h3', {}, 'Notes to deposit'), grid.node,
          h('label', { class: 'field', style: 'margin-top:16px' }, h('span', {}, 'Reference no. (optional)'), reference),
          h('label', { class: 'field' }, h('span', {}, 'Remark (optional)'), remark), error,
          h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Review and save')))),
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => A.gateway() });
    Keys.focusFirst(node);
  }

  window.CashDeskScreens.deposit = { open };
})();
