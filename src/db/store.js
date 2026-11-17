'use strict';
// The database file: sql.js (SQLite in memory) loaded from, and saved to, one encrypted file through the vault.
//
// Saving rule: a committed change is written to disk straight away (the whole file, atomically). Money is
// never left waiting in memory. Only low-value writes (such as the theme) pass { defer: true }, which groups
// them into one write about 400 ms later. close() always writes anything still waiting.
//
// If a write to disk fails after the change was committed in memory, the store stays "dirty" and keeps the
// error in lastSaveError; the next write, flush() or close() tries again, and callers get a PersistError.
const { migrate } = require('./migrations');
const { UserError } = require('../errors');

class PersistError extends UserError {
  constructor(message) { super(message, 'PERSIST'); this.name = 'PersistError'; }
}

const DEFER_MS = 400;

class Store {
  constructor({ SQL, db, vault, role, now }) {
    this.SQL = SQL;
    this.db = db;
    this.vault = vault;
    this.role = role;
    this.now = now;
    this.dirty = false;
    this.timer = null;
    this.depth = 0;
    this.lastSaveError = null;
    this.closed = false;
  }

  // vault: from createVault. SQL: the result of initSqlJs(). A file that exists but cannot be opened is an error;
  // a new empty database is created only when there is no file at all.
  static open({ SQL, vault, role = 'cashdesk.db', now = () => new Date() }) {
    const bytes = vault.read(role); // throws VaultError when the file is not trustworthy
    let db;
    try {
      db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      db.run('PRAGMA foreign_keys = ON');
      if (bytes) db.exec('SELECT 1 FROM sqlite_master LIMIT 1'); // proves the bytes are a database
    } catch (error) {
      throw new Error(`The data file could not be opened (${error.message}). It was left untouched. Restore a backup.`);
    }
    const store = new Store({ SQL, db, vault, role, now });
    const applied = migrate(db, { now });
    db.run('PRAGMA foreign_keys = ON');
    if (applied.length || !bytes) { store.dirty = true; store.flush(); }
    return store;
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  // Runs one statement. Writes are only allowed inside transaction(), so a change can never be made and then
  // forgotten without being saved. Returns { changes, lastId }.
  run(sql, params = []) {
    if (this.depth === 0) throw new Error('Database writes must run inside a transaction.');
    this.db.run(sql, params);
    return { changes: this.db.getRowsModified(), lastId: Number(this.get('SELECT last_insert_rowid() AS id').id) };
  }

  // fn runs inside BEGIN ... COMMIT; an exception rolls everything back and is rethrown. Calls inside fn join
  // the same transaction. After the outermost commit the file is written (now, or deferred).
  transaction(fn, { defer = false } = {}) {
    if (this.closed) throw new Error('The database is closed.');
    if (this.depth > 0) return fn(this);
    this.db.run('BEGIN');
    this.depth = 1;
    let result;
    try {
      result = fn(this);
      this.db.run('COMMIT');
    } catch (error) {
      try { this.db.run('ROLLBACK'); } catch { /* nothing open */ }
      throw error;
    } finally {
      this.depth = 0;
    }
    this.dirty = true;
    if (defer) this._schedule(); else this.flush();
    return result;
  }

  _schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch { /* kept in lastSaveError; retried on the next write and at close */ }
    }, DEFER_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty && this.lastSaveError === null && this.vault.exists(this.role)) return;
    if (this.depth > 0) throw new Error('Cannot save in the middle of a transaction.');
    try {
      const bytes = this.db.export();
      // export() closes and reopens the database, which resets pragmas: switch foreign keys back on.
      this.db.run('PRAGMA foreign_keys = ON');
      this.vault.write(this.role, bytes);
      this.dirty = false;
      this.lastSaveError = null;
    } catch (error) {
      this.lastSaveError = error;
      this.dirty = true;
      throw new PersistError(`The change could not be saved to disk (${error.message}). Free some space or check the folder, then try again.`);
    }
  }

  close() {
    if (this.closed) return;
    try { if (this.dirty) this.flush(); }
    finally {
      this.closed = true;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.db.close();
    }
  }
}

module.exports = { Store, PersistError };
