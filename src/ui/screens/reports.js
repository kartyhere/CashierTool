'use strict';
// Reports: pick one of nine, a date range, then see it here and export it as PDF (Alt+P) or Excel (Alt+X).
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page } = window.CashDeskShared;

  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const group = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
  const group2 = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const show = (c, v) => (v === null || v === undefined || v === '' ? '' : (c.kind === 'text' ? String(v) : (c.kind === 'money2' && typeof v === 'number' ? group2(v) : group(v))));

  function sectionNode(s) {
    const total = s.totals ? s.columns.map((c, i) => (s.totals[c.key] !== undefined ? s.totals[c.key] : (i === s.columns.findIndex((x) => s.totals[x.key] === undefined) ? 'Total' : ''))) : null;
    return h('div', { class: 'block panel' },
      s.heading ? h('h3', {}, s.heading) : null,
      s.rows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, s.columns.map((c) => h('th', { class: c.kind === 'text' ? '' : 'n' }, c.label)))),
          h('tbody', {}, s.rows.map((r) => h('tr', {}, s.columns.map((c) => h('td', { class: (c.kind === 'text' ? '' : 'n') + (typeof r[c.key] === 'number' && r[c.key] < 0 ? ' minus' : '') }, show(c, r[c.key])))))
            , total ? h('tr', { class: 'total' }, s.columns.map((c, i) => h('td', { class: c.kind === 'text' ? '' : 'n' }, show(c, total[i])))) : null))
        : h('p', { class: 'lede' }, 'Nothing to show for this period.'));
  }

  window.CashDeskShared.sectionNode = sectionNode;          // the service payment screen draws its tables the same way

  async function open() {
    let reports, lists, people, today;
    try {
      [reports, lists, people, today] = await Promise.all([api.report.list(), api.lists.get(), api.people.search('', 500, true), api.dashboard.get()]);
    } catch (e) { A.toast(e.message); A.gateway(); return; }
    const todayStr = today.day || dayOf(new Date());

    const reportSel = h('select', { 'aria-label': 'Report', data: { field: '1' } }, reports.map((r) => h('option', { value: r.id }, r.label)));
    const from = h('input', { type: 'text', value: todayStr, autocomplete: 'off', 'aria-label': 'From date', data: { field: '1' }, placeholder: 'YYYY-MM-DD' });
    const to = h('input', { type: 'text', value: todayStr, autocomplete: 'off', 'aria-label': 'To date', data: { field: '1' }, placeholder: 'YYYY-MM-DD' });
    const personSel = h('select', { 'aria-label': 'Person', data: { field: '1' } }, h('option', { value: '' }, 'Everyone'), people.people.map((p) => h('option', { value: String(p.id) }, p.name + (p.department ? ` (${p.department})` : ''))));
    const bankSel = h('select', { 'aria-label': 'Bank', data: { field: '1' } }, h('option', { value: '' }, 'All banks'), lists.banks.map((b) => h('option', { value: String(b.id) }, b.name)));
    const personRow = h('label', { class: 'field' }, h('span', {}, 'Person (optional)'), personSel);
    const bankRow = h('label', { class: 'field' }, h('span', {}, 'Bank (optional)'), bankSel);
    const result = h('div', { class: 'reportview' }, h('p', { class: 'lede' }, 'Press Enter to see the report.'));
    const error = h('div', { class: 'error', role: 'alert' });
    let busy = false;

    for (const i of [from, to]) i.addEventListener('input', () => { i.value = i.value.replace(/[^0-9-]/g, '').slice(0, 10); });
    function syncFilters() {
      const need = (reports.find((r) => r.id === reportSel.value) || {}).needs;
      personRow.hidden = need !== 'person'; bankRow.hidden = need !== 'bank';
      personSel.disabled = personRow.hidden; bankSel.disabled = bankRow.hidden;
    }
    reportSel.addEventListener('change', () => { syncFilters(); result.replaceChildren(h('p', { class: 'lede' }, 'Press Enter to see the report.')); });
    syncFilters();

    const params = () => ({
      report: reportSel.value, from: from.value, to: to.value,
      personId: !personSel.disabled && personSel.value ? Number(personSel.value) : undefined,
      bankId: !bankSel.disabled && bankSel.value ? Number(bankSel.value) : undefined,
    });

    async function run() {
      if (busy) return;
      error.textContent = ''; busy = true;
      try {
        const r = await api.report.run(params());
        result.replaceChildren(h('h2', {}, `${r.title} · ${r.subtitle}`), ...r.sections.map(sectionNode));
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }
    async function exportAs(format) {
      error.textContent = '';
      try {
        const r = await api.report.export({ ...params(), format });
        if (!r.cancelled) A.toast(`Saved ${r.path}`);
      } catch (e) { error.textContent = e.message; }
    }
    const setRange = (a, b) => { from.value = a; to.value = b; run(); return true; };

    const node = page({
      title: 'Reports',
      hints: ['Enter next, then show', 'Alt+P PDF', 'Alt+X Excel', 'Alt+M this month', 'Alt+T today', 'Esc back'],
      body: [
        h('div', { class: 'block panel' },
          h('div', { class: 'cols' },
            h('div', {}, h('label', { class: 'field' }, h('span', {}, 'Report'), reportSel), personRow, bankRow),
            h('div', {}, h('label', { class: 'field' }, h('span', {}, 'From'), from), h('label', { class: 'field' }, h('span', {}, 'To'), to))),
          error,
          h('div', { class: 'row card' }, h('button', { class: 'primary', type: 'button', on: { click: run } }, 'Show'),
            h('button', { type: 'button', on: { click: () => exportAs('pdf') } }, 'PDF'), h('button', { type: 'button', on: { click: () => exportAs('xlsx') } }, 'Excel'))),
        result,
      ],
    });
    A.show(node);
    Keys.setScreen({
      root: node, onSubmit: run, onEsc: () => A.gateway(),
      hotkeys: {
        'Alt+P': () => { exportAs('pdf'); return true; },
        'Alt+X': () => { exportAs('xlsx'); return true; },
        'Alt+T': () => setRange(todayStr, todayStr),
        'Alt+M': () => { const d = new Date(`${todayStr}T12:00:00`); return setRange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, todayStr); },
      },
    });
    reportSel.focus();
  }

  window.CashDeskScreens.reports = { open };
})();
