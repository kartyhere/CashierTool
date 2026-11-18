'use strict';
// Free service payment: party codes (stored in the database) and the monthly run (worked out from the Excel file, nothing stored).
const Fsc = require('../core/fsc');
const { UserError } = require('../errors');

function install(LedgerService) {
  const P = LedgerService.prototype;

  P.fscPartyCodes = function () {
    this.auth.requireSession();
    const rows = this.repo.partyCodes();
    return { count: rows.length, sample: rows.slice(0, 8) };
  };

  // rows: the party codes file as plain rows. Adds new codes, updates changed names, keeps codes that are not in the file.
  P.fscImportParties = function ({ rows, fileName }) {
    const s = this.auth.requireSession();
    const parsed = Fsc.parsePartyCodes(Array.isArray(rows) ? rows : []);
    if (!parsed.parties.size) throw new UserError('I found no party codes in that file. It needs two columns: the code (as in Service_parent) and the party name.');
    const existing = new Map(this.repo.partyCodes().map((r) => [r.code, r.name]));
    let added = 0, changed = 0, same = 0;
    const at = this.store.now().toISOString();
    this.store.transaction(() => {
      for (const [code, name] of parsed.parties) {
        if (!existing.has(code)) added++; else if (existing.get(code) !== name) changed++; else same++;
        if (existing.get(code) !== name) this.repo.partyCodeUpsert(code, name, at);
      }
      this.repo.audit({ userId: s.userId, action: 'party_codes_import', table: 'party_codes', after: { fileName, added, changed, same } });
    });
    return { added, changed, same, total: this.repo.partyCodes().length, issues: parsed.issues };
  };

  // rows: the monthly file as plain rows. Returns the report; the last run is kept in memory for the Excel / PDF export.
  P.fscRun = function ({ rows, fileName }) {
    this.auth.requireSession();
    const parties = new Map(this.repo.partyCodes().map((r) => [r.code, r.name]));
    if (!parties.size) throw new UserError('Load the party codes file first (press P), so names can be filled in.');
    const result = Fsc.compute(rows, parties, { fileName });
    if (!result.ok) throw new UserError(result.error);
    const report = Fsc.buildReport(result, { generated: this.today() });
    this._fscLast = report;
    return { report, totals: result.totals, issueCount: result.issues.filter((i) => i.level !== 'info').length, errorCount: result.issues.filter((i) => i.level === 'error').length };
  };

  P.fscLastReport = function () {
    this.auth.requireSession();
    if (!this._fscLast) throw new UserError('Run the monthly file first.');
    return this._fscLast;
  };
}

module.exports = { install };
