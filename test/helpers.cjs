'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { createVault } = require('../src/security/vault');
const { Store } = require('../src/db/store');
const { createRepo } = require('../src/db/repo');
const { AuthService } = require('../src/auth/service');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (t) => Buffer.from(`T:${t}`),
  decryptString: (b) => b.toString().slice(2),
};
let SQLp;
const getSQL = () => (SQLp ||= initSqlJs());
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cashdesk-'));

async function openApp({ dir = tmp(), clock } = {}) {
  const SQL = await getSQL();
  const vault = createVault({ userDataDir: dir, safeStorage: fakeSafeStorage });
  const store = Store.open({ SQL, vault });
  const repo = createRepo(store);
  let t = 1_700_000_000_000;
  const clk = clock || (() => t);
  const auth = new AuthService({ store, repo, clock: clk,
    hasher: { ...require('../src/security/passwords'), hash: (p) => 'h:' + p, verify: (p, h) => h === 'h:' + p, verifyDummy() {} } });
  return { dir, SQL, vault, store, repo, auth, advance: (ms) => { t += ms; }, reopen: () => openApp({ dir }) };
}
module.exports = { openApp, tmp, getSQL, fakeSafeStorage };
