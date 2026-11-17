'use strict';
// Exchange: notes out of the drawer, notes in, same total (for example a ₹500 changed into five ₹100s).
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, piecesText, page } = window.CashDeskShared;

  function open() {
    const live = h('div', { class: 'live' });
    const out = countGrid({ onChange: () => update() });
    const inn = countGrid({ onChange: () => update() });
    function update() {
      const a = out.total(), b = inn.total();
      live.textContent = a === b && a > 0 ? `Out ${F.inr(a)} = in ${F.inr(b)}` : `Out ${F.inr(a)}, in ${F.inr(b)}${a !== b ? ` · ${F.inr(Math.abs(a - b))} apart` : ''}`;
      live.classList.toggle('ok', a === b && a > 0);
    }
    update();
    const remark = h('input', { type: 'text', autocomplete: 'off', data: { field: '1' } });
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;
    async function submit() {
      if (busy) return;
      error.textContent = '';
      if (out.total() < 1) { error.textContent = 'Enter the notes going out.'; return; }
      if (out.total() !== inn.total()) { error.textContent = 'Out and in must be equal.'; return; }
      busy = true;
      try {
        const lines = [['Out', piecesText(out.pieces())], ['In', piecesText(inn.pieces())], ['Value', F.inr(out.total())]];
        if (remark.value.trim()) lines.push(['Remark', remark.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this exchange?', lines, yesLabel: 'Save' })) return;
        await api.exchange.save({ out: out.pieces(), in: inn.pieces(), remark: remark.value });
        A.toast(`Exchanged ${F.inr(out.total())}`);
        A.gateway();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    const node = page({
      title: 'Exchange',
      hints: ['Enter next', 'Enter on the last: save', 'Backspace on an empty box: back', 'Esc back'],
      body: [
        h('div', { class: 'cols' },
          h('div', { class: 'block panel' }, h('h3', {}, 'Out of the drawer'), out.node),
          h('div', { class: 'block panel' }, h('h3', {}, 'Into the drawer'), inn.node)),
        h('div', { class: 'block panel' }, live, h('label', { class: 'field', style: 'margin-top:12px' }, h('span', {}, 'Remark (optional)'), remark), error,
          h('div', { class: 'row card', style: 'max-width:320px' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Review and save'))),
      ],
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => A.gateway() });
    Keys.focusFirst(node);
  }

  window.CashDeskScreens.exchange = { open };
})();
