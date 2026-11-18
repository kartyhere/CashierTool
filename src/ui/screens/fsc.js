'use strict';
// Service payment: load the party codes once, then each month choose the Excel file and get what to pay each bank account.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page } = window.CashDeskShared;

  const inr2 = (n) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

  async function open() {
    let parties;
    try { parties = await api.fsc.parties(); } catch (e) { A.toast(e.message); A.gateway(); return; }
    let last = null; let busy = false;
    const error = h('div', { class: 'error', role: 'alert' });
    const partyLine = h('p', { class: 'lede' });
    const result = h('div', { class: 'reportview' }, h('p', { class: 'lede' }, 'Choose the monthly Excel file to see what to pay each bank account.'));
    const setParty = () => {
      partyLine.textContent = parties.count
        ? `Party codes loaded: ${parties.count}. Load the file again any time to add new codes or fix names.`
        : 'No party codes yet. Press P and choose the Excel file with the party codes and names first.';
    };
    setParty();

    // ---- search: type an invoice number, arrows choose, Enter copies the UTR ----
    const qBox = h('input', { type: 'text', id: 'fsc-q', 'aria-label': 'Invoice number', placeholder: 'Invoice number (GST lot number)', autocomplete: 'off', spellcheck: 'false' });
    const pBox = h('input', { type: 'text', id: 'fsc-party', 'aria-label': 'Party name filter', placeholder: 'Party name filter', autocomplete: 'off', spellcheck: 'false' });
    const hits = h('div', { class: 'fsc-hits', role: 'listbox', 'aria-label': 'Invoices found' });
    const searchNote = h('p', { class: 'lede' }, 'Choose the monthly file and the UTR file first, then search here.');
    let items = []; let sel = 0; let token = 0;
    const copyBtns = [];
    const selectRow = (i) => {
      if (!items.length) return;
      sel = Math.max(0, Math.min(items.length - 1, i));
      [...hits.children].forEach((el, n) => { el.classList.toggle('selected', n === sel); el.setAttribute('aria-selected', n === sel ? 'true' : 'false'); });
      const el = hits.children[sel]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    };
    async function search() {
      const mine = ++token;
      let r;
      try { r = await api.fsc.search(qBox.value, pBox.value); } catch (e) { error.textContent = e.message; return; }
      if (mine !== token) return;
      items = r.items; sel = 0; copyBtns.length = 0;
      hits.replaceChildren(...items.map((x, n) => {
        const btn = h('button', { type: 'button', tabindex: '-1', class: 'copy-utr', 'aria-label': `Copy UTR of ${x.gstLot}`, on: { click: () => copyAt(n) } }, 'Copy UTR');
        copyBtns.push(btn);
        return h('div', { class: 'fsc-hit', role: 'option', 'data-i': String(n), on: { mousedown: (ev) => { ev.preventDefault(); selectRow(n); qBox.focus(); } } },
          h('span', { class: 'hit-inv' }, x.gstLot || `(row ${x.row})`), h('span', { class: 'hit-party' }, x.party || '(party not found)'),
          h('span', { class: 'hit-acct' }, x.account || '(no account)'), h('span', { class: 'hit-amt' }, inr2(x.toPay)),
          h('span', { class: `hit-utr${x.utr ? '' : ' none'}` }, x.utr || (x.hasUtrFile ? (x.utrStatus || 'NO UTR') : 'UTR file not loaded')), btn);
      }));
      searchNote.textContent = !r.ready ? 'Choose the monthly file and the UTR file first, then search here.'
        : (!r.hasUtr ? 'Load the UTR file (Alt+U) to be able to copy UTRs.' : (items.length ? `${items.length}${items.length === 50 ? '+' : ''} found. Up / Down choose, Enter copies the UTR, Right goes to Copy UTR.` : 'No invoice like that.'));
      selectRow(0);
    }
    async function copyAt(n) {
      const x = items[n]; if (!x) return;
      error.textContent = '';
      try { const r = await api.fsc.copyUtr(x.row); A.toast(`Copied UTR ${r.utr} (${r.gstLot})`); }
      catch (e) { error.textContent = e.message; A.toast(e.message); }
      qBox.focus(); qBox.select();
    }
    qBox.addEventListener('input', search); pBox.addEventListener('input', search);
    const searchKeys = (ev, name) => {
      const el = ev.target;
      const inSearch = el === qBox || el === pBox; const inCopy = el.classList && el.classList.contains('copy-utr');
      if (!inSearch && !inCopy) return false;
      if (name === 'ArrowDown') { selectRow(sel + 1); if (inCopy && copyBtns[sel]) copyBtns[sel].focus(); return true; }
      if (name === 'ArrowUp') { selectRow(sel - 1); if (inCopy && copyBtns[sel]) copyBtns[sel].focus(); return true; }
      if (name === 'Enter') {
        if (el === pBox) { qBox.focus(); qBox.select(); return true; }
        copyAt(sel); return true;
      }
      if (name === 'ArrowRight' && el === qBox && qBox.selectionEnd === qBox.value.length && copyBtns[sel]) { copyBtns[sel].focus(); return true; }
      if (name === 'ArrowLeft' && inCopy) { qBox.focus(); return true; }
      return false;
    };
    const exportBtns = [];
    function drawResult(r) {
      last = r;
      const t = r.totals;
      exportBtns.forEach((b) => { b.disabled = false; });
      utrBtn.disabled = false; search();
      const bad = r.errorCount > 0 || !t.balanced;
      result.replaceChildren(
        h('div', { class: 'block panel' },
          h('div', { class: 'total-line' }, 'To pay ', h('b', {}, inr2(t.toPay / 100)), `  ·  ${t.accounts} bank accounts  ·  ${t.placedRows} invoices  ·  TDS ${inr2(t.tds / 100)}`),
          r.utr ? h('p', { class: r.utr.returnRows ? 'error' : 'lede' }, (r.utr.returnRows ? `HEADS UP: ${r.utr.returnRows} RETURNED payment${r.utr.returnRows === 1 ? '' : 's'} in the UTR file, ${inr2(r.utr.returnRowsPaise / 100)} (listed first below). ` : 'No returned payments in the UTR file. ') + `${r.utr.matchedAccounts} accounts found, ${r.utr.noUtr} without a UTR.`) : null,
          h('p', { class: bad ? 'error' : 'lede' }, bad
            ? `${r.errorCount ? `${r.errorCount} invoice${r.errorCount === 1 ? ' is' : 's are'} NOT in the payment list (see below). ` : ''}${t.balanced ? '' : 'The amounts do not add up: do not pay from this report. '}`
            : (r.issueCount ? `${r.issueCount} thing${r.issueCount === 1 ? '' : 's'} to look at below. ` : 'Every row is in the list and the amounts add up. ') + `${t.rows} rows read.`)),
        ...r.report.sheets[0].sections.map((s) => window.CashDeskShared.sectionNode(s)));
    }

    async function run() {
      if (busy) return; busy = true; error.textContent = '';
      try {
        const r = await api.fsc.run();
        if (!r.cancelled) { drawResult(r); A.toast(`${r.totals.accounts} bank accounts, ${inr2(r.totals.toPay / 100)} to pay`); qBox.focus(); }
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    async function loadParties() {
      if (busy) return true; busy = true; error.textContent = '';
      try {
        const r = await api.fsc.importParties();
        if (!r.cancelled) {
          parties = await api.fsc.parties(); setParty();
          A.toast(`${r.file}: ${r.added} added, ${r.changed} changed, ${r.same} unchanged`);
          if (r.issues.length) error.textContent = r.issues.slice(0, 4).join(' ');
        }
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
      return true;
    }
    async function exportAs(format) {
      if (!last) { A.toast('Choose the monthly file first'); return true; }
      error.textContent = '';
      try { const r = await api.fsc.export(format); if (!r.cancelled) A.toast(`Saved ${r.path}`); } catch (e) { error.textContent = e.message; }
      return true;
    }

    async function loadUtr() {
      if (busy) return true;
      if (!last) { A.toast('Choose the monthly file first'); return true; }
      busy = true; error.textContent = '';
      try {
        const r = await api.fsc.utr();
        if (!r.cancelled) { drawResult(r); A.toast(r.utr.returnRows ? `${r.utr.returnRows} RETURNED payments in the UTR file` : `UTR: ${r.utr.matchedAccounts} found, ${r.utr.noUtr} missing`); qBox.focus(); }
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
      return true;
    }
    const runBtn = h('button', { class: 'primary', type: 'button', on: { click: run } }, 'Choose the monthly file (Enter)');
    const utrBtn = h('button', { type: 'button', disabled: true, on: { click: loadUtr } }, 'UTR file (U or Alt+U)');
    const xlsxBtn = h('button', { type: 'button', disabled: true, on: { click: () => exportAs('xlsx') } }, 'Excel (Alt+X)');
    const pdfBtn = h('button', { type: 'button', disabled: true, on: { click: () => exportAs('pdf') } }, 'PDF (Alt+P)');
    exportBtns.push(xlsxBtn, pdfBtn);
    const node = page({
      title: 'Service payment',
      hints: ['Alt+F search invoice', 'Enter copy UTR', 'Enter choose the monthly file', 'P party codes file', 'Alt+U UTR file', 'Alt+X Excel', 'Alt+P PDF', 'Esc back'],
      body: [
        h('div', { class: 'block panel fsc-search' },
          h('div', { class: 'fsc-fields' }, qBox, pBox), searchNote, hits),
        h('div', { class: 'block panel' }, partyLine,
          h('p', { class: 'lede' }, 'Each lot: Taxable = Lot amount − Tax amount. TDS = 2% of Taxable, always rounded up to a whole rupee. To pay = Lot amount − TDS. Grouped by bank account number.'),
          error,
          h('div', { class: 'row card' }, runBtn, h('button', { type: 'button', on: { click: loadParties } }, 'Party codes file (P)'), utrBtn, xlsxBtn, pdfBtn)),
        result,
      ],
    });
    A.show(node);
    Keys.setScreen({
      root: node, onSubmit: run, onEsc: () => { const el = document.activeElement; if ((el === qBox || el === pBox) && el.value) { el.value = ''; search(); } else A.gateway(); },
      hotkeys: {
        P: (ev) => (ev.target.matches('input') ? false : loadParties()), U: (ev) => (ev.target.matches('input') ? false : loadUtr()), 'Alt+U': () => loadUtr(),
        ArrowDown: (ev) => searchKeys(ev, 'ArrowDown'), ArrowUp: (ev) => searchKeys(ev, 'ArrowUp'), Enter: (ev) => searchKeys(ev, 'Enter'),
        ArrowRight: (ev) => searchKeys(ev, 'ArrowRight'), ArrowLeft: (ev) => searchKeys(ev, 'ArrowLeft'),
        'Alt+X': () => exportAs('xlsx'), 'Alt+P': () => exportAs('pdf'), 'Alt+F': () => { qBox.focus(); qBox.select(); },
      },
    });
    runBtn.focus();
    search();
  }

  window.CashDeskScreens.fsc = { open };
})();
