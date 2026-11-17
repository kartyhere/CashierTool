'use strict';
// The nine reports. Each one is built as plain tables: { title, subtitle, sections: [{ heading, columns, rows, totals }] }.
// The same tables are drawn on screen, and written to PDF and Excel, so the three always agree.
// Column kinds: text, int (counts), money (whole rupees). Reading only: nothing here changes the books.
const { DENOMS } = require('../core/denoms');
const { figures } = require('../core/dayfigures');
const { UserError } = require('../errors');

const REPORTS = [
  { id: 'cashbook', label: 'Cash book', key: 'C', file: 'CashBook' },
  { id: 'denomination', label: 'Denomination report', key: 'D', file: 'Denominations' },
  { id: 'entries', label: 'Day entries', key: 'E', file: 'DayEntries' },
  { id: 'vouchers', label: 'Voucher register', key: 'V', file: 'Vouchers' },
  { id: 'payments', label: 'Payments by person', key: 'P', file: 'PaymentsByPerson', needs: 'person' },
  { id: 'expenses', label: 'Expense summary', key: 'X', file: 'Expenses' },
  { id: 'receipts', label: 'Receipts by source', key: 'R', file: 'Receipts' },
  { id: 'deposits', label: 'Bank deposits', key: 'B', file: 'BankDeposits', needs: 'bank' },
  { id: 'balances', label: 'Person balances', key: 'L', file: 'PersonBalances' },
];

const TYPE_LABEL = { opening: 'Opening count', voucher: 'Voucher', cash_in: 'Cash in', bank_deposit: 'Bank deposit', exchange: 'Exchange', settle: 'Settle', count_adjust: 'Count adjustment' };
const SOURCE_LABEL = { customer: 'Customer', branch: 'Branch', department: 'Department', bank_withdrawal: 'Bank withdrawal', other: 'Other' };
const dayOk = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const timeOf = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
const col = (key, label, kind = 'text') => ({ key, label, kind });
const days = (entries) => [...new Set(entries.map((e) => e.day))];
const breakup = (pieces) => pieces.filter((p) => p.qty !== 0).sort((a, b) => DENOMS.findIndex((d) => d.id === a.denom_id) - DENOMS.findIndex((d) => d.id === b.denom_id))
  .map((p) => `${p.qty > 0 ? '+' : '−'}${Math.abs(p.qty)}×${p.denom_id.slice(0, 1) === 'C' ? 'c' : ''}${p.denom_id.slice(1)}`).join(' ');

function groupSum(rows, keyFn, valueFn) {
  const map = new Map();
  for (const r of rows) { const k = keyFn(r); const g = map.get(k) || { count: 0, amount: 0 }; g.count += 1; g.amount += valueFn(r); map.set(k, g); }
  return map;
}

const BUILDERS = {
  cashbook({ entries, repo, from, to }) {
    const deltas = repo.entryDeltas();
    const closes = new Map(repo.dayClosesRange(from, to).map((c) => [c.day, c]));
    const checks = repo.tallyRange(from, to);
    const rows = days(entries).map((day) => {
      const f = figures(deltas, day);
      const c = closes.get(day);
      const last = checks.filter((t) => t.day === day).pop();
      const tally = c && c.tally_balance !== null ? c.tally_balance : last ? last.tally_balance : null;
      return { day, opening: f.opening, receipts: f.receipts, payments: f.payments, deposits: f.deposits, closing: f.closing,
        tally, difference: tally === null ? null : f.closing - tally, status: c && c.status === 'closed' ? 'Closed' : 'Open' };
    });
    const money = (k, l) => col(k, l, 'money');
    const inflow = entries.filter((e) => e.type === 'cash_in' || (e.type === 'settle' && e.cash_delta > 0));
    const bySource = groupSum(inflow, (e) => (e.type === 'settle' ? 'Collected from people' : SOURCE_LABEL[e.source] || 'Other'), (e) => e.cash_delta);
    const outflow = entries.filter((e) => e.type === 'voucher' || (e.type === 'settle' && e.cash_delta < 0));
    const byPay = groupSum(outflow, (e) => (e.type === 'settle' ? 'Settled to people' : 'Vouchers paid'), (e) => -e.cash_delta);
    const byBank = groupSum(entries.filter((e) => e.type === 'bank_deposit'), (e) => e.bank_name || 'Bank', (e) => -e.cash_delta);
    const list = (m) => [...m].map(([name, g]) => ({ name, count: g.count, amount: g.amount }));
    return [
      { heading: 'Day by day', columns: [col('day', 'Day'), money('opening', 'Opening'), money('receipts', 'Receipts'), money('payments', 'Payments'), money('deposits', 'Bank deposits'),
        money('closing', 'Closing'), money('tally', 'Tally'), money('difference', 'App − Tally'), col('status', 'Status')],
      rows, totals: { receipts: sum(rows, 'receipts'), payments: sum(rows, 'payments'), deposits: sum(rows, 'deposits') } },
      { heading: 'Receipts by source', columns: [col('name', 'Source'), col('count', 'Entries', 'int'), money('amount', 'Amount')], rows: list(bySource), totals: { amount: sum(list(bySource), 'amount') } },
      { heading: 'Payments', columns: [col('name', 'Kind'), col('count', 'Entries', 'int'), money('amount', 'Amount')], rows: list(byPay), totals: { amount: sum(list(byPay), 'amount') } },
      { heading: 'Bank deposits', columns: [col('name', 'Bank'), col('count', 'Deposits', 'int'), money('amount', 'Amount')], rows: list(byBank), totals: { amount: sum(list(byBank), 'amount') } },
      { heading: 'Tally checks', columns: [col('day', 'Day'), col('time', 'Time'), money('system', 'App'), money('tally', 'Tally'), money('difference', 'App − Tally'), col('remark', 'Remark'), col('by', 'By')],
        rows: checks.map((t) => ({ day: t.day, time: timeOf(t.at), system: t.system_balance, tally: t.tally_balance, difference: t.system_balance - t.tally_balance, remark: t.remark || '', by: t.user_name })) },
    ];
  },

  denomination({ entries, repo, from, to }) {
    const pieces = repo.reportPieces(from, to);
    const closes = new Map(repo.dayClosesRange(from, to).map((c) => [c.day, c]));
    const rows = []; const totals = [];
    for (const day of days(entries)) {
      const open = repo.openingPieces(day);
      const inn = {}; const out = {};
      for (const p of pieces) {
        if (p.day !== day || p.type === 'opening' || p.type === 'count_adjust') continue;
        const bucket = p.qty > 0 ? inn : out;
        bucket[p.denom_id] = (bucket[p.denom_id] || 0) + Math.abs(p.qty);
      }
      const c = closes.get(day) && closes.get(day).status === 'closed' ? JSON.parse(closes.get(day).counted_json).pieces : null;
      const t = { day, opening: 0, in: 0, out: 0, expected: 0, counted: c ? 0 : null, difference: c ? 0 : null };
      for (const d of DENOMS) {
        const o = open[d.id] || 0; const i = inn[d.id] || 0; const u = out[d.id] || 0; const exp = o + i - u; const cn = c ? (c[d.id] || 0) : null;
        t.opening += o * d.value; t.in += i * d.value; t.out += u * d.value; t.expected += exp * d.value;
        if (c) { t.counted += cn * d.value; t.difference += (cn - exp) * d.value; }
        if (o || i || u || exp || cn) rows.push({ day, denom: d.label, opening: o, in: i, out: u, expected: exp, counted: cn, difference: c ? cn - exp : null });
      }
      totals.push(t);
    }
    const money = (k, l) => col(k, l, 'money');
    return [
      { heading: 'By note and coin (pieces)', columns: [col('day', 'Day'), col('denom', 'Note / coin'), col('opening', 'Opening', 'int'), col('in', 'In', 'int'), col('out', 'Out', 'int'),
        col('expected', 'Expected', 'int'), col('counted', 'Counted', 'int'), col('difference', 'Difference', 'int')], rows },
      { heading: 'Day totals (rupees)', columns: [col('day', 'Day'), money('opening', 'Opening'), money('in', 'In'), money('out', 'Out'), money('expected', 'Expected'), money('counted', 'Counted'), money('difference', 'Difference')], rows: totals },
      { heading: `Bank balances at ${to}`, columns: [col('name', 'Bank'), money('balance', 'Balance')], rows: repo.banksAsOf(to), totals: { balance: sum(repo.banksAsOf(to), 'balance') } },
    ];
  },

  entries({ entries, repo, from, to }) {
    const pieces = repo.reportPieces(from, to);
    const rows = entries.map((e) => {
      const who = e.type === 'voucher' || e.type === 'settle' ? e.person_name : e.type === 'bank_deposit' ? e.bank_name
        : e.source === 'branch' ? e.branch_name : e.source === 'department' ? e.department_name : e.source === 'bank_withdrawal' ? e.bank_name : e.party_name;
      return { day: e.day, time: timeOf(e.created_at), no: e.id, type: TYPE_LABEL[e.type], who: who || '', department: e.department_name || '',
        amount: e.voucher_amount || Math.abs(e.cash_delta), cash: e.cash_delta, balance: e.balance_delta, breakup: breakup(pieces.filter((p) => p.entry_id === e.id)),
        by: e.user_name, note: [e.reference, e.remark].filter(Boolean).join(' · '), flag: e.flag ? 'Outside limit' : '' };
    });
    return [{ heading: null, columns: [col('day', 'Day'), col('time', 'Time'), col('no', 'No', 'int'), col('type', 'Type'), col('who', 'Person / source'), col('department', 'Department'),
      col('amount', 'Amount', 'money'), col('cash', 'Cash change', 'money'), col('balance', 'Balance change', 'money'), col('breakup', 'Notes (+ in, − out)'), col('by', 'By'), col('note', 'Reference / remark'), col('flag', 'Flag')], rows,
    totals: { cash: sum(rows, 'cash'), balance: sum(rows, 'balance') } }];
  },

  vouchers({ entries, repo, from, to }) {
    const lines = repo.reportLines(from, to);
    const rows = [];
    for (const e of entries.filter((x) => x.type === 'voucher')) {
      lines.filter((l) => l.entry_id === e.id).forEach((l, i) => rows.push({ day: e.day, no: e.id, person: e.person_name || '', department: e.department_name || '', type: l.type, line: l.amount, note: l.note || '',
        amount: i === 0 ? e.voucher_amount : null, paid: i === 0 ? -e.cash_delta : null, balance: i === 0 ? e.balance_delta : null }));
    }
    return [{ heading: null, columns: [col('day', 'Day'), col('no', 'No', 'int'), col('person', 'Person'), col('department', 'Department'), col('type', 'Expense type'), col('line', 'Line amount', 'money'),
      col('note', 'Note'), col('amount', 'Voucher', 'money'), col('paid', 'Paid', 'money'), col('balance', 'Balance change', 'money')], rows,
    totals: { line: sum(rows, 'line'), amount: sum(rows, 'amount'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance') } }];
  },

  payments({ entries, repo, personId, to }) {
    const names = new Map(repo.peopleBalancesAsOf(to).map((p) => [p.id, p]));
    const per = new Map();
    for (const e of entries) {
      if (!e.person_id || (e.type !== 'voucher' && e.type !== 'settle')) continue;
      if (personId && e.person_id !== personId) continue;
      const r = per.get(e.person_id) || { vouchers: 0, amount: 0, paid: 0, settledOut: 0, collected: 0 };
      if (e.type === 'voucher') { r.vouchers += 1; r.amount += e.voucher_amount; r.paid -= e.cash_delta; }
      else if (e.cash_delta < 0) r.settledOut -= e.cash_delta; else r.collected += e.cash_delta;
      per.set(e.person_id, r);
    }
    const rows = [...per].map(([id, r]) => ({ person: names.get(id).name, department: names.get(id).department || '', ...r, balance: names.get(id).balance }))
      .sort((a, b) => a.person.localeCompare(b.person));
    const m = (k, l) => col(k, l, 'money');
    return [{ heading: null, columns: [col('person', 'Person'), col('department', 'Department'), col('vouchers', 'Vouchers', 'int'), m('amount', 'Voucher total'), m('paid', 'Paid in cash'),
      m('settledOut', 'Settled to person'), m('collected', 'Collected from person'), m('balance', 'Balance now (+ we owe)')], rows,
    totals: { vouchers: sum(rows, 'vouchers'), amount: sum(rows, 'amount'), paid: sum(rows, 'paid'), settledOut: sum(rows, 'settledOut'), collected: sum(rows, 'collected') } }];
  },

  expenses({ entries, repo, from, to }) {
    const lines = repo.reportLines(from, to);
    void entries;
    const byType = [...groupSum(lines, (l) => l.type, (l) => l.amount)].map(([type, g]) => ({ type, count: g.count, amount: g.amount })).sort((a, b) => a.type.localeCompare(b.type));
    const byDept = [...groupSum(lines, (l) => `${l.department_name || '(no department)'}\u0000${l.type}`, (l) => l.amount)].map(([k, g]) => {
      const [department, type] = k.split('\u0000'); return { department, type, count: g.count, amount: g.amount };
    }).sort((a, b) => a.department.localeCompare(b.department) || a.type.localeCompare(b.type));
    return [
      { heading: 'By expense type', columns: [col('type', 'Expense type'), col('count', 'Lines', 'int'), col('amount', 'Amount', 'money')], rows: byType, totals: { count: sum(byType, 'count'), amount: sum(byType, 'amount') } },
      { heading: 'By department and expense type', columns: [col('department', 'Department'), col('type', 'Expense type'), col('count', 'Lines', 'int'), col('amount', 'Amount', 'money')], rows: byDept, totals: { count: sum(byDept, 'count'), amount: sum(byDept, 'amount') } },
    ];
  },

  receipts({ entries }) {
    const order = ['Customer', 'Branch', 'Department', 'Bank withdrawal', 'Other', 'Collected from people'];
    const rows = [];
    const inflow = entries.filter((e) => e.type === 'cash_in' || (e.type === 'settle' && e.cash_delta > 0));
    const nameOf = (e) => (e.type === 'settle' ? e.person_name : e.source === 'branch' ? e.branch_name : e.source === 'department' ? e.department_name : e.source === 'bank_withdrawal' ? e.bank_name : e.party_name) || '(no name)';
    const kindOf = (e) => (e.type === 'settle' ? 'Collected from people' : SOURCE_LABEL[e.source] || 'Other');
    const g = groupSum(inflow, (e) => `${kindOf(e)}\u0000${nameOf(e)}`, (e) => e.cash_delta);
    for (const [k, v] of g) { const [kind, name] = k.split('\u0000'); rows.push({ kind, name, count: v.count, amount: v.amount }); }
    rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
    return [{ heading: null, columns: [col('kind', 'Source'), col('name', 'Name'), col('count', 'Entries', 'int'), col('amount', 'Amount', 'money')], rows, totals: { count: sum(rows, 'count'), amount: sum(rows, 'amount') } }];
  },

  deposits({ entries, bankId }) {
    const dep = entries.filter((e) => e.type === 'bank_deposit' && (!bankId || e.bank_account_id === bankId));
    const rows = dep.map((e) => ({ day: e.day, time: timeOf(e.created_at), bank: e.bank_name || '', reference: e.reference || '', amount: e.bank_delta, by: e.user_name, remark: e.remark || '' }));
    const byBank = [...groupSum(dep, (e) => e.bank_name || 'Bank', (e) => e.bank_delta)].map(([name, v]) => ({ name, count: v.count, amount: v.amount }));
    return [
      { heading: 'Deposits', columns: [col('day', 'Day'), col('time', 'Time'), col('bank', 'Bank'), col('reference', 'Reference'), col('amount', 'Amount', 'money'), col('by', 'By'), col('remark', 'Remark')], rows, totals: { amount: sum(rows, 'amount') } },
      { heading: 'By account', columns: [col('name', 'Bank'), col('count', 'Deposits', 'int'), col('amount', 'Amount', 'money')], rows: byBank, totals: { count: sum(byBank, 'count'), amount: sum(byBank, 'amount') } },
    ];
  },

  balances({ repo, to }) {
    const all = repo.peopleBalancesAsOf(to).filter((p) => p.balance !== 0);
    const cols = [col('name', 'Person'), col('department', 'Department'), col('amount', 'Amount', 'money'), col('status', 'Status')];
    const owed = all.filter((p) => p.balance > 0).map((p) => ({ name: p.name, department: p.department || '', amount: p.balance, status: p.active ? 'Active' : 'Inactive' }));
    const owes = all.filter((p) => p.balance < 0).map((p) => ({ name: p.name, department: p.department || '', amount: -p.balance, status: p.active ? 'Active' : 'Inactive' }));
    return [
      { heading: `We owe them (at ${to})`, columns: cols, rows: owed, totals: { amount: sum(owed, 'amount') } },
      { heading: `They owe us (at ${to})`, columns: cols, rows: owes, totals: { amount: sum(owes, 'amount') } },
    ];
  },
};

function install(LedgerService) {
  const P = LedgerService.prototype;
  P.reportList = () => REPORTS.map(({ id, label, key, needs }) => ({ id, label, key, needs: needs || null }));

  // input: { report, from, to, personId?, bankId? }
  P.runReport = function (input) {
    const def = REPORTS.find((r) => r.id === input.report);
    if (!def) throw new UserError('Choose a report.');
    if (!dayOk(input.from) || !dayOk(input.to)) throw new UserError('Choose valid dates.');
    if (input.from > input.to) throw new UserError('The first date is after the last date.');
    const opt = (v, what) => { if (v === undefined || v === null || v === '') return null; if (!Number.isInteger(v) || v < 1) throw new UserError(`${what} is not valid.`); return v; };
    const personId = opt(input.personId, 'The person');
    const bankId = opt(input.bankId, 'The bank');
    const entries = this.repo.reportEntries(input.from, input.to);
    const sections = BUILDERS[def.id]({ entries, repo: this.repo, from: input.from, to: input.to, personId, bankId });
    const period = input.from === input.to ? input.from : `${input.from} to ${input.to}`;
    const filter = [personId && (this.repo.personGet(personId) || {}).name, bankId && (this.repo.listGet('bank_accounts', bankId) || {}).name].filter(Boolean).join(', ');
    return { id: def.id, title: def.label, subtitle: filter ? `${period} · ${filter}` : period, from: input.from, to: input.to, fileName: `CashDesk-${def.file}-${input.from === input.to ? input.from : `${input.from}_to_${input.to}`}`, sections };
  };
}

module.exports = { install, REPORTS };
