'use strict';
// Voucher: person -> amount -> payout -> notes to give -> expense lines -> remark -> confirm. All by keyboard.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page, piecesText, balanceText, addPerson } = window.CashDeskShared;
  const { DENOMS } = window.CashDeskDenoms;
  const NEW = '__new';
  const STAGES = ['person', 'amount', 'payout', 'breakup', 'lines', 'remark'];
  const sum = (m) => DENOMS.reduce((t, d) => t + d.value * (m[d.id] || 0), 0);
  const digits = (input, max) => input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, max); });

  async function open() {
    let types;
    try { types = (await api.lists.get()).expenseTypes.filter((t) => t.active); } catch (e) { A.toast(e.message); return; }

    const st = { person: null, amount: 0, brought: 0, preview: null, sel: 0, alts: [], altIdx: 0, results: [], pick: 0, stage: 'person' };

    // ---- step 1: person ----
    const personIn = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Type a name', 'aria-label': 'Person' });
    const pickList = h('div', { class: 'pick', hidden: true });
    const chip = h('div', { class: 'chip', hidden: true });
    const s1 = h('div', { class: 'step' }, h('label', { class: 'field' }, h('span', {}, 'Person (Alt+C adds a new one)'), personIn), pickList, chip);

    // ---- step 2: amount ----
    const amountIn = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Voucher amount' });
    digits(amountIn, 8);
    const broughtIn = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Brought by receiver' });
    digits(broughtIn, 8);
    const s2 = h('div', { class: 'step amount-row', hidden: true },
      h('label', { class: 'field' }, h('span', {}, 'Voucher amount (₹)'), amountIn),
      h('label', { class: 'field' }, h('span', {}, 'Brought by receiver (₹, Tab)'), broughtIn));

    // ---- step 3: payout ----
    const cards = h('div', { class: 'cards', tabindex: '0', 'aria-label': 'Payout choices' });
    const s3 = h('div', { class: 'step', hidden: true }, h('div', { class: 'field' }, h('span', {}, 'Pay (← → choose, Enter accept, O type another amount)')), cards);

    // ---- step 4: notes to give ----
    const giveIn = {}, backIn = {}, stockCell = {};
    const live = h('div', { class: 'live' });
    const gridRows = DENOMS.map((d) => {
      const g = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${d.label} give`, data: { col: 'give', denom: d.id } });
      const b = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'back', 'aria-label': `${d.label} back`, data: { col: 'back', denom: d.id } });
      digits(g, 6); digits(b, 6);
      g.addEventListener('input', updateLive); b.addEventListener('input', updateLive);
      giveIn[d.id] = g; backIn[d.id] = b; stockCell[d.id] = h('td', { class: 'n' }, '0');
      return h('tr', {}, h('td', {}, d.label), stockCell[d.id], h('td', { class: 'n' }, g), h('td', { class: 'n' }, b));
    });
    const s4 = h('div', { class: 'step', hidden: true },
      h('div', { class: 'field' }, h('span', {}, 'Notes and coins (↑ ↓ move, A other breakup, Enter accept)')),
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'In drawer'), h('th', { class: 'n' }, 'Give'), h('th', { class: 'n' }, 'Back'))), h('tbody', {}, gridRows)),
      live);

    // ---- step 5: expense lines ----
    const linesBody = h('tbody', {});
    const linesFoot = h('div', { class: 'live' });
    const s5 = h('div', { class: 'step', hidden: true },
      h('div', { class: 'field' }, h('span', {}, 'Expense lines (Enter on an empty type finishes)')),
      h('table', { class: 'lines-grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', { class: 'n' }, 'Amount ₹'), h('th', {}, 'Note'))), linesBody), linesFoot);

    // ---- step 6: remark ----
    const remarkIn = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Remark' });
    const error = h('div', { class: 'error', role: 'alert' });
    const saveBtn = h('button', { class: 'primary', type: 'button' }, 'Review and save');
    const s6 = h('div', { class: 'step', hidden: true }, h('label', { class: 'field' }, h('span', {}, 'Remark (optional)'), remarkIn), error, h('div', { class: 'row card' }, saveBtn));

    // ---- summary pane ----
    const summary = h('div', { class: 'block panel' });
    const steps = { person: s1, amount: s2, payout: s3, breakup: s4, lines: s5, remark: s6 };

    function show(stage) {
      st.stage = stage;
      const upto = STAGES.indexOf(stage);
      STAGES.forEach((k, i) => { steps[k].hidden = i > upto; });
    }

    // ---------- summary ----------
    async function refreshSummary() {
      let dash = null, hist = null;
      try { dash = await api.dashboard.get(); if (st.person) hist = await api.people.history(st.person.id, 5); } catch (e) { /* shown elsewhere */ }
      const rows = hist ? hist.entries.map((e) => h('tr', {}, h('td', {}, e.day.slice(5)), h('td', {}, e.type === 'settle' ? 'Settle' : 'Voucher'),
        h('td', { class: 'n' }, F.inr(e.type === 'settle' ? Math.abs(e.balanceDelta) : e.voucherAmount, { symbol: false })), h('td', { class: 'n' }, F.inr(e.paid, { symbol: false })))) : [];
      summary.replaceChildren(...[
        h('h3', {}, st.person ? st.person.name : 'Person'),
        st.person ? h('p', { class: 'lede', style: 'margin-bottom:12px' }, `${st.person.department || 'No department'} · ${balanceText(hist ? hist.person.balance : st.person.balance)}`) : h('p', { class: 'lede' }, 'Pick a person to see their last entries.'),
        hist && rows.length ? h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, ''), h('th', { class: 'n' }, 'Voucher'), h('th', { class: 'n' }, 'Paid'))), h('tbody', {}, rows)) : null,
        dash ? h('p', { class: 'lede', style: 'margin-top:14px' }, `Drawer ${F.inr(dash.drawer.total)} · paid today ${F.inr(dash.figures.payments)}`) : null].filter(Boolean));
    }

    // ---------- step 1 ----------
    let searchSeq = 0;
    async function runSearch() {
      const seq = ++searchSeq;
      try {
        const { people } = await api.people.search(personIn.value, 8);
        if (seq !== searchSeq) return;
        st.results = people; st.pick = 0;
        pickList.hidden = !people.length;
        pickList.replaceChildren(...people.map((p, i) => h('div', { class: i === 0 ? 'on' : '' },
          h('span', {}, p.name, p.department ? h('small', {}, ` · ${p.department}`) : null), h('small', {}, balanceText(p.balance)))));
      } catch (e) { A.toast(e.message); }
    }
    function markPick() { [...pickList.children].forEach((c, i) => c.classList.toggle('on', i === st.pick)); }
    function choose(p) {
      st.person = p;
      pickList.hidden = true;
      chip.hidden = false; chip.textContent = `${p.name} · ${balanceText(p.balance)}`;
      personIn.value = p.name;
      refreshSummary();
      show('amount'); amountIn.value = ''; amountIn.focus();
    }
    personIn.addEventListener('input', () => { st.person = null; chip.hidden = true; runSearch(); });
    personIn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!st.results.length) return;
        e.preventDefault(); st.pick = (st.pick + (e.key === 'ArrowDown' ? 1 : -1) + st.results.length) % st.results.length; markPick();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (st.results[st.pick]) choose(st.results[st.pick]);
        else A.toast('No match. Press Alt+C to add this person');
      }
    });

    // ---------- step 2 ----------
    const goPreview = async () => {
      const n = Number(amountIn.value);
      if (!n) { A.toast('Enter the voucher amount'); amountIn.focus(); return; }
      st.amount = n; st.brought = Number(broughtIn.value || 0);
      await loadPreview();
    };
    amountIn.addEventListener('keydown', async (e) => {
      if (e.key === 'Backspace' && amountIn.value === '') { e.preventDefault(); show('person'); personIn.focus(); personIn.select(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault(); await goPreview();
    });
    broughtIn.addEventListener('keydown', async (e) => {
      if (e.key === 'Backspace' && broughtIn.value === '') { e.preventDefault(); amountIn.focus(); amountIn.select(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault(); await goPreview();
    });
    async function loadPreview(customPayout) {
      try {
        st.preview = await api.voucher.preview({ personId: st.person.id, amount: st.amount, brought: st.brought, ...(customPayout !== undefined ? { payout: customPayout } : {}) });
      } catch (e) { A.toast(e.message); return; }
      st.sel = 0;
      renderCards(); show('payout'); cards.focus();
    }

    // ---------- step 3 ----------
    function renderCards() {
      const names = Object.fromEntries(DENOMS.map((d) => [d.id, d.label]));
      cards.replaceChildren(...st.preview.candidates.map((c, i) => h('div', { class: 'card-opt' + (i === st.sel ? ' on' : '') },
        c.exact ? h('span', { class: 'tag' }, 'Custom') : null,
        h('b', {}, F.inr(c.gross)),
        c.exact ? h('span', {}, c.brought ? `receiver brings back ${F.inr(c.brought)}` : 'exact voucher amount') : null,
        h('span', {}, c.newBalance === 0 ? 'balance settled' : `then ${balanceText(c.newBalance)}`),
        c.custom ? h('span', { class: 'warn' }, 'typed by hand') : null,
        !c.withinLimit ? h('span', { class: 'warn' }, 'outside the balance limit') : null,
        !c.payable ? h('span', { class: 'warn' }, `not payable${c.shortBy.length ? ': needs ' + c.shortBy.map((id) => names[id]).join(', ') : ''}`) : null)));
    }
    cards.addEventListener('keydown', async (e) => {
      const n = st.preview.candidates.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); st.sel = (st.sel + (e.key === 'ArrowRight' ? 1 : -1) + n) % n; renderCards(); }
      else if (e.key === 'Backspace') { e.preventDefault(); show('amount'); amountIn.focus(); amountIn.select(); }
      else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        const v = await A.promptDialog({ title: 'Pay another amount', label: 'Amount to pay (₹)', digits: true });
        if (v !== null && v !== '') loadPreview(Number(v)); else cards.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = st.preview.candidates[st.sel];
        if (!c.payable) { A.toast('The drawer cannot make that amount'); return; }
        st.alts = c.breakups; st.altIdx = 0;
        for (const d of DENOMS) { stockCell[d.id].textContent = String(st.preview.drawer.rows.find((r) => r.id === d.id).qty); backIn[d.id].value = ''; }
        setGive(st.alts[0]);
        if (c.brought) { let left = c.brought; for (const d of [...DENOMS].sort((x, y) => y.value - x.value)) { const q = Math.floor(left / d.value); if (q) { backIn[d.id].value = String(q); left -= q * d.value; } } updateLive(); }
        show('breakup'); giveIn[DENOMS[0].id].focus(); giveIn[DENOMS[0].id].select();
      }
    });

    // ---------- step 4 ----------
    const read = (map) => Object.fromEntries(DENOMS.map((d) => [d.id, Number(map[d.id].value || 0)]));
    function setGive(p) { for (const d of DENOMS) giveIn[d.id].value = p[d.id] ? String(p[d.id]) : ''; updateLive(); }
    function updateLive() {
      if (!st.preview) return;
      const c = st.preview.candidates[st.sel];
      const net = sum(read(giveIn)) - sum(read(backIn));
      const diff = net - c.payout;
      live.textContent = diff === 0 ? `Net ${F.inr(net)} matches the payout` : `Net ${F.inr(net)}: ${diff > 0 ? F.inr(diff) + ' too much' : F.inr(-diff) + ' short'} of ${F.inr(c.payout)}`;
      live.classList.toggle('ok', diff === 0);
    }
    s4.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t.dataset || !t.dataset.denom) return;
      const i = DENOMS.findIndex((d) => d.id === t.dataset.denom);
      const col = t.dataset.col === 'give' ? giveIn : backIn;
      if (e.key === 'ArrowDown') { e.preventDefault(); const n = col[DENOMS[(i + 1) % DENOMS.length].id]; n.focus(); n.select(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); const n = col[DENOMS[(i + DENOMS.length - 1) % DENOMS.length].id]; n.focus(); n.select(); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (st.alts.length > 1) { st.altIdx = (st.altIdx + 1) % st.alts.length; setGive(st.alts[st.altIdx]); A.toast(`Breakup ${st.altIdx + 1} of ${st.alts.length}`); } else A.toast('No other breakup'); }
      else if (e.key === 'Backspace' && t.value === '' && i === 0 && t.dataset.col === 'give') { e.preventDefault(); show('payout'); cards.focus(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const c = st.preview.candidates[st.sel];
        const give = read(giveIn), back = read(backIn);
        if (sum(give) - sum(back) !== c.payout) { A.toast(`Notes given minus received must be ${F.inr(c.payout)}`); return; }
        const short = DENOMS.find((d) => give[d.id] - back[d.id] > st.preview.drawer.rows.find((r) => r.id === d.id).qty);
        if (short) { A.toast(`The drawer has fewer ${short.label} than you are giving`); return; }
        if (!linesBody.children.length) addLine();
        show('lines'); linesBody.querySelector('select').focus();
      }
    });

    // ---------- step 5 ----------
    const typeOptions = () => [h('option', { value: '' }, ''), ...types.map((t) => h('option', { value: String(t.id) }, t.name)), h('option', { value: NEW }, '+ New…')];
    const lineTotal = () => [...linesBody.querySelectorAll('input.amt')].reduce((t, i) => t + Number(i.value || 0), 0);
    const remaining = () => st.amount - lineTotal();
    function updateLinesFoot() {
      const left = remaining();
      linesFoot.textContent = `Lines ${F.inr(lineTotal())} of ${F.inr(st.amount)}${left ? ` · ${left > 0 ? F.inr(left) + ' left to split' : F.inr(-left) + ' too much'}` : ' · fully split'}`;
      linesFoot.classList.toggle('ok', left === 0);
    }
    function addLine() {
      const sel = h('select', { 'aria-label': 'Expense type' }, typeOptions());
      const amt = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'amt', 'aria-label': 'Line amount' });
      const note = h('input', { type: 'text', autocomplete: 'off', class: 'note', 'aria-label': 'Line note' });
      digits(amt, 8);
      amt.addEventListener('input', updateLinesFoot);
      const row = h('tr', {}, h('td', {}, sel), h('td', { class: 'n' }, amt), h('td', {}, note));
      sel.addEventListener('keydown', async (e) => {
        if (e.key === 'Backspace') {
          e.preventDefault();
          const rows = [...linesBody.children]; const i = rows.indexOf(row);
          if (i === 0) { show('breakup'); giveIn[DENOMS[0].id].focus(); return; }
          row.remove(); updateLinesFoot(); rows[i - 1].querySelector('input.note').focus(); return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (sel.value === NEW) {
          const name = await A.promptDialog({ title: 'New expense type', label: 'Name' });
          if (name === null) { sel.focus(); return; }
          try {
            const { id } = await api.lists.save({ list: 'expenseTypes', name });
            types.push({ id, name: name.trim(), active: true });
            linesBody.querySelectorAll('select').forEach((s) => { const keep = s.value; s.replaceChildren(...typeOptions()); s.value = keep; });
            sel.value = String(id);
          } catch (err) { A.toast(err.message); sel.focus(); return; }
        }
        if (sel.value === '') {
          const rows = [...linesBody.children];
          if (rows.indexOf(row) === 0) { A.toast('Choose an expense type'); return; }
          if (remaining() !== 0) { A.toast(`Split the remaining ${F.inr(remaining())} first`); return; }
          row.remove(); updateLinesFoot(); show('remark'); remarkIn.focus(); return;
        }
        if (!amt.value && remaining() > 0) amt.value = String(remaining());
        updateLinesFoot(); amt.focus(); amt.select();
      });
      amt.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && amt.value === '') { e.preventDefault(); sel.focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (Number(amt.value) < 1) { A.toast('Enter the line amount'); return; } if (Number(amt.value) > st.amount) { A.toast('That is more than the voucher'); return; } note.focus(); }
      });
      note.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && note.value === '') { e.preventDefault(); amt.focus(); amt.select(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (remaining() > 0) { addLine(); linesBody.lastElementChild.querySelector('select').focus(); }
          else if (remaining() < 0) A.toast(`The lines are ${F.inr(-remaining())} more than the voucher`);
          else { show('remark'); remarkIn.focus(); }
        }
      });
      linesBody.append(row);
      updateLinesFoot();
    }

    // ---------- step 6 and saving ----------
    remarkIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Backspace' && remarkIn.value === '') { e.preventDefault(); show('lines'); const rows = linesBody.children; rows[rows.length - 1].querySelector('input.note').focus(); }
    });
    saveBtn.addEventListener('click', submit);

    let busy = false;
    async function submit() {
      if (busy) return;
      busy = true; error.textContent = '';
      try {
        const c = st.preview.candidates[st.sel];
        const give = read(giveIn), back = read(backIn);
        const lines = [...linesBody.children].map((row) => ({
          expenseTypeId: Number(row.querySelector('select').value), amount: Number(row.querySelector('input.amt').value), note: row.querySelector('input.note').value,
        })).filter((l) => l.expenseTypeId && l.amount);
        const newBalance = Number(st.person.balance) + st.amount - c.payout;
        const summaryLines = [['Person', st.person.name], ['Voucher', F.inr(st.amount)], ['Pay', F.inr(c.payout)], ...(c.brought ? [['Brought by receiver', F.inr(c.brought)]] : []), ['Balance after', balanceText(newBalance)],
          ['Give', piecesText(give) || 'nothing'], ...(sum(back) ? [['Receive back', piecesText(back)]] : []),
          ...lines.map((l) => [types.find((t) => t.id === l.expenseTypeId).name, F.inr(l.amount)])];
        if (remarkIn.value.trim()) summaryLines.push(['Remark', remarkIn.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this voucher?', lines: summaryLines, yesLabel: 'Save' })) { remarkIn.focus(); return; }
        const payload = { personId: st.person.id, amount: st.amount, give, back, lines, remark: remarkIn.value };
        let result;
        try { result = await api.voucher.save(payload); } catch (e) {
          if (e.code !== 'CONFIRM_LIMIT') throw e;
          if (!await A.confirmDialog({ title: 'Outside the balance limit', text: e.message, yesLabel: 'Save anyway' })) { remarkIn.focus(); return; }
          result = await api.voucher.save({ ...payload, confirmLimit: true });
        }
        A.toast(`Voucher saved: ${F.inr(result.paid)} paid to ${result.personName}`);
        reset();
      } catch (e) { error.textContent = e.message; } finally { busy = false; }
    }

    function reset() {
      st.person = null; st.preview = null; st.amount = 0; st.brought = 0;
      personIn.value = ''; amountIn.value = ''; broughtIn.value = ''; remarkIn.value = ''; chip.hidden = true; pickList.hidden = true; st.results = [];
      linesBody.replaceChildren(); error.textContent = '';
      refreshSummary();
      show('person'); personIn.focus();
      runSearch();
    }

    // ---------- screen ----------
    const node = page({
      title: 'Voucher',
      hints: ['Enter next step', 'Backspace on an empty box: back', 'Alt+C new person', 'Esc leave'],
      body: h('div', { class: 'cols' }, h('div', { class: 'block panel' }, s1, s2, s3, s4, s5, s6), summary),
    });
    A.show(node);
    Keys.setScreen({
      root: node,
      dirty: () => Boolean(st.person),
      onEsc: async () => {
        if (st.person && !await A.confirmDialog({ title: 'Leave this voucher?', text: 'Nothing has been saved.', yesLabel: 'Leave' })) return;
        A.gateway();
      },
      hotkeys: {
        'Alt+C': async () => {
          const id = await addPerson(personIn.value);
          if (id) { const { people } = await api.people.search('', 500); const p = people.find((x) => x.id === id); if (p) choose(p); }
        },
      },
    });
    refreshSummary(); runSearch();
    personIn.focus();
  }

  window.CashDeskScreens.voucher = { open };
})();
