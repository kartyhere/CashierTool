'use strict';
// All SQL lives here, in small named functions. Nothing else in the app writes SQL.
// Phase 1 covers users, settings and the audit log. Later phases add their queries to this file.

const LISTS = ['departments', 'branches', 'expense_types', 'bank_accounts'];

function createRepo(store) {
  const nowIso = () => store.now().toISOString();

  return {
    // ---- users ----
    countUsers() { return Number(store.get('SELECT COUNT(*) AS n FROM users').n); },
    findUserByName(username) {
      return store.get('SELECT id, username, pass_hash, role, active FROM users WHERE username = ?', [username]);
    },
    getUser(id) {
      return store.get('SELECT id, username, pass_hash, role, active FROM users WHERE id = ?', [id]);
    },
    createUser({ username, passHash, role }) {
      return store.run(
        'INSERT INTO users (username, pass_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)',
        [username, passHash, role, nowIso()],
      ).lastId;
    },
    setPasswordHash(id, passHash) {
      store.run('UPDATE users SET pass_hash = ? WHERE id = ?', [passHash, id]);
    },

    // ---- settings (all values are text) ----
    getSetting(key, fallback = null) {
      const row = store.get('SELECT value FROM settings WHERE key = ?', [key]);
      return row ? row.value : fallback;
    },
    setSetting(key, value) {
      store.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
    },

    // ---- entries and the drawer ----
    drawerCounts() {
      const out = {};
      for (const r of store.all(`SELECT p.denom_id AS id, SUM(p.qty) AS qty FROM entry_pieces p
        JOIN entries e ON e.id = p.entry_id WHERE e.deleted = 0 GROUP BY p.denom_id`)) out[r.id] = Number(r.qty);
      return out;
    },
    insertEntry(e) {
      return store.run(`INSERT INTO entries (day, created_at, user_id, type, source, person_id, branch_id, department_id, bank_account_id,
        party_name, voucher_amount, cash_delta, balance_delta, bank_delta, reference, remark, flag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.day, nowIso(), e.userId, e.type, e.source ?? null, e.personId ?? null, e.branchId ?? null, e.departmentId ?? null,
        e.bankAccountId ?? null, e.partyName ?? null, e.voucherAmount ?? null, e.cashDelta, e.balanceDelta ?? 0, e.bankDelta ?? 0,
        e.reference ?? null, e.remark ?? null, e.flag ?? null]).lastId;
    },
    insertPieces(entryId, pieces) {
      for (const [id, qty] of Object.entries(pieces)) {
        if (qty !== 0) store.run('INSERT INTO entry_pieces (entry_id, denom_id, qty) VALUES (?, ?, ?)', [entryId, id, qty]);
      }
    },
    getEntry(id) { return store.get('SELECT * FROM entries WHERE id = ?', [id]); },
    piecesOf(entryId) {
      const out = {};
      for (const r of store.all('SELECT denom_id AS id, qty FROM entry_pieces WHERE entry_id = ?', [entryId])) out[r.id] = Number(r.qty);
      return out;
    },
    markDeleted(id) { store.run('UPDATE entries SET deleted = 1 WHERE id = ?', [id]); },
    hasOpening() { return Number(store.get("SELECT COUNT(*) AS n FROM entries WHERE type = 'opening' AND deleted = 0").n) > 0; },
    lastEntryDay() { const r = store.get('SELECT MAX(day) AS d FROM entries'); return r ? r.d : null; },
    dayIsClosed(day) { const r = store.get("SELECT status FROM day_closes WHERE day = ?", [day]); return Boolean(r && r.status === 'closed'); },
    entryDeltas() { return store.all('SELECT day, type, cash_delta FROM entries WHERE deleted = 0'); },
    listEntries({ day, type = null }) {
      return store.all(`SELECT e.*, u.username AS user_name, pe.name AS person_name, b.name AS branch_name, d.name AS department_name, k.name AS bank_name
        FROM entries e JOIN users u ON u.id = e.user_id
        LEFT JOIN people pe ON pe.id = e.person_id
        LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN bank_accounts k ON k.id = e.bank_account_id
        WHERE e.day = ? AND (? IS NULL OR e.type = ?) ORDER BY e.id`, [day, type, type]);
    },

    // ---- days, day close, Tally ----
    piecesAsOf(day) {
      const out = {};
      for (const r of store.all(`SELECT p.denom_id AS id, SUM(p.qty) AS qty FROM entry_pieces p JOIN entries e ON e.id = p.entry_id
        WHERE e.deleted = 0 AND e.day <= ? GROUP BY p.denom_id`, [day])) out[r.id] = Number(r.qty);
      return out;
    },
    daysWithEntries() { return store.all('SELECT DISTINCT day FROM entries WHERE deleted = 0 ORDER BY day').map((r) => r.day); },
    getDayClose(day) { return store.get('SELECT * FROM day_closes WHERE day = ?', [day]); },
    saveDayClose(row) {
      store.run(`INSERT INTO day_closes (day, status, counted_json, expected_json, tally_balance, remark, closed_by, closed_at)
        VALUES (?, 'closed', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET status = 'closed', counted_json = excluded.counted_json, expected_json = excluded.expected_json,
          tally_balance = excluded.tally_balance, remark = excluded.remark, closed_by = excluded.closed_by, closed_at = excluded.closed_at`,
      [row.day, JSON.stringify(row.counted), JSON.stringify(row.expected), row.tallyBalance, row.remark, row.userId, nowIso()]);
    },
    setDayReopened(day) { store.run("UPDATE day_closes SET status = 'reopened' WHERE day = ?", [day]); },
    insertReopen({ day, userId, reason }) { store.run('INSERT INTO day_reopens (day, user_id, at, reason) VALUES (?, ?, ?, ?)', [day, userId, nowIso(), reason]); },
    adjustEntries(day) { return store.all("SELECT id FROM entries WHERE day = ? AND type = 'count_adjust' AND deleted = 0", [day]).map((r) => r.id); },
    markMorningChecked(day, userId) { store.run('UPDATE day_closes SET morning_checked_by = ?, morning_checked_at = ? WHERE day = ?', [userId, nowIso(), day]); },
    insertTally({ day, userId, system, tally, counted, remark }) {
      return store.run('INSERT INTO tally_checks (day, at, user_id, system_balance, tally_balance, counted_json, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [day, nowIso(), userId, system, tally, counted ? JSON.stringify(counted) : null, remark ?? null]).lastId;
    },
    tallyList(day) {
      return store.all('SELECT t.*, u.username AS user_name FROM tally_checks t JOIN users u ON u.id = t.user_id WHERE t.day = ? ORDER BY t.id', [day]);
    },

    // ---- people ----
    peopleAll() {
      return store.all(`SELECT p.id, p.name, p.department_id, d.name AS department, p.active,
        p.opening_balance + COALESCE((SELECT SUM(e.balance_delta) FROM entries e WHERE e.person_id = p.id AND e.deleted = 0), 0) AS balance
        FROM people p LEFT JOIN departments d ON d.id = p.department_id ORDER BY p.name COLLATE NOCASE`);
    },
    personGet(id) { return this.peopleAll().find((p) => p.id === id) || null; },
    personClash(name, departmentId, exceptId = 0) {
      return store.get('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND department_id IS ? AND id <> ?', [name, departmentId, exceptId]);
    },
    personInsert({ name, departmentId, openingBalance }) {
      return store.run('INSERT INTO people (name, department_id, opening_balance, active, created_at) VALUES (?, ?, ?, 1, ?)', [name, departmentId, openingBalance, nowIso()]).lastId;
    },
    personUpdate(id, { name, departmentId, active }) {
      store.run('UPDATE people SET name = ?, department_id = ?, active = ? WHERE id = ?', [name, departmentId, active ? 1 : 0, id]);
    },
    personHistory(id, limit = 5) {
      return store.all('SELECT * FROM entries WHERE person_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?', [id, limit]);
    },
    hiddenDenoms() { return store.all('SELECT id FROM denominations WHERE hidden = 1').map((r) => r.id); },
    insertLine(entryId, { expenseTypeId, amount, note, sort }) {
      store.run('INSERT INTO voucher_lines (entry_id, expense_type_id, amount, note, sort) VALUES (?, ?, ?, ?, ?)', [entryId, expenseTypeId, amount, note ?? null, sort]);
    },
    linesOf(entryId) {
      return store.all(`SELECT l.amount, l.note, t.name AS type FROM voucher_lines l JOIN expense_types t ON t.id = l.expense_type_id
        WHERE l.entry_id = ? ORDER BY l.sort`, [entryId]);
    },

    // ---- lists (departments, branches, expense types, bank accounts) ----
    listRows(table) {
      if (!LISTS.includes(table)) throw new Error('Unknown list.');
      return store.all(`SELECT * FROM ${table} ORDER BY active DESC, name COLLATE NOCASE`);
    },
    listFind(table, name) {
      if (!LISTS.includes(table)) throw new Error('Unknown list.');
      return store.get(`SELECT * FROM ${table} WHERE name = ? COLLATE NOCASE`, [name]);
    },
    listGet(table, id) {
      if (!LISTS.includes(table)) throw new Error('Unknown list.');
      return store.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    },
    listInsert(table, name, openingBalance = 0) {
      if (table === 'bank_accounts') return store.run('INSERT INTO bank_accounts (name, opening_balance) VALUES (?, ?)', [name, openingBalance]).lastId;
      if (!LISTS.includes(table)) throw new Error('Unknown list.');
      return store.run(`INSERT INTO ${table} (name) VALUES (?)`, [name]).lastId;
    },
    listUpdate(table, id, { name, active }) {
      if (!LISTS.includes(table)) throw new Error('Unknown list.');
      store.run(`UPDATE ${table} SET name = ?, active = ? WHERE id = ?`, [name, active ? 1 : 0, id]);
    },
    bankBalance(id) {
      const b = store.get('SELECT opening_balance FROM bank_accounts WHERE id = ?', [id]);
      const s = store.get('SELECT COALESCE(SUM(bank_delta), 0) AS s FROM entries WHERE bank_account_id = ? AND deleted = 0', [id]);
      return b ? Number(b.opening_balance) + Number(s.s) : 0;
    },

    // ---- reports (read only) ----
    reportEntries(from, to) {
      return store.all(`SELECT e.*, u.username AS user_name, pe.name AS person_name, COALESCE(e.department_id, pe.department_id) AS dept_id,
        COALESCE(d.name, pd.name) AS department_name, b.name AS branch_name, k.name AS bank_name
        FROM entries e JOIN users u ON u.id = e.user_id LEFT JOIN people pe ON pe.id = e.person_id
        LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN departments pd ON pd.id = pe.department_id
        LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN bank_accounts k ON k.id = e.bank_account_id
        WHERE e.deleted = 0 AND e.day >= ? AND e.day <= ? ORDER BY e.day, e.id`, [from, to]);
    },
    reportPieces(from, to) {
      return store.all(`SELECT e.day, e.type, e.id AS entry_id, p.denom_id, p.qty FROM entry_pieces p JOIN entries e ON e.id = p.entry_id
        WHERE e.deleted = 0 AND e.day >= ? AND e.day <= ? ORDER BY e.id`, [from, to]);
    },
    openingPieces(day) {
      const out = {};
      for (const r of store.all(`SELECT p.denom_id AS id, SUM(p.qty) AS qty FROM entry_pieces p JOIN entries e ON e.id = p.entry_id
        WHERE e.deleted = 0 AND (e.day < ? OR (e.day = ? AND e.type = 'opening')) GROUP BY p.denom_id`, [day, day])) out[r.id] = Number(r.qty);
      return out;
    },
    reportLines(from, to) {
      return store.all(`SELECT e.id AS entry_id, e.day, e.created_at, pe.name AS person_name, pd.name AS department_name, t.name AS type, l.amount, l.note, l.sort
        FROM voucher_lines l JOIN entries e ON e.id = l.entry_id JOIN expense_types t ON t.id = l.expense_type_id
        LEFT JOIN people pe ON pe.id = e.person_id LEFT JOIN departments pd ON pd.id = COALESCE(e.department_id, pe.department_id)
        WHERE e.deleted = 0 AND e.day >= ? AND e.day <= ? ORDER BY e.day, e.id, l.sort`, [from, to]);
    },
    dayClosesRange(from, to) { return store.all('SELECT * FROM day_closes WHERE day >= ? AND day <= ? ORDER BY day', [from, to]); },
    tallyRange(from, to) {
      return store.all(`SELECT t.*, u.username AS user_name FROM tally_checks t JOIN users u ON u.id = t.user_id
        WHERE t.day >= ? AND t.day <= ? ORDER BY t.day, t.id`, [from, to]);
    },
    peopleBalancesAsOf(day) {
      return store.all(`SELECT p.id, p.name, d.name AS department, p.active,
        p.opening_balance + COALESCE((SELECT SUM(e.balance_delta) FROM entries e WHERE e.person_id = p.id AND e.deleted = 0 AND e.day <= ?), 0) AS balance
        FROM people p LEFT JOIN departments d ON d.id = p.department_id ORDER BY p.name COLLATE NOCASE`, [day]);
    },
    banksAsOf(day) {
      return store.all(`SELECT k.id, k.name, k.opening_balance + COALESCE((SELECT SUM(e.bank_delta) FROM entries e
        WHERE e.bank_account_id = k.id AND e.deleted = 0 AND e.day <= ?), 0) AS balance FROM bank_accounts k ORDER BY k.name COLLATE NOCASE`, [day]);
    },

    // ---- audit log ----
    audit({ userId = null, action, table = null, rowId = null, before = null, after = null }) {
      store.run(
        'INSERT INTO audit_log (at, user_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nowIso(), userId, action, table, rowId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
      );
    },
    recentAudit(limit = 50) {
      return store.all('SELECT id, at, user_id, action, table_name, row_id, before_json, after_json FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
    },
  };
}

module.exports = { createRepo };
