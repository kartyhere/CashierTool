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
      const text = (l) => `${l.type} ${F.inr(l.amount)}`;
      let lines;
      if (!e.lines.length) lines = 'NOT SPLIT YET';
      else if (e.parts) lines = e.parts.map((p, i) => `V${i + 1} ${F.inr(p)}: ${e.lines.filter((l) => l.voucherNo === i + 1).map(text).join(', ')}`).join(' | ');
      else lines = e.lines.map(text).join(', ');
      const bal = e.balanceDelta ? ` · balance ${e.balanceDelta > 0 ? '+' : '−'}${F.inr(Math.abs(e.balanceDelta), { symbol: false })}` : '';
      return [e.person, F.inr(e.voucherAmount) + bal, lines, e.remark].filter(Boolean).join(' · ');
    }
    if (e.type === 'bank_deposit') return [e.bank, e.reference && `Ref ${e.reference}`, e.remark].filter(Boolean).join(' · ');
    if (e.type === 'exchange') return ['Exchange', e.remark].filter(Boolean).join(' · ');
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
      h('td', {}, TYPES[e.type] || e.type, e.deleted ? h('span', { class: 'tag' }, 'deleted') : null, e.flag ? h('span', { class: 'tag' }, 'over limit') : null, e.type === 'voucher' && !e.deleted && !e.lines.length ? h('span', { class: 'tag' }, 'not split') : null, e.parts ? h('span', { class: 'tag' }, `${e.parts.length} vouchers`) : null),
      h('td', {}, detail(e), h('div', { class: 'lede' }, piecesText(e.pieces))),
      h('td', { class: 'n' + (e.cashDelta < 0 ? ' minus' : '') }, (e.type === 'exchange' ? '' : (e.cashDelta < 0 ? '−' : '+')) + F.inr(e.amount, { symbol: false })),
      h('td', {}, e.user)));

    const node = page({
      title: `Entries · ${data.day}`,
      hints: ['← → change day', '↑ ↓ choose an entry', 'E edit the expense split of a voucher', 'Delete remove', 'Esc back'],
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

    // Edit the expense split (and remark) of a voucher. Money, notes and balances are never changed here.
    async function editSplit() {
      const row = document.activeElement;
      if (!row || !row.dataset || !row.dataset.id) return true;
      const entry = data.entries.find((x) => String(x.id) === row.dataset.id);
      if (!entry || entry.type !== 'voucher' || entry.deleted) { A.toast('Only a voucher that is not deleted can be edited'); return true; }
      if (data.closed) { A.toast('That day is closed. An admin can reopen the day to change it.'); return true; }
      if (!data.mayEdit) { A.toast('You do not have permission to change entries. Ask an admin.'); return true; }
      splitEditor(entry, data.day);
      return true;
    }
    Keys.setScreen({
      root: node, menu: { root: node },
      onEsc: () => A.gateway(),
      hotkeys: { e: editSplit, E: editSplit, ArrowLeft: () => open(shiftDay(data.day, -1)), ArrowRight: () => open(shiftDay(data.day, 1)), Delete: remove },
    });
    const first = node.querySelector('[data-menu-item]');
    if (first) first.focus();
  }

  // The split editor: every voucher of the entry in one page, existing lines filled in. Enter walks through; the last Enter goes to the remark; Enter there saves.
  async function splitEditor(entry, day) {
    let types;
    try { types = (await api.lists.get()).expenseTypes.filter((t) => t.active); } catch (e) { A.toast(e.message); return; }
    const parts = entry.parts || [entry.voucherAmount];
    const remarkIn = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Remark', value: entry.remark || '' });
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;
    async function save() {
      if (busy) return;
      busy = true; error.textContent = '';
      try {
        await api.entries.editVoucher({ id: entry.id, lines: splits.getLines(), remark: remarkIn.value });
        A.toast('Expense split saved');
        open(day);
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    const splits = window.CashDeskSplits.create({
      types, parts, lines: entry.lines, showAll: true,
      onFinish: () => { remarkIn.focus(); remarkIn.select(); },
      onBack: () => { A.toast('Esc goes back to the entries'); },
    });
    remarkIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Backspace' && remarkIn.value === '') { e.preventDefault(); splits.focusLast(); }
    });
    const node = page({
      title: `Edit expense split · ${entry.person} · ${F.inr(entry.voucherAmount)}${entry.parts ? ` (${entry.parts.length} vouchers)` : ''}`,
      hints: ['Enter next', 'Enter on an empty type finishes a voucher', 'Remark: Enter saves', 'Esc cancel'],
      body: h('div', { class: 'block panel' }, splits.node, h('label', { class: 'field' }, h('span', {}, 'Remark (optional)'), remarkIn), error,
        h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: save } }, 'Save'))),
    });
    A.show(node);
    Keys.setScreen({ root: node, onEsc: () => open(day) });
    splits.focus();
  }

  window.CashDeskScreens.entries = { open: () => open() };
})();
