'use strict';
// Backups. A backup is a copy of the whole database, sealed with AES-256-GCM under a key made from the BACKUP PASSWORD
// (scrypt), so it can be restored on any PC by typing that password. The data key itself belongs to the Windows account
// and is never written into a backup.
//
// Automatic backups (day close, quit) need the key without asking, so the derived key is kept in cashdesk-backup.key,
// wrapped by the Windows account like the data key. The password itself is never stored.
// File: "CDBAK001" | salt(16) | nonce(12) | tag(16) | ciphertext.  Newest 30 "CashDesk-backup-*" files are kept.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeAtomic } = require('../security/vault');
const { UserError } = require('../errors');

const MAGIC = Buffer.from('CDBAK001');
const HEAD = 8 + 16 + 12 + 16;
const KEEP = 30, KEEP_SAFETY = 5;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const deriveKey = (password, salt) => crypto.scryptSync(String(password), salt, 32, SCRYPT);

function sealBackup(plain, key, salt) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, nonce, c.getAuthTag(), body]);
}
function openBackup(bytes, password) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEAD || !bytes.subarray(0, 8).equals(MAGIC)) throw new UserError('That file is not a Cash Desk backup.', 'BAD_BACKUP');
  const key = deriveKey(password, bytes.subarray(8, 24));
  const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(24, 36));
  d.setAAD(MAGIC); d.setAuthTag(bytes.subarray(36, 52));
  try { return Buffer.concat([d.update(bytes.subarray(52)), d.final()]); }
  catch { throw new UserError('Wrong backup password, or the backup is damaged.', 'BAD_PASSWORD'); }
}

class BackupService {
  constructor({ store, repo, safeStorage, userDataDir, defaultDir, now = () => new Date() }) {
    Object.assign(this, { store, repo, safeStorage, userDataDir, defaultDir, now });
    this.keyFile = path.join(userDataDir, 'cashdesk-backup.key');
    this.lastWrites = store.writes; // a backup on quit is skipped when nothing was saved since the last one
  }

  folder() { return this.repo.getSetting('backup_folder', null) || this.defaultDir; }
  configured() { return fs.existsSync(this.keyFile) && this.repo.getSetting('backup_salt', null) !== null; }

  _key() {
    try { return Buffer.from(this.safeStorage.decryptString(fs.readFileSync(this.keyFile)), 'base64'); }
    catch { throw new UserError('The backup key cannot be read. Set the backup password again (Settings, Backup).', 'BACKUP_KEY'); }
  }

  setPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new UserError('The backup password must be 8 to 128 characters.');
    const salt = crypto.randomBytes(16);
    writeAtomic(this.keyFile, this.safeStorage.encryptString(deriveKey(password, salt).toString('base64')));
    this.store.transaction(() => this.repo.setSetting('backup_salt', salt.toString('base64')));
  }

  setFolder(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new UserError('Choose a folder.');
    try { fs.mkdirSync(dir, { recursive: true }); const probe = path.join(dir, `.w${process.pid}`); fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe); }
    catch { throw new UserError('Cash Desk cannot write to that folder.'); }
    this.store.transaction(() => this.repo.setSetting('backup_folder', dir));
  }

  list() {
    const dir = this.folder();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => /^CashDesk-(backup|before-restore)-.*\.cdbak$/.test(n)).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString(), safety: name.includes('before-restore') };
    }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name < b.name ? 1 : -1));
  }

  _prune(prefix, keep) {
    const dir = this.folder();
    for (const f of this.list().filter((x) => x.name.startsWith(prefix)).slice(keep)) { try { fs.unlinkSync(path.join(dir, f.name)); } catch { /* in use: next time */ } }
  }

  // reason: 'manual', 'day close', 'quit'. Returns { name, path }. Throws when no backup password is set yet.
  create(reason = 'manual', prefix = 'CashDesk-backup') {
    if (!this.configured()) throw new UserError('Set a backup password first (Settings, Backup).', 'BACKUP_OFF');
    const salt = Buffer.from(this.repo.getSetting('backup_salt'), 'base64');
    fs.mkdirSync(this.folder(), { recursive: true });
    let file = path.join(this.folder(), `${prefix}-${stamp(this.now())}.cdbak`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(this.folder(), `${prefix}-${stamp(this.now())}-${n}.cdbak`); // never overwrite a backup
    writeAtomic(file, sealBackup(this.store.snapshot(), this._key(), salt));
    this._prune(prefix, prefix === 'CashDesk-backup' ? KEEP : KEEP_SAFETY);
    this.lastWrites = this.store.writes;
    return { name: path.basename(file), path: file };
  }

  // Never throws: a failed automatic backup must not stop a day close or a quit.
  auto(reason) {
    if (reason === 'quit' && this.store.writes === this.lastWrites) return { ok: true, skipped: true };
    try { return { ok: true, ...this.create(reason) }; }
    catch (error) { return { ok: false, message: error.message, code: error.code }; }
  }

  status() {
    const files = this.list();
    return { configured: this.configured(), folder: this.folder(), customFolder: Boolean(this.repo.getSetting('backup_folder', null)), keep: KEEP,
      lastAt: (files.find((f) => !f.safety) || {}).at || null, files: files.slice(0, 40) };
  }

  // Replaces ALL current data with the backup. A safety copy of the current data is made first.
  restore({ name, password }) {
    if (typeof name !== 'string' || name !== path.basename(name)) throw new UserError('Choose a backup from the list.');
    const file = path.join(this.folder(), name);
    if (!fs.existsSync(file)) throw new UserError('That backup file is not in the backup folder any more.');
    const plain = openBackup(fs.readFileSync(file), password);
    let safety = null;
    if (this.configured()) safety = this.create('before restore', 'CashDesk-before-restore').name;
    this.store.replace(plain);
    return { restored: name, safetyCopy: safety };
  }
}

module.exports = { BackupService, sealBackup, openBackup, KEEP };
