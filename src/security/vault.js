'use strict';
// Encrypted storage for Cash Desk's data files (same approach as BOH since 1.0.65, in a smaller form).
//
//  * A random 256-bit data key is created once and kept in `cashdesk.key`, wrapped by the Windows account
//    (Electron safeStorage = DPAPI). The key is never written in the clear.
//  * Every data file is AES-256-GCM sealed. The file's name (its "role") is part of the authenticated data,
//    so a sealed copy renamed to another file name does not open.
//  * Reads are strict: a file that is not sealed is never trusted (a planted plain copy is refused, not read).
//  * Writes are atomic: temp file in the same folder, fsync, rename. A power cut leaves the old file or the new one.
//  * If sealed data exists but the key is missing, a new key is NEVER created (that would orphan the data).
//
// Because the key belongs to the Windows account, the data folder cannot be opened on another PC or account.
// Backups that must be restorable elsewhere need their own password-based key (Phase 6).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('CDESK001'); // 8 bytes
const HEADER = 8 + 12 + 16; // magic + nonce + tag

class VaultError extends Error {
  constructor(message, code) { super(message); this.name = 'VaultError'; this.code = code; }
}

const aad = (role) => Buffer.concat([MAGIC, Buffer.from(`\0${role}`)]);

function seal(plain, key, role) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(role));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
}

function unseal(bytes, key, role) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER || !bytes.subarray(0, 8).equals(MAGIC)) {
    throw new VaultError('A data file is not protected. It was not used. Keep the file and restore a backup.', 'UNPROTECTED');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
  decipher.setAAD(aad(role));
  decipher.setAuthTag(bytes.subarray(20, 36));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  } catch {
    throw new VaultError('A data file failed its integrity check (damaged or changed). Keep the file and restore a backup.', 'TAMPERED');
  }
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Windows can refuse a rename for a moment while antivirus or a backup tool has the target open.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      if (attempt >= 5 || !RETRY_CODES.has(error.code)) throw error;
      sleepSync(40 * (attempt + 1));
    }
  }
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    renameWithRetry(tmp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    try { fs.unlinkSync(tmp); } catch { /* renamed away, or never created */ }
  }
}

function hasSealedData(dataDir) {
  if (!fs.existsSync(dataDir)) return false;
  return fs.readdirSync(dataDir).some((name) => !name.endsWith('.tmp'));
}

// safeStorage is injected so tests can run in plain Node. In the app it is Electron's safeStorage.
function createVault({ userDataDir, safeStorage }) {
  if (!userDataDir) throw new Error('A data folder is required.');
  if (!safeStorage || !safeStorage.isEncryptionAvailable()
    || (typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new VaultError('Secure Windows account storage is unavailable, so Cash Desk will not start. No files were changed.', 'NO_SECURE_STORAGE');
  }
  const keyFile = path.join(userDataDir, 'cashdesk.key');
  const dataDir = path.join(userDataDir, 'data');

  let key;
  if (fs.existsSync(keyFile)) {
    try { key = Buffer.from(safeStorage.decryptString(fs.readFileSync(keyFile)), 'base64'); }
    catch { throw new VaultError('The data key cannot be unlocked for this Windows account. Keep the files and restore a backup in a separate setup.', 'KEY_UNREADABLE'); }
    if (key.length !== 32) throw new VaultError('The data key is invalid.', 'KEY_INVALID');
  } else {
    if (hasSealedData(dataDir)) {
      throw new VaultError('The data key is missing, but data files exist. A new key was not created, so nothing was lost. Restore the key file or a backup.', 'KEY_MISSING');
    }
    key = crypto.randomBytes(32);
    writeAtomic(keyFile, safeStorage.encryptString(key.toString('base64')));
  }

  const fileFor = (role) => {
    if (!/^[A-Za-z0-9._-]+$/.test(role) || role.startsWith('.')) throw new Error('Invalid data file name.');
    return path.join(dataDir, role);
  };

  return {
    dataDir,
    exists: (role) => fs.existsSync(fileFor(role)),
    // Returns the plain bytes, or null when the file does not exist yet. Throws VaultError if it is not trustworthy.
    read(role) {
      const file = fileFor(role);
      if (!fs.existsSync(file)) return null;
      return unseal(fs.readFileSync(file), key, role);
    },
    write(role, bytes) {
      writeAtomic(fileFor(role), seal(Buffer.from(bytes), key, role));
    },
  };
}

module.exports = { createVault, VaultError, seal, unseal, writeAtomic };
