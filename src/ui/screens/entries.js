'use strict';
// Entries: everything entered on a day, with the day's figures. Left / Right change the day, Delete removes an entry.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { piecesText, page } = window.CashDeskShared;

  const TYPES = { opening: 'Opening', voucher: 'Voucher', cash_in: 'Cash in', bank_deposit: 'Bank deposit', exchange: 'Exchange', settle: 'Settle', count_adjust: 'Count adjust' };
  const SOURCES = { customer: 'Customer', branch: 'Branch', department: 'Department', bank_withdrawal: 'Bank withdrawal', other: 'Other' };

  const pad = (n) => String(n).padStart(2, '0');
  function shiftDay(day, delta) {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const timeOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function detail(e) {
    if (e.type === 'voucher') {
      const lines = e.lines.map((l) => `${l.type} ${F.inr(l.amount)}`).join(', ');
      const bal = e.balanceDelta ? ` · balance ${e.balanceDelta > 0 ? '+' : '−'}${F.inr(Math.abs(e.balanceDelta), { symbol: false })}` : '';
      return [e.person, F.inr(e.voucherAmount) + bal, lines, e.remark].filter(Boolean).join(' · ');
    }
    if (e.type === 'settle') return [e.person, e.cashDelta < 0 ? 'Paid' : 'Collected', e.remark].filter(Boolean).join(' · ');
    if (e.type === 'cash_in') {
      const where = e.branch || e.department || e.bank || '';
      return [SOURCES[e.source] || '', where, e.partyName, e.remark].filter(Boolean).join(' · ');
    }
    return e.remark || '';
  }

  async function open(day) {
    let data;
    try { data = await api.entries.list(day ? { day } : {}); } catch (e) { A.toast(e.message); A.gateway(); return; }
    const f = data.figures;

    const rows = data.entries.map((e) => h('tr', { tabindex: '0', class: e.deleted ? 'gone' : '', data: { menuItem: '1', id: String(e.id), deleted: e.deleted ? '1' : '' } },
      h('td', {}, timeOf(e.at)),
      h('td', {}, TYPES[e.type] || e.type, e.deleted ? h('span', { class: 'tag' }, 'deleted') : null, e.flag ? h('span', { class: 'tag' }, 'over limit') : null),
      h('td', {}, detail(e), h('div', { class: 'lede' }, piecesText(e.pieces))),
      h('td', { class: 'n' + (e.cashDelta < 0 ? ' minus' : '') }, (e.cashDelta < 0 ? '−' : '+') + F.inr(e.amount, { symbol: false })),
      h('td', {}, e.user)));

    const node = page({
      title: `Entries · ${data.day}`,
      hints: ['← → change day', '↑ ↓ choose an entry', 'Delete remove', 'Esc back'],
      body: [
        h('div', { class: 'figures' }, [['Opening', f.opening], ['Receipts', f.receipts], ['Payments', f.payments], ['Deposits', f.deposits], ['Closing', f.closing]]
          .map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, F.inr(v))))),
        h('div', { class: 'block panel' },
          rows.length
            ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Type'), h('th', {}, 'Details'), h('th', { class: 'n' }, 'Amount ₹'), h('th', {}, 'By'))), h('tbody', {}, rows))
            : h('p', { class: 'lede' }, 'No entries on this day.')),
      ],
    });
    A.show(node);

    async function remove() {
      const row = document.activeElement;
      if (!row || !row.dataset || !row.dataset.id) return;
      if (row.dataset.deleted) { A.toast('That entry is already deleted'); return; }
      const entry = data.entries.find((x) => String(x.id) === row.dataset.id);
      const yes = await A.confirmDialog({
        title: 'Delete this entry?',
        text: 'It stays in the record marked as deleted. The drawer is recalculated.',
        lines: [['Type', TYPES[entry.type]], ['Amount', F.inr(entry.amount)], ['Notes and coins', piecesText(entry.pieces)]],
        yesLabel: 'Delete',
      });
      if (!yes) return;
      try { await api.entries.delete(entry.id); A.toast('Entry deleted'); open(data.day); } catch (e) { A.toast(e.message); }
    }

    Keys.setScreen({
      root: node, menu: { root: node },
      onEsc: () => A.gateway(),
      hotkeys: { ArrowLeft: () => open(shiftDay(data.day, -1)), ArrowRight: () => open(shiftDay(data.day, 1)), Delete: remove },
    });
    const first = node.querySelector('[data-menu-item]');
    if (first) first.focus();
  }

  window.CashDeskScreens.entries = { open: () => open() };
})();
