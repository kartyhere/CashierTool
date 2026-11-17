'use strict';
// Report -> Excel. Numbers stay numbers (so they can be summed in Excel); the Total row is bold with a rule above it.
const ExcelJS = require('exceljs');
const { totalsRow } = require('./format');

const NUM = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';

async function toXlsx(report, { generatedAt = new Date() } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cash Desk'; wb.created = generatedAt;
  const ws = wb.addWorksheet(report.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = report.title; ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${report.subtitle}  ·  amounts in rupees`; ws.getCell('A2').font = { color: { argb: 'FF666666' } };
  let r = 4;
  const widths = [];
  const grow = (i, v) => { widths[i] = Math.min(60, Math.max(widths[i] || 8, String(v ?? '').length + 2)); };
  for (const section of report.sections) {
    if (section.heading) { ws.getCell(r, 1).value = section.heading; ws.getCell(r, 1).font = { bold: true, size: 11 }; r++; }
    section.columns.forEach((c, i) => {
      const cellH = ws.getCell(r, i + 1); cellH.value = c.label; cellH.font = { bold: true };
      cellH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
      cellH.alignment = { horizontal: c.kind === 'text' ? 'left' : 'right' }; grow(i, c.label);
    });
    r++;
    const put = (row, bold) => {
      section.columns.forEach((c, i) => {
        const v = row[c.key];
        const x = ws.getCell(r, i + 1);
        if (v !== null && v !== undefined && v !== '') x.value = v;
        if (c.kind !== 'text' && typeof v === 'number') x.numFmt = NUM;
        if (bold) { x.font = { bold: true }; x.border = { top: { style: 'thin' } }; }
        grow(i, c.kind === 'text' ? v : (typeof v === 'number' ? v.toLocaleString('en-IN') : v));
      });
      r++;
    };
    section.rows.forEach((row) => put(row, false));
    const t = totalsRow(section);
    if (t) put(t, true);
    r++;
  }
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { toXlsx };
