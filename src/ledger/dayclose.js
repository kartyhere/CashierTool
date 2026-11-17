'use strict';
// Tally checks, the morning check, day close and reopen.
// Tally difference is always  system - Tally  (positive: the app shows more than Tally).
const { DENOMS } = require('../core/denoms');
const { figures } = require('../core/dayfigures');
const { compare } = require('../core/dayclose');
const { UserError } = require('../errors');

function install(LedgerService) {
  const { normalizePieces, text } = require('./service');
  const P = LedgerService.prototype;
  const pad = (n) => String(n).padStart(2, '0');
  const dayOk = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const intOrNull = (v, what) => {
    if (v === undefined || v === null || v === '') return null;
    if (!Number.isInteger(v) || Math.abs(v) > 100000000) throw new UserError(`${what} must be a whole number of rupees.`);
    return v;
  };
  const sumPieces = (p) => DENOMS.reduce((t, d) => t + d.value * (p[d.id] || 0), 0);

  P._unclosedDays = function () {
    return this.repo.daysWithEntries().filter((d) => !this.repo.dayIsClosed(d));
  };

  // ---- Tally check: compare the app's cash balance with the balance in Tally, any time of day ----
  P.tallyCheck = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Enter the Tally balance.');
    const tally = intOrNull(input.tallyBalance, 'The Tally balance');
    if (tally === null) throw new UserError('Enter the Tally balance.');
    const counted = input.counted ? normalizePieces(input.counted) : null;
    const remark = text(input.remark, 200, 'The remark');
    return this.store.transaction(() => {
      const day = this.today();
      const system = this.drawer().total;
      const countedTotal = counted && Object.keys(counted).length ? sumPieces(counted) : null;
      const id = this.repo.insertTally({ day, userId: s.userId, system, tally, counted: countedTotal === null ? null : counted, remark });
      this.repo.audit({ userId: s.userId, action: 'tally_check', table: 'tally_checks', rowId: id, after: { system, tally, countedTotal } });
      return { id, system, tally, difference: system - tally, countedTotal, countedDifference: countedTotal === null ? null : countedTotal - system };
    });
  };

  P.tallyList = function ({ day } = {}) {
    this.auth.requireSession();
    const d = day === undefined ? this.today() : day;
    if (!dayOk(d)) throw new UserError('Choose a valid date.');
    return {
      day: d,
      checks: this.repo.tallyList(d).map((t) => ({
        id: t.id, at: t.at, user: t.user_name, system: t.system_balance, tally: t.tally_balance, difference: t.system_balance - t.tally_balance,
        countedTotal: t.counted_json ? sumPieces(JSON.parse(t.counted_json)) : null, remark: t.remark,
      })),
    };
  };

  // ---- Day close ----
  P.dayInfo = function ({ day } = {}) {
    const s = this.auth.requireSession();
    const today = this.today();
    const open = this._unclosedDays();
    const d = day === undefined || day === null ? (open[0] || today) : day;
    if (!dayOk(d)) throw new UserError('Choose a valid date.');
    const expected = this.repo.piecesAsOf(d);
    const row = this.repo.getDayClose(d);
    const closed = row && row.status === 'closed';
    return {
      day: d, today, hasEntries: this.repo.daysWithEntries().includes(d),
      state: closed ? 'closed' : row ? 'reopened' : 'open',
      figures: figures(this.repo.entryDeltas(), d),
      expected: DENOMS.map((x) => ({ id: x.id, label: x.label, value: x.value, expected: expected[x.id] || 0 })),
      expectedTotal: sumPieces(expected),
      closed: closed ? { counted: JSON.parse(row.counted_json), expected: JSON.parse(row.expected_json), tally: row.tally_balance, remark: row.remark, at: row.closed_at } : null,
      openDays: open, canReopen: s.role === 'admin',
    };
  };

  P.closeDay = function (input) {
    const s = this.auth.requireSession();
    if (!input || typeof input !== 'object') throw new UserError('Fill in the form.');
    const day = input.day;
    if (!dayOk(day)) throw new UserError('Choose a valid date.');
    const counted = normalizePieces(input.counted || {});
    const tally = intOrNull(input.tallyBalance, 'The Tally balance');
    const remark = text(input.remark, 200, 'The remark');
    return this.store.transaction(() => {
      if (day > this.today()) throw new UserError('That day has not come yet.');
      if (!this.repo.daysWithEntries().includes(day)) throw new UserError('There are no entries on that day, so there is nothing to close.');
      if (this.repo.dayIsClosed(day)) throw new UserError('That day is already closed.', 'DAY_CLOSED');
      const expected = this.repo.piecesAsOf(day);
      const cmp = compare(expected, counted);
      if (cmp.hasDiff && input.confirmDifferences !== true) {
        const more = cmp.diffTotal > 0;
        throw new UserError(`Counted ₹${cmp.countedTotal.toLocaleString('en-IN')} but the books say ₹${cmp.expectedTotal.toLocaleString('en-IN')}${cmp.diffTotal ? ` (${more ? '₹' + cmp.diffTotal + ' more' : '₹' + -cmp.diffTotal + ' less'})` : ' (same total, different notes)'}. Close with differences?`, 'CONFIRM_DIFF', { diffTotal: cmp.diffTotal });
      }
      let adjustId = null;
      if (cmp.hasDiff) {
        const now = this.repo.drawerCounts();
        const net = {};
        for (const r of cmp.rows) {
          if (!r.diff) continue;
          net[r.id] = r.diff;
          if ((now[r.id] || 0) + r.diff < 0) throw new UserError(`Cannot close ${day}: later entries already use these notes. Close the later days first or fix the count.`, 'DRAWER_NEGATIVE');
        }
        adjustId = this.repo.insertEntry({ day, userId: s.userId, type: 'count_adjust', cashDelta: cmp.diffTotal, remark: 'Count adjustment at day close' });
        this.repo.insertPieces(adjustId, net);
      }
      const books = figures(this.repo.entryDeltas(), day);
      this.repo.saveDayClose({ day, userId: s.userId, remark, tallyBalance: tally,
        counted: { pieces: counted, total: cmp.countedTotal },
        expected: { pieces: expected, total: cmp.expectedTotal, figures: { ...books, closing: books.closing - cmp.diffTotal } } });
      this.repo.audit({ userId: s.userId, action: 'day_close', table: 'day_closes', after: { day, expected: cmp.expectedTotal, counted: cmp.countedTotal, diff: cmp.diffTotal, tally } });
      const closing = cmp.countedTotal;
      return { day, expectedTotal: cmp.expectedTotal, countedTotal: cmp.countedTotal, adjustment: cmp.diffTotal, adjustId, tallyDifference: tally === null ? null : closing - tally };
    });
  };

  P.reopenDay = function ({ day, reason }) {
    const s = this.auth.requireRole('admin');
    if (!dayOk(day)) throw new UserError('Choose a valid date.');
    const why = text(reason, 200, 'The reason');
    if (!why || why.length < 3) throw new UserError('Write the reason for reopening.');
    return this.store.transaction(() => {
      if (!this.repo.dayIsClosed(day)) throw new UserError('That day is not closed.');
      const ids = this.repo.adjustEntries(day);
      const now = this.repo.drawerCounts();
      for (const id of ids) {
        for (const [d, q] of Object.entries(this.repo.piecesOf(id))) {
          if ((now[d] || 0) - q < 0) throw new UserError('Cannot reopen: later entries already use the notes added by the count adjustment.', 'DRAWER_NEGATIVE');
        }
      }
      for (const id of ids) {
        const before = this.repo.getEntry(id);
        this.repo.markDeleted(id);
        this.repo.audit({ userId: s.userId, action: 'entry_delete', table: 'entries', rowId: id, before });
      }
      this.repo.setDayReopened(day);
      this.repo.insertReopen({ day, userId: s.userId, reason: why });
      this.repo.audit({ userId: s.userId, action: 'day_reopen', table: 'day_closes', after: { day, reason: why } });
      return { day };
    });
  };

  // ---- Morning check: from 9:15, show the last day's figures and ask for Tally's closing balance ----
  P.morningStatus = function () {
    this.auth.requireSession();
    const today = this.today();
    const lastDay = this.repo.daysWithEntries().filter((d) => d < today).pop() || null;
    if (!lastDay) return { due: false };
    const clock = this.store.now();
    const hhmm = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`;
    const due = hhmm >= this.repo.getSetting('morning_check_time', '09:15')
      && this.repo.getSetting('morning_checked_on', '') !== today
      && clock.getTime() >= Number(this.repo.getSetting('morning_snooze_until', '0'));
    const f = figures(this.repo.entryDeltas(), lastDay);
    return {
      due, lastDay, closedDay: this.repo.dayIsClosed(lastDay),
      opening: f.opening, receipts: f.receipts, outgo: f.payments + f.deposits, payments: f.payments, deposits: f.deposits, closing: f.closing,
    };
  };

  P.morningDone = function ({ tallyBalance, remark }) {
    const s = this.auth.requireSession();
    const tally = intOrNull(tallyBalance, 'The Tally balance');
    if (tally === null) throw new UserError('Enter the Tally balance.');
    const note = text(remark, 200, 'The remark');
    return this.store.transaction(() => {
      const st = this.morningStatus();
      if (!st.lastDay) throw new UserError('There is no earlier day to check.');
      const id = this.repo.insertTally({ day: st.lastDay, userId: s.userId, system: st.closing, tally, remark: note ? `Morning check: ${note}` : 'Morning check' });
      this.repo.setSetting('morning_checked_on', this.today());
      this.repo.markMorningChecked(st.lastDay, s.userId);
      this.repo.audit({ userId: s.userId, action: 'morning_check', table: 'tally_checks', rowId: id, after: { day: st.lastDay, system: st.closing, tally } });
      return { day: st.lastDay, system: st.closing, tally, difference: st.closing - tally };
    });
  };

  P.morningSnooze = function () {
    this.auth.requireSession();
    const minutes = this._number('morning_repeat_minutes', 30, 1);
    this.store.transaction(() => this.repo.setSetting('morning_snooze_until', String(this.store.now().getTime() + minutes * 60000)));
    return { minutes };
  };
}

module.exports = { install };
