'use strict';
// Report -> PDF (A4 landscape). Built-in font has no rupee sign, so amounts are plain numbers and the page says "Amounts in rupees".
const { jsPDF } = require('jspdf');
const { cell: rawCell, totalsRow } = require('./format');

// The built-in PDF font has no rupee sign or true minus, so they are written as Rs and -.
const safe = (t) => String(t).replace(/₹/g, 'Rs ').replace(/[\u2212\u2013\u2014]/g, '-').replace(/Rs +/g, 'Rs ');
const cell = (c, v) => safe(rawCell(c, v));

const W = 842, H = 595, M = 28, LINE = 10, FONT = 7.5;

function toPdf(report, { generatedAt = new Date(), appName = 'Cash Desk' } = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: false });
  doc.setProperties({ title: safe(`${report.title} ${report.subtitle}`), creator: appName });
  let y = M;
  const usable = W - 2 * M;

  const newPage = () => { doc.addPage(); y = M; };
  function title() {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(safe(report.title), M, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(safe(`${report.subtitle}   ·   Amounts in rupees`), M, y + 27);
    y += 44;
  }

  function drawSection(section) {
    const cols = section.columns;
    // Column widths from the widest content, then scaled to the page.
    doc.setFontSize(FONT);
    const want = cols.map((c) => {
      doc.setFont('helvetica', 'bold');
      let w = doc.getTextWidth(safe(c.label));
      doc.setFont('helvetica', 'normal');
      for (const r of [...section.rows, totalsRow(section) || {}]) w = Math.max(w, Math.min(doc.getTextWidth(cell(c, r[c.key])), c.kind === 'text' ? 170 : 90));
      return w + 8;
    });
    const scale = Math.min(1, usable / want.reduce((a, b) => a + b, 0));
    const widths = want.map((w) => w * scale);
    const xs = widths.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + widths[i - 1] : M), acc), []);

    const header = () => {
      if (y + 2 * LINE > H - M) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT);
      doc.setFillColor(230, 230, 230); doc.rect(M, y, usable, LINE + 4, 'F');
      cols.forEach((c, i) => { const t = doc.splitTextToSize(safe(c.label), widths[i] - 6)[0]; doc.text(t, c.kind === 'text' ? xs[i] + 3 : xs[i] + widths[i] - 3, y + LINE, { align: c.kind === 'text' ? 'left' : 'right' }); });
      y += LINE + 6;
    };
    if (section.heading) {
      if (y + 4 * LINE > H - M) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(safe(section.heading), M, y + 8); y += 16;
    }
    header();
    const draw = (row, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(FONT);
      const wrapped = cols.map((c, i) => (c.kind === 'text' ? doc.splitTextToSize(cell(c, row[c.key]), widths[i] - 6) : [cell(c, row[c.key])]));
      const lines = Math.max(1, ...wrapped.map((w) => w.length));
      if (y + lines * LINE + 4 > H - M - 14) { newPage(); header(); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(FONT); }
      cols.forEach((c, i) => wrapped[i].forEach((t, k) => doc.text(t, c.kind === 'text' ? xs[i] + 3 : xs[i] + widths[i] - 3, y + LINE - 1 + k * LINE, { align: c.kind === 'text' ? 'left' : 'right' })));
      y += lines * LINE + 2;
      doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 2;
    };
    if (!section.rows.length) { doc.setFont('helvetica', 'italic'); doc.setFontSize(FONT); doc.text('Nothing to show for this period.', M + 3, y + LINE); y += LINE + 6; }
    section.rows.forEach((r) => draw(r, false));
    const t = totalsRow(section);
    if (t) draw(t, true);
    y += 14;
  }

  title();
  report.sections.forEach(drawSection);
  if (report.id === 'denomination') { // sign-off lines for the day close
    if (y + 70 > H - M) newPage();
    y += 40; doc.setDrawColor(0); doc.setLineWidth(0.6); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.line(M, y, M + 200, y); doc.text('Cashier', M, y + 12);
    doc.line(W - M - 200, y, W - M, y); doc.text('Manager', W - M - 200, y + 12);
  }

  const pages = doc.getNumberOfPages();
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110);
    doc.text(safe(`${appName} · ${report.title} · generated ${stamp}`), M, H - 14); doc.text(`Page ${p} of ${pages}`, W - M, H - 14, { align: 'right' });
    doc.setTextColor(0);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { toPdf };
