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
        party_name, voucher_amount, cash_delta, balance_delta, bank_delta, reference, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.day, nowIso(), e.userId, e.type, e.source ?? null, e.personId ?? null, e.branchId ?? null, e.departmentId ?? null,
        e.bankAccountId ?? null, e.partyName ?? null, e.voucherAmount ?? null, e.cashDelta, e.balanceDelta ?? 0, e.bankDelta ?? 0,
        e.reference ?? null, e.remark ?? null]).lastId;
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
      return store.all(`SELECT e.*, u.username AS user_name, b.name AS branch_name, d.name AS department_name, k.name AS bank_name
        FROM entries e JOIN users u ON u.id = e.user_id
        LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN bank_accounts k ON k.id = e.bank_account_id
        WHERE e.day = ? AND (? IS NULL OR e.type = ?) ORDER BY e.id`, [day, type, type]);
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
