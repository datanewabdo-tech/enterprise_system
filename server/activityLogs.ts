import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from './db.js';

export const ACTIVITY_LOG_MAX_FIELDS = 50;
export const ACTIVITY_LOG_FIELD_KEYS = Array.from({ length: ACTIVITY_LOG_MAX_FIELDS }, (_, i) => `field${i + 1}`);

export type ActivityLogSortOrder = 'asc' | 'desc';

export interface ActivityLogListParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: ActivityLogSortOrder;
  recordType?: string;
  sourceFile?: string;
  lineNumber?: number;
  importBatchId?: bigint;
}

export interface ActivityLogParseIssue {
  line: number;
  message: string;
  code?: 'MALFORMED' | 'EXCEEDED_FIELDS';
  originalRecord?: string;
  actualFieldCount?: number;
}

export interface ParsedActivityLogRecord {
  lineNumber: number;
  recordType: string | null;
  fields: Array<string | null>;
  originalRecord: string;
  sourceFile: string;
  fieldCount: number;
  exceededFieldLimit: boolean;
  issues: ActivityLogParseIssue[];
}

export interface ActivityLogPreviewResult {
  filename: string;
  size: number;
  fileHash: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  exceededFieldLimitRecords: number;
  sampleRecords: ParsedActivityLogRecord[];
  errors: ActivityLogParseIssue[];
  duplicateBatch?: {
    id: string;
    filename: string;
    uploadedAt: string;
    status: string;
    totalRecords: number;
    importedRecords: number;
    failedRecords: number;
  } | null;
  isDuplicate: boolean;
}

interface ActivityLogsImportProgress {
  jobId: string;
  batchId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED';
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  failedRecords: number;
  exceededFieldLimitRecords: number;
  startedAt: number;
  updatedAt: number;
  errorSamples: ActivityLogParseIssue[];
}

const importProgressMap = new Map<string, ActivityLogsImportProgress>();

function toBigIntId(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) throw new Error('Invalid id');
  return BigInt(trimmed);
}

export function serializeBigInts<T>(value: T): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) out[k] = serializeBigInts(v);
    return out;
  }
  return value;
}

const ACTIVITY_LOG_SORTABLE_FIELDS = new Set([
  'id',
  'lineNumber',
  'recordType',
  ...ACTIVITY_LOG_FIELD_KEYS,
  'originalRecord',
  'sourceFile',
  'importBatchId',
  'createdAt',
]);

export function parseActivityLogListQuery(query: any): ActivityLogListParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));

  let sortBy = typeof query.sortBy === 'string' ? query.sortBy : 'id';
  if (!ACTIVITY_LOG_SORTABLE_FIELDS.has(sortBy)) sortBy = 'id';

  const sortOrder: ActivityLogSortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const lineNumberRaw = query.lineNumber;
  const lineNumber = lineNumberRaw !== undefined && lineNumberRaw !== null && String(lineNumberRaw).trim() !== ''
    ? Number(lineNumberRaw)
    : undefined;

  let importBatchId: bigint | undefined;
  if (query.importBatchId !== undefined && query.importBatchId !== null && String(query.importBatchId).trim() !== '') {
    try { importBatchId = toBigIntId(String(query.importBatchId)); } catch { importBatchId = undefined; }
  }

  return {
    page,
    pageSize,
    search: typeof query.search === 'string' ? query.search.trim() : undefined,
    sortBy,
    sortOrder,
    recordType: typeof query.recordType === 'string' ? query.recordType.trim() : undefined,
    sourceFile: typeof query.sourceFile === 'string' ? query.sourceFile.trim() : undefined,
    lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
    importBatchId,
  };
}

function toNullableText(v: string): string | null {
  return v === '' ? null : v;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      result.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result;
}

export function parseActivityLogLine(line: string, lineNumber: number, sourceFile: string): ParsedActivityLogRecord {
  const originalRecord = line.replace(/\r$/, '');
  const issues: ActivityLogParseIssue[] = [];

  if (originalRecord.trim() === '') {
    issues.push({ line: lineNumber, message: 'Empty line', code: 'MALFORMED', originalRecord });
    return {
      lineNumber,
      recordType: null,
      fields: Array.from({ length: ACTIVITY_LOG_MAX_FIELDS }, () => null),
      originalRecord,
      sourceFile,
      fieldCount: 0,
      exceededFieldLimit: false,
      issues,
    };
  }

  let parsedValues: string[];
  try {
    parsedValues = parseCsvLine(originalRecord);
  } catch (err: any) {
    issues.push({ line: lineNumber, message: err?.message || 'Failed to parse CSV line', code: 'MALFORMED', originalRecord });
    parsedValues = [originalRecord];
  }

  const recordType = toNullableText(parsedValues[0] ?? '');
  const fieldCount = parsedValues.length;
  const exceededFieldLimit = fieldCount > ACTIVITY_LOG_MAX_FIELDS + 1; // record_type + ACTIVITY_LOG_MAX_FIELDS

  const mapped: Array<string | null> = Array.from({ length: ACTIVITY_LOG_MAX_FIELDS }, () => null);
  for (let i = 0; i < ACTIVITY_LOG_MAX_FIELDS; i++) {
    const idx = i + 1;
    if (idx >= parsedValues.length) break;
    mapped[i] = toNullableText(parsedValues[idx] ?? '');
  }

  if (exceededFieldLimit) {
    issues.push({
      line: lineNumber,
      message: `Record has ${fieldCount} fields; maximum supported is ${ACTIVITY_LOG_MAX_FIELDS + 1} (record_type + ${ACTIVITY_LOG_MAX_FIELDS}). Extra fields were not mapped but the complete original record was preserved.`,
      code: 'EXCEEDED_FIELDS',
      originalRecord,
      actualFieldCount: fieldCount,
    });
  }

  return {
    lineNumber,
    recordType,
    fields: mapped,
    originalRecord,
    sourceFile,
    fieldCount,
    exceededFieldLimit,
    issues,
  };
}

function updateProgress(jobId: string, patch: Partial<ActivityLogsImportProgress>) {
  const prev = importProgressMap.get(jobId);
  if (!prev) return;
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  importProgressMap.set(jobId, next);
}

export function getActivityLogsImportProgress(batchId: bigint | string): ActivityLogsImportProgress | null {
  const batchKey = batchId.toString();
  for (const item of importProgressMap.values()) {
    if (item.batchId === batchKey) return item;
  }
  return null;
}

async function computeFileSha256(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readAllActivityLogRecords(filePath: string, sourceFile: string): Promise<ParsedActivityLogRecord[]> {
  const records: ParsedActivityLogRecord[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    records.push(parseActivityLogLine(line, lineNumber, sourceFile));
  }

  return records;
}

export async function previewActivityLogsFile(args: {
  filePath: string;
  filename: string;
  size?: number;
}): Promise<ActivityLogPreviewResult> {
  const [fileHash, records] = await Promise.all([
    computeFileSha256(args.filePath),
    readAllActivityLogRecords(args.filePath, args.filename),
  ]);

  const duplicate = await db.activityLogsImportBatch.findFirst({
    where: { fileHash: fileHash },
    orderBy: { uploadedAt: 'desc' },
  });

  let invalidRecords = 0;
  let exceededFieldLimitRecords = 0;
  const errors: ActivityLogParseIssue[] = [];

  for (const r of records) {
    if (r.exceededFieldLimit) exceededFieldLimitRecords += 1;
    if (r.issues.some((i) => i.code === 'MALFORMED')) invalidRecords += 1;
    for (const issue of r.issues) errors.push(issue);
  }

  const validRecords = records.length - invalidRecords;

  return {
    filename: args.filename,
    size: args.size ?? fs.statSync(args.filePath).size,
    fileHash,
    totalRecords: records.length,
    validRecords,
    invalidRecords,
    exceededFieldLimitRecords,
    sampleRecords: records.slice(0, 20),
    errors,
    duplicateBatch: duplicate
      ? {
          id: duplicate.id.toString(),
          filename: duplicate.filename,
          uploadedAt: duplicate.uploadedAt.toISOString(),
          status: duplicate.status,
          totalRecords: duplicate.totalRecords,
          importedRecords: duplicate.importedRecords,
          failedRecords: duplicate.failedRecords,
        }
      : null,
    isDuplicate: Boolean(duplicate),
  };
}

function toCreateActivityLogData(parsed: ParsedActivityLogRecord, batchId: bigint, createdAt: Date) {
  const data: Record<string, any> = {
    lineNumber: parsed.lineNumber,
    recordType: parsed.recordType,
    originalRecord: parsed.originalRecord,
    sourceFile: parsed.sourceFile,
    importBatchId: batchId,
    createdAt,
  };
  for (let i = 0; i < ACTIVITY_LOG_MAX_FIELDS; i++) {
    data[`field${i + 1}`] = parsed.fields[i] ?? null;
  }
  return data;
}

export async function startActivityLogsImport(args: {
  filePath: string;
  filename: string;
  userId: number;
  forceDuplicate?: boolean;
}): Promise<{ jobId: string; batchId: bigint; status: 'PROCESSING' }> {
  if (!fs.existsSync(args.filePath)) {
    throw new Error('Uploaded file not found');
  }

  const fileHash = await computeFileSha256(args.filePath);

  const existing = await db.activityLogsImportBatch.findFirst({ where: { fileHash } });
  if (existing && !args.forceDuplicate) {
    throw new Error('A batch with the same file hash already exists. Use forceDuplicate=true to import again.');
  }

  const batch = await db.activityLogsImportBatch.create({
    data: {
      filename: args.filename,
      fileHash,
      totalRecords: 0,
      importedRecords: 0,
      failedRecords: 0,
      status: 'PROCESSING',
      uploadedById: args.userId,
      uploadedAt: new Date(),
    },
  });

  const jobId = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const progress: ActivityLogsImportProgress = {
    jobId,
    batchId: batch.id.toString(),
    status: 'PROCESSING',
    totalRecords: 0,
    processedRecords: 0,
    importedRecords: 0,
    failedRecords: 0,
    exceededFieldLimitRecords: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    errorSamples: [],
  };
  importProgressMap.set(jobId, progress);

  void processActivityLogsImport({ jobId, batchId: batch.id, filePath: args.filePath, filename: args.filename }).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    updateProgress(jobId, {
      status: 'FAILED',
      errorSamples: [
        ...(importProgressMap.get(jobId)?.errorSamples ?? []),
        { line: 0, message, code: 'MALFORMED' as const },
      ].slice(0, 200),
    });
    try {
      await db.activityLogsImportBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED' },
      });
    } catch {
      // ignore
    }
  });

  return { jobId, batchId: batch.id, status: 'PROCESSING' };
}

async function processActivityLogsImport(args: { jobId: string; batchId: bigint; filePath: string; filename: string }) {
  const CHUNK_SIZE = 500;
  const createdAt = new Date();
  let totalRecords = 0;
  let importedRecords = 0;
  let failedRecords = 0;
  let exceededFieldLimitRecords = 0;
  let processedRecords = 0;
  const errorSamples: ActivityLogParseIssue[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath),
    crlfDelay: Infinity,
  });

  let buffer: ReturnType<typeof toCreateActivityLogData>[] = [];
  let lineNumber = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const chunk = buffer;
    buffer = [];
    try {
      const res = await db.activityLog.createMany({ data: chunk as any, skipDuplicates: false });
      importedRecords += res.count;
    } catch (err: any) {
      failedRecords += chunk.length;
      errorSamples.push({ line: 0, message: `Batch insert failed: ${err?.message || String(err)}`, code: 'MALFORMED' });
    }

    await db.activityLogsImportBatch.update({
      where: { id: args.batchId },
      data: {
        totalRecords,
        importedRecords,
        failedRecords,
        status: 'PROCESSING',
      },
    });

    updateProgress(args.jobId, {
      totalRecords,
      processedRecords,
      importedRecords,
      failedRecords,
      exceededFieldLimitRecords,
      errorSamples: errorSamples.slice(-200),
      status: 'PROCESSING',
    });
  };

  for await (const line of rl) {
    lineNumber += 1;
    totalRecords += 1;
    processedRecords += 1;
    const parsed = parseActivityLogLine(line, lineNumber, args.filename);

    if (parsed.exceededFieldLimit) {
      exceededFieldLimitRecords += 1;
    }

    const malformed = parsed.issues.some((i) => i.code === 'MALFORMED');
    if (parsed.issues.length > 0) {
      for (const issue of parsed.issues) {
        if (errorSamples.length < 200) errorSamples.push(issue);
      }
    }

    // Keep mapped values and the complete original record even when the supported field limit is exceeded.
    // Only malformed records are counted as failed; exceeded-field records remain importable with preserved raw data.
    if (malformed) {
      failedRecords += 1;
    } else {
      buffer.push(toCreateActivityLogData(parsed, args.batchId, createdAt));
      if (buffer.length >= CHUNK_SIZE) {
        await flush();
      }
    }

    if (totalRecords % 250 === 0) {
      updateProgress(args.jobId, {
        totalRecords,
        processedRecords,
        importedRecords,
        failedRecords,
        exceededFieldLimitRecords,
        errorSamples: errorSamples.slice(-200),
      });
    }
  }

  await flush();

  const finalStatus = failedRecords > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  await db.activityLogsImportBatch.update({
    where: { id: args.batchId },
    data: {
      totalRecords,
      importedRecords,
      failedRecords,
      status: finalStatus,
    },
  });

  updateProgress(args.jobId, {
    status: finalStatus,
    totalRecords,
    processedRecords,
    importedRecords,
    failedRecords,
    exceededFieldLimitRecords,
    errorSamples: errorSamples.slice(-200),
  });
}

function buildActivityLogsWhere(params: Omit<ActivityLogListParams, 'page' | 'pageSize' | 'sortBy' | 'sortOrder'>) {
  const and: any[] = [];

  if (params.recordType) and.push({ recordType: { equals: params.recordType, mode: 'insensitive' } });
  if (params.sourceFile) and.push({ sourceFile: { equals: params.sourceFile, mode: 'insensitive' } });
  if (Number.isFinite(params.lineNumber)) and.push({ lineNumber: params.lineNumber });
  if (params.importBatchId) and.push({ importBatchId: params.importBatchId });

  if (params.search) {
    const q = params.search;
    const or: any[] = [
      { recordType: { contains: q, mode: 'insensitive' } },
      { sourceFile: { contains: q, mode: 'insensitive' } },
      { originalRecord: { contains: q, mode: 'insensitive' } },
      ...ACTIVITY_LOG_FIELD_KEYS.map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })),
    ];
    const numeric = Number(q);
    if (Number.isFinite(numeric) && q.trim() !== '' && Number.isInteger(numeric)) {
      or.push({ id: BigInt(Math.trunc(numeric)) as any });
      or.push({ lineNumber: Math.trunc(numeric) });
      or.push({ importBatchId: BigInt(Math.trunc(numeric)) as any });
    }
    and.push({ OR: or });
  }

  return and.length ? { AND: and } : {};
}

export async function listActivityLogs(params: ActivityLogListParams) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50));
  const sortBy = params.sortBy && ACTIVITY_LOG_SORTABLE_FIELDS.has(params.sortBy) ? params.sortBy : 'id';
  const sortOrder: ActivityLogSortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';
  const where = buildActivityLogsWhere(params);

  const [total, rows] = await Promise.all([
    db.activityLog.count({ where }),
    db.activityLog.findMany({
      where,
      orderBy: { [sortBy]: sortOrder } as any,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return serializeBigInts({
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}

export async function getActivityLogById(id: bigint) {
  const row = await db.activityLog.findUnique({ where: { id } });
  return row ? serializeBigInts(row) : null;
}

export async function getActivityLogsStatistics(filters: Omit<ActivityLogListParams, 'page' | 'pageSize' | 'sortBy' | 'sortOrder'>) {
  const where = buildActivityLogsWhere({
    page: 1,
    pageSize: 50,
    ...filters,
  } as ActivityLogListParams);

  const [totalRecords, recordTypeGroups, sourceFileGroups, importBatches, failedImportRecords] = await Promise.all([
    db.activityLog.count({ where }),
    db.activityLog.groupBy({
      by: ['recordType'],
      where,
      _count: { _all: true },
    }),
    db.activityLog.groupBy({
      by: ['sourceFile'],
      where,
      _count: { _all: true },
    }),
    db.activityLogsImportBatch.count(),
    db.activityLogsImportBatch.aggregate({
      _sum: { failedRecords: true },
    }),
  ]);

  const uniqueRecordTypes = recordTypeGroups.filter((r) => r.recordType !== null && String(r.recordType).trim() !== '').length;
  const importedSourceFiles = sourceFileGroups.filter((r) => r.sourceFile !== null && String(r.sourceFile).trim() !== '').length;

  const breakdownSorted = [...recordTypeGroups].sort((a, b) => Number(b._count?._all ?? 0) - Number(a._count?._all ?? 0));
  const totalForBreakdown = totalRecords || 0;
  const recordTypeBreakdown = breakdownSorted.map((row) => {
    const count = Number(row._count?._all ?? 0);
    return {
      recordType: row.recordType,
      count,
      percentage: totalForBreakdown > 0 ? Number(((count / totalForBreakdown) * 100).toFixed(2)) : 0,
    };
  });

  return serializeBigInts({
    totalActivityLogsRecords: totalRecords,
    uniqueRecordTypes,
    importedSourceFiles,
    importBatches,
    failedImportRecords: Number(failedImportRecords._sum.failedRecords ?? 0),
    recordTypeBreakdown,
  });
}

export async function listActivityLogsImportBatches() {
  const batches = await db.activityLogsImportBatch.findMany({
    orderBy: { uploadedAt: 'desc' },
    include: { uploadedBy: { select: { id: true, username: true, fullName: true } } },
  });
  return serializeBigInts(batches.map((b) => ({
    ...b,
    uploadedBy: b.uploadedBy?.username ?? b.uploadedBy?.fullName ?? null,
    uploadedById: b.uploadedById ?? null,
  })));
}

export async function getActivityLogsImportBatch(batchId: bigint) {
  const batch = await db.activityLogsImportBatch.findUnique({
    where: { id: batchId },
    include: { uploadedBy: { select: { id: true, username: true, fullName: true } } },
  });
  if (!batch) return null;
  const progress = getActivityLogsImportProgress(batchId);
  return serializeBigInts({
    ...batch,
    uploadedBy: batch.uploadedBy?.username ?? batch.uploadedBy?.fullName ?? null,
    uploadedById: batch.uploadedById ?? null,
    progress,
    errors: progress?.errorSamples ?? [],
  });
}

export async function undoActivityLogsImportBatch(args: {
  batchId: bigint;
  userId: number;
  username: string;
  ipAddress?: string | null;
}) {
  const batch = await db.activityLogsImportBatch.findUnique({ where: { id: args.batchId } });
  if (!batch) throw new Error('Activity logs import batch not found');
  if (batch.status === 'UNDONE') throw new Error('This import batch has already been undone');

  const deletedCount = await db.$transaction(async (tx) => {
    const deleted = await tx.activityLog.deleteMany({ where: { importBatchId: args.batchId } });
    await tx.activityLogsImportBatch.update({
      where: { id: args.batchId },
      data: { status: 'UNDONE' },
    });
    return deleted.count;
  });

  try {
    await db.auditLog.create({
      data: {
        userId: args.userId,
        username: args.username,
        action: 'ACTIVITY_LOGS_IMPORT_UNDO',
        module: 'Activity Logs',
        recordId: args.batchId.toString(),
        result: 'SUCCESS',
        details: `Undid activity logs import batch #${args.batchId.toString()} (${batch.filename}), deleted ${deletedCount} records`,
        ipAddress: args.ipAddress || undefined,
      },
    });
  } catch {
    // ignore
  }

  return serializeBigInts({ batchId: args.batchId, deletedRecords: deletedCount, status: 'UNDONE', filename: batch.filename });
}

const BASE_LABELS_EN: Record<string, string> = {
  id: 'ID',
  lineNumber: 'Line Number',
  recordType: 'Record Type',
  originalRecord: 'Original Record',
  sourceFile: 'Source File',
  importBatchId: 'Import Batch ID',
  createdAt: 'Created At',
};

const BASE_LABELS_AR: Record<string, string> = {
  id: 'المعرف',
  lineNumber: 'رقم السطر',
  recordType: 'نوع السجل',
  originalRecord: 'السجل الأصلي',
  sourceFile: 'الملف المصدر',
  importBatchId: 'معرف دفعة الاستيراد',
  createdAt: 'تاريخ الإنشاء',
};

function buildFieldLabels(): { en: Record<string, string>; ar: Record<string, string> } {
  const en: Record<string, string> = { ...BASE_LABELS_EN };
  const ar: Record<string, string> = { ...BASE_LABELS_AR };
  for (let i = 1; i <= ACTIVITY_LOG_MAX_FIELDS; i++) {
    en[`field${i}`] = `Field ${i}`;
    ar[`field${i}`] = `الحقل ${i}`;
  }
  return { en, ar };
}

const { en: FIELD_LABELS_EN, ar: FIELD_LABELS_AR } = buildFieldLabels();

export const ACTIVITY_LOG_EXPORTABLE_COLUMNS = Object.keys(FIELD_LABELS_EN);

function columnHeader(key: string, lang: 'en' | 'ar') {
  return (lang === 'ar' ? FIELD_LABELS_AR[key] : FIELD_LABELS_EN[key]) || key;
}

function formatExportValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

async function queryActivityLogsForExport(params: ActivityLogListParams & { selectedColumns?: string[] }) {
  const selected = (params.selectedColumns && params.selectedColumns.length
    ? params.selectedColumns.filter((c) => ACTIVITY_LOG_EXPORTABLE_COLUMNS.includes(c))
    : ACTIVITY_LOG_EXPORTABLE_COLUMNS);

  const rows: any[] = [];
  let page = 1;
  const take = 2000;
  while (true) {
    const res = await listActivityLogs({ ...params, page, pageSize: take });
    rows.push(...(res as any).data);
    const pagination = (res as any).pagination;
    if (!pagination || (res as any).data.length < take || rows.length >= pagination.total) break;
    page += 1;
    if (page > 10000) break;
  }
  return { rows, selectedColumns: selected };
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function exportActivityLogs(args: {
  format: 'csv' | 'xlsx' | 'pdf';
  params: ActivityLogListParams;
  selectedColumns?: string[];
  language?: 'en' | 'ar';
}) {
  const lang: 'en' | 'ar' = args.language === 'ar' ? 'ar' : 'en';
  const { rows, selectedColumns } = await queryActivityLogsForExport({ ...args.params, selectedColumns: args.selectedColumns });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `activity_logs_export_${stamp}`;

  if (args.format === 'csv') {
    const header = selectedColumns.map((c) => escapeCsv(columnHeader(c, lang))).join(',');
    const lines = rows.map((row) =>
      selectedColumns.map((c) => escapeCsv(formatExportValue((row as any)[c]))).join(','),
    );
    const csv = '\uFEFF' + [header, ...lines].join('\r\n');
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', content: Buffer.from(csv, 'utf8') };
  }

  if (args.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(lang === 'ar' ? 'سجلات النشاط' : 'Activity Logs');
    ws.columns = selectedColumns.map((c) => ({ header: columnHeader(c, lang), key: c, width: Math.max(14, columnHeader(c, lang).length + 2) }));
    ws.getRow(1).font = { bold: true };
    for (const row of rows) {
      const obj: Record<string, any> = {};
      for (const c of selectedColumns) obj[c] = formatExportValue((row as any)[c]);
      const r = ws.addRow(obj);
      selectedColumns.forEach((_c, i) => { r.getCell(i + 1).numFmt = '@'; });
    }
    const buf = await wb.xlsx.writeBuffer();
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(buf),
    };
  }

  // PDF
  const content = await buildActivityLogsPdf(rows, selectedColumns, lang);
  return { filename: `${base}.pdf`, contentType: 'application/pdf', content };
}

async function buildActivityLogsPdf(rows: any[], columns: string[], lang: 'en' | 'ar'): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.from(c)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const title = lang === 'ar' ? 'سجلات النشاط' : 'Activity Logs';
    doc.fontSize(14).fillColor('#111827').text(title, { align: lang === 'ar' ? 'right' : 'left' });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#4b5563').text(`${lang === 'ar' ? 'عدد السجلات' : 'Records'}: ${rows.length} | ${new Date().toISOString()}`);
    doc.moveDown(0.5);

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      if (doc.y > doc.page.height - 60) doc.addPage();
      const idLabel = formatExportValue((row as any).id);
      doc.fontSize(9).fillColor('#111827').text(`${lang === 'ar' ? 'سجل' : 'Record'} #${idLabel}`, { underline: true });
      doc.moveDown(0.15);
      doc.fontSize(7).fillColor('#111827');
      for (const c of columns) {
        if (doc.y > doc.page.height - 40) doc.addPage();
        const text = `${columnHeader(c, lang)}: ${formatExportValue((row as any)[c])}`;
        doc.text(text, { width: doc.page.width - 48, align: lang === 'ar' ? 'right' : 'left' });
      }
      doc.moveDown(0.35);
      if (idx < rows.length - 1) {
        doc.moveTo(24, doc.y).lineTo(doc.page.width - 24, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.25);
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor('#6b7280').text(`${i + 1} / ${range.count}`, 24, doc.page.height - 20, {
        width: doc.page.width - 48,
        align: 'center',
      });
    }

    doc.end();
  });
}

export async function buildImportErrorReport(batchId: bigint) {
  const batch = await db.activityLogsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const progress = getActivityLogsImportProgress(batchId);
  const errors = progress?.errorSamples ?? [];
  const lines = [
    ['batch_id', 'filename', 'line_number', 'code', 'actual_field_count', 'message', 'original_record'].map(escapeCsv).join(','),
    ...errors.map((e) => [
      String(batchId.toString()),
      String(batch.filename ?? ''),
      String(e.line ?? ''),
      String(e.code ?? ''),
      e.actualFieldCount !== undefined ? String(e.actualFieldCount) : '',
      String(e.message ?? ''),
      String(e.originalRecord ?? ''),
    ].map((v) => escapeCsv(v)).join(',')),
  ];
  const csv = '\uFEFF' + lines.join('\r\n');
  return {
    filename: `activity_logs_import_errors_batch_${batchId.toString()}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content: Buffer.from(csv, 'utf8'),
  };
}

export function getActivityLogsMeta() {
  return {
    maxFields: ACTIVITY_LOG_MAX_FIELDS,
    columns: ACTIVITY_LOG_EXPORTABLE_COLUMNS,
  };
}
