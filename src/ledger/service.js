'use strict';
// The cash book: drawer, opening count, cash in, entries and the lists. Every rule is checked here on save,
// whatever the page already checked, and the page never sends totals: amounts are worked out from the pieces.
const { DENOMS, BY_ID, totalValue } = require('../core/denoms');
const { figures } = require('../core/dayfigures');
const { suggest: depositSuggest } = require('../core/deposit');
const { UserError } = require('../errors');

const SOURCES = ['customer', 'branch', 'department', 'bank_withdrawal', 'other'];
const LIST_TABLES = { departments: 'departments', branches: 'branches', expenseTypes: 'expense_types', banks: 'bank_accounts' };
const LIST_ACTIONS = { departments: 'department', branches: 'branch', expenseTypes: 'expense type', banks: 'bank account' };
const MAX_PIECES = 100000;

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const text = (v, max, what) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new UserError(`${what} is not valid.`);
  const t = v.trim();
  if (t.length > max) throw new UserError(`${what} is too long (at most ${max} characters).`);
  return t || null;
};
const id = (v, what) => {
  if (!Number.isInteger(v) || v < 1) throw new UserError(`Choose ${what}.`);
  return v;
};

// Counts from the page -> { N500: 3, ... } with zero rows dropped. Whole numbers only.
function normalizePieces(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('Enter the notes and coins.');
  const out = {};
  for (const [key, qty] of Object.entries(input)) {
    if (!BY_ID[key]) throw new UserError('Unknown note or coin.');
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_PIECES) throw new UserError('Counts must be whole numbers, 0 or more.');
    if (qty > 0) out[key] = qty;
  }
  return out;
}

class LedgerService {
  constructor({ store, repo, auth }) {
    this.store = store;
    this.repo = repo;
    this.auth = auth;
  }

  today() { return localDay(this.store.now()); }

  // ---- guards ----
  // The day new entries go on. Blocked by a closed today, a PC clock set back, or an earlier day that was never closed
  // (an admin can go on with a written reason, which is kept in the audit log).
  _openDay(input) {
    const day = this.today();
    const last = this.repo.lastEntryDay();
    if (last && day < last) {
      throw new UserError(`This PC's date (${day}) is earlier than the last entry (${last}). Fix the Windows date and time, then try again.`, 'CLOCK_BEHIND');
    }
    if (this.repo.dayIsClosed(day)) throw new UserError('Today is closed. Reopen the day to add entries.', 'DAY_CLOSED');
    const open = this.repo.daysWithEntries().filter((d) => d < day && !this.repo.dayIsClosed(d));
    if (open.length) {
      const reason = input && typeof input.skipEarlierReason === 'string' ? input.skipEarlierReason.trim() : '';
      const s = this.auth.requireSession();
      if (reason.length >= 3 && s.role === 'admin') {
        this.repo.audit({ userId: s.userId, action: 'earlier_day_skipped', after: { open, reason } });
      } else {
        throw new UserError(`${open[0]} is not closed yet. Close that day first (Day close).`, 'EARLIER_OPEN', { day: open[0] });
      }
    }
    return day;
  }

  _maxAmount() {
    const n = Number(this.repo.getSetting('max_entry_amount', '1000000'));
    return Number.isInteger(n) && n > 0 ? n : 1000000;
  }

  // ---- reading ----
  drawer() {
    const counts = this.repo.drawerCounts();
    const rows = DENOMS.map((d) => {
      const qty = counts[d.id] || 0;
      return { id: d.id, label: d.label, value: d.value, kind: d.kind, qty, amount: qty * d.value };
    });
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
  }

  dashboard() {
    this.auth.requireSession();
    const day = this.today();
    const last = this.repo.lastEntryDay();
    const banks = this.repo.listRows('bank_accounts').filter((b) => b.active)
      .map((b) => ({ id: b.id, name: b.name, balance: this.repo.bankBalance(b.id) }));
    const drawer = this.drawer();
    const clock = this.store.now();
    const hhmm = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`;
    const limit = Number(this.repo.getSetting('deposit_limit', '500000'));
    const due = drawer.total >= limit && hhmm >= this.repo.getSetting('deposit_banner_from', '12:00');
    return {
      depositDue: due ? depositSuggest({ stock: this._stock(), float: Number(this.repo.getSetting('deposit_float', '5000')) }).total : 0,
      day,
      backupOff: this.repo.getSetting('backup_salt', null) === null,
      earlierOpen: this.repo.daysWithEntries().find((d) => d < day && !this.repo.dayIsClosed(d)) || null,
      hasOpening: this.repo.hasOpening(),
      clockBehind: Boolean(last && day < last),
      unsplit: this.repo.unsplitVouchers().length,
      dayClosed: this.repo.dayIsClosed(day),
      drawer,
      figures: figures(this.repo.entryDeltas(), day),
      banks,
    };
  }

  entries({ day, type } = {}) {
    this.auth.requireSession();
    const d = day === undefined ? this.today() : day;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new UserError('Choose a valid date.');
    if (type !== undefined && type !== null && typeof type !== 'string') throw new UserError('Choose a valid type.');
    const rows = this.repo.listEntries({ day: d, type: type || null }).map((e) => ({
      id: e.id, day: e.day, at: e.created_at, user: e.user_name, type: e.type, source: e.source,
      person: e.person_name, flag: e.flag, voucherAmount: e.voucher_amount, balanceDelta: e.balance_delta, lines: this.repo.linesOf(e.id),
      partyName: e.party_name, branch: e.branch_name, department: e.department_name, bank: e.bank_name,
      amount: Math.abs(e.cash_delta), cashDelta: e.cash_delta, bankDelta: e.bank_delta, remark: e.remark, reference: e.reference,
      deleted: Boolean(e.deleted), pieces: this.repo.piecesOf(e.id), parts: e.parts_json ? JSON.parse(e.parts_json) : null,
    })).map((e) => (e.type === 'exchange' ? { ...e, amount: Object.entries(e.pieces).reduce((t, [d, q]) => t + (q < 0 ? -q * BY_ID[d].value : 0), 0) } : e));
    return { day: d, entries: rows, figures: figures(this.repo.entryDeltas(), d), closed: this.repo.dayIsClosed(d), mayEdit: this._mayEdit(this.auth.requireSession()) };
  }

  // ---- opening count ----
  saveOpening(input) {
    const s = this.auth.requireSession();
    const { pieces } = input || {};
    const p = normalizePieces(pieces);
    const amount = totalValue(p);
    if (amount < 1) throw new UserError('Enter at least one note or coin.');
    if (amount > this._maxAmount() * 10) throw new UserError('That total is too large. Check the counts.');
    return this.store.transaction(() => {
      if (this.repo.hasOpening()) throw new UserError('The opening count is already entered. To fix it, delete it from Entries and enter it again.', 'OPENING_DONE');
      const day = this._openDay(input);
      const entryId = this.repo.insertEntry({ day, userId: s.userId, type: 'opening', cashDelta: amount, remark: 'Opening count' });
      this.repo.insertPieces(entryId, p);
      this.repo.audit({ userId: s.userId, action: 'opening_save', table: 'entries', rowId: entryId, after: { day, amount, pieces: p } });
      return { id: entryId, amount };
    });
  }

  // ---- cash in ----
  saveCashIn(input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    const source = input.source;
    if (!SOURCES.includes(source)) throw new UserError('Choose where the cash came from.');
    const p = normalizePieces(input.pieces);
    const amount = totalValue(p);
    if (amount < 1) throw new UserError('Enter the notes and coins received.');
    if (amount > this._maxAmount()) throw new UserError(`One entry can be at most ₹${this._maxAmount().toLocaleString('en-IN')}.`);
    const partyName = text(input.partyName, 80, 'The name');
    const remark = text(input.remark, 200, 'The remark');
    const reference = text(input.reference, 60, 'The reference');

    return this.store.transaction(() => {
      const day = this._openDay(input);
      const e = { day, userId: s.userId, type: 'cash_in', source, cashDelta: amount, partyName, remark, reference };
      if (source === 'branch') {
        e.branchId = id(input.branchId, 'a branch');
        const row = this.repo.listGet('branches', e.branchId);
        if (!row || !row.active) throw new UserError('That branch is not available.');
      } else if (source === 'department') {
        e.departmentId = id(input.departmentId, 'a department');
        const row = this.repo.listGet('departments', e.departmentId);
        if (!row || !row.active) throw new UserError('That department is not available.');
      } else if (source === 'bank_withdrawal') {
        e.bankAccountId = id(input.bankAccountId, 'a bank');
        const row = this.repo.listGet('bank_accounts', e.bankAccountId);
        if (!row || !row.active) throw new UserError('That bank account is not available.');
        e.bankDelta = -amount;
        if (this.repo.bankBalance(e.bankAccountId) - amount < 0 && input.confirmNegativeBank !== true) {
          throw new UserError(`${row.name} would go below ₹0 in this app's records. The bank statement may differ. Save anyway?`, 'CONFIRM_BANK');
        }
      } else if (source === 'other' && !remark) {
        throw new UserError('Add a remark to say what this cash is.');
      }
      const entryId = this.repo.insertEntry(e);
      this.repo.insertPieces(entryId, p);
      this.repo.audit({ userId: s.userId, action: 'entry_save', table: 'entries', rowId: entryId, after: { ...e, pieces: p } });
      return { id: entryId, amount };
    });
  }

  // ---- delete (marks the entry deleted; the row is never removed) ----
  deleteEntry({ id: entryId }) {
    const s = this.auth.requireSession();
    id(entryId, 'an entry');
    return this.store.transaction(() => {
      const e = this.repo.getEntry(entryId);
      if (!e || e.deleted) throw new UserError('That entry was not found.');
      if (this.repo.dayIsClosed(e.day)) throw new UserError('That day is closed. Reopen the day to change it.', 'DAY_CLOSED');
      if (!['opening', 'cash_in', 'voucher', 'settle', 'bank_deposit', 'exchange'].includes(e.type)) throw new UserError('This kind of entry cannot be deleted yet.');
      const pieces = this.repo.piecesOf(entryId);
      const counts = this.repo.drawerCounts();
      for (const [denom, qty] of Object.entries(pieces)) {
        if ((counts[denom] || 0) - qty < 0) {
          throw new UserError(`Cannot delete: the drawer would have fewer than 0 of ${BY_ID[denom].label}. Some of these notes were paid out later.`, 'DRAWER_NEGATIVE');
        }
      }
      this.repo.markDeleted(entryId);
      this.repo.audit({ userId: s.userId, action: 'entry_delete', table: 'entries', rowId: entryId, before: { ...e, pieces } });
      return { id: entryId };
    });
  }

  // ---- lists ----
  lists() {
    this.auth.requireSession();
    const banks = this.repo.listRows('bank_accounts').map((b) => ({ id: b.id, name: b.name, active: Boolean(b.active), openingBalance: Number(b.opening_balance), balance: this.repo.bankBalance(b.id) }));
    const plain = (t) => this.repo.listRows(t).map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active) }));
    return { departments: plain('departments'), branches: plain('branches'), expenseTypes: plain('expense_types'), banks };
  }

  // Add (no id) or rename / switch off (id). Adding is open to every signed-in user: new names join as they come up.
  saveListItem({ list, id: itemId, name, active, openingBalance }) {
    const s = this.auth.requireSession();
    const table = LIST_TABLES[list];
    if (!table) throw new UserError('Unknown list.');
    const clean = text(name, 60, 'The name');
    if (!clean) throw new UserError('Enter a name.');
    return this.store.transaction(() => {
      const clash = this.repo.listFind(table, clean);
      if (itemId === undefined || itemId === null) {
        if (clash) throw new UserError(`${clean} is already in the list.`);
        let opening = 0;
        if (table === 'bank_accounts' && openingBalance !== undefined) {
          if (!Number.isInteger(openingBalance)) throw new UserError('The opening balance must be a whole number.');
          opening = openingBalance;
        }
        const newId = this.repo.listInsert(table, clean, opening);
        this.repo.audit({ userId: s.userId, action: 'list_add', table, rowId: newId, after: { name: clean } });
        return { id: newId };
      }
      const before = this.repo.listGet(table, itemId);
      if (!before) throw new UserError('That item was not found.');
      if (clash && clash.id !== itemId) throw new UserError(`${clean} is already in the list.`);
      const isActive = active === undefined ? Boolean(before.active) : Boolean(active);
      this.repo.listUpdate(table, itemId, { name: clean, active: isActive });
      this.repo.audit({ userId: s.userId, action: 'list_edit', table, rowId: itemId, before: { name: before.name, active: Boolean(before.active) }, after: { name: clean, active: isActive } });
      return { id: itemId };
    });
  }
}

module.exports = { LedgerService, normalizePieces, localDay, text, id, SOURCES, LIST_ACTIONS };
require('./voucher').install(LedgerService);
require('./dayclose').install(LedgerService);
require('./reports').install(LedgerService);
require('./settings').install(LedgerService);
require('./fsc').install(LedgerService);
