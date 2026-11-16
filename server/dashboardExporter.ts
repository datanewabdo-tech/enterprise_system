import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import reshaper from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  ShadingType,
  ImageRun,
  Header,
  Footer,
  PageNumber,
} from 'docx';
import { db } from './db.js';
import { getDashboardKPIs, buildRegistrationWhere } from './analytics.js';
import { DashboardFilters } from './validators.js';
import { maskSensitiveRecord } from './auth.js';

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

const bidi = bidiFactory();

const FONT_PATHS = {
  latinRegular: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  latinBold: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  arabicRegular: '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  arabicBold: '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
};

export interface DashboardExportScope {
  kpis: boolean;
  appliedFilters: boolean;
  registrationsByCountry: boolean;
  btsMap: boolean;
  networkCellsByMcc: boolean;
  militaryNetworks: boolean;
  civilianNetworks: boolean;
  includeDetailedRecords: boolean;
  includeSensitiveIdentifiers: boolean;
}

export interface DashboardExportOptions {
  format: 'pdf' | 'xlsx' | 'docx';
  language: 'en' | 'ar';
  filters: Partial<DashboardFilters>;
  scope: DashboardExportScope;
  chartImages?: Record<string, string>;
  userId?: number;
  username: string;
  canUnmask: boolean;
}

function hasArabicChars(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

/**
 * Shapes Arabic ligatures and computes BiDi visual string order for PDFKit rendering.
 */
export function shapePdfText(text: string, dir: 'ltr' | 'rtl' = 'ltr'): string {
  if (!text) return '';
  if (!hasArabicChars(text)) return text;
  try {
    const shaped = reshaper.ArabicShaper.convertArabic(text);
    const levels = bidi.getEmbeddingLevels(shaped, dir);
    return bidi.getReorderedString(shaped, levels);
  } catch {
    return text;
  }
}

function decodeBase64Png(dataUrl?: string): Buffer | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
}

function summarizeAppliedFilters(filters: Partial<DashboardFilters>, language: 'en' | 'ar'): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  const push = (kEn: string, kAr: string, val: any) => {
    if (val === undefined || val === null || val === '' || val === 'all') return;
    if (Array.isArray(val) && val.length === 0) return;
    entries.push({
      key: language === 'ar' ? kAr : kEn,
      value: Array.isArray(val) ? val.join(', ') : String(val),
    });
  };

  if (filters.missionIds && filters.missionIds.length > 0) {
    const placeholders = filters.missionIds.map(() => '?').join(', ');
    const missions = db
      .prepare(`SELECT id, mission, location FROM missions WHERE id IN (${placeholders})`)
      .all(...filters.missionIds) as Array<{ id: number; mission: string; location: string }>;
    const label = missions.map(m => `${m.mission} (${m.location} #${m.id})`).join('; ');
    push('Selected Missions', 'المهام المحددة', label || filters.missionIds.join(', '));
  } else if (filters.mission && filters.mission !== 'ALL') {
    push('Mission', 'المهمة', filters.mission);
  } else {
    push('Mission Scope', 'نطاق المهام', language === 'ar' ? 'كافة المهام' : 'All Missions');
  }

  push('Country (Reg)', 'الدولة (التسجيلات)', filters.country);
  push('Country Code', 'رمز الدولة', filters.countryCode);
  push('IMSI Filter', 'تصفية IMSI', filters.imsi);
  push('IMEI Filter', 'تصفية IMEI', filters.imei);
  push('TMSI Filter', 'تصفية TMSI', filters.tmsi);
  push('BTS Name', 'اسم البرج BTS', filters.btsName);
  push('BTS Code', 'رمز BTS', filters.bts);
  push('UE Model', 'طراز الجهاز', filters.ueModel);
  push('Last Seen From', 'آخر ظهور من', filters.lastSeenFrom);
  push('Last Seen To', 'آخر ظهور إلى', filters.lastSeenTo);
  push('BTS Altitude Min', 'ارتفاع البرج من', filters.btsAltitudeMin);
  push('BTS Altitude Max', 'ارتفاع البرج إلى', filters.btsAltitudeMax);
  push('Has BTS Location', 'توفر موقع BTS', filters.hasBtsLocation);
  push('BTS Outdated', 'موقع BTS قديم', filters.btsLocationOutdated);
  push('Has Device Location', 'توفر موقع الجهاز', filters.hasDeviceLocation);
  push('Action', 'الإجراء', filters.action);
  push('Update Type', 'نوع التحديث', filters.update);
  push('RAT', 'تقنية الشبكة RAT', filters.rat);
  push('MCC', 'رمز الدولة MCC', filters.mcc);
  push('MNC', 'رمز المشغل MNC', filters.mnc);
  push('LAC', 'رمز المنطقة LAC', filters.lac);
  push('Cell ID', 'معرف الخلية', filters.cellId);
  push('Channel', 'القناة', filters.channel);
  push('BSIC', 'BSIC', filters.bsic);
  push('PCI', 'PCI', filters.pci);
  push('RxLev dBm Min', 'أدنى قوة إشارة dBm', filters.rxLevDbmMin);
  push('RxLev dBm Max', 'أعلى قوة إشارة dBm', filters.rxLevDbmMax);
  push('Has Coordinates', 'توفر الإحداثيات', filters.hasCoordinates);
  push('PLMN Lookup', 'بحث المشغل PLMN', filters.plmnQuery);

  return entries;
}

function getKpiRows(kpis: any, language: 'en' | 'ar'): Array<{ metric: string; value: number }> {
  const isAr = language === 'ar';
  return [
    { metric: isAr ? 'إجمالي التسجيلات' : 'Total Registrations', value: kpis.totalRegistrations },
    { metric: isAr ? 'شرائح IMSI الفريدة' : 'Distinct IMSIs', value: kpis.distinctImsis },
    { metric: isAr ? 'أجهزة IMEI الفريدة' : 'Distinct IMEIs', value: kpis.distinctImeis },
    { metric: isAr ? 'إجمالي سجلات خلايا الشبكة' : 'Total Network-Cell Records', value: kpis.totalNetworkCells },
    { metric: isAr ? 'خلايا الشبكة الفريدة' : 'Distinct Network Cells', value: kpis.distinctNetworkCells },
    { metric: isAr ? 'إجمالي المهام المحددة' : 'Total Missions', value: kpis.totalMissions },
    { metric: isAr ? 'الدول الممثلة' : 'Countries Represented', value: kpis.countriesRepresented },
    { metric: isAr ? 'إجمالي مواقع الأبراج (BTS)' : 'Total BTS Locations', value: kpis.totalBtsLocations },
    { metric: isAr ? 'خلايا ذات إحداثيات صالحة' : 'Network Cells with Valid Coordinates', value: kpis.networkCellsWithValidCoords },
    { metric: isAr ? 'خلايا الشبكات العسكرية' : 'Military Network Cells', value: kpis.militaryNetworkCells },
    { metric: isAr ? 'خلايا الشبكات المدنية' : 'Civilian Network Cells', value: kpis.civilianNetworkCells },
  ];
}

export async function generateDashboardExport(options: DashboardExportOptions) {
  const dashboard = getDashboardKPIs(options.filters);
  const filterRows = summarizeAppliedFilters(options.filters, options.language);
  const kpiRows = getKpiRows(dashboard.kpis, options.language);
  const isAr = options.language === 'ar';
  const generatedAt = new Date().toISOString();

  // Optional detailed registration rows (respects RBAC and explicit opt-in)
  let detailedRegRows: any[] = [];
  if (options.scope.includeDetailedRecords) {
    const regWhere = buildRegistrationWhere(options.filters);
    const raw = db
      .prepare(`SELECT id, reg_id, mission_id, mission, bts, bts_name, country, country_code, ue_model, imsi, imei, tmsi, bts_location, last_seen, action FROM registrations ${regWhere.whereSql} ORDER BY id DESC LIMIT 1000`)
      .all(...regWhere.params) as any[];
    const allowUnmask = Boolean(options.canUnmask && options.scope.includeSensitiveIdentifiers);
    detailedRegRows = raw.map(r => maskSensitiveRecord(r, allowUnmask));
  }

  let buffer: Buffer;
  let ext = options.format;
  let contentType = 'application/octet-stream';

  if (options.format === 'xlsx') {
    buffer = await buildExcelReport(dashboard, filterRows, kpiRows, detailedRegRows, options);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (options.format === 'docx') {
    buffer = await buildWordReport(dashboard, filterRows, kpiRows, detailedRegRows, options, generatedAt);
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else {
    buffer = await buildPdfReport(dashboard, filterRows, kpiRows, detailedRegRows, options, generatedAt);
    contentType = 'application/pdf';
  }

  const timestamp = Date.now();
  const fileName = `dashboard_intelligence_report_${options.language}_${timestamp}.${ext}`;
  const filePath = path.join(EXPORTS_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  const scopeSummary = Object.entries(options.scope)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k)
    .join(',');

  const info = db
    .prepare(`
      INSERT INTO export_history (user_id, username, format, scope, selected_missions, applied_filters, status, file_path, file_name, file_size)
      VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
    `)
    .run(
      options.userId || null,
      options.username,
      options.format.toUpperCase(),
      scopeSummary,
      JSON.stringify(options.filters.missionIds || []),
      JSON.stringify(options.filters),
      filePath,
      fileName,
      buffer.length
    );

  db.prepare(`
    INSERT INTO audit_logs (user_id, username, action, module, record_id, ip_address, result, details)
    VALUES (?, ?, 'DASHBOARD_EXPORT', 'export_history', ?, '127.0.0.1', 'SUCCESS', ?)
  `).run(
    options.userId || null,
    options.username,
    String(info.lastInsertRowid),
    `Exported dashboard report in ${options.format.toUpperCase()} (${options.language.toUpperCase()}) scope=[${scopeSummary}]`
  );

  // Clean up export files older than 24 hours
  cleanupOldExports();

  return {
    exportId: Number(info.lastInsertRowid),
    fileName,
    filePath,
    contentType,
    buffer,
  };
}

function cleanupOldExports() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(EXPORTS_DIR)) {
      const full = path.join(EXPORTS_DIR, entry);
      const st = fs.statSync(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    }
  } catch {
    // non-fatal cleanup
  }
}

async function buildExcelReport(
  dashboard: any,
  filterRows: Array<{ key: string; value: string }>,
  kpiRows: Array<{ metric: string; value: number }>,
  detailedRegRows: any[],
  options: DashboardExportOptions
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Enterprise Mission Intelligence Platform';
  wb.created = new Date();
  const isAr = options.language === 'ar';

  const styleSheetHeader = (ws: ExcelJS.Worksheet, headers: string[], widths: number[]) => {
    ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: isAr }];
    ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] || 20 }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: isAr ? 'right' : 'left' };
    headerRow.height = 24;
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
  };

  // Sheet 1: Dashboard Summary
  const summaryWs = wb.addWorksheet(isAr ? 'ملخص اللوحة' : 'Dashboard Summary');
  styleSheetHeader(
    summaryWs,
    [isAr ? 'البند' : 'Section', isAr ? 'التفاصيل' : 'Summary'],
    [34, 54]
  );
  summaryWs.addRow([isAr ? 'عنوان التقرير' : 'Report Title', isAr ? 'تقرير لوحة المعلومات التحليلية للمهام' : 'Enterprise Mission Analytics Dashboard Report']);
  summaryWs.addRow([isAr ? 'تاريخ التوليد' : 'Generated At', new Date().toISOString()]);
  summaryWs.addRow([isAr ? 'المستخدم' : 'Generated By', options.username]);
  summaryWs.addRow([isAr ? 'إجمالي التسجيلات' : 'Total Registrations', dashboard.kpis.totalRegistrations]);
  summaryWs.addRow([isAr ? 'شرائح IMSI الفريدة' : 'Distinct IMSIs', dashboard.kpis.distinctImsis]);
  summaryWs.addRow([isAr ? 'خلايا الشبكة الفريدة' : 'Distinct Network Cells', dashboard.kpis.distinctNetworkCells]);

  // Sheet 2: Applied Filters
  if (options.scope.appliedFilters) {
    const fWs = wb.addWorksheet(isAr ? 'الفلاتر المطبقة' : 'Applied Filters');
    styleSheetHeader(fWs, [isAr ? 'معيار التصفية' : 'Filter Criteria', isAr ? 'القيمة' : 'Value'], [30, 60]);
    for (const f of filterRows) {
      fWs.addRow([f.key, f.value]);
    }
  }

  // Sheet 3: KPI Metrics
  if (options.scope.kpis) {
    const kWs = wb.addWorksheet(isAr ? 'مؤشرات الأداء' : 'KPI Metrics');
    styleSheetHeader(kWs, [isAr ? 'المؤشر' : 'Metric', isAr ? 'القيمة' : 'Value'], [40, 22]);
    for (const k of kpiRows) {
      kWs.addRow([k.metric, k.value]);
    }
  }

  // Sheet 4: Registrations by Country
  if (options.scope.registrationsByCountry) {
    const cWs = wb.addWorksheet(isAr ? 'الشرائح لكل دولة' : 'Registrations by Country');
    styleSheetHeader(
      cWs,
      [
        isAr ? 'الترتيب' : 'Rank',
        isAr ? 'الدولة' : 'Country',
        isAr ? 'شرائح IMSI الفريدة' : 'Distinct IMSIs',
        isAr ? 'إجمالي السجلات' : 'Total Records',
        isAr ? 'النسبة المئوية %' : 'Share (%)',
      ],
      [12, 28, 20, 20, 16]
    );
    for (const item of dashboard.registrationsByCountry.items) {
      cWs.addRow([item.rank, item.country, item.distinctImsiCount, item.totalRecords, item.percentageShare]);
    }
    const totRow = cWs.addRow([
      '',
      isAr ? 'الإجمالي' : 'TOTAL',
      dashboard.registrationsByCountry.totalDistinctImsis,
      dashboard.registrationsByCountry.items.reduce((s: number, i: any) => s + i.totalRecords, 0),
      100,
    ]);
    totRow.font = { bold: true };
  }

  // Sheet 5: Network Cells by MCC
  if (options.scope.networkCellsByMcc) {
    const mWs = wb.addWorksheet(isAr ? 'الخلايا لكل دولة MCC' : 'Network Cells by MCC');
    styleSheetHeader(
      mWs,
      [
        isAr ? 'الترتيب' : 'Rank',
        'MCC',
        isAr ? 'الدولة' : 'Country',
        isAr ? 'الخلايا الفريدة' : 'Distinct Cells',
        isAr ? 'إجمالي السجلات' : 'Total Records',
        isAr ? 'النسبة %' : 'Share (%)',
      ],
      [12, 14, 28, 20, 18, 16]
    );
    for (const item of dashboard.networkCellsByMcc.items) {
      const row = mWs.addRow([item.rank, String(item.mcc), item.country, item.distinctCellCount, item.totalRecords, item.percentageShare]);
      row.getCell(2).numFmt = '@';
    }
    const totRow = mWs.addRow([
      '',
      '',
      isAr ? 'الإجمالي' : 'TOTAL',
      dashboard.networkCellsByMcc.totalDistinctCells,
      dashboard.networkCellsByMcc.items.reduce((s: number, i: any) => s + i.totalRecords, 0),
      100,
    ]);
    totRow.font = { bold: true };
  }

  // Sheet 6: Military Networks
  if (options.scope.militaryNetworks) {
    const milWs = wb.addWorksheet(isAr ? 'الشبكات العسكرية' : 'Military Networks');
    styleSheetHeader(
      milWs,
      [
        isAr ? 'الترتيب' : 'Rank',
        isAr ? 'الشبكة' : 'Operator',
        isAr ? 'الدولة' : 'Country',
        'MCC/MNC',
        isAr ? 'الخلايا الفريدة' : 'Distinct Cells',
        isAr ? 'إجمالي السجلات' : 'Total Records',
      ],
      [12, 34, 18, 16, 18, 18]
    );
    for (const item of dashboard.militaryNetworks.items) {
      const row = milWs.addRow([item.rank, item.operator, item.country, `${item.mcc}/${item.mnc}`, item.distinctCellCount, item.totalRecords]);
      row.getCell(4).numFmt = '@';
    }
    const totRow = milWs.addRow(['', isAr ? 'الإجمالي' : 'TOTAL', '', '', dashboard.militaryNetworks.totalDistinctCells, dashboard.militaryNetworks.totalRecords]);
    totRow.font = { bold: true };
  }

  // Sheet 7: Civilian Networks
  if (options.scope.civilianNetworks) {
    const civWs = wb.addWorksheet(isAr ? 'الشبكات المدنية' : 'Civilian Networks');
    styleSheetHeader(
      civWs,
      [
        isAr ? 'الترتيب بالمجموعة' : 'Group Rank',
        isAr ? 'الدولة' : 'Country',
        isAr ? 'المشغل' : 'Operator',
        'MCC/MNC',
        isAr ? 'الخلايا الفريدة' : 'Distinct Cells',
        isAr ? 'إجمالي السجلات' : 'Total Records',
      ],
      [16, 22, 26, 16, 18, 18]
    );
    for (const item of dashboard.civilianNetworks.items) {
      const row = civWs.addRow([item.rank, item.country, item.operator, item.plmn, item.distinctCellCount, item.totalRecords]);
      row.getCell(4).numFmt = '@';
    }
    const totRow = civWs.addRow(['', isAr ? 'الإجمالي' : 'TOTAL', '', '', dashboard.civilianNetworks.totalDistinctCells, dashboard.civilianNetworks.totalRecords]);
    totRow.font = { bold: true };
  }

  // Sheet 8: BTS Locations (No sensitive identifiers)
  if (options.scope.btsMap) {
    const btsWs = wb.addWorksheet(isAr ? 'مواقع الأبراج BTS' : 'BTS Locations');
    styleSheetHeader(
      btsWs,
      ['Latitude', 'Longitude', 'Source', 'Registrations Count', 'Network Cells Count', 'BTS Names', 'Countries', 'RATs'],
      [14, 14, 18, 20, 20, 28, 22, 18]
    );
    for (const loc of dashboard.btsMap.locations) {
      btsWs.addRow([
        loc.lat,
        loc.lng,
        loc.source,
        loc.registrationCount,
        loc.networkCellCount,
        loc.btsNames.join(', '),
        loc.countries.join(', '),
        loc.rats.join(', '),
      ]);
    }
  }

  // Sheet 9: Optional Detailed Records (String preservation for IMSI/IMEI/TMSI)
  if (options.scope.includeDetailedRecords && detailedRegRows.length > 0) {
    const detWs = wb.addWorksheet(isAr ? 'السجلات التفصيلية' : 'Detailed Registrations');
    const headers = ['ID', 'Reg ID', 'Mission', 'BTS Name', 'Country', 'UE Model', 'IMSI', 'IMEI', 'TMSI', 'Last Seen', 'Action'];
    styleSheetHeader(detWs, headers, [10, 18, 20, 24, 18, 24, 20, 20, 16, 24, 14]);
    for (const r of detailedRegRows) {
      const row = detWs.addRow([
        r.id,
        String(r.reg_id || ''),
        String(r.mission || ''),
        String(r.bts_name || ''),
        String(r.country || ''),
        String(r.ue_model || ''),
        String(r.imsi || ''),
        String(r.imei || ''),
        String(r.tmsi || ''),
        String(r.last_seen || ''),
        String(r.action || ''),
      ]);
      // Preserve long IDs and leading zeros as literal text
      [2, 7, 8, 9].forEach(cIdx => {
        row.getCell(cIdx).numFmt = '@';
      });
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function buildWordReport(
  dashboard: any,
  filterRows: Array<{ key: string; value: string }>,
  kpiRows: Array<{ metric: string; value: number }>,
  detailedRegRows: any[],
  options: DashboardExportOptions,
  generatedAt: string
): Promise<Buffer> {
  const isAr = options.language === 'ar';
  const align = isAr ? AlignmentType.RIGHT : AlignmentType.LEFT;

  const makeTable = (headers: string[], rows: Array<Array<string | number>>) => {
    const headerCells = headers.map(
      h =>
        new TableCell({
          shading: { fill: '1E293B', type: ShadingType.CLEAR, color: 'auto' },
          children: [
            new Paragraph({
              bidirectional: isAr,
              alignment: align,
              children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20, font: isAr ? 'Cairo' : 'Calibri' })],
            }),
          ],
        })
    );

    const dataRows = rows.map(
      (r, idx) =>
        new TableRow({
          children: r.map(
            cell =>
              new TableCell({
                shading: idx % 2 === 1 ? { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' } : undefined,
                children: [
                  new Paragraph({
                    bidirectional: isAr,
                    alignment: align,
                    children: [new TextRun({ text: String(cell ?? '-'), size: 19, font: isAr ? 'Cairo' : 'Calibri' })],
                  }),
                ],
              })
          ),
        })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      },
      rows: [new TableRow({ tableHeader: true, children: headerCells }), ...dataRows],
    });
  };

  const makeHeading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      bidirectional: isAr,
      alignment: align,
      spacing: { before: 280, after: 120 },
      children: [new TextRun({ text, bold: true, size: 28, color: '0F172A', font: isAr ? 'Cairo' : 'Calibri' })],
    });

  const maybeAddChartImage = (children: any[], imageKey: string, caption: string) => {
    const buf = decodeBase64Png(options.chartImages?.[imageKey]);
    if (!buf) return;
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 160 },
        children: [
          new ImageRun({
            data: buf,
            transformation: { width: 540, height: 240 },
            type: 'png',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: isAr,
        spacing: { after: 140 },
        children: [new TextRun({ text: caption, italics: true, size: 18, color: '64748B' })],
      })
    );
  };

  const children: any[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      bidirectional: isAr,
      alignment: align,
      children: [
        new TextRun({
          text: isAr
            ? 'تقرير لوحة المعلومات التحليلية والخرائط المكانية'
            : 'Enterprise Mission Data & Signal Intelligence Report',
          bold: true,
          size: 36,
          color: '1E3A8A',
          font: isAr ? 'Cairo' : 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      bidirectional: isAr,
      alignment: align,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${isAr ? 'تاريخ التقرير' : 'Generated'}: ${generatedAt}  |  ${isAr ? 'بواسطة' : 'Operator'}: ${options.username}`,
          size: 20,
          color: '475569',
        }),
      ],
    }),
  ];

  if (options.scope.appliedFilters) {
    children.push(makeHeading(isAr ? 'ملخص التصفية المطبقة' : 'Applied Dashboard Filters'));
    children.push(
      makeTable(
        [isAr ? 'المعيار' : 'Filter Criterion', isAr ? 'القيمة' : 'Value'],
        filterRows.map(f => [f.key, f.value])
      )
    );
  }

  if (options.scope.kpis) {
    children.push(makeHeading(isAr ? 'مؤشرات الأداء الرئيسية' : 'Key Performance Indicators'));
    children.push(
      makeTable(
        [isAr ? 'المؤشر' : 'KPI Metric', isAr ? 'القيمة' : 'Count'],
        kpiRows.map(k => [k.metric, k.value.toLocaleString()])
      )
    );
  }

  if (options.scope.registrationsByCountry) {
    children.push(makeHeading(isAr ? dashboard.registrationsByCountry.titleAr : dashboard.registrationsByCountry.titleEn));
    maybeAddChartImage(children, 'registrationsByCountry', dashboard.registrationsByCountry.titleAr);
    children.push(
      makeTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'الدولة' : 'Country', isAr ? 'شرائح IMSI الفريدة' : 'Distinct IMSIs', isAr ? 'النسبة %' : 'Share %'],
        dashboard.registrationsByCountry.items.map((i: any) => [i.rank, i.country, i.distinctImsiCount, `${i.percentageShare}%`])
      )
    );
  }

  if (options.scope.networkCellsByMcc) {
    children.push(makeHeading(isAr ? dashboard.networkCellsByMcc.titleAr : dashboard.networkCellsByMcc.titleEn));
    maybeAddChartImage(children, 'networkCellsByMcc', dashboard.networkCellsByMcc.titleAr);
    children.push(
      makeTable(
        [isAr ? 'الترتيب' : 'Rank', 'MCC', isAr ? 'الدولة' : 'Country', isAr ? 'الخلايا الفريدة' : 'Distinct Cells', isAr ? 'النسبة %' : 'Share %'],
        dashboard.networkCellsByMcc.items.map((i: any) => [i.rank, i.mcc, i.country, i.distinctCellCount, `${i.percentageShare}%`])
      )
    );
  }

  if (options.scope.militaryNetworks) {
    children.push(makeHeading(isAr ? dashboard.militaryNetworks.titleAr : dashboard.militaryNetworks.titleEn));
    maybeAddChartImage(children, 'militaryNetworks', dashboard.militaryNetworks.titleAr);
    children.push(
      makeTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'الشبكة' : 'Operator', 'MCC/MNC', isAr ? 'الخلايا الفريدة' : 'Distinct Cells', isAr ? 'إجمالي السجلات' : 'Total Records'],
        dashboard.militaryNetworks.items.map((i: any) => [i.rank, i.operator, `${i.mcc}/${i.mnc}`, i.distinctCellCount, i.totalRecords])
      )
    );
  }

  if (options.scope.civilianNetworks) {
    children.push(makeHeading(isAr ? dashboard.civilianNetworks.titleAr : dashboard.civilianNetworks.titleEn));
    maybeAddChartImage(children, 'civilianNetworks', dashboard.civilianNetworks.titleAr);
    children.push(
      makeTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'الدولة' : 'Country', isAr ? 'المشغل' : 'Operator', 'MCC/MNC', isAr ? 'الخلايا الفريدة' : 'Distinct Cells'],
        dashboard.civilianNetworks.items.map((i: any) => [i.rank, i.country, i.operator, i.plmn, i.distinctCellCount])
      )
    );
  }

  if (options.scope.btsMap) {
    children.push(makeHeading(isAr ? 'خريطة وملخص مواقع الأبراج (BTS)' : 'BTS Locations Spatial Summary'));
    maybeAddChartImage(children, 'btsMap', isAr ? 'لقطة خريطة مواقع الأبراج' : 'BTS Locations Map Snapshot');
    children.push(
      makeTable(
        ['Latitude', 'Longitude', 'Source', 'Registrations', 'Network Cells', 'BTS Names'],
        dashboard.btsMap.locations.slice(0, 60).map((l: any) => [
          l.lat,
          l.lng,
          l.source,
          l.registrationCount,
          l.networkCellCount,
          l.btsNames.join(', ') || '-',
        ])
      )
    );
  }

  if (options.scope.includeDetailedRecords && detailedRegRows.length > 0) {
    children.push(makeHeading(isAr ? 'السجلات التفصيلية (مقنعة حسب الصلاحية)' : 'Detailed Registration Records'));
    children.push(
      makeTable(
        ['ID', 'Mission', 'Country', 'BTS Name', 'IMSI', 'IMEI'],
        detailedRegRows.slice(0, 100).map(r => [r.id, r.mission || '-', r.country || '-', r.bts_name || '-', r.imsi || '-', r.imei || '-'])
      )
    );
  }

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: 'Enterprise Intelligence Dashboard Export', size: 16, color: '94A3B8' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ', size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '64748B' }),
                  new TextRun({ text: ' of ', size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '64748B' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

async function buildPdfReport(
  dashboard: any,
  filterRows: Array<{ key: string; value: string }>,
  kpiRows: Array<{ metric: string; value: number }>,
  detailedRegRows: any[],
  options: DashboardExportOptions,
  generatedAt: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true,
      info: {
        Title: 'Enterprise Mission Intelligence Dashboard Report',
        Author: options.username,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hasLatin = fs.existsSync(FONT_PATHS.latinRegular) && fs.existsSync(FONT_PATHS.latinBold);
    const hasArabic = fs.existsSync(FONT_PATHS.arabicRegular) && fs.existsSync(FONT_PATHS.arabicBold);

    if (hasLatin) {
      doc.registerFont('Latin', FONT_PATHS.latinRegular);
      doc.registerFont('LatinBold', FONT_PATHS.latinBold);
    }
    if (hasArabic) {
      doc.registerFont('Arabic', FONT_PATHS.arabicRegular);
      doc.registerFont('ArabicBold', FONT_PATHS.arabicBold);
    }

    const isAr = options.language === 'ar';
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom - 20;

    const pickFont = (text: string, bold = false) => {
      if (hasArabicChars(text) && hasArabic) return bold ? 'ArabicBold' : 'Arabic';
      if (hasLatin) return bold ? 'LatinBold' : 'Latin';
      return bold ? 'Helvetica-Bold' : 'Helvetica';
    };

    const drawText = (text: string, x: number, y: number, opts: any = {}) => {
      const str = String(text ?? '');
      const dir = hasArabicChars(str) ? 'rtl' : 'ltr';
      const shaped = shapePdfText(str, dir);
      doc.font(pickFont(str, Boolean(opts.bold))).text(shaped, x, y, opts);
    };

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > pageBottom) {
        doc.addPage();
      }
    };

    const drawSectionHeader = (title: string) => {
      ensureSpace(46);
      doc.moveDown(0.5);
      const y = doc.y;
      doc.rect(doc.page.margins.left, y, pageW, 22).fill('#0F172A');
      doc.fillColor('#FFFFFF').fontSize(11);
      drawText(title, doc.page.margins.left + 8, y + 5, {
        width: pageW - 16,
        align: isAr ? 'right' : 'left',
        bold: true,
      });
      doc.y = y + 28;
      doc.fillColor('#0F172A');
    };

    const drawTable = (headers: string[], rows: Array<Array<string | number>>, colRatios: number[]) => {
      const colWidths = colRatios.map(r => r * pageW);
      const rowHeight = 20;

      const drawHeaderRow = (y: number) => {
        doc.rect(doc.page.margins.left, y, pageW, rowHeight).fill('#1E293B');
        let cx = doc.page.margins.left;
        doc.fillColor('#FFFFFF').fontSize(8.5);
        for (let i = 0; i < headers.length; i++) {
          drawText(headers[i], cx + 4, y + 5, {
            width: colWidths[i] - 8,
            align: isAr ? 'right' : 'left',
            bold: true,
            lineBreak: false,
          });
          cx += colWidths[i];
        }
        return y + rowHeight;
      };

      ensureSpace(rowHeight * 2);
      let y = drawHeaderRow(doc.y);

      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        if (y + rowHeight > pageBottom) {
          doc.addPage();
          y = drawHeaderRow(doc.page.margins.top);
        }
        if (rIdx % 2 === 1) {
          doc.rect(doc.page.margins.left, y, pageW, rowHeight).fill('#F8FAFC');
        }
        doc.rect(doc.page.margins.left, y, pageW, rowHeight).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

        let cx = doc.page.margins.left;
        doc.fillColor('#1E293B').fontSize(8.5);
        for (let cIdx = 0; cIdx < headers.length; cIdx++) {
          const val = String(rows[rIdx][cIdx] ?? '-').slice(0, 48);
          drawText(val, cx + 4, y + 5, {
            width: colWidths[cIdx] - 8,
            align: isAr ? 'right' : 'left',
            lineBreak: false,
          });
          cx += colWidths[cIdx];
        }
        y += rowHeight;
      }
      doc.y = y + 8;
    };

    const drawChartImage = (imageKey: string) => {
      const buf = decodeBase64Png(options.chartImages?.[imageKey]);
      if (!buf) return;
      ensureSpace(195);
      try {
        doc.image(buf, doc.page.margins.left, doc.y, { fit: [pageW, 180], align: 'center' });
        doc.y += 186;
      } catch {
        // skip corrupted image gracefully
      }
    };

    // Report Banner
    doc.rect(doc.page.margins.left, doc.y, pageW, 52).fill('#1E3A8A');
    doc.fillColor('#FFFFFF').fontSize(15);
    drawText(
      isAr ? 'تقرير لوحة المعلومات التحليلية والخرائط' : 'Enterprise Mission Analytics & Mapping Report',
      doc.page.margins.left + 12,
      doc.y + 10,
      { width: pageW - 24, align: isAr ? 'right' : 'left', bold: true }
    );
    doc.fontSize(9).fillColor('#CBD5E1');
    drawText(
      `${isAr ? 'تاريخ التوليد' : 'Generated'}: ${generatedAt}  |  ${isAr ? 'المستخدم' : 'User'}: ${options.username}`,
      doc.page.margins.left + 12,
      doc.y + 32,
      { width: pageW - 24, align: isAr ? 'right' : 'left' }
    );
    doc.y += 62;

    if (options.scope.appliedFilters) {
      drawSectionHeader(isAr ? 'الفلاتر المطبقة' : 'Applied Dashboard Filters');
      drawTable(
        [isAr ? 'المعيار' : 'Criterion', isAr ? 'القيمة' : 'Value'],
        filterRows.map(f => [f.key, f.value]),
        [0.35, 0.65]
      );
    }

    if (options.scope.kpis) {
      drawSectionHeader(isAr ? 'مؤشرات الأداء الرئيسية' : 'Key Performance Indicators');
      drawTable(
        [isAr ? 'المؤشر' : 'KPI Metric', isAr ? 'القيمة' : 'Value'],
        kpiRows.map(k => [k.metric, k.value.toLocaleString()]),
        [0.7, 0.3]
      );
    }

    if (options.scope.registrationsByCountry) {
      drawSectionHeader(isAr ? dashboard.registrationsByCountry.titleAr : dashboard.registrationsByCountry.titleEn);
      drawChartImage('registrationsByCountry');
      drawTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'الدولة' : 'Country', isAr ? 'شرائح فريدة' : 'Distinct IMSI', isAr ? 'السجلات' : 'Records', '%'],
        dashboard.registrationsByCountry.items.map((i: any) => [i.rank, i.country, i.distinctImsiCount, i.totalRecords, `${i.percentageShare}%`]),
        [0.12, 0.36, 0.2, 0.18, 0.14]
      );
    }

    if (options.scope.networkCellsByMcc) {
      drawSectionHeader(isAr ? dashboard.networkCellsByMcc.titleAr : dashboard.networkCellsByMcc.titleEn);
      drawChartImage('networkCellsByMcc');
      drawTable(
        [isAr ? 'الترتيب' : 'Rank', 'MCC', isAr ? 'الدولة' : 'Country', isAr ? 'خلايا فريدة' : 'Distinct Cells', '%'],
        dashboard.networkCellsByMcc.items.map((i: any) => [i.rank, i.mcc, i.country, i.distinctCellCount, `${i.percentageShare}%`]),
        [0.12, 0.14, 0.38, 0.22, 0.14]
      );
    }

    if (options.scope.militaryNetworks) {
      drawSectionHeader(isAr ? dashboard.militaryNetworks.titleAr : dashboard.militaryNetworks.titleEn);
      drawChartImage('militaryNetworks');
      drawTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'المشغل' : 'Operator', 'MCC/MNC', isAr ? 'خلايا فريدة' : 'Distinct Cells', isAr ? 'السجلات' : 'Records'],
        dashboard.militaryNetworks.items.map((i: any) => [i.rank, i.operator, `${i.mcc}/${i.mnc}`, i.distinctCellCount, i.totalRecords]),
        [0.1, 0.42, 0.16, 0.16, 0.16]
      );
    }

    if (options.scope.civilianNetworks) {
      drawSectionHeader(isAr ? dashboard.civilianNetworks.titleAr : dashboard.civilianNetworks.titleEn);
      drawChartImage('civilianNetworks');
      drawTable(
        [isAr ? 'الترتيب' : 'Rank', isAr ? 'الدولة' : 'Country', isAr ? 'المشغل' : 'Operator', 'MCC/MNC', isAr ? 'الخلايا' : 'Cells'],
        dashboard.civilianNetworks.items.map((i: any) => [i.rank, i.country, i.operator, i.plmn, i.distinctCellCount]),
        [0.1, 0.24, 0.32, 0.16, 0.18]
      );
    }

    if (options.scope.btsMap) {
      drawSectionHeader(isAr ? 'ملخص مواقع الأبراج (BTS)' : 'BTS Locations Map Summary');
      drawChartImage('btsMap');
      drawTable(
        ['Lat', 'Lng', 'Source', 'Reg Count', 'Cell Count', 'BTS Names'],
        dashboard.btsMap.locations.slice(0, 50).map((l: any) => [l.lat, l.lng, l.source, l.registrationCount, l.networkCellCount, l.btsNames.join(', ') || '-']),
        [0.14, 0.14, 0.16, 0.14, 0.14, 0.28]
      );
    }

    if (options.scope.includeDetailedRecords && detailedRegRows.length > 0) {
      drawSectionHeader(isAr ? 'السجلات التفصيلية' : 'Detailed Registrations');
      drawTable(
        ['ID', 'Mission', 'Country', 'BTS Name', 'IMSI', 'IMEI'],
        detailedRegRows.slice(0, 100).map(r => [r.id, r.mission || '-', r.country || '-', r.bts_name || '-', r.imsi || '-', r.imei || '-']),
        [0.08, 0.2, 0.16, 0.2, 0.18, 0.18]
      );
    }

    // Add page numbers on all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font(hasLatin ? 'Latin' : 'Helvetica').fontSize(8).fillColor('#64748B');
      doc.text(
        `Page ${i + 1} of ${range.count} — Enterprise Mission Analytics Platform`,
        doc.page.margins.left,
        doc.page.height - 28,
        { width: pageW, align: 'center' }
      );
    }

    doc.end();
  });
}
