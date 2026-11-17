'use strict';
// Settle: pay a person what you owe them, or collect what they owe you. The notes decide the amount.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, piecesText, page, balanceText } = window.CashDeskShared;

  async function open(personId) {
    let hist;
    try { hist = await api.people.history(personId, 1); } catch (e) { A.toast(e.message); return; }
    const person = hist.person;
    const grid = countGrid();
    const dir = h('select', { 'aria-label': 'Pay or collect', data: { field: '1' } },
      h('option', { value: 'pay' }, 'Pay them (you owe them)'), h('option', { value: 'collect' }, 'Collect from them (they owe you)'));
    dir.value = person.balance < 0 ? 'collect' : 'pay';
    const remark = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;
    async function submit() {
      if (busy) return;
      error.textContent = '';
      const total = grid.total();
      if (total < 1) { error.textContent = 'Enter the notes and coins.'; return; }
      busy = true;
      try {
        const sign = dir.value === 'pay' ? -1 : 1;
        const lines = [['Person', person.name], [dir.value === 'pay' ? 'Pay' : 'Collect', F.inr(total)], ['Notes and coins', piecesText(grid.pieces())],
          ['Balance after', balanceText(person.balance + sign * total)]];
        if (remark.value.trim()) lines.push(['Remark', remark.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this settlement?', lines, yesLabel: 'Save' })) return;
        const r = await api.settle.save({ personId, direction: dir.value, pieces: grid.pieces(), remark: remark.value });
        A.toast(`${dir.value === 'pay' ? 'Paid' : 'Collected'} ${F.inr(r.amount)}: ${r.personName} now ${balanceText(r.newBalance)}`);
        window.CashDeskScreens.peopleAt.open(personId);
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    const node = page({
      title: `Settle · ${person.name}`,
      hints: ['↑ ↓ pay or collect', 'Enter next', 'Enter on the last: save', 'Esc back'],
      body: h('div', { class: 'cols' },
        h('div', { class: 'block panel' }, h('h3', {}, person.name), h('p', { class: 'lede', style: 'margin-bottom:14px' }, `${person.department || 'No department'} · ${balanceText(person.balance)}`),
          h('label', { class: 'field' }, h('span', {}, 'Direction'), dir)),
        h('div', { class: 'block panel' }, h('h3', {}, 'Notes and coins'), grid.node,
          h('label', { class: 'field', style: 'margin-top:16px' }, h('span', {}, 'Remark (optional)'), remark), error,
          h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Review and save')))),
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => window.CashDeskScreens.peopleAt.open(personId) });
    Keys.focusFirst(node);
  }

  window.CashDeskScreens.settle = { open };
})();
