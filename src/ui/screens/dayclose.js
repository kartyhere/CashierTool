'use strict';
// Day close: count the drawer, compare with the books and Tally, then close. A closed day cannot take new entries.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page } = window.CashDeskShared;
  const { DENOMS } = window.CashDeskDenoms;

  const sign = (n) => (n === 0 ? '0' : (n > 0 ? '+' : '−') + F.inr(Math.abs(n), { symbol: false }));

  async function open(day) {
    let info;
    try { info = await api.day.info(day); } catch (e) { A.toast(e.message); A.gateway(); return; }
    const f = info.figures;
    const closed = info.state === 'closed';

    const days = [...new Set([...info.openDays, info.day, info.today])].sort();
    const daySel = h('select', { 'aria-label': 'Day', data: { field: '1' } }, days.map((d) => h('option', { value: d }, d + (info.openDays.includes(d) ? '' : d === info.today ? ' (today)' : ' (closed)'))));
    daySel.value = info.day;
    daySel.addEventListener('change', () => open(daySel.value));

    const counted = {};
    const diffCells = {};
    const tally = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Tally balance', data: { field: '1' }, disabled: closed });
    tally.addEventListener('input', () => { tally.value = F.digitsOnly(tally.value).slice(0, 12); update(); });
    const remark = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Remark', data: { field: '1' }, disabled: closed });
    const live = h('div', { class: 'live' });
    const error = h('div', { class: 'error', role: 'alert' });

    const shownCounted = closed ? info.closed.counted.pieces : {};
    const rows = info.expected.map((d) => {
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${d.label} counted`, data: { field: '1' }, disabled: closed });
      input.value = closed && shownCounted[d.id] ? String(shownCounted[d.id]) : '';
      input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, 6); update(); });
      counted[d.id] = input;
      diffCells[d.id] = h('td', { class: 'n' }, '');
      return h('tr', {}, h('td', {}, d.label), h('td', { class: 'n' }, String(d.expected)), h('td', { class: 'n' }, input), diffCells[d.id]);
    });
    const countedPieces = () => Object.fromEntries(DENOMS.map((d) => [d.id, Number(counted[d.id].value || 0)]));
    const countedTotal = () => DENOMS.reduce((t, d) => t + d.value * Number(counted[d.id].value || 0), 0);
    const expectedAt = Object.fromEntries(info.expected.map((d) => [d.id, d.expected]));

    function update() {
      for (const d of DENOMS) {
        const diff = Number(counted[d.id].value || 0) - expectedAt[d.id];
        diffCells[d.id].textContent = counted[d.id].value === '' && !closed ? '' : diff === 0 ? '✓' : (diff > 0 ? '+' : '−') + Math.abs(diff);
      }
      const ct = countedTotal();
      const dBooks = ct - info.expectedTotal;
      let t = `Counted ${F.inr(ct)} · books ${F.inr(info.expectedTotal)} · ${dBooks === 0 ? 'matches' : F.inr(Math.abs(dBooks)) + (dBooks > 0 ? ' more' : ' less')}`;
      if (tally.value) { const dt = ct - Number(tally.value); t += ` · Tally ${dt === 0 ? 'matches' : F.inr(Math.abs(dt)) + (dt > 0 ? ' more' : ' less') + ' than Tally'}`; }
      live.textContent = t;
      live.classList.toggle('ok', dBooks === 0);
    }
    if (closed) { tally.value = info.closed.tally === null ? '' : String(info.closed.tally); remark.value = info.closed.remark || ''; }
    update();

    let busy = false;
    async function submit() {
      if (busy || closed) return;
      error.textContent = '';
      if (!info.hasEntries) { error.textContent = 'There are no entries on this day.'; return; }
      busy = true;
      try {
        const payload = { day: info.day, counted: countedPieces(), tallyBalance: tally.value ? Number(tally.value) : null, remark: remark.value };
        try {
          if (!await A.confirmDialog({ title: `Close ${info.day}?`, text: 'After closing, no entries can be added to this day.', yesLabel: 'Close day',
            lines: [['Counted', F.inr(countedTotal())], ['Books', F.inr(info.expectedTotal)], ...(tally.value ? [['Tally', F.inr(Number(tally.value))]] : [])] })) return;
          var r = await api.day.close(payload);
        } catch (e) {
          if (e.code !== 'CONFIRM_DIFF') throw e;
          if (!await A.confirmDialog({ title: 'Close with differences?', text: e.message, yesLabel: 'Close anyway' })) return;
          r = await api.day.close({ ...payload, confirmDifferences: true });
        }
        A.toast(r.adjustment === 0 ? `${info.day} closed` : `${info.day} closed with a ${F.inr(Math.abs(r.adjustment))} ${r.adjustment > 0 ? 'surplus' : 'shortage'} adjusted`);
        A.gateway();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }

    async function reopen() {
      if (!closed) return;
      if (!info.canReopen) { A.toast('Only an admin can reopen a closed day'); return; }
      const reason = await A.promptDialog({ title: `Reopen ${info.day}`, label: 'Reason (kept in the log)' });
      if (reason === null) return;
      try { await api.day.reopen(info.day, reason); A.toast(`${info.day} reopened`); open(info.day); } catch (e) { A.toast(e.message); }
    }

    const node = page({
      title: `Day close · ${info.day}${closed ? ' · CLOSED' : info.state === 'reopened' ? ' · REOPENED' : ''}`,
      hints: closed ? ['Alt+R reopen (admin)', 'Esc back'] : ['Enter next', 'Alt+E fill counts from the books', 'Enter on the last: close', 'Esc back'],
      body: [
        h('div', { class: 'figures' }, [['Opening', f.opening], ['Receipts', f.receipts], ['Payments', f.payments], ['Deposits', f.deposits], ['Closing (books)', info.expectedTotal]]
          .map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, F.inr(v))))),
        h('div', { class: 'cols' },
          h('div', { class: 'block panel' }, h('h3', {}, 'Count the drawer'),
            h('label', { class: 'field' }, h('span', {}, 'Day'), daySel),
            h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'Books'), h('th', { class: 'n' }, 'Counted'), h('th', { class: 'n' }, 'Difference'))), h('tbody', {}, rows)), live),
          h('div', { class: 'block panel' }, h('h3', {}, closed ? 'Closed' : 'Tally and sign-off'),
            h('label', { class: 'field' }, h('span', {}, 'Tally cash balance (₹, optional)'), tally),
            h('label', { class: 'field' }, h('span', {}, 'Remark (optional)'), remark), error,
            closed ? h('p', { class: 'lede' }, `Closed ${new Date(info.closed.at).toLocaleString('en-IN')}. Counted ${F.inr(info.closed.counted.total)}.`)
              : h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: submit } }, 'Close the day')))),
      ],
    });
    A.show(node);
    Keys.setScreen({
      root: node, onSubmit: submit, onEsc: () => A.gateway(),
      hotkeys: {
        'Alt+E': () => { if (closed) return true; for (const d of DENOMS) counted[d.id].value = expectedAt[d.id] ? String(expectedAt[d.id]) : ''; update(); return true; },
        'Alt+R': () => { reopen(); return true; },
      },
    });
    (closed ? daySel : counted[DENOMS[0].id]).focus();
  }

  window.CashDeskScreens.dayclose = { open: () => open() };
})();
