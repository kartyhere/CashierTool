'use strict';
// The expense split of a voucher, one section per voucher. Used when a voucher is entered and when a saved one is edited.
//   Splits.create({ types, parts: [120, 143], lines: [], showAll, onFinish(lines), onBack() })
// Each voucher's lines must add up to that voucher's amount. Enter on an empty type finishes the voucher and goes to the next.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F } = A;
  const NEW = '__new';

  function create({ types, parts, lines = [], showAll = false, onFinish, onBack }) {
    const root = h('div', { class: 'splits' });
    let bodies = [], foots = [], sections = [], cur = 0, P = parts;
    const digits = (input) => input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, 8); });

    const rowsOf = (k) => [...bodies[k].children];
    const totalOf = (k) => rowsOf(k).reduce((t, r) => t + Number(r.querySelector('input.amt').value || 0), 0);
    const remaining = (k) => P[k] - totalOf(k);
    function updateFoot(k) {
      const left = remaining(k);
      foots[k].textContent = `Lines ${F.inr(totalOf(k))} of ${F.inr(P[k])}${left ? ` · ${left > 0 ? F.inr(left) + ' left to split' : F.inr(-left) + ' too much'}` : ' · fully split'}`;
      foots[k].classList.toggle('ok', left === 0);
    }
    const typeOptions = () => [h('option', { value: '' }, ''), ...types.map((t) => h('option', { value: String(t.id) }, t.name)), h('option', { value: NEW }, '+ New…')];
    const firstSelect = (k) => { const r = rowsOf(k)[0]; return r ? r.querySelector('select') : null; };

    function showSection(k) {
      cur = Math.max(cur, k);
      sections.forEach((s, i) => { s.hidden = !showAll && i > cur; });
    }
    function nextVoucher(k) {
      // every voucher must add up before the split is finished
      if (k < P.length - 1) {
        showSection(k + 1);
        if (!rowsOf(k + 1).length) addLine(k + 1);
        firstSelect(k + 1).focus();
        return;
      }
      for (let i = 0; i < P.length; i++) {
        if (remaining(i) !== 0) { A.toast(`Voucher ${i + 1}: ${F.inr(Math.abs(remaining(i)))} ${remaining(i) > 0 ? 'left to split' : 'too much'}`); const s = firstSelect(i); if (s) s.focus(); return; }
      }
      onFinish(getLines());
    }

    function addLine(k, preset) {
      const sel = h('select', { 'aria-label': `Voucher ${k + 1} expense type` }, typeOptions());
      const amt = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'amt', 'aria-label': `Voucher ${k + 1} line amount` });
      const note = h('input', { type: 'text', autocomplete: 'off', class: 'note', 'aria-label': `Voucher ${k + 1} line note` });
      digits(amt);
      amt.addEventListener('input', () => updateFoot(k));
      if (preset) { sel.value = String(preset.expenseTypeId); amt.value = String(preset.amount); note.value = preset.note || ''; }
      const row = h('tr', {}, h('td', {}, sel), h('td', { class: 'n' }, amt), h('td', {}, note));
      sel.addEventListener('keydown', async (e) => {
        if (e.key === 'Backspace') {
          e.preventDefault();
          const rows = rowsOf(k); const i = rows.indexOf(row);
          if (i === 0) {
            if (k === 0) { onBack(); return; }
            const prev = rowsOf(k - 1); prev[prev.length - 1].querySelector('input.note').focus(); return;
          }
          row.remove(); updateFoot(k); rows[i - 1].querySelector('input.note').focus(); return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (sel.value === NEW) {
          const name = await A.promptDialog({ title: 'New expense type', label: 'Name' });
          if (name === null) { sel.focus(); return; }
          try {
            const { id } = await api.lists.save({ list: 'expenseTypes', name });
            types.push({ id, name: name.trim(), active: true });
            root.querySelectorAll('select').forEach((s) => { const keep = s.value; s.replaceChildren(...typeOptions()); s.value = keep; });
            sel.value = String(id);
          } catch (err) { A.toast(err.message); sel.focus(); return; }
        }
        if (sel.value === '') {
          if (rowsOf(k).indexOf(row) === 0) { A.toast('Choose an expense type'); return; }
          if (remaining(k) !== 0) { A.toast(`Split the remaining ${F.inr(remaining(k))} first`); return; }
          row.remove(); updateFoot(k); nextVoucher(k); return;
        }
        if (!amt.value && remaining(k) > 0) amt.value = String(remaining(k));
        updateFoot(k); amt.focus(); amt.select();
      });
      amt.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && amt.value === '') { e.preventDefault(); sel.focus(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (Number(amt.value) < 1) { A.toast('Enter the line amount'); return; }
          if (Number(amt.value) > P[k]) { A.toast('That is more than the voucher'); return; }
          note.focus();
        }
      });
      note.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && note.value === '') { e.preventDefault(); amt.focus(); amt.select(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const rows = rowsOf(k); const i = rows.indexOf(row);
          if (i < rows.length - 1) { rows[i + 1].querySelector('select').focus(); return; }     // an existing line below (editing)
          if (remaining(k) > 0) { addLine(k); return; }
          if (remaining(k) < 0) { A.toast(`The lines are ${F.inr(-remaining(k))} more than the voucher`); return; }
          nextVoucher(k);
        }
      });
      bodies[k].append(row);
      updateFoot(k);
      if (!preset) sel.focus();
    }

    function getLines() {
      const out = [];
      P.forEach((_, k) => rowsOf(k).forEach((row) => {
        const expenseTypeId = Number(row.querySelector('select').value); const amount = Number(row.querySelector('input.amt').value);
        if (expenseTypeId && amount) out.push({ voucherNo: k + 1, expenseTypeId, amount, note: row.querySelector('input.note').value });
      }));
      return out;
    }

    // Start (again) with these voucher amounts and these existing lines.
    function reset(newParts, existing = []) {
      P = newParts; cur = 0;
      bodies = P.map(() => h('tbody', {}));
      foots = P.map(() => h('div', { class: 'live' }));
      sections = P.map((amount, k) => h('div', { class: 'split-section', hidden: !showAll && k > 0 },
        h('div', { class: 'field' }, h('span', {}, P.length > 1 ? `Voucher ${k + 1} of ${P.length} · ${F.inr(amount)}` : `Expense lines · ${F.inr(amount)} (Enter on an empty type finishes)`)),
        h('table', { class: 'lines-grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', { class: 'n' }, 'Amount ₹'), h('th', {}, 'Note'))), bodies[k]), foots[k]));
      root.replaceChildren(...sections);
      P.forEach((_, k) => {
        const mine = existing.filter((l) => (l.voucherNo || 1) === k + 1);
        if (mine.length) mine.forEach((l) => addLine(k, l)); else if (k === 0 || showAll) addLine(k);
        updateFoot(k);
      });
    }
    reset(parts, lines);

    return {
      node: root, reset, getLines,
      // Move to the first voucher that still needs lines (or the first one when editing).
      focus() { const s = firstSelect(0); if (s) { s.focus(); } },
      focusLast() { const k = Math.min(cur, P.length - 1); const rows = rowsOf(k); if (rows.length) rows[rows.length - 1].querySelector('input.note').focus(); },
    };
  }

  window.CashDeskSplits = { create };
})();
