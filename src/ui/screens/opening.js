'use strict';
// Opening count: what is in the drawer when you start using Cash Desk. Entered once.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, piecesText, page } = window.CashDeskShared;

  function open() {
    const grid = countGrid();
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;
    async function submit() {
      if (busy) return;
      const pieces = grid.pieces();
      const total = grid.total();
      error.textContent = '';
      if (total < 1) { error.textContent = 'Enter at least one note or coin.'; return; }
      busy = true;
      try {
        const yes = await A.confirmDialog({ title: 'Save opening count?', lines: [['Total', F.inr(total)], ['Counted', piecesText(pieces)]], yesLabel: 'Save' });
        if (!yes) return;
        await api.opening.save(pieces);
        A.toast('Opening count saved');
        A.gateway();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    const node = page({
      title: 'Opening count',
      hints: ['Enter next count', 'Enter on the last: save', 'Backspace on an empty count: back'],
      body: h('div', { class: 'block panel', style: 'max-width:560px' },
        h('h3', {}, 'Count the drawer'),
        h('p', { class: 'hint' }, 'Count every note and coin in the drawer now. Leave a row empty if you have none. This is entered once; the drawer is tracked from here.'),
        grid.node, error,
        h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Save opening count'))),
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => A.gateway() });
    Keys.focusFirst(node);
  }

  window.CashDeskScreens.opening = { open };
})();
