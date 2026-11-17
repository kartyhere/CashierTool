'use strict';
// Tally check: compare the cash balance in Cash Desk with the balance in Tally, at any time of the day.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { countGrid, page } = window.CashDeskShared;

  const pad = (n) => String(n).padStart(2, '0');
  const timeOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const diffText = (d) => (d === 0 ? 'matches' : `${F.inr(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than Tally`);

  async function open() {
    let dash, list;
    try { [dash, list] = await Promise.all([api.dashboard.get(), api.tally.list()]); } catch (e) { A.toast(e.message); return; }

    const tally = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Tally balance' });
    tally.addEventListener('input', () => { tally.value = F.digitsOnly(tally.value).slice(0, 12); });
    const remark = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Remark' });
    const grid = countGrid();
    const result = h('div', { class: 'live' });
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;

    async function submit() {
      if (busy) return;
      error.textContent = '';
      if (!tally.value) { error.textContent = 'Enter the Tally balance.'; tally.focus(); return; }
      busy = true;
      try {
        const counted = grid.total() > 0 ? grid.pieces() : undefined;
        const r = await api.tally.check({ tallyBalance: Number(tally.value), counted, remark: remark.value });
        const tail = r.countedTotal === null ? '' : ` Counted ${F.inr(r.countedTotal)}: ${r.countedDifference === 0 ? 'matches the app' : F.inr(Math.abs(r.countedDifference)) + (r.countedDifference > 0 ? ' more' : ' less') + ' than the app'}.`;
        open().then(() => {
          const el = document.querySelector('.live.result');
          if (el) { el.textContent = `App ${F.inr(r.system)} · Tally ${F.inr(r.tally)}: ${diffText(r.difference)}.${tail}`; el.classList.toggle('ok', r.difference === 0); }
        });
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    result.classList.add('result');

    tally.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); remark.focus(); } });
    remark.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Backspace' && remark.value === '') { e.preventDefault(); tally.focus(); }
    });

    const rows = list.checks.map((c) => h('tr', {}, h('td', {}, timeOf(c.at)), h('td', { class: 'n' }, F.inr(c.system, { symbol: false })), h('td', { class: 'n' }, F.inr(c.tally, { symbol: false })),
      h('td', { class: 'n' + (c.difference !== 0 ? ' minus' : '') }, c.difference === 0 ? '0' : (c.difference > 0 ? '+' : '−') + F.inr(Math.abs(c.difference), { symbol: false })),
      h('td', {}, c.remark || '', c.countedTotal === null ? '' : ` counted ${F.inr(c.countedTotal)}`), h('td', {}, c.user)));

    const node = page({
      title: `Tally check · ${list.day}`,
      hints: ['Enter next', 'Enter on the remark: save', 'Tab for the optional count', 'Esc back'],
      body: [
        h('div', { class: 'figures' }, h('div', {}, h('span', {}, 'Cash in Cash Desk now'), h('b', {}, F.inr(dash.drawer.total))),
          h('div', {}, h('span', {}, 'Receipts today'), h('b', {}, F.inr(dash.figures.receipts))), h('div', {}, h('span', {}, 'Payments today'), h('b', {}, F.inr(dash.figures.payments))),
          h('div', {}, h('span', {}, 'Deposits today'), h('b', {}, F.inr(dash.figures.deposits)))),
        h('div', { class: 'cols' },
          h('div', { class: 'block panel' }, h('h3', {}, 'Compare with Tally'),
            h('label', { class: 'field' }, h('span', {}, 'Tally cash balance (₹)'), tally), h('label', { class: 'field' }, h('span', {}, 'Remark (optional)'), remark), error, result,
            h('div', { class: 'row card', style: 'margin-top:12px' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Save check'))),
          h('div', { class: 'block panel' }, h('h3', {}, 'Count the drawer (optional)'), grid.node)),
        h('div', { class: 'block panel' }, h('h3', {}, "Today's checks"),
          rows.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', { class: 'n' }, 'App ₹'), h('th', { class: 'n' }, 'Tally ₹'), h('th', { class: 'n' }, 'App − Tally'), h('th', {}, 'Note'), h('th', {}, 'By'))), h('tbody', {}, rows))
            : h('p', { class: 'lede' }, 'No checks yet today.')),
      ],
    });
    A.show(node);
    Keys.setScreen({ root: node, onSubmit: submit, onEsc: () => A.gateway() });
    tally.focus();
  }

  window.CashDeskScreens.tally = { open };
})();
