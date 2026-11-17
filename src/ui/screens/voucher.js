'use strict';
// Voucher: person -> amount -> payout -> notes to give -> expense lines -> remark -> confirm. All by keyboard.
(function () {
  const A = window.CashDeskApp;
  const { h, api, F, Keys } = A;
  const { page, piecesText, balanceText, addPerson } = window.CashDeskShared;
  const Splits = window.CashDeskSplits;
  const { DENOMS } = window.CashDeskDenoms;
  const STAGES = ['person', 'amount', 'payout', 'breakup', 'lines', 'remark'];
  const sum = (m) => DENOMS.reduce((t, d) => t + d.value * (m[d.id] || 0), 0);
  const digits = (input, max) => input.addEventListener('input', () => { input.value = F.digitsOnly(input.value).slice(0, max); });

  async function open() {
    let types;
    try { types = (await api.lists.get()).expenseTypes.filter((t) => t.active); } catch (e) { A.toast(e.message); return; }

    const st = { person: null, amount: 0, parts: [], splitLater: false, brought: 0, preview: null, sel: 0, alts: [], altIdx: 0, results: [], pick: 0, stage: 'person' };

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
    // Vouchers from the same person, no fixed limit: a new box appears under the last one each time one is filled and Enter is pressed.
    // Enter on an empty box (or 0) ends the list. The total shows as you go.
    const amts = [amountIn];
    const moreBox = h('div', { class: 'more-vouchers' });
    const totalNote = h('div', { class: 'total-line', hidden: true });
    const partsNow = () => amts.map((i) => Number(i.value || 0)).filter((n) => n > 0);
    function updateTotal() {
      const p = partsNow();
      totalNote.hidden = p.length === 0;
      totalNote.replaceChildren('Total ', h('b', {}, F.inr(p.reduce((t, n) => t + n, 0))), p.length > 1 ? `  ·  ${p.length} vouchers: ${p.join(' + ')}` : '');
    }
    amountIn.addEventListener('input', updateTotal);
    function addVoucherRow() {
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `Voucher ${amts.length + 1} amount` });
      digits(input, 8); input.addEventListener('input', updateTotal);
      amts.push(input);
      moreBox.append(h('label', { class: 'field' }, h('span', {}, `Voucher ${amts.length} (₹)`), input));
      input.focus();
    }
    function clearVoucherRows() { amts.length = 1; moreBox.replaceChildren(); totalNote.hidden = true; }
    const s2 = h('div', { class: 'step', hidden: true },
      h('div', { class: 'amount-row' },
        h('label', { class: 'field' }, h('span', {}, 'Voucher 1 (₹)'), amountIn),
        h('label', { class: 'field' }, h('span', {}, 'Brought by receiver (₹, Tab)'), broughtIn)),
      moreBox, totalNote);

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
      h('p', { class: 'lede', style: 'margin-bottom:8px' }, 'Give = notes and coins you hand over. Back = notes and coins the person hands back to you (small change they bring).'),
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Note / coin'), h('th', { class: 'n' }, 'In drawer'), h('th', { class: 'n' }, 'Give'), h('th', { class: 'n' }, 'Back (from person)'))), h('tbody', {}, gridRows)),
      live);

    // ---- step 5: expense split, one section per voucher ----
    const splits = Splits.create({
      types, parts: [1],
      onFinish: () => { show('remark'); remarkIn.focus(); },
      onBack: () => { show('breakup'); giveIn[DENOMS[0].id].focus(); },
    });
    const s5 = h('div', { class: 'step', hidden: true }, splits.node);

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
      const parts = partsNow();
      if (!parts.length) { A.toast('Enter the voucher amount'); amountIn.focus(); return; }
      st.parts = parts; st.amount = parts.reduce((t, n) => t + n, 0); st.brought = Number(broughtIn.value || 0);
      await loadPreview();
    };
    // Enter on a box: the next box; on the last box, a filled one adds another voucher and an empty one (or 0) carries on.
    const enterOn = async (i) => {
      if (i < amts.length - 1) { amts[i + 1].focus(); amts[i + 1].select(); return; }
      if (Number(amts[i].value || 0) === 0) { if (i === 0) { A.toast('Enter the voucher amount'); return; } await goPreview(); return; }
      addVoucherRow();
    };
    amountIn.addEventListener('keydown', async (e) => {
      if (e.key === 'Backspace' && amountIn.value === '' && amts.length === 1) { e.preventDefault(); show('person'); personIn.focus(); personIn.select(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault(); await enterOn(0);
    });
    broughtIn.addEventListener('keydown', async (e) => {
      if (e.key === 'Backspace' && broughtIn.value === '') { e.preventDefault(); amountIn.focus(); amountIn.select(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault(); await enterOn(0);
    });
    // boxes added later: Backspace on an empty one removes it and goes back up
    moreBox.addEventListener('keydown', async (e) => {
      const i = amts.indexOf(e.target);
      if (i < 1) return;
      if (e.key === 'Enter') { e.preventDefault(); await enterOn(i); }
      else if (e.key === 'Backspace' && e.target.value === '' && i === amts.length - 1) {
        e.preventDefault(); amts.pop(); moreBox.lastElementChild.remove(); updateTotal(); amts[amts.length - 1].focus(); amts[amts.length - 1].select();
      }
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
        st.splitLater = false;
        splits.reset(st.parts, []);
        show('lines'); splits.focus();
      }
    });

    // ---------- step 6 and saving ----------
    remarkIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Backspace' && remarkIn.value === '') { e.preventDefault(); show('lines'); if (st.splitLater) { st.splitLater = false; splits.focus(); } else splits.focusLast(); }
    });
    saveBtn.addEventListener('click', submit);

    let busy = false;
    async function submit() {
      if (busy) return;
      busy = true; error.textContent = '';
      try {
        const c = st.preview.candidates[st.sel];
        const give = read(giveIn), back = read(backIn);
        const lines = st.splitLater ? [] : splits.getLines();
        const newBalance = Number(st.person.balance) + st.amount - c.payout;
        const summaryLines = [['Person', st.person.name], [st.parts.length > 1 ? `Vouchers (${st.parts.length})` : 'Voucher', st.parts.length > 1 ? `${st.parts.map((n) => F.inr(n)).join(' + ')} = ${F.inr(st.amount)}` : F.inr(st.amount)], ['Pay', F.inr(c.payout)], ...(c.brought ? [['Brought by receiver', F.inr(c.brought)]] : []), ['Balance after', balanceText(newBalance)],
          ['Give', piecesText(give) || 'nothing'], ...(sum(back) ? [['Receive back', piecesText(back)]] : []),
          ...(st.splitLater ? [['Expense split', 'later (not split yet)']] : lines.map((l) => [(st.parts.length > 1 ? `V${l.voucherNo} · ` : '') + types.find((t) => t.id === l.expenseTypeId).name, F.inr(l.amount)]))];
        if (remarkIn.value.trim()) summaryLines.push(['Remark', remarkIn.value.trim()]);
        if (!await A.confirmDialog({ title: 'Save this voucher?', lines: summaryLines, yesLabel: 'Save' })) { remarkIn.focus(); return; }
        const payload = { personId: st.person.id, amount: st.amount, parts: st.parts, give, back, lines, splitLater: st.splitLater, remark: remarkIn.value };
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
      st.person = null; st.preview = null; st.amount = 0; st.parts = []; st.splitLater = false; st.brought = 0; clearVoucherRows();
      personIn.value = ''; amountIn.value = ''; broughtIn.value = ''; remarkIn.value = ''; chip.hidden = true; pickList.hidden = true; st.results = [];
      st.splitLater = false; error.textContent = '';
      refreshSummary();
      show('person'); personIn.focus();
      runSearch();
    }

    // ---------- screen ----------
    const node = page({
      title: 'Voucher',
      hints: ['Enter next step', 'Enter on an empty voucher box: continue', 'F8 split the expenses later', 'Backspace on an empty box: back', 'Alt+C new person', 'Esc leave'],
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
        F8: () => { if (st.stage !== 'lines') return false; st.splitLater = true; show('remark'); remarkIn.focus(); A.toast('Expense split left for later'); return true; },
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
