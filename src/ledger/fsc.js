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
    this._fscLast = report; this._fscResult = result;
    return { report, totals: result.totals, issueCount: result.issues.filter((i) => i.level !== 'info').length, errorCount: result.issues.filter((i) => i.level === 'error').length };
  };

  // The bank's UTR file, after the monthly file has been run: attaches UTR, amount and Paid / Return to each bank account.
  P.fscUtr = function ({ rows, fileName }) {
    this.auth.requireSession();
    const result = this._fscResult;
    if (!result) throw new UserError('Choose the monthly file first, then the UTR file.');
    const u = Fsc.attachUtr(result, rows, { utrFileName: fileName });
    if (!u.ok) throw new UserError(u.error);
    result.utr = u;
    const report = Fsc.buildReport(result, { generated: this.today() });
    this._fscLast = report;
    const errors = result.issues.filter((i) => i.level === 'error').length + u.issues.filter((i) => i.level === 'error').length;
    return { report, totals: { ...result.totals, utr: u.totals }, issueCount: result.issues.filter((i) => i.level !== 'info').length + u.issues.length, errorCount: errors, utr: u.totals };
  };

  P.fscSearch = function ({ q, party }) {
    this.auth.requireSession();
    if (!this._fscResult) return { ready: false, items: [] };
    return { ready: true, hasUtr: Boolean(this._fscResult.utr), items: Fsc.searchInvoices(this._fscResult, { q: String(q || ''), party: String(party || '') }) };
  };

  // The UTR for one invoice row of the monthly file (the page sends only the row number; main finds the text to copy).
  P.fscUtrFor = function ({ row }) {
    this.auth.requireSession();
    if (!this._fscResult) throw new UserError('Choose the monthly file first.');
    if (!this._fscResult.utr) throw new UserError('Load the UTR file first (press U).');
    const hit = Fsc.searchInvoices(this._fscResult, { limit: 100000 }).find((x) => x.row === Number(row));
    if (!hit) throw new UserError('That invoice is not in the list.');
    if (!hit.utr) throw new UserError(hit.utrStatus === 'RETURNED' ? 'This payment was RETURNED and has no paid UTR.' : 'No paid UTR was found for this bank account.');
    return { utr: hit.utr, gstLot: hit.gstLot };
  };

  P.fscLastReport = function () {
    this.auth.requireSession();
    if (!this._fscLast) throw new UserError('Run the monthly file first.');
    return this._fscLast;
  };
}

module.exports = { install };
