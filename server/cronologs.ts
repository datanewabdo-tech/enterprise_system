import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table as DocxTable,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { db } from './db.js';

export type CronologFieldType = 'string' | 'float' | 'int';

export type CronologGroup =
  | 'call'
  | 'calledParty'
  | 'callingParty'
  | 'thuraya'
  | 'networkSystem'
  | 'target'
  | 'message';

export interface CronologFieldDef {
  position: number;
  sourceName: string;
  field: string;
  type: CronologFieldType;
  group: CronologGroup;
}

export const CRONOLOG_FIELDS: CronologFieldDef[] = [
  { position: 1, sourceName: 'Date Up', field: 'dateUp', type: 'string', group: 'call' },
  { position: 2, sourceName: 'Time Up', field: 'timeUp', type: 'string', group: 'call' },
  { position: 3, sourceName: 'Date Down', field: 'dateDown', type: 'string', group: 'call' },
  { position: 4, sourceName: 'Time Down', field: 'timeDown', type: 'string', group: 'call' },
  { position: 5, sourceName: 'Unique Call ID', field: 'uniqueCallId', type: 'string', group: 'call' },
  { position: 6, sourceName: 'Unit Latitude', field: 'unitLatitude', type: 'float', group: 'networkSystem' },
  { position: 7, sourceName: 'Unit Longitude', field: 'unitLongitude', type: 'float', group: 'networkSystem' },
  { position: 8, sourceName: 'Called TMSI', field: 'calledTmsi', type: 'string', group: 'calledParty' },
  { position: 9, sourceName: 'Called Contention Resolution ID', field: 'calledContentionResolutionId', type: 'string', group: 'calledParty' },
  { position: 10, sourceName: 'Called IMSI', field: 'calledImsi', type: 'string', group: 'calledParty' },
  { position: 11, sourceName: 'Called IMEI', field: 'calledImei', type: 'string', group: 'calledParty' },
  { position: 12, sourceName: 'Called PSTN', field: 'calledPstn', type: 'string', group: 'calledParty' },
  { position: 13, sourceName: 'Calling TMSI', field: 'callingTmsi', type: 'string', group: 'callingParty' },
  { position: 14, sourceName: 'Calling Contention Resolution ID', field: 'callingContentionResolutionId', type: 'string', group: 'callingParty' },
  { position: 15, sourceName: 'Calling IMSI', field: 'callingImsi', type: 'string', group: 'callingParty' },
  { position: 16, sourceName: 'Calling IMEI', field: 'callingImei', type: 'string', group: 'callingParty' },
  { position: 17, sourceName: 'Calling PSTN', field: 'callingPstn', type: 'string', group: 'callingParty' },
  { position: 18, sourceName: 'Mobile Origination', field: 'mobileOrigination', type: 'string', group: 'call' },
  { position: 19, sourceName: 'Reverse Received', field: 'reverseReceived', type: 'string', group: 'call' },
  { position: 20, sourceName: 'Thuraya IMSI', field: 'thurayaImsi', type: 'string', group: 'thuraya' },
  { position: 21, sourceName: 'Thuraya IMEI', field: 'thurayaImei', type: 'string', group: 'thuraya' },
  { position: 22, sourceName: 'Original TMSI', field: 'originalTmsi', type: 'string', group: 'thuraya' },
  { position: 23, sourceName: 'Reallocated TMSI', field: 'reallocatedTmsi', type: 'string', group: 'thuraya' },
  { position: 24, sourceName: 'Contention Resolution ID', field: 'contentionResolutionId', type: 'string', group: 'thuraya' },
  { position: 25, sourceName: 'DTMF Digits', field: 'dtmfDigits', type: 'string', group: 'call' },
  { position: 26, sourceName: 'Mobile Latitude', field: 'mobileLatitude', type: 'float', group: 'networkSystem' },
  { position: 27, sourceName: 'Mobile Longitude', field: 'mobileLongitude', type: 'float', group: 'networkSystem' },
  { position: 28, sourceName: 'System ID', field: 'systemId', type: 'string', group: 'networkSystem' },
  { position: 29, sourceName: 'thuraya vocoder algorithm', field: 'thurayaVocoderAlgorithm', type: 'string', group: 'thuraya' },
  { position: 30, sourceName: 'Mode of Call', field: 'modeOfCall', type: 'string', group: 'call' },
  { position: 31, sourceName: 'Sub Mode of Call', field: 'subModeOfCall', type: 'string', group: 'call' },
  { position: 32, sourceName: 'reason for EOC', field: 'reasonForEoc', type: 'string', group: 'call' },
  { position: 33, sourceName: 'Thuraya SRAND', field: 'thurayaSrand', type: 'string', group: 'thuraya' },
  { position: 34, sourceName: 'Thuraya SRES', field: 'thurayaSres', type: 'string', group: 'thuraya' },
  { position: 35, sourceName: 'ciphering key squence number', field: 'cipheringKeySequenceNumber', type: 'string', group: 'thuraya' },
  { position: 36, sourceName: 'Kc', field: 'kc', type: 'string', group: 'thuraya' },
  { position: 37, sourceName: 'Ki', field: 'ki', type: 'string', group: 'thuraya' },
  { position: 38, sourceName: 'Target Identifiers', field: 'targetIdentifiers', type: 'string', group: 'target' },
  { position: 39, sourceName: 'Case Notation', field: 'caseNotation', type: 'string', group: 'target' },
  { position: 40, sourceName: 'Audio Routed', field: 'audioRouted', type: 'string', group: 'call' },
  { position: 41, sourceName: 'Encryption mode', field: 'encryptionMode', type: 'string', group: 'networkSystem' },
  { position: 42, sourceName: 'Initial Control Channel', field: 'initialControlChannel', type: 'string', group: 'call' },
  { position: 43, sourceName: 'Voice Channel History', field: 'voiceChannelHistory', type: 'string', group: 'call' },
  { position: 44, sourceName: 'Voice Channel History Timestamp', field: 'voiceChannelHistoryTimestamp', type: 'string', group: 'call' },
  { position: 45, sourceName: 'Message Type', field: 'messageType', type: 'string', group: 'message' },
  { position: 46, sourceName: 'Message Length', field: 'messageLength', type: 'int', group: 'message' },
  { position: 47, sourceName: 'Message', field: 'message', type: 'string', group: 'message' },
  { position: 48, sourceName: 'Called Normalized PSTN', field: 'calledNormalizedPstn', type: 'string', group: 'calledParty' },
  { position: 49, sourceName: 'Calling Normalized PSTN', field: 'callingNormalizedPstn', type: 'string', group: 'callingParty' },
  { position: 50, sourceName: 'Target Selection Result', field: 'targetSelectionResult', type: 'string', group: 'target' },
  { position: 51, sourceName: 'Target Rule', field: 'targetRule', type: 'string', group: 'target' },
  { position: 52, sourceName: 'Called Party Target Rule', field: 'calledPartyTargetRule', type: 'string', group: 'calledParty' },
  { position: 53, sourceName: 'Calling Party Target Rule', field: 'callingPartyTargetRule', type: 'string', group: 'callingParty' },
  { position: 54, sourceName: 'Hit List', field: 'hitList', type: 'string', group: 'target' },
];

export const CRONOLOG_EXPECTED_COLUMNS = CRONOLOG_FIELDS.length;
export const CRONOLOG_FIELD_BY_KEY = new Map(CRONOLOG_FIELDS.map((f) => [f.field, f]));
export const CRONOLOG_SOURCE_NAMES = CRONOLOG_FIELDS.map((f) => f.sourceName);
export const CRONOLOG_FIELD_KEYS = CRONOLOG_FIELDS.map((f) => f.field);

export const CRONOLOG_GROUP_LABELS: Record<CronologGroup, { en: string; ar: string }> = {
  call: { en: 'Call', ar: 'المكالمة' },
  calledParty: { en: 'Called Party', ar: 'الطرف المتصل به' },
  callingParty: { en: 'Calling Party', ar: 'الطرف المتصل' },
  thuraya: { en: 'Thuraya', ar: 'الثريا' },
  networkSystem: { en: 'Network/System', ar: 'الشبكة/النظام' },
  target: { en: 'Target', ar: 'الهدف' },
  message: { en: 'Message', ar: 'الرسالة' },
};

export interface ParsedCronologRecord {
  lineNumber: number;
  values: (string | null)[];
  record: Record<string, string | number | null>;
  errors: string[];
}

export interface CronologParseIssue {
  line: number;
  field?: string;
  message: string;
  actualColumns?: number;
}

export interface CronologPreviewSummary {
  filename: string;
  size: number;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  expectedColumns: number;
  actualColumnIssues: Array<{ line: number; actual: number; expected: number }>;
  sampleRecords: Array<Record<string, string | number | null>>;
  firstRecords: Array<Record<string, string | number | null>>;
  parsingErrors: CronologParseIssue[];
  fileHash: string;
  isDuplicate: boolean;
  duplicateBatch: { id: number; filename: string; uploadedAt: Date; status: string } | null;
}

export interface CronologImportProgress {
  jobId: string;
  batchId?: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  totalRecords: number;
  importedRecords: number;
  failedRecords: number;
  errorSamples: CronologParseIssue[];
}

const importJobs = new Map<string, CronologImportProgress>();

export function getCronologImportProgress(jobId: string): CronologImportProgress | null {
  return importJobs.get(jobId) ?? null;
}

function normalizeEmpty(value: string): string | null {
  if (value == null) return null;
  return value.trim() === '' ? null : value;
}

/**
 * Parse a single headerless colon-delimited line into exactly 54 fields.
 * - Never uses split(':')
 * - Preserves consecutive delimiters and empty positions
 * - Supports quoted fields and quoted values containing colons
 * - Unquotes surrounding double quotes and unescapes doubled quotes ("")
 */
export function parseCronologLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote inside quoted field
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      // Start quoted field; only meaningful at field start or if quote appears
      // as part of content before any delimiter (be permissive).
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ':') {
      fields.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  fields.push(current);
  return fields;
}

export function coerceCronologField(
  def: CronologFieldDef,
  raw: string,
  lineNumber: number,
): { value: string | number | null; error?: string } {
  const normalized = normalizeEmpty(raw);
  if (normalized === null) return { value: null };

  if (def.type === 'string') {
    return { value: normalized };
  }

  if (def.type === 'float') {
    const n = Number(normalized);
    if (!Number.isFinite(n)) {
      return {
        value: null,
        error: `Line ${lineNumber}, field "${def.sourceName}" (${def.position}): invalid number "${normalized}"`,
      };
    }
    return { value: n };
  }

  // int
  const n = Number(normalized);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return {
      value: null,
      error: `Line ${lineNumber}, field "${def.sourceName}" (${def.position}): invalid integer "${normalized}"`,
    };
  }
  return { value: n };
}

export function parseAndValidateCronologRecord(
  line: string,
  lineNumber: number,
): ParsedCronologRecord {
  const rawFields = parseCronologLine(line.replace(/\r$/, ''));
  const errors: string[] = [];

  if (rawFields.length !== CRONOLOG_EXPECTED_COLUMNS) {
    errors.push(
      `Line ${lineNumber}: expected ${CRONOLOG_EXPECTED_COLUMNS} fields, got ${rawFields.length}`,
    );
    return {
      lineNumber,
      values: rawFields.map((v) => normalizeEmpty(v)),
      record: {},
      errors,
    };
  }

  const record: Record<string, string | number | null> = {};

  for (let i = 0; i < CRONOLOG_FIELDS.length; i++) {
    const def = CRONOLOG_FIELDS[i];
    const coerced = coerceCronologField(def, rawFields[i] ?? '', lineNumber);
    if (coerced.error) {
      errors.push(coerced.error);
      // keep null for invalid numeric; record remains invalid due to error
      record[def.field] = null;
    } else {
      record[def.field] = coerced.value;
    }
  }

  return {
    lineNumber,
    values: rawFields.map((v) => normalizeEmpty(v)),
    record,
    errors,
  };
}

export async function computeFileHash(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function findDuplicateBatch(fileHash: string) {
  if (!fileHash) return null;
  return db.cronologsImportBatch.findFirst({
    where: { fileHash, status: { not: 'UNDONE' } },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, uploadedAt: true, status: true },
  });
}

export async function previewCronologFile(args: {
  filePath: string;
  filename: string;
  size: number;
}): Promise<CronologPreviewSummary> {
  const fileHash = await computeFileHash(args.filePath);
  const duplicateBatch = await findDuplicateBatch(fileHash);

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let totalRecords = 0;
  let validRecords = 0;
  let invalidRecords = 0;
  const actualColumnIssues: Array<{ line: number; actual: number; expected: number }> = [];
  const parsingErrors: CronologParseIssue[] = [];
  const sampleRecords: Array<Record<string, string | number | null>> = [];
  const firstRecords: Array<Record<string, string | number | null>> = [];

  for await (const rawLine of rl) {
    totalRecords += 1;
    const lineNumber = totalRecords; // first line is record 1
    // Skip completely empty trailing line if it's the only thing? No, headerless data rows.
    // But a truly empty line would parse to 1 empty field and be an error - report it.
    const parsed = parseAndValidateCronologRecord(rawLine, lineNumber);

    if (parsed.errors.length) {
      invalidRecords += 1;
      if (rawLine !== undefined) {
        const fields = parseCronologLine(rawLine.replace(/\r$/, ''));
        if (fields.length !== CRONOLOG_EXPECTED_COLUMNS) {
          if (actualColumnIssues.length < 50) {
            actualColumnIssues.push({
              line: lineNumber,
              actual: fields.length,
              expected: CRONOLOG_EXPECTED_COLUMNS,
            });
          }
        }
      }
      for (const msg of parsed.errors) {
        if (parsingErrors.length < 100) {
          const fieldMatch = msg.match(/field "([^"]+)"/);
          parsingErrors.push({
            line: lineNumber,
            field: fieldMatch?.[1],
            message: msg,
            actualColumns:
              parsed.values.length !== CRONOLOG_EXPECTED_COLUMNS ? parsed.values.length : undefined,
          });
        }
      }
      continue;
    }

    validRecords += 1;
    if (sampleRecords.length < 10) {
      sampleRecords.push(buildDisplayRecord(parsed.record));
    }
    if (firstRecords.length < 10) {
      firstRecords.push(buildDisplayRecord(parsed.record));
    }
  }

  return {
    filename: args.filename,
    size: args.size,
    totalRecords,
    validRecords,
    invalidRecords,
    expectedColumns: CRONOLOG_EXPECTED_COLUMNS,
    actualColumnIssues,
    sampleRecords,
    parsingErrors,
    firstRecords,
    fileHash,
    isDuplicate: Boolean(duplicateBatch),
    duplicateBatch,
  };
}

export function buildDisplayRecord(
  record: Record<string, string | number | null>,
): Record<string, string | number | null> {
  // Preserve original source column names as keys for UI preview/export friendliness
  const out: Record<string, string | number | null> = {};
  for (const def of CRONOLOG_FIELDS) {
    out[def.sourceName] = record[def.field] ?? null;
  }
  return out;
}

function toDbRecord(
  record: Record<string, string | number | null>,
  importBatchId: number,
) {
  const data: Record<string, any> = { importBatchId };
  for (const def of CRONOLOG_FIELDS) {
    data[def.field] = record[def.field] ?? null;
  }
  return data;
}

export async function startCronologImport(args: {
  filePath: string;
  filename: string;
  fileHash?: string;
  userId?: number | null;
  username?: string | null;
  forceDuplicate?: boolean;
}): Promise<{ jobId: string; batchId: number }> {
  const fileHash = args.fileHash || (await computeFileHash(args.filePath));
  const duplicate = await findDuplicateBatch(fileHash);
  if (duplicate && !args.forceDuplicate) {
    throw new Error(
      `Duplicate file detected (matches batch #${duplicate.id}: ${duplicate.filename}). Re-submit with forceDuplicate=true to import intentionally.`,
    );
  }

  const batch = await db.cronologsImportBatch.create({
    data: {
      filename: args.filename,
      fileHash,
      totalRecords: 0,
      importedRecords: 0,
      failedRecords: 0,
      status: 'PROCESSING',
      uploadedBy: args.username ?? null,
    },
  });

  const jobId = `cronolog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  importJobs.set(jobId, {
    jobId,
    batchId: batch.id,
    status: 'RUNNING',
    totalRecords: 0,
    importedRecords: 0,
    failedRecords: 0,
    errorSamples: [],
  });

  void processCronologImport({
    jobId,
    batchId: batch.id,
    filePath: args.filePath,
    username: args.username,
  }).catch(async (err) => {
    const progress = importJobs.get(jobId);
    if (progress) {
      progress.status = 'FAILED';
      if (progress.errorSamples.length < 5) {
        progress.errorSamples.push({ line: 0, message: err?.message || String(err) });
      }
    }
    try {
      await db.cronologsImportBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED' },
      });
    } catch {
      // ignore
    }
  });

  return { jobId, batchId: batch.id };
}

async function processCronologImport(args: {
  jobId: string;
  batchId: number;
  filePath: string;
  username?: string | null;
}): Promise<void> {
  const progress = importJobs.get(args.jobId);
  if (!progress) return;

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let totalRecords = 0;
  let importedRecords = 0;
  let failedRecords = 0;
  const errorSamples: CronologParseIssue[] = [];
  const chunk: any[] = [];
  const CHUNK_SIZE = 500;

  const flush = async () => {
    if (!chunk.length) return;
    const data = chunk.splice(0, chunk.length);
    try {
      await db.cronolog.createMany({ data });
      importedRecords += data.length;
    } catch (err: any) {
      // Fallback: try row-by-row inside transaction to isolate bad rows (unlikely, but safe)
      for (const row of data) {
        try {
          await db.cronolog.create({ data: row });
          importedRecords += 1;
        } catch (rowErr: any) {
          failedRecords += 1;
          if (errorSamples.length < 100) {
            errorSamples.push({ line: 0, message: rowErr?.message || String(rowErr) });
          }
        }
      }
    }

    progress.totalRecords = totalRecords;
    progress.importedRecords = importedRecords;
    progress.failedRecords = failedRecords;
    progress.errorSamples = errorSamples.slice(0, 100);

    await db.cronologsImportBatch.update({
      where: { id: args.batchId },
      data: {
        totalRecords,
        importedRecords,
        failedRecords,
      },
    });
  };

  for await (const rawLine of rl) {
    totalRecords += 1;
    const lineNumber = totalRecords;
    const parsed = parseAndValidateCronologRecord(rawLine, lineNumber);

    if (parsed.errors.length) {
      failedRecords += 1;
      for (const msg of parsed.errors) {
        if (errorSamples.length < 100) {
          const fieldMatch = msg.match(/field "([^"]+)"/);
          parsingErrorsPush(errorSamples, {
            line: lineNumber,
            field: fieldMatch?.[1],
            message: msg,
            actualColumns:
              parsed.values.length !== CRONOLOG_EXPECTED_COLUMNS ? parsed.values.length : undefined,
          });
        }
      }
    } else {
      chunk.push(toDbRecord(parsed.record, args.batchId));
      if (chunk.length >= CHUNK_SIZE) {
        await flush();
      }
    }

    if (totalRecords % 500 === 0) {
      progress.totalRecords = totalRecords;
      progress.importedRecords = importedRecords;
      progress.failedRecords = failedRecords;
      progress.errorSamples = errorSamples.slice(0, 100);
    }
  }

  await flush();

  const status = failedRecords > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  progress.status = 'COMPLETED';
  progress.totalRecords = totalRecords;
  progress.importedRecords = importedRecords;
  progress.failedRecords = failedRecords;
  progress.errorSamples = errorSamples.slice(0, 100);

  await db.cronologsImportBatch.update({
    where: { id: args.batchId },
    data: {
      status,
      totalRecords,
      importedRecords,
      failedRecords,
    },
  });

  // Audit log is written by route after detecting completion in many flows? but async job -
  // write here best-effort using username if available via batch record is not stored except uploadedBy.
  try {
    await db.auditLog.create({
      data: {
        username: args.username?.trim() || 'system',
        action: 'CRONOLOGS_IMPORT',
        module: 'Cronologs',
        recordId: String(args.batchId),
        result: failedRecords > 0 ? 'PARTIAL' : 'SUCCESS',
        details: `Imported ${importedRecords}/${totalRecords} records (${failedRecords} failed) from cronologs file`,
      },
    });
  } catch {
    // ignore audit failures
  }
}

function parsingErrorsPush(target: CronologParseIssue[], issue: CronologParseIssue) {
  if (target.length < 100) target.push(issue);
}

export type CronologSortOrder = 'asc' | 'desc';

export interface CronologListParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: CronologSortOrder;
  filters?: Record<string, string | undefined>;
  dateUp?: string;
  dateDown?: string;
}

const SORTABLE_FIELDS = new Set<string>([
  'id',
  'createdAt',
  'updatedAt',
  'importBatchId',
  ...CRONOLOG_FIELD_KEYS,
]);

export async function listCronologs(params: CronologListParams) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const where: any = { AND: [] as any[] };

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.AND.push({
      OR: CRONOLOG_FIELDS
        .filter((f) => f.type === 'string')
        .map((f) => ({ [f.field]: { contains: q, mode: 'insensitive' as const } })),
    });
  }

  if (params.dateUp && params.dateUp.trim()) {
    where.AND.push({ dateUp: { contains: params.dateUp.trim(), mode: 'insensitive' } });
  }
  if (params.dateDown && params.dateDown.trim()) {
    where.AND.push({ dateDown: { contains: params.dateDown.trim(), mode: 'insensitive' } });
  }

  const filters = params.filters || {};
  for (const [key, value] of Object.entries(filters)) {
    if (!value || !String(value).trim()) continue;
    const def = CRONOLOG_FIELD_BY_KEY.get(key);
    if (!def) continue;
    const v = String(value).trim();
    if (def.type === 'string') {
      where.AND.push({ [key]: { contains: v, mode: 'insensitive' } });
    } else if (def.type === 'int') {
      const n = Number(v);
      if (Number.isInteger(n)) where.AND.push({ [key]: n });
    } else if (def.type === 'float') {
      const n = Number(v);
      if (Number.isFinite(n)) where.AND.push({ [key]: n });
    }
  }

  if (where.AND.length === 0) delete where.AND;

  const sortBy = params.sortBy && SORTABLE_FIELDS.has(params.sortBy) ? params.sortBy : 'id';
  const sortOrder: 'asc' | 'desc' = params.sortOrder === 'asc' ? 'asc' : 'desc';

  const [total, rows] = await db.$transaction([
    db.cronolog.count({ where }),
    db.cronolog.findMany({
      where,
      orderBy: { [sortBy]: sortOrder } as any,
      skip,
      take: pageSize,
    }),
  ]);

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getCronologById(id: number) {
  return db.cronolog.findUnique({ where: { id } });
}

export async function getCronologStatistics() {
  const [totalRecords, uniqueCallIds, uniqueCalledImsis, uniqueCallingImsis, recordsWithUnitCoordinates, importBatches] =
    await Promise.all([
      db.cronolog.count(),
      db.cronolog.groupBy({ by: ['uniqueCallId'], where: { uniqueCallId: { not: null } } }).then((r) => r.length),
      db.cronolog.groupBy({ by: ['calledImsi'], where: { calledImsi: { not: null } } }).then((r) => r.length),
      db.cronolog.groupBy({ by: ['callingImsi'], where: { callingImsi: { not: null } } }).then((r) => r.length),
      db.cronolog.count({ where: { unitLatitude: { not: null }, unitLongitude: { not: null } } }),
      db.cronologsImportBatch.count({ where: { status: { not: 'UNDONE' } } }),
    ]);

  // Also count non-empty-string uniqueness more accurately by filtering empties in JS if needed?
  // groupBy on non-null still includes empty strings; refine with raw queries for correctness.
  const [uCall, uCalled, uCalling] = await Promise.all([
    db.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(DISTINCT unique_call_id) AS c FROM cronologs WHERE unique_call_id IS NOT NULL AND BTRIM(unique_call_id) <> ''`,
    db.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(DISTINCT called_imsi) AS c FROM cronologs WHERE called_imsi IS NOT NULL AND BTRIM(called_imsi) <> ''`,
    db.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(DISTINCT calling_imsi) AS c FROM cronologs WHERE calling_imsi IS NOT NULL AND BTRIM(calling_imsi) <> ''`,
  ]);

  return {
    totalCronologsRecords: totalRecords,
    uniqueCallIds: Number(uCall[0]?.c ?? uniqueCallIds),
    uniqueCalledImsis: Number(uCalled[0]?.c ?? uniqueCalledImsis),
    uniqueCallingImsis: Number(uCalling[0]?.c ?? uniqueCallingImsis),
    recordsWithUnitCoordinates,
    importBatches,
  };
}

export async function listCronologImportBatches() {
  return db.cronologsImportBatch.findMany({
    orderBy: { uploadedAt: 'desc' },
  });
}

export async function getCronologImportBatch(batchId: number) {
  const batch = await db.cronologsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const progress = [...importJobs.values()].find((j) => j.batchId === batchId) || null;
  return { ...batch, progress };
}

export async function undoCronologImportBatch(batchId: number, username?: string | null) {
  const batch = await db.cronologsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error('Cronologs import batch not found');
  if (batch.status === 'UNDONE') throw new Error('This import batch has already been undone');

  const deletedCount = await db.$transaction(async (tx) => {
    const deleted = await tx.cronolog.deleteMany({ where: { importBatchId: batchId } });
    await tx.cronologsImportBatch.update({
      where: { id: batchId },
      data: { status: 'UNDONE' },
    });
    return deleted.count;
  });

  try {
    await db.auditLog.create({
      data: {
        username: username?.trim() || 'system',
        action: 'CRONOLOGS_IMPORT_UNDO',
        module: 'Cronologs',
        recordId: String(batchId),
        result: 'SUCCESS',
        details: `Undid cronologs import batch #${batchId} (${batch.filename}), deleted ${deletedCount} records`,
      },
    });
  } catch {
    // ignore
  }

  return { batchId, deletedRecords: deletedCount, status: 'UNDONE' };
}

export function parseCronologListQuery(query: any): CronologListParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
  const search = typeof query.search === 'string' ? query.search : undefined;
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : undefined;
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : query.sortOrder === 'desc' ? 'desc' : undefined;
  const dateUp = typeof query.dateUp === 'string' ? query.dateUp : undefined;
  const dateDown = typeof query.dateDown === 'string' ? query.dateDown : undefined;

  const filters: Record<string, string> = {};
  if (typeof query.filters === 'string') {
    try {
      const parsed = JSON.parse(query.filters);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') filters[k] = v;
        }
      }
    } catch {
      // ignore invalid filters JSON
    }
  }

  // also accept column filters as direct query params
  for (const def of CRONOLOG_FIELDS) {
    const val = query[def.field];
    if (typeof val === 'string' && val.trim()) filters[def.field] = val;
  }

  return { page, pageSize, search, sortBy, sortOrder, filters, dateUp, dateDown };
}

export async function queryCronologsForExport(params: CronologListParams & { selectedColumns?: string[] }) {
  const page = 1;
  const pageSize = 1000000; // we'll page manually in chunks below instead
  const { search, sortBy, sortOrder, filters, dateUp, dateDown } = params;
  // Build where/order same as listCronologs but fetch in batches
  const base = { search, sortBy, sortOrder, filters, dateUp, dateDown };

  const selectedFields = (params.selectedColumns && params.selectedColumns.length
    ? params.selectedColumns.filter((c) => CRONOLOG_FIELD_BY_KEY.has(c))
    : CRONOLOG_FIELD_KEYS);

  // Use batching to avoid loading everything at once
  const rows: any[] = [];
  let p = 1;
  const take = 2000;
  while (true) {
    const res = await listCronologs({ ...base, page: p, pageSize: take });
    rows.push(...res.data);
    if (res.data.length < take || rows.length >= res.pagination.total) break;
    p += 1;
    if (p > 5000) break; // safety cap
  }

  return { rows, selectedFields };
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export async function exportCronologs(args: {
  format: 'csv' | 'xlsx' | 'pdf' | 'docx';
  params: CronologListParams;
  selectedColumns?: string[];
  language?: 'en' | 'ar';
}): Promise<{ filename: string; contentType: string; content: Buffer }> {
  const { rows, selectedFields } = await queryCronologsForExport({
    ...args.params,
    selectedColumns: args.selectedColumns,
  });
  const fields = CRONOLOG_FIELDS.filter((f) => selectedFields.includes(f.field));
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `cronologs_export_${stamp}`;

  if (args.format === 'csv') {
    const header = fields.map((f) => escapeCsv(f.sourceName)).join(',');
    const lines = rows.map((row) => fields.map((f) => escapeCsv(row[f.field])).join(','));
    const csv = '\uFEFF' + [header, ...lines].join('\r\n');
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', content: Buffer.from(csv, 'utf8') };
  }

  if (args.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cronologs');
    ws.columns = fields.map((f) => ({ header: f.sourceName, key: f.field, width: Math.max(14, f.sourceName.length + 2) }));
    ws.getRow(1).font = { bold: true };
    for (const row of rows) {
      const obj: Record<string, any> = {};
      for (const f of fields) {
        const v = row[f.field];
        // Preserve identifiers/leading zeros/dates as text
        obj[f.field] = v === null || v === undefined ? null : String(v);
      }
      const r = ws.addRow(obj);
      fields.forEach((f, i) => {
        r.getCell(i + 1).numFmt = '@';
      });
    }
    const buf = await wb.xlsx.writeBuffer();
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(buf),
    };
  }

  if (args.format === 'pdf') {
    const content = await buildCronologsPdf(rows, fields, args.language || 'en');
    return { filename: `${base}.pdf`, contentType: 'application/pdf', content };
  }

  // docx
  const content = await buildCronologsDocx(rows, fields, args.language || 'en');
  return {
    filename: `${base}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content,
  };
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

async function buildCronologsPdf(
  rows: any[],
  fields: CronologFieldDef[],
  language: 'en' | 'ar',
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.from(c)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const title = language === 'ar' ? 'تصدير سجلات كرونولوج' : 'Cronologs Export';
    doc.fontSize(14).fillColor('#111827').text(title, { align: language === 'ar' ? 'right' : 'left' });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#4b5563').text(`Records: ${rows.length} | Generated: ${new Date().toISOString()}`);
    doc.moveDown(0.5);

    // Render as key-value blocks per record for readability with 54 columns
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.fontSize(9).fillColor('#111827').text(`Record #${row.id ?? idx + 1}`, { underline: true });
      doc.moveDown(0.15);
      doc.fontSize(7).fillColor('#111827');
      for (const f of fields) {
        if (doc.y > doc.page.height - 40) doc.addPage();
        const text = `${f.sourceName}: ${valueText(row[f.field])}`;
        doc.text(text, { width: doc.page.width - 48 });
      }
      doc.moveDown(0.4);
      if (idx < rows.length - 1) {
        doc.moveTo(24, doc.y).lineTo(doc.page.width - 24, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.3);
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

async function buildCronologsDocx(
  rows: any[],
  fields: CronologFieldDef[],
  language: 'en' | 'ar',
): Promise<Buffer> {
  const title = language === 'ar' ? 'تصدير سجلات كرونولوج' : 'Cronologs Export';
  const isAr = language === 'ar';

  const children: Array<Paragraph | DocxTable> = [];
  children.push(
    new Paragraph({
      alignment: isAr ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: isAr,
      children: [new TextRun({ text: title, bold: true, size: 30 })],
    }),
  );
  children.push(
    new Paragraph({
      alignment: isAr ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: isAr,
      children: [new TextRun({ text: `Records: ${rows.length}`, size: 18, color: '4B5563' })],
      spacing: { after: 200 },
    }),
  );

  // One table per record (54 columns as rows) to preserve all fields clearly
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    children.push(
      new Paragraph({
        alignment: isAr ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: isAr,
        children: [new TextRun({ text: `Record #${row.id ?? i + 1}`, bold: true, size: 22 })],
        spacing: { before: 120, after: 80 },
      }),
    );

    const tableRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({ shading: { type: 'clear', fill: '4F46E5', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: isAr ? 'الحقل' : 'Field', bold: true, color: 'FFFFFF' })] })] }),
          new TableCell({ shading: { type: 'clear', fill: '4F46E5', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: isAr ? 'القيمة' : 'Value', bold: true, color: 'FFFFFF' })] })] }),
        ],
      }),
    ];

    for (const f of fields) {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: f.sourceName, size: 16 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: valueText(row[f.field]), size: 16 })] })] }),
          ],
        }),
      );
    }

    children.push(
      new DocxTable({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
        },
        rows: tableRows,
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: title, bold: true })] })] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' / ' }), new TextRun({ children: [PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

export function getCronologMeta() {
  return {
    expectedColumns: CRONOLOG_EXPECTED_COLUMNS,
    fields: CRONOLOG_FIELDS,
    groups: CRONOLOG_GROUP_LABELS,
  };
}
