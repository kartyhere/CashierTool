'use strict';
// All SQL lives here, in small named functions. Nothing else in the app writes SQL.
// Phase 1 covers users, settings and the audit log. Later phases add their queries to this file.

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
