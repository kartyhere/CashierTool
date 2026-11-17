'use strict';
// Settings, users and denominations. Admin only. Every change is checked here and written to the audit log with before and after.
const { UserError } = require('../errors');

// key: [label, default, min, max, kind]. kind: int or time. Money rules (rounding step, balance limit, largest entry) are here too.
const FIELDS = {
  rounding_step: ['Rounding step (₹)', 10, 1, 100, 'int'],
  balance_limit: ['Person balance limit (±₹)', 10, 0, 1000, 'int'],
  max_entry_amount: ['Largest amount in one entry (₹)', 1000000, 1000, 100000000, 'int'],
  deposit_float: ['Cash kept in the drawer after a deposit (₹)', 5000, 0, 1000000, 'int'],
  deposit_limit: ['Show the deposit banner at this much cash (₹)', 500000, 1000, 100000000, 'int'],
  deposit_banner_from: ['Deposit banner from (24 h, HH:MM)', '12:00', null, null, 'time'],
  morning_check_time: ['Morning check from (24 h, HH:MM)', '09:15', null, null, 'time'],
  morning_repeat_minutes: ['Morning check repeats every (minutes)', 30, 1, 240, 'int'],
  idle_lock_minutes: ['Lock after idle (minutes)', 10, 1, 120, 'int'],
};

function install(LedgerService) {
  const P = LedgerService.prototype;

  P.settingsGet = function () {
    this.auth.requireRole('admin');
    return { fields: Object.entries(FIELDS).map(([key, [label, def, min, max, kind]]) => ({ key, label, kind, min, max, default: def, value: kind === 'int' ? this._number(key, def, min) : this.repo.getSetting(key, def) })) };
  };

  P.settingsSave = function (input) {
    const s = this.auth.requireRole('admin');
    if (!input || typeof input !== 'object' || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw new UserError('Nothing to save.');
    const next = {};
    for (const [key, raw] of Object.entries(input.values)) {
      const f = FIELDS[key];
      if (!f) throw new UserError('Unknown setting.');
      const [label, , min, max, kind] = f;
      if (kind === 'time') {
        if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new UserError(`${label}: use hours and minutes like 09:15.`);
        next[key] = raw;
      } else {
        if (!Number.isInteger(raw) || raw < min || raw > max) throw new UserError(`${label}: enter a whole number from ${min} to ${max}.`);
        next[key] = String(raw);
      }
    }
    return this.store.transaction(() => {
      const before = {}; const after = {};
      for (const [key, value] of Object.entries(next)) {
        const old = this.repo.getSetting(key, null);
        if (old === value) continue;
        before[key] = old; after[key] = value;
        this.repo.setSetting(key, value);
      }
      if (Object.keys(after).length) this.repo.audit({ userId: s.userId, action: 'settings_change', table: 'settings', before, after });
      return { changed: Object.keys(after).length };
    });
  };

  // ---- users ----
  P.usersList = function () {
    this.auth.requireRole('admin');
    return { users: this.repo.usersAll().map((u) => ({ id: u.id, username: u.username, role: u.role, active: Boolean(u.active), canEdit: u.role === 'admin' || Boolean(u.can_edit) })) };
  };

  // New user: { username, password, role }. Existing: { id, role?, active?, password? } (an admin sets a new password for them).
  P.userSave = function (input) {
    const s = this.auth.requireRole('admin');
    const hasher = this.auth.hasher;
    const role = input.role;
    if (role !== undefined && role !== 'admin' && role !== 'cashier') throw new UserError('The role must be admin or cashier.');
    if (!input.id) {
      const name = hasher.validateUsername(input.username);
      hasher.validatePassword(input.password);
      if (this.repo.findUserByName(name)) throw new UserError('That username is already taken.');
      const passHash = hasher.hash(input.password);
      return this.store.transaction(() => {
        const id = this.repo.createUser({ username: name, passHash, role: role || 'cashier' });
        this.repo.audit({ userId: s.userId, action: 'user_create', table: 'users', rowId: id, after: { username: name, role: role || 'cashier' } });
        return { id };
      });
    }
    const user = this.repo.getUser(input.id);
    if (!user) throw new UserError('That user does not exist.');
    const newRole = role || user.role;
    const newActive = input.active === undefined ? Boolean(user.active) : Boolean(input.active);
    const newCanEdit = input.canEdit === undefined ? Boolean(user.can_edit) : Boolean(input.canEdit);
    if (user.id === s.userId && (newRole !== user.role || !newActive)) throw new UserError('You cannot change your own role or turn yourself off.');
    const losesAdmin = user.role === 'admin' && user.active && (newRole !== 'admin' || !newActive);
    if (losesAdmin && this.repo.activeAdmins() <= 1) throw new UserError('There must be at least one active admin.');
    let passHash = null;
    if (input.password !== undefined) { hasher.validatePassword(input.password); passHash = hasher.hash(input.password); }
    return this.store.transaction(() => {
      this.repo.userUpdate(user.id, { role: newRole, active: newActive, canEdit: newCanEdit });
      if (passHash) this.repo.setPasswordHash(user.id, passHash);
      this.repo.audit({ userId: s.userId, action: passHash ? 'user_password_reset' : 'user_update', table: 'users', rowId: user.id,
        before: { role: user.role, active: Boolean(user.active), canEdit: Boolean(user.can_edit) }, after: { role: newRole, active: newActive, canEdit: newCanEdit } });
      return { id: user.id };
    });
  };

  // ---- denominations: a hidden one is never suggested (any pieces still in the drawer are still counted) ----
  P.denominationsList = function () {
    this.auth.requireRole('admin');
    const stock = this.repo.drawerCounts();
    return { denominations: this.repo.denominationRows().map((d) => ({ id: d.id, value: d.value, kind: d.kind, hidden: Boolean(d.hidden), inDrawer: stock[d.id] || 0 })) };
  };
  P.denominationHide = function ({ id, hidden }) {
    const s = this.auth.requireRole('admin');
    const row = this.repo.denominationRows().find((d) => d.id === id);
    if (!row) throw new UserError('Unknown note or coin.');
    const hide = Boolean(hidden);
    if (hide && this.repo.denominationRows().filter((d) => !d.hidden && d.id !== id).length < 1) throw new UserError('At least one note or coin must stay in use.');
    this.store.transaction(() => {
      this.repo.setDenominationHidden(id, hide);
      this.repo.audit({ userId: s.userId, action: hide ? 'denomination_hide' : 'denomination_show', table: 'denominations', before: { hidden: Boolean(row.hidden) }, after: { id, hidden: hide } });
    });
    return { id, hidden: hide };
  };
}

module.exports = { install, FIELDS };
