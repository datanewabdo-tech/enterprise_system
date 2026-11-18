/**
 * Table Statistics report exporters.
 *
 * All formats are rendered from the SAME TableStats object that powers the
 * frontend statistics section, so exported numbers always match the UI.
 * Only the statistics service (db.ts::getTableStats) computes numbers - this
 * module is responsible purely for presentation.
 */

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table as DocxTable,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { TableColumnStats, TableStats } from './db.js';
import { shapePdfText } from './dashboardExporter.js';
import {
  columnLabel,
  reportText,
  statLabel,
  type StatsLanguage,
} from './statsLabels.js';

export interface StatsExportResult {
  contentType: string;
  filename: string;
  content: Buffer;
}

export interface StatsExportOptions {
  format: 'pdf' | 'docx' | 'csv';
  language: StatsLanguage;
  stats: TableStats;
  /** Human readable page name, e.g. "Registrations". */
  pageName?: string;
}

interface MetaRow {
  label: string;
  value: string;
}

interface GeneralRow {
  label: string;
  value: string;
  scope: 'global' | 'filtered';
}

interface ColumnRow {
  columnName: string;
  dbName: string;
  statistic: string;
  value: string;
  dataType: string;
}

interface ReportData {
  language: StatsLanguage;
  text: Record<string, string>;
  meta: MetaRow[];
  general: GeneralRow[];
  columns: ColumnRow[];
  notes: string[];
}

const FONT_PATHS = {
  latinRegular: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  latinBold: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  arabicRegular: '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  arabicBold: '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
};

function hasArabicChars(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(text ?? ''));
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value);
}

function formatDateTime(iso: string, language: StatsLanguage): string {
  try {
    return new Date(iso).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/** Turn active filters into a compact, human readable string. */
function describeFilters(stats: TableStats, language: StatsLanguage): string {
  const text = reportText(language);
  const parts: string[] = [];

  if (stats.meta?.mission) {
    parts.push(`${text.mission}: ${stats.meta.mission}`);
  }
  if (stats.meta?.search) {
    parts.push(`${text.search}: ${stats.meta.search}`);
  }
  for (const filter of stats.meta?.filters ?? []) {
    const column = filter?.column ?? '';
    const label = column ? columnLabel(column, language) : '';
    const operator = filter?.operator ?? '';
    const value = filter?.value;
    const value2 = filter?.value2;
    const renderedValue =
      value2 !== undefined && value2 !== null
        ? `${String(value ?? '')} - ${String(value2)}`
        : String(value ?? '');
    parts.push(`${label} ${operator} ${renderedValue}`.trim());
  }

  return parts.length ? parts.join(' | ') : text.noFilters;
}

/** Build the normalized report used by every export format. */
function buildReport(
  stats: TableStats,
  language: StatsLanguage,
  pageName: string,
): ReportData {
  const text = reportText(language);
  const columns: TableColumnStats[] = stats.columns ?? [];

  let totalCells = 0;
  let filledCells = 0;
  let maxDuplicates = 0;
  for (const column of columns) {
    totalCells += Number(column.totalCount ?? 0);
    filledCells += Number(column.nonNullCount ?? 0);
    maxDuplicates = Math.max(maxDuplicates, Number(column.duplicateCount ?? 0));
  }
  const completeness = totalCells > 0
    ? `${((filledCells / totalCells) * 100).toFixed(1)}%`
    : '-';

  const duplicateRecords =
    stats.business?.duplicateImsiRecords ??
    stats.business?.duplicateCellRecords ??
    maxDuplicates;

  const meta: MetaRow[] = [
    { label: text.appName, value: '' },
    { label: text.statisticsReport, value: '' },
    { label: text.page, value: pageName },
    { label: text.table, value: stats.tableName || stats.table },
    { label: text.generatedAt, value: formatDateTime(stats.meta?.generatedAt ?? new Date().toISOString(), language) },
  ];
  if (stats.meta?.mission) {
    meta.push({ label: text.mission, value: stats.meta.mission });
  }
  meta.push({ label: text.activeFilters, value: describeFilters(stats, language) });

  const general: GeneralRow[] = [
    { label: statLabel('totalRecords', language), value: formatNumber(stats.totalRecords), scope: 'global' },
    { label: statLabel('filteredRecords', language), value: formatNumber(stats.filteredRecords), scope: 'filtered' },
    { label: statLabel('duplicateRecords', language), value: formatNumber(duplicateRecords), scope: 'global' },
    { label: statLabel('dataCompleteness', language), value: completeness, scope: 'global' },
    { label: statLabel('totalColumns', language), value: formatNumber(columns.length), scope: 'global' },
  ];

  if (stats.business && Object.keys(stats.business).length) {
    for (const [key, value] of Object.entries(stats.business)) {
      general.push({
        label: language === 'ar' ? key : key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim(),
        value: formatNumber(value),
        scope: 'global',
      });
    }
  }

  const columnRows: ColumnRow[] = [];
  for (const column of columns) {
    const display = columnLabel(column.column, language);
    const dataType = column.dataType || column.type || '-';
    const push = (statisticKey: string, value: unknown) => {
      columnRows.push({
        columnName: display,
        dbName: column.column,
        statistic: statLabel(statisticKey, language),
        value: value === null || value === undefined || value === '' ? '-' : String(value),
        dataType,
      });
    };

    // Always expose the real database column name explicitly.
    push('__dbName', column.column);
    push('uniqueValues', formatNumber(column.distinctCount));
    push('missingValues', formatNumber(column.nullCount));
    push('duplicateValues', formatNumber(column.duplicateCount));
    push('recordsCount', formatNumber(column.nonNullCount));

    if (column.min !== undefined && column.min !== null) push('min', formatNumber(column.min));
    if (column.max !== undefined && column.max !== null) push('max', formatNumber(column.max));
    if (column.avg !== undefined && column.avg !== null) push('avg', formatNumber(column.avg));
    if (column.sum !== undefined && column.sum !== null) push('sum', formatNumber(column.sum));
    if (column.minDate) push('minDate', column.minDate);
    if (column.maxDate) push('maxDate', column.maxDate);
    if (Array.isArray(column.topValues) && column.topValues.length) {
      push(
        'topValues',
        column.topValues
          .slice(0, 5)
          .map((item) => `${item.value} (${formatNumber(item.count)})`)
          .join(', '),
      );
    }
  }

  // Give the synthetic "database column name" row a localized label.
  for (const row of columnRows) {
    if (row.statistic === statLabel('__dbName', language)) {
      row.statistic = text.databaseColumn;
    }
  }

  return {
    language,
    text,
    meta,
    general,
    columns: columnRows,
    notes: [text.columnStatsNote, text.duplicateNote],
  };
}

function safeFilename(value: string): string {
  return String(value ?? 'table').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function escapeCsv(value: unknown): string {
  let str = value === null || value === undefined ? '' : String(value);
  const isNumeric = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str.trim());
  if (!isNumeric && /^[\s]*[=+\-@]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

function buildCsv(report: ReportData): Buffer {
  const lines: string[][] = [];
  const t = report.text;
  lines.push([t.section, t.columnName, t.statistic, t.value, t.dataType]);

  for (const row of report.meta) {
    if (!row.value && row.label === t.appName) {
      lines.push([t.sectionMetadata, '', t.appName, '', '']);
      continue;
    }
    if (!row.value && row.label === t.statisticsReport) continue;
    lines.push([t.sectionMetadata, '', row.label, row.value, '']);
  }

  for (const row of report.general) {
    lines.push([t.sectionGeneral, '', row.label, row.value, '']);
  }

  for (const row of report.columns) {
    lines.push([t.sectionColumn, row.columnName, row.statistic, row.value, row.dataType]);
  }

  lines.push([t.sectionNotes, '', t.additionalInfo, report.notes.join(' '), '']);

  const csv = lines.map((line) => line.map(escapeCsv).join(',')).join('\r\n');
  // UTF-8 BOM so Excel detects Arabic/Unicode correctly.
  return Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from(csv, 'utf8')]);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface PdfColumn {
  key: string;
  header: string;
  width: number;
  align?: 'left' | 'right';
}

interface PdfFonts {
  hasLatin: boolean;
  hasArabic: boolean;
}

function setupPdfFonts(doc: PDFKit.PDFDocument): PdfFonts {
  const fonts: PdfFonts = { hasLatin: false, hasArabic: false };

  if (fs.existsSync(FONT_PATHS.latinRegular) && fs.existsSync(FONT_PATHS.latinBold)) {
    doc.registerFont('Latin', FONT_PATHS.latinRegular);
    doc.registerFont('LatinBold', FONT_PATHS.latinBold);
    fonts.hasLatin = true;
  }
  if (fs.existsSync(FONT_PATHS.arabicRegular) && fs.existsSync(FONT_PATHS.arabicBold)) {
    doc.registerFont('Arabic', FONT_PATHS.arabicRegular);
    doc.registerFont('ArabicBold', FONT_PATHS.arabicBold);
    fonts.hasArabic = true;
  }

  return fonts;
}

function pdfFontName(text: string, bold: boolean, fonts: PdfFonts): string {
  if (hasArabicChars(text) && fonts.hasArabic) {
    return bold ? 'ArabicBold' : 'Arabic';
  }
  if (fonts.hasLatin) return bold ? 'LatinBold' : 'Latin';
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

function writePdfText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: { width: number; fontSize?: number; color?: string; bold?: boolean; align?: 'left' | 'right' },
  language: StatsLanguage,
  fonts: PdfFonts,
): number {
  const shaped = language === 'ar' ? shapePdfText(text, 'rtl') : text;
  const fontSize = options.fontSize ?? 8;
  doc.font(pdfFontName(shaped, Boolean(options.bold), fonts));
  doc.fontSize(fontSize);
  doc.fillColor(options.color ?? '#1E293B');
  doc.text(shaped, x, y, {
    width: options.width,
    align: options.align ?? 'left',
    lineBreak: true,
  });
  return doc.heightOfString(shaped, { width: options.width, lineBreak: true });
}

function drawPdfTable(
  doc: PDFKit.PDFDocument,
  tableColumns: PdfColumn[],
  rows: Array<Record<string, unknown>>,
  language: StatsLanguage,
  fonts: PdfFonts,
): void {
  const left = 40;
  const usable = doc.page.width - 80;
  const rawTotal = tableColumns.reduce((sum, col) => sum + col.width, 0) || 1;
  const scaled = tableColumns.map((col) => ({
    ...col,
    width: (col.width / rawTotal) * usable,
  }));
  const headerHeight = 20;

  const drawHeader = () => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    let x = left;
    for (const col of scaled) {
      doc.rect(x, y, col.width, headerHeight).fill('#4F46E5');
      writePdfText(
        doc,
        col.header,
        x + 4,
        y + 5,
        { width: col.width - 8, fontSize: 9, color: '#FFFFFF', bold: true, align: col.align },
        language,
        fonts,
      );
      x += col.width;
    }
    doc.y = y + headerHeight + 3;
  };

  drawHeader();

  rows.forEach((row, index) => {
    const values = scaled.map((col) => {
      const value = row[col.key];
      return value === null || value === undefined ? '' : String(value);
    });
    const heights = scaled.map((col, i) =>
      measurePdfTextHeight(doc, values[i], col.width - 8, 8, fonts),
    );
    const rowHeight = Math.max(16, ...heights) + 8;

    if (doc.y + rowHeight > doc.page.height - 55) {
      doc.addPage();
      drawHeader();
    }

    const y = doc.y;
    let x = left;
    for (let i = 0; i < scaled.length; i += 1) {
      const col = scaled[i];
      if (index % 2 === 1) {
        doc.rect(x, y, col.width, rowHeight).fill('#F1F5F9');
      }
      writePdfText(
        doc,
        values[i],
        x + 4,
        y + 4,
        { width: col.width - 8, fontSize: 8, align: col.align },
        language,
        fonts,
      );
      x += col.width;
    }
    doc.y = y + rowHeight;
  });

  doc.moveDown(0.6);
}

function measurePdfTextHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  fontSize: number,
  fonts: PdfFonts,
): number {
  doc.font(pdfFontName(text, false, fonts)).fontSize(fontSize);
  return doc.heightOfString(text || ' ', { width, lineBreak: true });
}

function buildPdf(report: ReportData, language: StatsLanguage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const fonts = setupPdfFonts(doc);
    const titleAlign = language === 'ar' ? 'right' : 'left';

    // Report title
    writePdfText(
      doc,
      report.text.statisticsReport,
      40,
      doc.y,
      { width: doc.page.width - 80, fontSize: 18, bold: true, color: '#1E293B', align: titleAlign },
      language,
      fonts,
    );
    doc.moveDown(0.8);

    // Metadata block
    for (const row of report.meta) {
      if (!row.value) {
        writePdfText(
          doc,
          row.label,
          40,
          doc.y,
          { width: doc.page.width - 80, fontSize: row.label === report.text.appName ? 11 : 10, bold: row.label === report.text.appName, color: '#4F46E5' },
          language,
          fonts,
        );
        continue;
      }
      writePdfText(
        doc,
        `${row.label}: ${row.value}`,
        40,
        doc.y,
        { width: doc.page.width - 80, fontSize: 9, color: '#334155' },
        language,
        fonts,
      );
    }
    doc.moveDown(0.8);

    // General statistics table
    writePdfText(
      doc,
      report.text.generalStatistics,
      40,
      doc.y,
      { width: doc.page.width - 80, fontSize: 13, bold: true, color: '#0F172A', align: titleAlign },
      language,
      fonts,
    );
    doc.moveDown(0.4);

    drawPdfTable(
      doc,
      [
        { key: 'label', header: report.text.statistic, width: 45 },
        { key: 'value', header: report.text.value, width: 25, align: 'right' },
        { key: 'scope', header: report.text.scope, width: 30 },
      ],
      report.general.map((row) => ({
        label: row.label,
        value: row.value,
        scope: row.scope === 'global' ? report.text.global : report.text.filtered,
      })),
      language,
      fonts,
    );

    // Column statistics table
    writePdfText(
      doc,
      report.text.columnStatistics,
      40,
      doc.y,
      { width: doc.page.width - 80, fontSize: 13, bold: true, color: '#0F172A', align: titleAlign },
      language,
      fonts,
    );
    doc.moveDown(0.4);

    drawPdfTable(
      doc,
      [
        { key: 'columnName', header: report.text.columnName, width: 30 },
        { key: 'dbName', header: report.text.databaseColumn, width: 22 },
        { key: 'statistic', header: report.text.statistic, width: 24 },
        { key: 'value', header: report.text.value, width: 18, align: 'right' },
        { key: 'dataType', header: report.text.dataType, width: 16 },
      ],
      report.columns.map((row) => ({
        columnName: row.columnName,
        dbName: row.dbName,
        statistic: row.statistic,
        value: row.value,
        dataType: row.dataType,
      })),
      language,
      fonts,
    );

    // Notes / additional information
    writePdfText(
      doc,
      report.text.additionalInfo,
      40,
      doc.y,
      { width: doc.page.width - 80, fontSize: 11, bold: true, color: '#0F172A', align: titleAlign },
      language,
      fonts,
    );
    doc.moveDown(0.3);
    for (const note of report.notes) {
      writePdfText(
        doc,
        `- ${note}`,
        40,
        doc.y,
        { width: doc.page.width - 80, fontSize: 8, color: '#475569' },
        language,
        fonts,
      );
    }

    // Page numbers + timestamp footer on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      const footer = `${report.text.pageNumber} ${i + 1} / ${range.count}  |  ${report.text.generatedAt}: ${report.meta.find((m) => m.label === report.text.generatedAt)?.value ?? ''}`;
      doc.font(pdfFontName(footer, false, fonts)).fontSize(7).fillColor('#64748B');
      doc.text(language === 'ar' ? shapePdfText(footer, 'rtl') : footer, 40, doc.page.height - 28, {
        width: doc.page.width - 80,
        align: 'center',
      });
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

function docxCell(
  content: string,
  options: { header?: boolean; bold?: boolean; isAr?: boolean; align?: 'left' | 'right'; width?: number } = {},
): TableCell {
  const isHeader = Boolean(options.header);
  const alignment = options.align === 'right'
    ? AlignmentType.RIGHT
    : options.isAr
      ? AlignmentType.RIGHT
      : AlignmentType.LEFT;

  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: isHeader
      ? { type: ShadingType.CLEAR, fill: '4F46E5', color: 'auto' }
      : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment,
        bidirectional: options.isAr,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: content || '-',
            bold: isHeader || Boolean(options.bold),
            size: isHeader ? 18 : 17,
            color: isHeader ? 'FFFFFF' : '1E293B',
            font: options.isAr ? 'Cairo' : 'Calibri',
          }),
        ],
      }),
    ],
  });
}

function docxTable(
  headers: string[],
  rows: string[][],
  isAr: boolean,
  widths?: number[],
  rightAlignIndex?: number,
): DocxTable {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((header, i) =>
      docxCell(header, {
        header: true,
        isAr,
        align: i === rightAlignIndex ? 'right' : undefined,
        width: widths?.[i],
      }),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: headers.map((_header, i) =>
          docxCell(row[i] ?? '', {
            isAr,
            align: i === rightAlignIndex ? 'right' : undefined,
            width: widths?.[i],
          }),
        ),
      }),
  );

  return new DocxTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    },
    rows: [headerRow, ...bodyRows],
  });
}

function docxParagraph(
  text: string,
  options: { heading?: boolean; bold?: boolean; isAr?: boolean; size?: number; color?: string } = {},
): Paragraph {
  return new Paragraph({
    bidirectional: options.isAr,
    alignment: options.isAr ? AlignmentType.RIGHT : AlignmentType.LEFT,
    heading: options.heading ? HeadingLevel.HEADING_2 : undefined,
    spacing: { before: options.heading ? 200 : 60, after: 80 },
    children: [
      new TextRun({
        text,
        bold: options.bold || options.heading,
        size: options.size ?? (options.heading ? 26 : 20),
        color: options.color,
        font: options.isAr ? 'Cairo' : 'Calibri',
      }),
    ],
  });
}

function buildDocx(report: ReportData, language: StatsLanguage): Promise<Buffer> {
  const isAr = language === 'ar';
  const children: Array<Paragraph | DocxTable> = [];

  children.push(docxParagraph(report.text.statisticsReport, { heading: true, isAr }));

  for (const row of report.meta) {
    if (!row.value) {
      children.push(docxParagraph(row.label, { bold: true, isAr, color: '4F46E5', size: row.label === report.text.appName ? 24 : 20 }));
      continue;
    }
    children.push(docxParagraph(`${row.label}: ${row.value}`, { isAr }));
  }

  children.push(docxParagraph(report.text.generalStatistics, { heading: true, isAr }));
  children.push(
    docxTable(
      [report.text.statistic, report.text.value, report.text.scope],
      report.general.map((row) => [
        row.label,
        row.value,
        row.scope === 'global' ? report.text.global : report.text.filtered,
      ]),
      isAr,
      [50, 25, 25],
      1,
    ),
  );

  children.push(docxParagraph(report.text.columnStatistics, { heading: true, isAr }));
  children.push(
    docxTable(
      [report.text.columnName, report.text.dataType, report.text.statistic, report.text.value],
      report.columns.map((row) => [row.columnName, row.dataType, row.statistic, row.value]),
      isAr,
      [30, 18, 30, 22],
      3,
    ),
  );

  children.push(docxParagraph(report.text.additionalInfo, { heading: true, isAr }));
  for (const note of report.notes) {
    children.push(docxParagraph(`- ${note}`, { isAr, size: 18 }));
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: isAr ? 'Cairo' : 'Calibri', size: 20 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
        },
        headers: {
          default: new Header({
            children: [
              docxParagraph(report.text.appName, { bold: true, isAr, color: '4F46E5' }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: isAr,
                children: [
                  new TextRun({ text: `${report.text.pageNumber} `, font: isAr ? 'Cairo' : 'Calibri', size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: isAr ? 'Cairo' : 'Calibri', size: 16 }),
                  new TextRun({ text: ` / `, font: isAr ? 'Cairo' : 'Calibri', size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: isAr ? 'Cairo' : 'Calibri', size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document).then((buffer) => Buffer.from(buffer));
}

/** Generate a table statistics export in the requested format. */
export async function exportTableStatistics(
  options: StatsExportOptions,
): Promise<StatsExportResult> {
  const language: StatsLanguage = options.language === 'ar' ? 'ar' : 'en';
  const pageName = options.pageName || options.stats.tableName || options.stats.table;
  const report = buildReport(options.stats, language, pageName);
  const baseName = `${safeFilename(options.stats.tableName || options.stats.table)}_statistics_${dateStamp()}`;

  switch (options.format) {
    case 'csv':
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${baseName}.csv`,
        content: buildCsv(report),
      };
    case 'docx':
      return {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${baseName}.docx`,
        content: await buildDocx(report, language),
      };
    case 'pdf':
      return {
        contentType: 'application/pdf',
        filename: `${baseName}.pdf`,
        content: await buildPdf(report, language),
      };
    default:
      throw new Error(`Unsupported statistics export format: ${options.format}`);
  }
}
