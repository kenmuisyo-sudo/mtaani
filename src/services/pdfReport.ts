import PDFDocument from 'pdfkit';
import type { Swap, Expense } from '../lib/types.js';

type SwapRow = Pick<
  Swap,
  | 'swappedAt'
  | 'tukTukReg'
  | 'incomingBarcode'
  | 'incomingPct'
  | 'outgoingBarcode'
  | 'outgoingPct'
  | 'netPercent'
  | 'totalCharged'
  | 'companyShare'
  | 'stationShare'
>;

export interface ReportMeta {
  title: string;
  organizationName: string;
  substationName?: string;
  periodLabel: string;
  from: Date;
  to: Date;
  totals: {
    swapCount: number;
    grossRevenue: number;
    companyShare: number;
    stationShare: number;
    energyPercent: number;
    totalExpenses: number;
    profit: number;
  };
}

export function buildSwapPdf(meta: ReportMeta, swaps: SwapRow[], expenses: Expense[] = []): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(`${meta.organizationName} Swap Report`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#444');
    if (meta.substationName) doc.text(`Substation: ${meta.substationName}`, { align: 'center' });
    doc.text(`Period: ${meta.periodLabel}`, { align: 'center' });
    doc.text(
      `${meta.from.toLocaleString('en-KE')} — ${meta.to.toLocaleString('en-KE')}`,
      { align: 'center' }
    );
    doc.moveDown(1);
    doc.fillColor('#000');

    // Summary Section
    doc.fontSize(12).text('Summary', { underline: true });
    doc.fontSize(10);
    doc.text(`Total swaps: ${meta.totals.swapCount}`);
    doc.text(`Gross revenue: KES ${meta.totals.grossRevenue.toFixed(2)}`);
    doc.text(`Total expenses: KES ${meta.totals.totalExpenses.toFixed(2)}`);
    doc.text(`Net profit: KES ${meta.totals.profit.toFixed(2)}`);
    doc.text(`Company share (60%): KES ${meta.totals.companyShare.toFixed(2)}`);
    doc.text(`Station share (40%): KES ${meta.totals.stationShare.toFixed(2)}`);
    doc.moveDown(1.5);

    // Expenses Section
    if (expenses.length > 0) {
      doc.fontSize(12).text('Expenses', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(9);

      const expCols = [40, 150, 300, 450, 600];
      const expHeaders = ['Date Paid', 'Type', 'Substation', 'Employee/Notes', 'Amount'];
      
      expHeaders.forEach((h, i) => doc.text(h, expCols[i], doc.y, { continued: i < expHeaders.length - 1 }));
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(780, doc.y).stroke();
      doc.moveDown(0.5);

      for (const e of expenses) {
        if (doc.y > 500) doc.addPage();
        const y = doc.y;
        doc.text(new Date(e.datePaid).toLocaleString('en-KE').split(',')[0], expCols[0], y);
        doc.text(e.type, expCols[1], y);
        doc.text(e.substation?.name || '-', expCols[2], y);
        doc.text(e.employee?.name || e.notes || '-', expCols[3], y);
        doc.text(Number(e.amount).toFixed(2), expCols[4], y);
        doc.moveDown(0.5);
      }
      doc.moveDown(2);
    }

    // Transactions Section
    doc.fontSize(12).text('Transactions', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(9);

    const cols = [40, 150, 230, 310, 360, 460, 510, 560, 620, 700];
    const headers = ['Date', 'Vehicle', 'InBatt', 'In%', 'OutBatt', 'Out%', 'Net%', 'Total', 'Co.60%', 'St.40%'];
    
    headers.forEach((h, i) => doc.text(h, cols[i], doc.y, { continued: i < headers.length - 1 }));
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(780, doc.y).stroke();
    doc.moveDown(0.5);

    for (const s of swaps) {
      if (doc.y > 500) doc.addPage();
      const y = doc.y;
      doc.text(new Date(s.swappedAt).toLocaleString('en-KE'), cols[0], y);
      doc.text(s.tukTukReg, cols[1], y);
      doc.text(s.incomingBarcode, cols[2], y);
      doc.text(`${s.incomingPct}%`, cols[3], y);
      doc.text(s.outgoingBarcode, cols[4], y);
      doc.text(`${s.outgoingPct}%`, cols[5], y);
      doc.text(`${s.netPercent}%`, cols[6], y);
      doc.text(Number(s.totalCharged).toFixed(2), cols[7], y);
      doc.text(Number(s.companyShare).toFixed(2), cols[8], y);
      doc.text(Number(s.stationShare).toFixed(2), cols[9], y);
      doc.moveDown(0.5);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#666').text('Confidential Report', {
      align: 'center',
    });
    doc.end();
  });
}
