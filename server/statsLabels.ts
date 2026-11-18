/**
 * Bilingual labels for Table Statistics.
 *
 * This module is intentionally dependency-free so it can be shared by the
 * statistics API (db.ts), the statistics exporters (tableStats.ts) and tested
 * in isolation. Column labels are derived from the *actual* PostgreSQL column
 * name (information_schema), never from a Prisma model field name.
 */

export type StatsLanguage = 'en' | 'ar';

/** Well known acronyms that should stay upper-case in generated labels. */
const ACRONYMS = new Set([
  'ID', 'IMSI', 'IMEI', 'TMSI', 'MCC', 'MNC', 'LAC', 'BTS', 'CID', 'BSIC',
  'PSC', 'PCI', 'TAC', 'GPS', 'SMS', 'WIFI', 'URL', 'IP', 'API', 'ARFCN',
  'MSC', 'HLR', 'VLR', 'PLMN', 'MCCMNC', 'CSV', 'PDF', 'XLSX', 'JSON',
]);

/**
 * Convert an actual database column name (snake_case, camelCase or lowercase)
 * into a readable English display name.
 *
 * Examples:
 *   imsi           -> IMSI
 *   bts_location   -> BTS Location
 *   btsLocation    -> BTS Location
 *   mission_id     -> Mission ID
 *   createdAt      -> Created At
 */
export function humanizeColumnName(column: string): string {
  const raw = String(column ?? '').trim();
  if (!raw) return '';

  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Known Arabic translations for the most common database column names. */
const ARABIC_COLUMN_LABELS: Record<string, string> = {
  id: 'المعرف',
  mission: 'المهمة',
  mission_id: 'معرف المهمة',
  mission_name: 'اسم المهمة',
  name: 'الاسم',
  imsi: 'IMSI',
  imei: 'IMEI',
  tmsi: 'TMSI',
  mcc: 'MCC',
  mnc: 'MNC',
  mcc_mnc: 'MCC / MNC',
  lac: 'LAC',
  tac: 'TAC',
  cid: 'CID',
  cell_id: 'معرف الخلية',
  bts: 'BTS',
  bts_location: 'موقع BTS',
  bts_name: 'اسم BTS',
  country: 'الدولة',
  latitude: 'خط العرض',
  longitude: 'خط الطول',
  lat: 'خط العرض',
  lng: 'خط الطول',
  timestamp: 'الطابع الزمني',
  created_at: 'تاريخ الإنشاء',
  updated_at: 'تاريخ التحديث',
  status: 'الحالة',
  username: 'اسم المستخدم',
  email: 'البريد الإلكتروني',
  role: 'الدور',
  phone_number: 'رقم الهاتف',
  operator: 'المشغل',
  band: 'النطاق',
  frequency: 'التردد',
  bssid: 'BSSID',
  ssid: 'SSID',
  address: 'العنوان',
  type: 'النوع',
  value: 'القيمة',
  description: 'الوصف',
  path: 'المسار',
  file_name: 'اسم الملف',
  file_size: 'حجم الملف',
  notes: 'ملاحظات',
};

/** English labels for table-level and column-level statistics. */
const EN_STAT_LABELS: Record<string, string> = {
  totalRecords: 'Total Records',
  filteredRecords: 'Filtered Records',
  duplicateRecords: 'Duplicate Records',
  dataCompleteness: 'Data Completeness',
  totalColumns: 'Total Columns',
  uniqueValues: 'Unique Values',
  missingValues: 'Missing Values',
  duplicateValues: 'Duplicate Values',
  recordsCount: 'Non-empty Values',
  min: 'Minimum',
  max: 'Maximum',
  avg: 'Average',
  sum: 'Sum',
  median: 'Median',
  stddev: 'Standard Deviation',
  validCount: 'Valid Values',
  minDate: 'Earliest Date',
  maxDate: 'Latest Date',
  topValues: 'Top Values',
};

/** Arabic labels for table-level and column-level statistics. */
const AR_STAT_LABELS: Record<string, string> = {
  totalRecords: 'إجمالي السجلات',
  filteredRecords: 'السجلات بعد التصفية',
  duplicateRecords: 'السجلات المكررة',
  dataCompleteness: 'اكتمال البيانات',
  totalColumns: 'عدد الأعمدة',
  uniqueValues: 'القيم المميزة',
  missingValues: 'القيم المفقودة',
  duplicateValues: 'القيم المكررة',
  recordsCount: 'القيم غير الفارغة',
  min: 'الحد الأدنى',
  max: 'الحد الأعلى',
  avg: 'المتوسط',
  sum: 'المجموع',
  median: 'الوسيط',
  stddev: 'الانحراف المعياري',
  validCount: 'القيم الصالحة',
  minDate: 'أقدم تاريخ',
  maxDate: 'أحدث تاريخ',
  topValues: 'أكثر القيم تكراراً',
};

/** English display name for an actual database column. */
export function columnLabelEn(column: string): string {
  return humanizeColumnName(column);
}

/**
 * Arabic display name for an actual database column.
 * Falls back to the raw column name so the real DB column is never hidden.
 */
export function columnLabelAr(column: string): string {
  const key = String(column ?? '').trim();
  return ARABIC_COLUMN_LABELS[key] ?? key;
}

/** Display name in the requested language. */
export function columnLabel(column: string, language: StatsLanguage): string {
  return language === 'ar' ? columnLabelAr(column) : columnLabelEn(column);
}

/** Label for a table-level or column-level statistic. */
export function statLabel(key: string, language: StatsLanguage): string {
  const dict = language === 'ar' ? AR_STAT_LABELS : EN_STAT_LABELS;
  return dict[key] ?? humanizeColumnName(key);
}

/** Generic UI strings used by the report exports. */
export function reportText(language: StatsLanguage): Record<string, string> {
  return language === 'ar'
    ? {
        appName: 'لوحة إدارة البيانات المؤسسية',
        statisticsReport: 'تقرير إحصائيات الجدول',
        page: 'الصفحة',
        table: 'جدول قاعدة البيانات',
        generatedAt: 'تاريخ ووقت التوليد',
        mission: 'المهمة المحددة',
        activeFilters: 'عوامل التصفية المفعّلة',
        noFilters: 'لا توجد عوامل تصفية',
        generalStatistics: 'الإحصائيات العامة',
        globalStatistics: 'الإحصائيات العامة (كامل الجدول)',
        filteredStatistics: 'إحصائيات البيانات بعد التصفية',
        columnStatistics: 'إحصائيات الأعمدة',
        columnName: 'اسم العمود',
        statistic: 'الإحصائية',
        value: 'القيمة',
        dataType: 'نوع البيانات',
        scope: 'النطاق',
        section: 'القسم',
        sectionMetadata: 'بيانات التقرير',
        sectionGeneral: 'عام',
        sectionColumn: 'عمود',
        sectionNotes: 'ملاحظات',
        databaseColumn: 'عمود قاعدة البيانات',
        global: 'عام',
        filtered: 'بعد التصفية',
        search: 'البحث',
        pageNumber: 'صفحة',
        additionalInfo: 'معلومات إضافية',
        columnStatsNote: 'تم حساب إحصائيات الأعمدة على السجلات المطابقة لعوامل التصفية المفعّلة.',
        duplicateNote: 'القيم المكررة = عدد القيم غير الفارغة - عدد القيم المميزة.',
      }
    : {
        appName: 'Enterprise Data Management Dashboard',
        statisticsReport: 'Table Statistics Report',
        page: 'Page',
        table: 'Database Table',
        generatedAt: 'Generated At',
        mission: 'Selected Mission',
        activeFilters: 'Active Filters',
        noFilters: 'No active filters',
        generalStatistics: 'General Statistics',
        globalStatistics: 'Global Statistics (whole table)',
        filteredStatistics: 'Filtered Statistics',
        columnStatistics: 'Column Statistics',
        columnName: 'Column Name',
        statistic: 'Statistic',
        value: 'Value',
        dataType: 'Data Type',
        scope: 'Scope',
        section: 'Section',
        sectionMetadata: 'Metadata',
        sectionGeneral: 'General',
        sectionColumn: 'Column',
        sectionNotes: 'Notes',
        databaseColumn: 'Database Column',
        global: 'Global',
        filtered: 'Filtered',
        search: 'Search',
        pageNumber: 'Page',
        additionalInfo: 'Additional Information',
        columnStatsNote: 'Column statistics are computed over the records matching the active filters.',
        duplicateNote: 'Duplicate values = non-empty values - distinct values.',
      };
}
