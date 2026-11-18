'use strict';
// Reads an .xlsx into plain rows of values (what the cell shows: a formula gives its stored result).
// Only used for the monthly service payment file and the party codes file.
const ExcelJS = require('exceljs');
const path = require('node:path');
const { UserError } = require('../errors');

const MAX_BYTES = 40 * 1024 * 1024;

function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;
  if ('result' in v) return plain(v.result);                         // formula
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return plain(v.text);                             // hyperlink
  if ('error' in v) return null;
  return null;
}

async function readWorkbook(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new UserError('Choose an Excel file.');
  if (!/\.xlsx$/i.test(file)) throw new UserError('Choose an Excel .xlsx file. If it is an old .xls file, open it in Excel and Save As .xlsx first.');
  const fs = require('node:fs');
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) throw new UserError('That file is too big (over 40 MB).');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(file); } catch (e) { throw new UserError('That file could not be opened as an Excel .xlsx file. Is it open in Excel, or damaged?'); }
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells = [];
      for (let c = 1; c <= Math.min(ws.columnCount, 200); c++) cells.push(plain(row.getCell(c).value));
      rows[n - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return { name: ws.name, rows };
  });
}

module.exports = { readWorkbook, plain };
