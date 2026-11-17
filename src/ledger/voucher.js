'use strict';
// People, vouchers and settling. Added to LedgerService so all money rules live in one place.
// The page never sends totals or balances: every figure here is worked out again from the pieces and the stored entries.
const { DENOMS, BY_ID, totalValue } = require('../core/denoms');
const { payoutCandidates, evaluate } = require('../core/payout');
const { search } = require('../core/search');
const { UserError } = require('../errors');

function install(LedgerService) {
  const { normalizePieces, text, id: needId } = require('./service');
  const P = LedgerService.prototype;

  const intIn = (v, min, max, what) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new UserError(`${what} is not valid.`);
    return v;
  };

  // ---- settings used by the voucher ----
  P._number = function (key, fallback, min = 0) {
    const n = Number(this.repo.getSetting(key, String(fallback)));
    return Number.isInteger(n) && n >= min ? n : fallback;
  };
  // What the drawer can hand out: hidden denominations are never suggested (they are still counted elsewhere).
  P._stock = function () {
    const stock = this.repo.drawerCounts();
    const out = {};
    for (const d of DENOMS) out[d.id] = Math.max(0, stock[d.id] || 0);
    for (const h of this.repo.hiddenDenoms()) out[h] = 0;
    return out;
  };
  P._visibleIds = function () {
    const hidden = new Set(this.repo.hiddenDenoms());
    return DENOMS.filter((d) => !hidden.has(d.id)).map((d) => d.id);
  };

  // ---- people ----
  const personOut = (p) => ({ id: p.id, name: p.name, department: p.department, departmentId: p.department_id, active: Boolean(p.active), balance: Number(p.balance) });

  P.searchPeople = function ({ q = '', limit = 8, includeInactive = false } = {}) {
    this.auth.requireSession();
    if (typeof q !== 'string' || q.length > 60) throw new UserError('The search text is not valid.');
    const n = intIn(limit, 1, 500, 'The limit');
    const all = this.repo.peopleAll().filter((p) => includeInactive || p.active);
    return { people: search(q, all, n).map(personOut) };
  };

  P.savePerson = function ({ id: personId, name, department, openingBalance, active }) {
    const s = this.auth.requireSession();
    const clean = text(name, 60, 'The name');
    if (!clean) throw new UserError('Enter a name.');
    const dept = text(department, 60, 'The department');
    return this.store.transaction(() => {
      let departmentId = null;
      if (dept) {
        const row = this.repo.listFind('departments', dept);
        departmentId = row ? row.id : this.repo.listInsert('departments', dept);
        if (!row) this.repo.audit({ userId: s.userId, action: 'list_add', table: 'departments', rowId: departmentId, after: { name: dept } });
      }
      if (personId === undefined || personId === null) {
        if (this.repo.personClash(clean, departmentId)) throw new UserError(`${clean} is already in ${dept || 'the list'}.`);
        const bal = openingBalance === undefined ? 0 : intIn(openingBalance, -10000000, 10000000, 'The balance');
        const newId = this.repo.personInsert({ name: clean, departmentId, openingBalance: bal });
        this.repo.audit({ userId: s.userId, action: 'person_add', table: 'people', rowId: newId, after: { name: clean, department: dept, openingBalance: bal } });
        return { id: newId };
      }
      const before = this.repo.personGet(personId);
      if (!before) throw new UserError('That person was not found.');
      if (this.repo.personClash(clean, departmentId, personId)) throw new UserError(`${clean} is already in ${dept || 'the list'}.`);
      const isActive = active === undefined ? Boolean(before.active) : Boolean(active);
      this.repo.personUpdate(personId, { name: clean, departmentId, active: isActive });
      this.repo.audit({ userId: s.userId, action: 'person_edit', table: 'people', rowId: personId, before: personOut(before), after: { name: clean, department: dept, active: isActive } });
      return { id: personId };
    });
  };

  P.personHistory = function ({ id: personId, limit = 5 }) {
    this.auth.requireSession();
    needId(personId, 'a person');
    const person = this.repo.personGet(personId);
    if (!person) throw new UserError('That person was not found.');
    const rows = this.repo.personHistory(personId, intIn(limit, 1, 100, 'The limit')).map((e) => ({
      id: e.id, day: e.day, type: e.type, voucherAmount: e.voucher_amount, paid: -e.cash_delta, balanceDelta: e.balance_delta, flag: e.flag, remark: e.remark,
      lines: this.repo.linesOf(e.id),
    }));
    return { person: personOut(person), entries: rows };
  };

  // ---- voucher preview: payout choices and note breakups, nothing is saved ----
  P.previewVoucher = function ({ personId, amount, payout }) {
    this.auth.requireSession();
    needId(personId, 'a person');
    intIn(amount, 1, this._maxAmount(), 'The amount');
    const person = this.repo.personGet(personId);
    if (!person || !person.active) throw new UserError('Choose a person who is in the list.');
    const stock = this._stock();
    const args = { amount, balance: Number(person.balance), stock, step: this._number('rounding_step', 10, 1), limit: this._number('balance_limit', 10), ids: this._visibleIds() };
    const candidates = payoutCandidates(args);
    if (payout !== undefined && payout !== null) {
      intIn(payout, 0, this._maxAmount() * 2, 'The payout');
      const custom = evaluate({ ...args, payout, custom: true });
      candidates.unshift(custom);
      return { person: personOut(person), amount, candidates: candidates.filter((c, i) => i === 0 || c.payout !== payout).slice(0, 4), drawer: this.drawer() };
    }
    return { person: personOut(person), amount, candidates, drawer: this.drawer() };
  };

  // ---- voucher save ----
  P.saveVoucher = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    const amount = intIn(input.amount, 1, this._maxAmount(), 'The amount');
    needId(input.personId, 'a person');
    const give = normalizePieces(input.give || {});
    const back = normalizePieces(input.back || {});
    const remark = text(input.remark, 200, 'The remark');
    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 30) throw new UserError('Add at least one expense line.');
    const lines = input.lines.map((l, i) => {
      if (!l || typeof l !== 'object') throw new UserError('An expense line is not valid.');
      return { expenseTypeId: needId(l.expenseTypeId, 'an expense type'), amount: intIn(l.amount, 1, amount, 'A line amount'), note: text(l.note, 120, 'A line note'), sort: i + 1 };
    });
    if (lines.reduce((t, l) => t + l.amount, 0) !== amount) throw new UserError('The expense lines must add up to the voucher amount.');

    const paid = totalValue(give) - totalValue(back);
    if (paid < 0) throw new UserError('The notes received back are more than the notes given.');

    return this.store.transaction(() => {
      const day = this._openDay(input);
      const person = this.repo.personGet(input.personId);
      if (!person || !person.active) throw new UserError('Choose a person who is in the list.');
      for (const l of lines) {
        const t = this.repo.listGet('expense_types', l.expenseTypeId);
        if (!t || !t.active) throw new UserError('An expense type is not available.');
      }
      const counts = this.repo.drawerCounts();
      const net = {};
      for (const d of DENOMS) {
        const q = (back[d.id] || 0) - (give[d.id] || 0);
        if (q) net[d.id] = q;
        if ((counts[d.id] || 0) + q < 0) throw new UserError(`The drawer has only ${counts[d.id] || 0} of ${d.label}.`, 'DRAWER_NEGATIVE');
      }
      const delta = amount - paid;
      const newBalance = Number(person.balance) + delta;
      const limit = this._number('balance_limit', 10);
      const outside = Math.abs(newBalance) > limit;
      if (outside && input.confirmLimit !== true) {
        throw new UserError(`${person.name}'s balance would be ${newBalance > 0 ? 'you owe ₹' + newBalance : 'owes you ₹' + -newBalance}, outside the ±₹${limit} limit. Save anyway?`, 'CONFIRM_LIMIT', { newBalance });
      }
      const entryId = this.repo.insertEntry({
        day, userId: s.userId, type: 'voucher', personId: person.id, voucherAmount: amount, cashDelta: -paid, balanceDelta: delta,
        remark, flag: outside ? 'outside_limit' : null,
      });
      this.repo.insertPieces(entryId, net);
      lines.forEach((l) => this.repo.insertLine(entryId, l));
      this.repo.audit({ userId: s.userId, action: 'entry_save', table: 'entries', rowId: entryId, after: { type: 'voucher', person: person.name, amount, paid, balanceDelta: delta, newBalance, lines, give, back } });
      return { id: entryId, paid, newBalance, personName: person.name };
    });
  };

  // ---- settle: pay a person what we owe, or collect what they owe ----
  P.saveSettle = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    needId(input.personId, 'a person');
    if (!['pay', 'collect'].includes(input.direction)) throw new UserError('Choose pay or collect.');
    const pieces = normalizePieces(input.pieces);
    const amount = totalValue(pieces);
    if (amount < 1) throw new UserError('Enter the notes and coins.');
    if (amount > this._maxAmount()) throw new UserError(`One entry can be at most ₹${this._maxAmount().toLocaleString('en-IN')}.`);
    const remark = text(input.remark, 200, 'The remark');
    const sign = input.direction === 'pay' ? -1 : 1;

    return this.store.transaction(() => {
      const day = this._openDay(input);
      const person = this.repo.personGet(input.personId);
      if (!person) throw new UserError('That person was not found.');
      const counts = this.repo.drawerCounts();
      const net = {};
      for (const [d, q] of Object.entries(pieces)) {
        net[d] = sign * q;
        if ((counts[d] || 0) + net[d] < 0) throw new UserError(`The drawer has only ${counts[d] || 0} of ${BY_ID[d].label}.`, 'DRAWER_NEGATIVE');
      }
      const entryId = this.repo.insertEntry({ day, userId: s.userId, type: 'settle', personId: person.id, voucherAmount: 0, cashDelta: sign * amount, balanceDelta: sign * amount, remark });
      this.repo.insertPieces(entryId, net);
      this.repo.audit({ userId: s.userId, action: 'entry_save', table: 'entries', rowId: entryId, after: { type: 'settle', person: person.name, direction: input.direction, amount, pieces } });
      return { id: entryId, amount, newBalance: Number(person.balance) + sign * amount, personName: person.name };
    });
  };

  // ---- bank deposit ----
  P.suggestDeposit = function () {
    this.auth.requireSession();
    const banks = this.repo.listRows('bank_accounts').filter((b) => b.active).map((b) => ({ id: b.id, name: b.name, balance: this.repo.bankBalance(b.id) }));
    const { suggest } = require('../core/deposit');
    return { ...suggest({ stock: this._stock(), float: this._number('deposit_float', 5000) }), banks };
  };

  P.saveDeposit = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    needId(input.bankAccountId, 'a bank');
    const pieces = normalizePieces(input.pieces);
    const amount = totalValue(pieces);
    if (amount < 1) throw new UserError('Enter the notes you are depositing.');
    if (amount > this._maxAmount()) throw new UserError(`One entry can be at most ₹${this._maxAmount().toLocaleString('en-IN')}.`);
    const reference = text(input.reference, 60, 'The reference');
    const remark = text(input.remark, 200, 'The remark');
    return this.store.transaction(() => {
      const day = this._openDay(input);
      const bank = this.repo.listGet('bank_accounts', input.bankAccountId);
      if (!bank || !bank.active) throw new UserError('That bank account is not available.');
      const counts = this.repo.drawerCounts();
      const net = {};
      for (const [d, q] of Object.entries(pieces)) {
        net[d] = -q;
        if ((counts[d] || 0) - q < 0) throw new UserError(`The drawer has only ${counts[d] || 0} of ${BY_ID[d].label}.`, 'DRAWER_NEGATIVE');
      }
      const entryId = this.repo.insertEntry({ day, userId: s.userId, type: 'bank_deposit', bankAccountId: bank.id, cashDelta: -amount, bankDelta: amount, reference, remark });
      this.repo.insertPieces(entryId, net);
      this.repo.audit({ userId: s.userId, action: 'entry_save', table: 'entries', rowId: entryId, after: { type: 'bank_deposit', bank: bank.name, amount, reference, pieces } });
      return { id: entryId, amount, bankName: bank.name, bankBalance: this.repo.bankBalance(bank.id) };
    });
  };

  // ---- exchange: notes out, notes in, equal value (e.g. a ₹500 for five ₹100s) ----
  P.saveExchange = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    const out = normalizePieces(input.out || {});
    const inn = normalizePieces(input.in || {});
    const amount = totalValue(out);
    if (amount < 1) throw new UserError('Enter the notes going out.');
    if (totalValue(inn) !== amount) throw new UserError(`Out is ₹${amount} but in is ₹${totalValue(inn)}. They must be equal.`);
    const remark = text(input.remark, 200, 'The remark');
    return this.store.transaction(() => {
      const day = this._openDay(input);
      const counts = this.repo.drawerCounts();
      const net = {};
      for (const d of DENOMS) {
        const q = (inn[d.id] || 0) - (out[d.id] || 0);
        if (q) net[d.id] = q;
        if ((counts[d.id] || 0) + q < 0) throw new UserError(`The drawer has only ${counts[d.id] || 0} of ${d.label}.`, 'DRAWER_NEGATIVE');
      }
      if (!Object.keys(net).length) throw new UserError('Out and in are the same notes. Nothing to exchange.');
      const entryId = this.repo.insertEntry({ day, userId: s.userId, type: 'exchange', cashDelta: 0, remark });
      this.repo.insertPieces(entryId, net);
      this.repo.audit({ userId: s.userId, action: 'entry_save', table: 'entries', rowId: entryId, after: { type: 'exchange', amount, out, in: inn } });
      return { id: entryId, amount };
    });
  };
}

module.exports = { install };
