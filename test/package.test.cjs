'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');

test('separate identity from BOH, portable windows build', () => {
  assert.equal(pkg.build.appId, 'com.karthik.cashdesk');
  assert.equal(pkg.build.productName, 'Cash Desk');
  assert.equal(pkg.build.win.target[0].target, 'portable');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});
test('CHANGES.md has an entry for this version', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'CHANGES.md'), 'utf8');
  assert.ok(c.includes(`## ${pkg.version}`));
});
test('the build ships only what it needs', () => {
  assert.ok(pkg.build.files.includes('src/**/*'));
  assert.ok(!Object.keys(pkg.dependencies).some((d) => !['sql.js', 'exceljs', 'jspdf'].includes(d)));
});
