'use strict';
// Accounts, sign-in, lock and idle lock. Lives in the main process; the page never sees a hash or a session id.
//
// Wrong-password handling: one counter for the whole app (not per user name), saved in the database so closing
// and reopening the app does not reset it. From the 5th wrong try in a row sign-in is locked for 1 minute, doubling
// with each further wrong try up to 15 minutes. A correct password resets the counter. The lock applies to the
// correct password too, so guessing cannot be paused and resumed.
const crypto = require('node:crypto');
const passwords = require('../security/passwords');
const { UserError } = require('../errors');

const FREE_TRIES = 4; // the 5th wrong try in a row locks
const LOCK_BASE_MS = 60 * 1000;
const LOCK_MAX_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_MINUTES = 10;

class AuthError extends UserError {
  constructor(message, code, extra = {}) {
    super(message, code, extra);
    this.name = 'AuthError';
  }
}

function waitText(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

class AuthService {
  // clock() returns milliseconds. By default it follows the store's clock, so tests drive everything from one place.
  constructor({ store, repo, clock, hasher = passwords }) {
    this.store = store;
    this.repo = repo;
    this.clock = clock || (() => store.now().getTime());
    this.hasher = hasher;
    this.session = null; // { id, userId, username, role, locked, lastActivity }
  }

  // ---- state ----
  status() {
    const s = this.session;
    return {
      setupRequired: this.repo.countUsers() === 0,
      signedIn: Boolean(s),
      locked: Boolean(s && s.locked),
      user: s ? { username: s.username, role: s.role } : null,
      lockedUntil: this._lockedUntil(),
    };
  }

  requireSession({ allowLocked = false } = {}) {
    if (!this.session) throw new AuthError('Please sign in.', 'NOT_SIGNED_IN');
    if (this.session.locked && !allowLocked) throw new AuthError('Cash Desk is locked. Enter your password to continue.', 'LOCKED');
    return this.session;
  }

  requireRole(role) {
    const s = this.requireSession();
    if (s.role !== role) throw new AuthError('Only an admin can do this.', 'FORBIDDEN');
    return s;
  }

  // ---- first-run setup ----
  setup({ username, password }) {
    if (this.repo.countUsers() > 0) throw new AuthError('Setup has already been done.', 'SETUP_DONE');
    const name = this.hasher.validateUsername(username);
    this.hasher.validatePassword(password);
    const passHash = this.hasher.hash(password);
    return this.store.transaction(() => {
      const userId = this.repo.createUser({ username: name, passHash, role: 'admin' });
      this.repo.audit({ userId, action: 'setup', table: 'users', rowId: userId, after: { username: name, role: 'admin' } });
      return this._openSession({ id: userId, username: name, role: 'admin' });
    });
  }

  // ---- sign in / out ----
  signIn({ username, password }) {
    this._assertNotLockedOut();
    const wellFormed = typeof username === 'string' && typeof password === 'string' && password.length <= 128;
    const user = wellFormed ? this.repo.findUserByName(username.trim()) : null;
    let ok = false;
    if (user && user.active) ok = this.hasher.verify(password, user.pass_hash);
    else if (wellFormed) this.hasher.verifyDummy(password);
    if (!ok) this._wrongAttempt({ userId: user ? user.id : null, action: 'signin_failed', message: 'Wrong username or password.' });
    return this.store.transaction(() => {
      this._clearAttempts();
      return this._openSession(user, 'signin');
    });
  }

  signOut() {
    const s = this.session;
    if (!s) return;
    this.store.transaction(() => this.repo.audit({ userId: s.userId, action: 'signout' }));
    this.session = null;
  }

  // ---- lock / unlock ----
  lock(reason = 'manual') {
    const s = this.requireSession({ allowLocked: true });
    if (s.locked) return;
    s.locked = true;
    this.store.transaction(() => this.repo.audit({ userId: s.userId, action: reason === 'idle' ? 'idle_lock' : 'lock' }), { defer: true });
  }

  unlock({ password }) {
    const s = this.requireSession({ allowLocked: true });
    this._assertNotLockedOut();
    const user = this.repo.getUser(s.userId);
    const ok = typeof password === 'string' && password.length <= 128 && user && user.active && this.hasher.verify(password, user.pass_hash);
    if (!ok) this._wrongAttempt({ userId: s.userId, action: 'unlock_failed', message: 'Wrong password.' });
    this.store.transaction(() => {
      this._clearAttempts();
      this.repo.audit({ userId: s.userId, action: 'unlock' });
    });
    s.locked = false;
    s.lastActivity = this.clock();
  }

  // ---- activity and idle lock ----
  touch() {
    if (this.session && !this.session.locked) this.session.lastActivity = this.clock();
  }

  idleMinutes() {
    const n = Number(this.repo.getSetting('idle_lock_minutes', String(DEFAULT_IDLE_MINUTES)));
    return Number.isInteger(n) && n >= 1 && n <= 480 ? n : DEFAULT_IDLE_MINUTES;
  }

  // Called every few seconds by the app. Returns true when this call locked the session.
  checkIdle() {
    const s = this.session;
    if (!s || s.locked) return false;
    if (this.clock() - s.lastActivity < this.idleMinutes() * 60 * 1000) return false;
    this.lock('idle');
    return true;
  }

  // ---- password change (own password) ----
  changePassword({ current, next }) {
    const s = this.requireSession();
    this._assertNotLockedOut();
    const user = this.repo.getUser(s.userId);
    const ok = typeof current === 'string' && current.length <= 128 && this.hasher.verify(current, user.pass_hash);
    if (!ok) this._wrongAttempt({ userId: s.userId, action: 'password_change_failed', message: 'The current password is wrong.' });
    this.hasher.validatePassword(next);
    const passHash = this.hasher.hash(next);
    this.store.transaction(() => {
      this._clearAttempts();
      this.repo.setPasswordHash(s.userId, passHash);
      this.repo.audit({ userId: s.userId, action: 'password_change', table: 'users', rowId: s.userId });
    });
  }

  // ---- internals ----
  _openSession(user, auditAction = null) {
    const now = this.clock();
    this.session = { id: crypto.randomUUID(), userId: user.id, username: user.username, role: user.role, locked: false, lastActivity: now };
    if (auditAction) this.repo.audit({ userId: user.id, action: auditAction });
    return { username: user.username, role: user.role };
  }

  _attempts() {
    try {
      const parsed = JSON.parse(this.repo.getSetting('auth_attempts', '{}'));
      return { failures: Number(parsed.failures) || 0, until: Number(parsed.until) || 0 };
    } catch { return { failures: 0, until: 0 }; }
  }

  _lockedUntil() {
    const until = this._attempts().until;
    return until > this.clock() ? until : 0;
  }

  _assertNotLockedOut() {
    const until = this._lockedUntil();
    if (until) throw new AuthError(`Too many wrong tries. Try again in ${waitText(until - this.clock())}.`, 'LOCKED_OUT', { until });
  }

  _clearAttempts() {
    if (this.repo.getSetting('auth_attempts', null) !== null) this.repo.setSetting('auth_attempts', JSON.stringify({ failures: 0, until: 0 }));
  }

  // Records the failure (and the lock, from the 5th in a row) and throws. The attempted name is never stored:
  // someone may have typed a password into the name box.
  _wrongAttempt({ userId, action, message }) {
    const now = this.clock();
    const failures = this._attempts().failures + 1;
    const until = failures > FREE_TRIES ? now + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (failures - FREE_TRIES - 1)) : 0;
    this.store.transaction(() => {
      this.repo.setSetting('auth_attempts', JSON.stringify({ failures, until }));
      this.repo.audit({ userId, action });
    });
    if (until) throw new AuthError(`${message} Locked for ${waitText(until - now)}.`, 'LOCKED_OUT', { until });
    throw new AuthError(message, 'BAD_CREDENTIALS', { triesLeft: FREE_TRIES + 1 - failures });
  }
}

module.exports = { AuthService, AuthError, waitText, FREE_TRIES };
