import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { DatabaseSync } from 'node:sqlite';
import { db, getTableColumns } from './db.js';

export interface CoordinateParseResult {
  latitude: number | null;
  longitude: number | null;
  isValid: boolean;
  error?: string;
}

export const KNOWN_DOMAIN_TABLES = [
  'missions', 'plmn_storage', 'tac_numbers', 'whitelist_targets',
  'scheduled_tasks', 'map_layers', 'mission_extras', 'location_extras',
  'targets', 'map_cell_databases', 'wifi_access_points', 'registrations',
  'network_cells', 'gps_history', 'sms_calls', 'map_user_markers',
  'map_user_polygons', 'map_user_circles', 'mission_files', 'location_files',
  'target_files', 'map_cells', 'wifi_access_point_clients',
] as const;

const TABLE_DEPENDENCY_ORDER: Record<string, number> = {
  missions: 1, plmn_storage: 1, tac_numbers: 1, whitelist_targets: 1,
  scheduled_tasks: 1, map_layers: 1,
  mission_extras: 2, location_extras: 2, targets: 2,
  map_cell_databases: 2, wifi_access_points: 2,
  registrations: 3, network_cells: 3, gps_history: 3, sms_calls: 3,
  map_user_markers: 3, map_user_polygons: 3, map_user_circles: 3,
  mission_files: 4, location_files: 4, target_files: 4,
  map_cells: 4, wifi_access_point_clients: 4,
};

const ALLOWED_TABLES = new Set<string>(KNOWN_DOMAIN_TABLES);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

type ColumnMeta = {
  name: string;
  type: string;
  notnull: number | boolean;
  pk: number;
  default?: unknown;
  udt?: string;
};

type IdMapStore = Map<string, Map<any, any>>;

// Interactive transactions only exist on the root client; when a caller passes
// a transaction client we simply run inside it.
async function runInTransaction<T>(
  client: any,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  return typeof client.$transaction === 'function'
    ? client.$transaction(fn, { maxWait: 10_000, timeout: 60_000 })
    : fn(client);
}

// ExcelJS returns objects for formulas, rich text and hyperlinks.
function unwrapCell(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Date || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if ('result' in value) return unwrapCell(value.result);
  if (Array.isArray(value.richText)) {
    return value.richText.map((part: any) => part?.text ?? '').join('');
  }
  if ('text' in value) return unwrapCell(value.text);
  if ('error' in value) return null;
  return value;
}

// SQLite stores dates as epoch milliseconds / seconds or ISO strings.
function toDate(value: any): Date {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{9,}$/.test(value.trim()))) {
    const n = Number(value);
    return new Date(n < 1e11 ? n * 1000 : n);
  }
  return new Date(value);
}

const isEmpty = (value: any): boolean =>
  value === undefined || value === null ||
  (typeof value === 'string' && value.trim() === '');

function assertTable(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Unsupported destination table: ${table}`);
  }
}

function quoteIdent(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

function quoteSqliteIdent(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqliteRows(sqlite: DatabaseSync, table: string): Record<string, any>[] {
  const exists = sqlite.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table);

  if (!exists) throw new Error(`SQLite source table not found: ${table}`);

  return sqlite.prepare(
    `SELECT * FROM ${quoteSqliteIdent(table)}`,
  ).all() as Record<string, any>[];
}

function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = jsonSafe(item);
    }
    return output;
  }
  return value;
}

export function getDependencyOrder(tableName: string): number {
  return TABLE_DEPENDENCY_ORDER[tableName] ?? 5;
}

export function suggestDestinationTable(sourceTable: string): string {
  const clean = sourceTable.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ALLOWED_TABLES.has(clean)) return clean;

  const snake = sourceTable
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (ALLOWED_TABLES.has(snake)) return snake;
  if (ALLOWED_TABLES.has(`${snake}s`)) return `${snake}s`;

  return 'registrations';
}

export async function autoMapColumns(
  sourceCols: string[],
  destTable: string,
): Promise<Record<string, string>> {
  assertTable(destTable);

  const destCols = (await getTableColumns(destTable)).map((c: any) => c.name);
  const mapping: Record<string, string> = {};

  for (const source of sourceCols) {
    const normalized = source.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = destCols.find((destination: string) =>
      destination.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized,
    );

    if (match) mapping[source] = match;
  }

  // Common coordinate aliases. These are suggestions only; the importer
  // still validates the resulting values before writing them.
  if (destTable === 'gps_history') {
    const aliases: Record<string, string[]> = {
      latitude: ['lat', 'gps_lat', 'gps_latitude'],
      longitude: ['lng', 'lon', 'long', 'gps_lng', 'gps_longitude'],
    };

    for (const [destination, candidates] of Object.entries(aliases)) {
      if (!destCols.includes(destination)) continue;
      const source = sourceCols.find(col =>
        candidates.includes(col.toLowerCase().replace(/[^a-z0-9]/g, '')),
      );
      if (source && !mapping[source]) mapping[source] = destination;
    }
  }

  return mapping;
}

export function parseCoordinates(
  input: any,
  secondaryInput?: any,
  order: 'LAT_LNG' | 'LNG_LAT' = 'LAT_LNG',
): CoordinateParseResult {
  if (isEmpty(input)) {
    return {
      latitude: null, longitude: null, isValid: false,
      error: 'Empty coordinate input',
    };
  }

  let latitude: number | null = null;
  let longitude: number | null = null;

  if (!isEmpty(secondaryInput)) {
    const first = Number(String(input).trim());
    const second = Number(String(secondaryInput).trim());

    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return {
        latitude: null, longitude: null, isValid: false,
        error: 'Non-numeric coordinate value',
      };
    }

    [latitude, longitude] = order === 'LAT_LNG'
      ? [first, second]
      : [second, first];
  } else {
    const text = String(input).trim();

    const wkt = text.match(
      /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i,
    );

    if (wkt) {
      longitude = Number(wkt[1]);
      latitude = Number(wkt[2]);
    } else if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.type === 'Point' && Array.isArray(parsed.coordinates)) {
          longitude = Number(parsed.coordinates[0]);
          latitude = Number(parsed.coordinates[1]);
        }
      } catch {
        // Continue with delimited coordinate formats.
      }
    }

    if (latitude === null || longitude === null) {
      // Newline-separated values are interpreted as LATITUDE then LONGITUDE.
      const parts = text.includes(';') ? text.split(';')
        : text.includes(',') ? text.split(',')
        : text.includes('/') ? text.split('/')
        : text.split(/[\r\n\s]+/).filter(Boolean);

      if (parts.length >= 2) {
        const first = Number(parts[0].trim());
        const second = Number(parts[1].trim());

        if (Number.isFinite(first) && Number.isFinite(second)) {
          [latitude, longitude] = order === 'LAT_LNG'
            ? [first, second]
            : [second, first];
        }
      }
    }
  }

  if (
    latitude === null || longitude === null ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
  ) {
    return {
      latitude: null, longitude: null, isValid: false,
      error: 'Could not extract a valid coordinate pair',
    };
  }

  if (latitude < -90 || latitude > 90) {
    return {
      latitude, longitude, isValid: false,
      error: `Latitude ${latitude} is outside [-90, 90]`,
    };
  }

  if (longitude < -180 || longitude > 180) {
    return {
      latitude, longitude, isValid: false,
      error: `Longitude ${longitude} is outside [-180, 180]`,
    };
  }

  return { latitude, longitude, isValid: true };
}

async function readTabularFile(
  filePath: string,
  originalName: string,
  sheetOrTable?: string,
): Promise<Record<string, any>[]> {
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = sheetOrTable
      ? workbook.getWorksheet(sheetOrTable)
      : workbook.worksheets[0];

    if (!sheet) throw new Error(`Worksheet not found: ${sheetOrTable}`);

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? `col_${col}`);
    });

    const rows: Record<string, any>[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const record: Record<string, any> = {};
      headers.forEach((header, col) => {
        if (header) record[header] = row.getCell(col).value;
      });

      if (Object.keys(record).length) rows.push(record);
    });

    return rows;
  }

  if (ext === '.csv') {
    return parseCsv(fs.readFileSync(filePath, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, any>[];
  }

  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    const sqlite = new DatabaseSync(filePath, { readOnly: true });

    try {
      const table = sheetOrTable;
      if (!table) {
        throw new Error('A source SQLite table must be selected for this import');
      }
      return sqliteRows(sqlite, table);
    } finally {
      sqlite.close();
    }
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

export async function inspectFile(filePath: string, originalName: string) {
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.readFile(filePath);

    const sheets = workbook.worksheets.map(ws => {
      const headers: string[] = [];

      ws.getRow(1).eachCell((cell, col) => {
        headers[col] = String(cell.value ?? `col_${col}`);
      });

      const preview: Record<string, any>[] = [];

      for (let rowNumber = 2; rowNumber <= Math.min(ws.rowCount, 11); rowNumber++) {
        const record: Record<string, any> = {};
        headers.forEach((header, index) => {
          if (header) record[header] = ws.getRow(rowNumber).getCell(index).value;
        });
        preview.push(record);
      }

      return {
        sheetName: ws.name,
        rowCount: Math.max(0, ws.rowCount - 1),
        columns: headers.filter(Boolean),
        preview,
      };
    });

    return { type: 'EXCEL', sheets };
  }

  if (ext === '.csv') {
    const records = parseCsv(fs.readFileSync(filePath, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      to: 100,
    }) as Record<string, any>[];

    return {
      type: 'CSV',
      columns: records.length ? Object.keys(records[0]) : [],
      preview: records.slice(0, 10),
      totalSampled: records.length,
    };
  }

  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    const sqlite = new DatabaseSync(filePath, { readOnly: true });

    try {
      const tables = sqlite.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const inspected = [];

      for (const { name } of tables) {
        const cols = sqlite.prepare(
          `PRAGMA table_info(${quoteSqliteIdent(name)})`,
        ).all() as any[];

        const count = sqlite.prepare(
          `SELECT COUNT(*) AS count FROM ${quoteSqliteIdent(name)}`,
        ).get() as any;

        const preview = sqlite.prepare(
          `SELECT * FROM ${quoteSqliteIdent(name)} LIMIT 10`,
        ).all();

        const destination = suggestDestinationTable(name);

        inspected.push({
          tableName: name,
          rowCount: Number(count?.count ?? 0),
          columns: cols.map(c => ({
            name: c.name, type: c.type, pk: c.pk, notnull: c.notnull,
          })),
          preview,
          suggestedDestination: destination,
          suggestedMapping: await autoMapColumns(
            cols.map(c => c.name),
            destination,
          ),
          destColumns: await getTableColumns(destination),
          dependencyOrder: getDependencyOrder(destination),
        });
      }

      inspected.sort((a, b) => a.dependencyOrder - b.dependencyOrder);

      return { type: 'SQLITE', tables: inspected };
    } finally {
      sqlite.close();
    }
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

export interface MultiSqliteTableConfig {
  sourceTable: string;
  destinationTable: string;
  columnMapping: Record<string, string>;
  conflictMode: 'skip' | 'update' | 'replace';
  matchKey?: string;
}

function mapConflictMode(
  mode: MultiSqliteTableConfig['conflictMode'],
): 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE' {
  return mode === 'skip' ? 'INSERT_ONLY'
    : mode === 'update' ? 'UPDATE_EXISTING'
    : 'INSERT_OR_UPDATE';
}

function coerceValueForColumn(
  value: any,
  type: string,
  column?: string,
): { value: any; error?: string } {
  value = unwrapCell(value);

  if (isEmpty(value)) return { value: null };

  const normalizedType = String(type).toLowerCase();

  if (normalizedType.includes('bool')) {
    if (typeof value === 'boolean') return { value };

    const normalized = String(value).trim().toLowerCase();

    if (['1', 'true', 'yes', 'y'].includes(normalized)) return { value: true };
    if (['0', 'false', 'no', 'n'].includes(normalized)) return { value: false };

    return {
      value,
      error: `Expected boolean for ${column || 'column'}, received "${value}"`,
    };
  }

  if (normalizedType.includes('bigint')) {
    try {
      return { value: BigInt(String(value).trim()) };
    } catch {
      return {
        value,
        error: `Expected bigint for ${column || 'column'}, received "${value}"`,
      };
    }
  }

  if (/\b(smallint|integer|int2|int4|serial|int)\b/.test(normalizedType)) {
    const number = Number(value);

    return Number.isSafeInteger(number)
      ? { value: number }
      : {
          value,
          error: `Expected integer for ${column || 'column'}, received "${value}"`,
        };
  }

  if (/(real|double precision|numeric|decimal|float)/.test(normalizedType)) {
    const number = Number(value);

    return Number.isFinite(number)
      ? { value: number }
      : {
          value,
          error: `Expected number for ${column || 'column'}, received "${value}"`,
        };
  }

  if (
    normalizedType.includes('timestamp') ||
    normalizedType === 'date' ||
    normalizedType.includes('time')
  ) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? { value, error: `Invalid date/time for ${column || 'column'}` }
        : { value };
    }

    const date = toDate(value);

    return Number.isNaN(date.getTime())
      ? {
          value,
          error: `Invalid date/time for ${column || 'column'}: "${value}"`,
        }
      : { value: date };
  }

  if (normalizedType === 'json' || normalizedType === 'jsonb') {
    if (typeof value === 'string') {
      try {
        return { value: JSON.parse(value) };
      } catch {
        return { value, error: `Invalid JSON for ${column || 'column'}` };
      }
    }
    return { value };
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    return { value: JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v) };
  }

  // PostgreSQL rejects NUL bytes in text columns.
  return { value: String(value).replace(/\u0000/g, '') };
}

async function getMeta(table: string): Promise<ColumnMeta[]> {
  assertTable(table);
  return await getTableColumns(table) as ColumnMeta[];
}

function primaryKeyColumns(columns: ColumnMeta[]): string[] {
  return columns
    .filter(column => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(column => column.name);
}


function isRequired(column: ColumnMeta): boolean {
  const required = column.notnull === true || Number(column.notnull) === 1;
  const hasDefault = column.default !== undefined && column.default !== null;
  const isPrimaryKey = Number(column.pk) > 0;

  return required && !hasDefault && !isPrimaryKey;
}

function validateRequiredColumns(
  table: string,
  record: Record<string, any>,
  columns: ColumnMeta[],
): void {
  const missing: string[] = [];

  for (const column of columns.filter(isRequired)) {
    if (!isEmpty(record[column.name])) continue;

    // SQLite let NULL/'' through; PostgreSQL NOT NULL text columns accept ''.
    if (/char|text/i.test(String(column.type))) {
      record[column.name] = '';
      continue;
    }

    missing.push(column.name);
  }

  if (missing.length) {
    throw new Error(
      `${table}: missing required destination column(s): ${missing.join(', ')}`,
    );
  }
}

function normalizeGpsRecord(
  table: string,
  record: Record<string, any>,
  sourceRow: Record<string, any>,
  allowed: Set<string>,
): Record<string, any> {
  if (table !== 'gps_history') return record;

  // Coordinate aliases are applied only when the destination field has not
  // already been explicitly mapped.
  if (isEmpty(record.latitude) && allowed.has('latitude')) {
    for (const alias of ['lat', 'gps_lat', 'gps_latitude']) {
      if (!isEmpty(sourceRow[alias])) {
        record.latitude = sourceRow[alias];
        break;
      }
    }
  }

  if (isEmpty(record.longitude) && allowed.has('longitude')) {
    for (const alias of ['lng', 'lon', 'long', 'gps_lng', 'gps_longitude']) {
      if (!isEmpty(sourceRow[alias])) {
        record.longitude = sourceRow[alias];
        break;
      }
    }
  }

  // The project's BTS coordinate format is latitude on line 1 and longitude
  // on line 2. Do not swap these values.
  if (
    (isEmpty(record.latitude) || isEmpty(record.longitude)) &&
    !isEmpty(sourceRow.bts_location)
  ) {
    const parsed = parseCoordinates(sourceRow.bts_location, undefined, 'LAT_LNG');

    if (!parsed.isValid) {
      throw new Error(`Invalid bts_location: ${parsed.error}`);
    }

    if (isEmpty(record.latitude)) record.latitude = parsed.latitude;
    if (isEmpty(record.longitude)) record.longitude = parsed.longitude;
  }

  for (const coordinate of ['latitude', 'longitude']) {
    if (!allowed.has(coordinate)) continue;

    const converted = coerceValueForColumn(
      record[coordinate],
      'double precision',
      coordinate,
    );

    if (converted.error || isEmpty(converted.value)) {
      throw new Error(
        converted.error || `GPS ${coordinate} is required`,
      );
    }

    record[coordinate] = converted.value;
  }

  if (
    Number(record.latitude) < -90 ||
    Number(record.latitude) > 90
  ) {
    throw new Error(`GPS latitude ${record.latitude} is outside [-90, 90]`);
  }

  if (
    Number(record.longitude) < -180 ||
    Number(record.longitude) > 180
  ) {
    throw new Error(`GPS longitude ${record.longitude} is outside [-180, 180]`);
  }

  return record;
}

async function findExisting(
  tx: any,
  table: string,
  keys: string[],
  record: Record<string, any>,
): Promise<any | null> {
  if (!keys.length || keys.some(key => isEmpty(record[key]))) return null;

  const where = keys
    .map((key, index) => `${quoteIdent(key)} = $${index + 1}`)
    .join(' AND ');

  const values = keys.map(key => record[key]);

  const rows = await tx.$queryRawUnsafe(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1`,
    ...values,
  );

  return rows[0] ?? null;
}

async function insertRow(
  tx: any,
  table: string,
  record: Record<string, any>,
): Promise<any> {
  const columns = Object.keys(record).filter(key => !key.startsWith('__'));

  if (!columns.length) {
    throw new Error(`No mapped columns available for ${table}`);
  }

  const values = columns.map(column => record[column]);
  const sqlColumns = columns.map(quoteIdent).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

  const rows = await tx.$queryRawUnsafe(
    `INSERT INTO ${quoteIdent(table)} (${sqlColumns}) VALUES (${placeholders}) RETURNING *`,
    ...values,
  );

  return rows[0];
}

async function updateRow(
  tx: any,
  table: string,
  existing: Record<string, any>,
  record: Record<string, any>,
  keys: string[],
): Promise<any> {
  const columns = Object.keys(record).filter(
    key => !keys.includes(key) && !key.startsWith('__'),
  );

  if (!columns.length) return existing;

  const values = columns.map(column => record[column]);
  const whereValues = keys.map(key => existing[key]);

  const setSql = columns
    .map((column, index) => `${quoteIdent(column)} = $${index + 1}`)
    .join(', ');

  const whereSql = keys
    .map((key, index) => `${quoteIdent(key)} = $${columns.length + index + 1}`)
    .join(' AND ');

  const rows = await tx.$queryRawUnsafe(
    `UPDATE ${quoteIdent(table)} SET ${setSql} WHERE ${whereSql} RETURNING *`,
    ...values,
    ...whereValues,
  );

  return rows[0] ?? existing;
}

async function recordChange(
  tx: any,
  batchId: string,
  table: string,
  operation: 'INSERT' | 'UPDATE',
  before: any,
  after: any,
  keyColumns: string[],
): Promise<void> {
  const row = after ?? before;
  const primaryKeys = keyColumns.length ? keyColumns : ['id'];

  const recordId = JSON.stringify(
    Object.fromEntries(
      primaryKeys.map(key => [key, jsonSafe(row?.[key])]),
    ),
  );

  await tx.importChange.create({
    data: {
      batchId,
      tableName: table,
      recordId,
      operation,
      beforeData: before ? jsonSafe(before) : undefined,
      afterData: after ? jsonSafe(after) : undefined,
    },
  });
}

async function createBatch(
  batchId: string,
  filename: string,
  fileType: string,
  table: string,
  mode: string,
  matchKey: string,
  total: number,
  userId?: number,
  targetDb: any = db,
): Promise<void> {
  await targetDb.importBatch.create({
    data: {
      batchId,
      filename,
      fileType,
      destinationTable: table,
      importMode: mode,
      matchKey,
      totalProcessed: total,
      status: 'IN_PROGRESS',
      undoStatus: 'NOT_UNDONE',
      userId: userId ?? null,
    },
  });
}

async function updateBatch(
  batchId: string,
  counts: any,
  errors: string[],
  targetDb: any = db,
): Promise<void> {
  await targetDb.importBatch.update({
    where: { batchId },
    data: {
      insertedCount: counts.inserted ?? 0,
      updatedCount: counts.updated ?? 0,
      skippedCount: counts.skipped ?? 0,
      errorCount: counts.errors ?? 0,
      errorLog: errors.slice(0, 100).join('\n'),
      status: counts.errors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      completedAt: new Date(),
    },
  });
}

async function writeImportHistory(data: any, targetDb: any = db): Promise<void> {
  try {
    await targetDb.importHistory.create({ data });
  } catch (error) {
    console.error('Could not write ImportHistory:', error);
  }
}

async function writeAudit(data: any, targetDb: any = db): Promise<void> {
  try {
    await targetDb.auditLog.create({ data });
  } catch (error) {
    console.error('Could not write AuditLog:', error);
  }
}

function registerIdMapping(
  store: IdMapStore,
  table: string,
  sourceId: any,
  destinationId: any,
): void {
  if (isEmpty(sourceId) || isEmpty(destinationId)) return;

  if (!store.has(table)) store.set(table, new Map());
  store.get(table)!.set(sourceId, destinationId);
}

async function discoverForeignKeys(
  table: string,
  targetDb: any = db,
): Promise<any[]> {
  assertTable(table);

  return targetDb.$queryRawUnsafe(`
    SELECT
      kcu.column_name AS column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
     AND tc.table_name = kcu.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_schema = current_schema()
      AND tc.table_name = $1
    ORDER BY kcu.ordinal_position
  `, table);
}
function defaultMatchKeys(table: string, columns: ColumnMeta[]): string[] {
  if (table === 'missions') return ['mission'];
  if (table === 'plmn_storage') return ['mcc', 'mnc'];
  if (table === 'tac_numbers') return ['tac'];
  if (table === 'wifi_access_points') return ['bssid'];

  // A generated primary key is not a safe cross-database match key.
  // Composite primary keys may still be legitimate natural keys.
  const pk = primaryKeyColumns(columns);
  if (pk.length > 1) return pk;

  return [];
}

function matchKeysFor(
  table: string,
  columns: ColumnMeta[],
  requested?: string,
): string[] {
  if (table === 'missions') return requested && requested !== 'id' ? [requested] : ['mission'];
  if (table === 'plmn_storage') return ['mcc', 'mnc'];

  if (requested) {
    // 'id' is allowed: the source row's id is matched against the destination id.

    if (!columns.some(column => column.name === requested)) {
      throw new Error(`Unknown match key "${requested}" for ${table}`);
    }

    return [requested];
  }

  return defaultMatchKeys(table, columns);
}
function keyString(keys: string[], source: Record<string, any>): string {
  return JSON.stringify(
    keys.map(key => {
      const value = source[key];
      return value instanceof Date ? value.toISOString() : String(value);
    }),
  );
}

const normalizeForCompare = (value: unknown): string => {
  if (value === null || value === undefined) return '\u0000null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(jsonSafe(value));
  return String(value);
};

// Only the fields whose value really changes; null when the row is identical.
function changedFields(
  existing: Record<string, any>,
  record: Record<string, any>,
  keys: string[],
): Record<string, any> | null {
  const patch: Record<string, any> = {};

  for (const [column, value] of Object.entries(record)) {
    if (column.startsWith('__') || keys.includes(column) || value === undefined) continue;
    if (normalizeForCompare(existing[column]) !== normalizeForCompare(value)) patch[column] = value;
  }

  return Object.keys(patch).length ? patch : null;
}

// One query per chunk instead of one query per row.
async function findExistingBatch(
  client: any,
  table: string,
  keys: string[],
  records: Record<string, any>[],
): Promise<Map<string, any>> {
  const found = new Map<string, any>();
  const candidates = records.filter(r => keys.length && keys.every(k => !isEmpty(r[k])));
  const size = Math.max(1, Math.floor(30000 / Math.max(keys.length, 1)));

  for (let i = 0; i < candidates.length; i += size) {
    const params: unknown[] = [];

    const tuples = candidates
      .slice(i, i + size)
      .map(record =>
        '(' + keys.map(key => { params.push(record[key]); return `$${params.length}`; }).join(', ') + ')',
      )
      .join(', ');

    const rows: any[] = await client.$queryRawUnsafe(
      `SELECT * FROM ${quoteIdent(table)} WHERE (${keys.map(quoteIdent).join(', ')}) IN (${tuples})`,
      ...params,
    );

    for (const row of rows) found.set(keyString(keys, row), row);
  }

  return found;
}

// UPDATE ... FROM (VALUES ...) : many rows in one statement.
async function bulkUpdate(
  tx: any,
  table: string,
  keys: string[],
  columnsMeta: ColumnMeta[],
  items: Array<{ existing: Record<string, any>; patch: Record<string, any> }>,
): Promise<void> {
  const setColumns = Object.keys(items[0].patch);
  const allColumns = [...keys, ...setColumns];
  const meta = new Map(columnsMeta.map(column => [column.name, column]));

  const castOf = (column: string): string => {
    const udt = String(meta.get(column)?.udt ?? 'text');
    if (['varchar', 'bpchar', 'name', 'citext', 'uuid'].includes(udt)) return 'text';
    return /^[a-z0-9_]+$/.test(udt) ? udt : 'text';
  };

  const size = Math.max(1, Math.floor(60000 / allColumns.length));

  for (let offset = 0; offset < items.length; offset += size) {
    const params: unknown[] = [];

    const valuesSql = items
      .slice(offset, offset + size)
      .map(({ existing, patch }) =>
        '(' + allColumns.map(column => {
          const value = keys.includes(column) ? existing[column] : patch[column];
          const cast = castOf(column);

          if (value === null || value === undefined) return `NULL::${cast}`;

          if (cast === 'json' || cast === 'jsonb') {
            params.push(typeof value === 'string' ? value : JSON.stringify(jsonSafe(value)));
            return `$${params.length}::text::${cast}`;
          }

          params.push(value);
          return `$${params.length}::${cast}`;
        }).join(', ') + ')',
      )
      .join(', ');

    await tx.$executeRawUnsafe(
      `UPDATE ${quoteIdent(table)} AS t SET ${setColumns.map(c => `${quoteIdent(c)} = v.${quoteIdent(c)}`).join(', ')} ` +
      `FROM (VALUES ${valuesSql}) AS v(${allColumns.map(quoteIdent).join(', ')}) ` +
      `WHERE ${keys.map(k => `t.${quoteIdent(k)} = v.${quoteIdent(k)}`).join(' AND ')}`,
      ...params,
    );
  }
}

async function importMappedRows(args: {
  table: string;
  rows: Record<string, any>[];
  columns: ColumnMeta[];
  mode: 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE';
  matchKeys: string[];
  batchId: string;
  sourceTable?: string;
  idMaps?: IdMapStore;
  targetDb?: any;
  shouldCancel?: () => boolean;
  onProgress?: (counts: { inserted: number; updated: number; skipped: number; errors: number }) => void;
}) {
  const {
    table,
    rows,
    columns,
    mode,
    matchKeys,
    batchId,
    targetDb = db,
  } = args;

  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const errors: string[] = [];
  const pk = primaryKeyColumns(columns);
  const idMap = args.idMaps ?? new Map<string, Map<any, any>>();
  const matchById = matchKeys.length === 1 && matchKeys[0] === 'id';
  const hasSerialId = pk.length === 1 && pk[0] === 'id';
  const keyColumns = pk.length ? pk : ['id'];

  if (mode === 'UPDATE_EXISTING' && matchKeys.length === 0) {
    return {
      inserted: 0,
      updated: 0,
      skipped: rows.length,
      errors: 1,
      errorLog: [
        `${table}: "update only" needs a match key and none exists for this table, so ${rows.length} row(s) were skipped. ` +
        'Choose a match key (or use "skip"/"replace" to insert new rows).',
      ],
    };
  }

  const foreignKeys = await discoverForeignKeys(table, targetDb);
  const missionLabelCache = new Map<string, any[]>();
  const report = () => args.onProgress?.({ ...counts });
  const addError = (index: number, message: string) => {
    counts.errors++;
    if (errors.length < 100) errors.push(`Row ${index + 1}: ${message}`);
  };

  // Source row -> destination-ready record (FK remap, mission label lookup).
  const prepare = async (input: Record<string, any>) => {
    const sourceId = input.id;
    const record: Record<string, any> = {};

    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith('__')) continue;
      if (!columns.some(column => column.name === key)) continue;
      record[key] = value;
    }

    // Generated ids are never copied, except when matching by id (upsert).
    if (hasSerialId && !matchById) delete record.id;

    for (const fk of foreignKeys) {
      const column = fk.column;
      const parentTable = fk.parent_table;

      if (isEmpty(record[column])) continue;

      // A child of a table imported in this job MUST point at its new id;
      // keeping the old SQLite id would silently link an unrelated row.
      const parentMap = idMap.get(parentTable);

      if (parentMap) {
        const mappedId = parentMap.get(record[column]);

        if (mappedId === undefined) {
          throw new Error(
            `${column} = ${record[column]} refers to a ${parentTable} row that was not imported`,
          );
        }

        record[column] = mappedId;
      }
    }

    if (
      table !== 'missions' &&
      columns.some(column => column.name === 'mission_id') &&
      isEmpty(record.mission_id) &&
      !isEmpty(record.mission)
    ) {
      const label = String(record.mission);
      let matches = missionLabelCache.get(label);

      if (!matches) {
        matches = await targetDb.$queryRaw`
          SELECT id FROM missions WHERE mission = ${label} ORDER BY id
        ` as any[];
        missionLabelCache.set(label, matches);
      }

      if (matches.length === 1) {
        record.mission_id = matches[0].id;
      } else if (matches.length > 1) {
        throw new Error(
          `Mission label "${label}" is ambiguous. Provide mission_id in the source data.`,
        );
      }
    }

    return { record, sourceId };
  };

  type Item = { record: Record<string, any>; sourceId: any; index: number };

  const mapId = (sourceId: any, destinationRow: any) => {
    if (hasSerialId) registerIdMapping(idMap, table, sourceId, destinationRow?.id);
  };

  // Safe single-row path, used only to isolate a failing row inside a chunk.
  const processOne = async (item: Item) => {
    try {
      const outcome = await runInTransaction(targetDb, async (tx: any) => {
        const existing = await findExisting(tx, table, matchKeys, item.record);

        if (existing && mode === 'INSERT_ONLY') return { operation: 'SKIPPED', row: existing };
        if (!existing && mode === 'UPDATE_EXISTING') return { operation: 'SKIPPED', row: null };

        if (existing) {
          const updated = await updateRow(tx, table, existing, item.record, matchKeys);
          await recordChange(tx, batchId, table, 'UPDATE', existing, updated, keyColumns);
          return { operation: 'UPDATE', row: updated };
        }

        const inserted = await insertRow(tx, table, item.record);
        await recordChange(tx, batchId, table, 'INSERT', null, inserted, keyColumns);
        return { operation: 'INSERT', row: inserted };
      });

      if (outcome.operation === 'SKIPPED') counts.skipped++;
      else if (outcome.operation === 'UPDATE') counts.updated++;
      else counts.inserted++;

      if (outcome.row) mapId(item.sourceId, outcome.row);
    } catch (error: any) {
      addError(item.index, error?.message ?? String(error));
    }
  };

  // 1. Prepare every row (cheap, in memory).
  const prepared: Item[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (args.shouldCancel?.()) break;
    if (i % 500 === 0) await new Promise(resolve => setImmediate(resolve));

    try {
      prepared.push({ ...(await prepare(rows[i])), index: i });
    } catch (error: any) {
      addError(i, error?.message ?? String(error));
    }
  }

  // 2. Write chunk by chunk: one lookup, bulk INSERT, updates and the undo log
  //    all inside a single transaction per chunk.
  let cursor = 0;

  while (cursor < prepared.length) {
    if (args.shouldCancel?.()) break;

    const wide = new Set<string>();
    prepared.slice(cursor, cursor + 500).forEach(item =>
      Object.keys(item.record).forEach(key => { if (!key.startsWith('__')) wide.add(key); }),
    );

    // PostgreSQL allows at most 65,535 bind parameters per statement.
    const size = Math.max(1, Math.min(500, Math.floor(60000 / Math.max(wide.size, 1))));
    const chunk = prepared.slice(cursor, cursor + size);
    cursor += chunk.length;

    try {
      const delta = { inserted: 0, updated: 0, skipped: 0 };
      const idPairs: Array<[any, any]> = [];

      await runInTransaction(targetDb, async (tx: any) => {
        const existingMap = matchKeys.length
          ? await findExistingBatch(tx, table, matchKeys, chunk.map(item => item.record))
          : new Map<string, any>();

        const changes: any[] = [];
        let queue: Item[] = [];
        const queued = new Set<string>();

        const flush = async () => {
          if (!queue.length) return;

          const cols = [...new Set(queue.flatMap(item =>
            Object.keys(item.record).filter(key => !key.startsWith('__')),
          ))];

          if (!cols.length) throw new Error(`No mapped columns available for ${table}`);

          const params: unknown[] = [];

          const valuesSql = queue
            .map(item =>
              '(' + cols.map(col => {
                const value = item.record[col];
                if (value === undefined) return 'DEFAULT';
                params.push(value);
                return `$${params.length}`;
              }).join(', ') + ')',
            )
            .join(', ');

          const inserted: any[] = await tx.$queryRawUnsafe(
            `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES ${valuesSql} RETURNING *`,
            ...params,
          );

          inserted.forEach((row, position) => {
            const item = queue[position];
            const key = Object.fromEntries(keyColumns.map(k => [k, jsonSafe(row[k])]));

            // Undo only needs the primary key of an inserted row.
            changes.push({
              batchId,
              tableName: table,
              recordId: JSON.stringify(key),
              operation: 'INSERT',
              afterData: key,
            });

            idPairs.push([item.sourceId, row]);
            if (matchKeys.length && matchKeys.every(k => !isEmpty(item.record[k]))) {
              existingMap.set(keyString(matchKeys, item.record), row);
            }
          });

          delta.inserted += inserted.length;
          queue = [];
          queued.clear();
        };

        const pendingUpdates: Array<{ existing: any; patch: Record<string, any>; ks: string }> = [];
        const pendingKeys = new Set<string>();

        const flushUpdates = async () => {
          if (!pendingUpdates.length) return;

          // Rows that update the same set of columns share one statement.
          const groups = new Map<string, typeof pendingUpdates>();

          for (const update of pendingUpdates) {
            const signature = Object.keys(update.patch).sort().join(',');
            const group = groups.get(signature) ?? [];
            group.push(update);
            groups.set(signature, group);
          }

          for (const group of groups.values()) {
            await bulkUpdate(tx, table, matchKeys, columns, group);
          }

          for (const { existing, patch, ks } of pendingUpdates) {
            changes.push({
              batchId,
              tableName: table,
              recordId: JSON.stringify(Object.fromEntries(keyColumns.map(k => [k, jsonSafe(existing[k])]))),
              operation: 'UPDATE',
              beforeData: jsonSafe(existing),
              afterData: jsonSafe({ ...existing, ...patch }),
            });

            existingMap.set(ks, { ...existing, ...patch });
          }

          pendingUpdates.length = 0;
          pendingKeys.clear();
        };

        for (const item of chunk) {
          const hasKey = matchKeys.length > 0 && matchKeys.every(k => !isEmpty(item.record[k]));
          const ks = hasKey ? keyString(matchKeys, item.record) : null;

          // Same key twice in the file: write what is queued so this row sees it.
          if (ks && queued.has(ks)) await flush();

          const existing = ks ? existingMap.get(ks) : null;

          if (existing && mode === 'INSERT_ONLY') {
            delta.skipped++;
            idPairs.push([item.sourceId, existing]);
            continue;
          }

          if (!existing && mode === 'UPDATE_EXISTING') {
            delta.skipped++;
            continue;
          }

          if (existing) {
            idPairs.push([item.sourceId, existing]);

            const patch = changedFields(existing, item.record, matchKeys);

            // Identical row: nothing to write.
            if (!patch) {
              delta.skipped++;
              continue;
            }

            if (pendingKeys.has(ks!)) await flushUpdates();

            pendingUpdates.push({ existing, patch, ks: ks! });
            pendingKeys.add(ks!);
            delta.updated++;
            continue;
          }

          queue.push(item);
          if (ks) queued.add(ks);
        }

        await flush();
        await flushUpdates();

        if (changes.length) await tx.importChange.createMany({ data: changes });
      });

      counts.inserted += delta.inserted;
      counts.updated += delta.updated;
      counts.skipped += delta.skipped;
      idPairs.forEach(([sourceId, row]) => mapId(sourceId, row));
    } catch {
      // Isolate the bad row(s): redo this chunk one row at a time.
      for (const item of chunk) {
        if (args.shouldCancel?.()) break;
        await processOne(item);
      }
    }

    report();
  }

  // Rows were inserted with explicit ids, so move the serial sequence past them.
  if (matchById && counts.inserted > 0) {
    try {
      await targetDb.$queryRawUnsafe(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1))`,
        table,
      );
    } catch (error: any) {
      errors.push(`Could not resync id sequence for ${table}: ${error?.message ?? error}`);
    }
  }

  return { ...counts, errors: counts.errors, errorLog: errors };
}

export async function estimateMultiSqliteImport(
  filePath: string,
  tableConfigs: MultiSqliteTableConfig[],
  targetDb: any = db,
) {
  const sqlite = new DatabaseSync(filePath, { readOnly: true });

  try {
    const estimates = [];

    for (const config of topoSortTables(tableConfigs)) {
      assertTable(config.destinationTable);

      const columns = await getMeta(config.destinationTable);
      const columnMap = new Map(columns.map(column => [column.name, column]));
      const sourceRows = sqliteRows(sqlite, config.sourceTable);
      const keys = matchKeysFor(
        config.destinationTable,
        columns,
        config.matchKey,
      );

      const requiredMissing = columns
        .filter(isRequired)
        .filter(column =>
          !Object.values(config.columnMapping).includes(column.name),
        )
        .map(column => column.name);

      const valid: Record<string, any>[] = [];
      let estimatedInsert = 0;
      let estimatedUpdate = 0;
      let estimatedSkip = 0;
      let estimatedErrors = 0;

      const sampleErrors: string[] = [];

      for (let index = 0; index < sourceRows.length; index++) {
        const sourceRow = sourceRows[index];
        const mapped: Record<string, any> = {};
        let invalid = false;

        for (const [sourceColumn, destinationColumn] of Object.entries(
          config.columnMapping,
        )) {
          const meta = columnMap.get(destinationColumn);

          if (!meta || !(sourceColumn in sourceRow)) continue;

          const converted = coerceValueForColumn(
            sourceRow[sourceColumn],
            meta.type,
            destinationColumn,
          );

          if (converted.error) {
            invalid = true;
            if (sampleErrors.length < 10) {
              sampleErrors.push(`Row ${index + 1}: ${converted.error}`);
            }
          } else if (converted.value !== null) {
            mapped[destinationColumn] = converted.value;
          }
        }

        try {
          normalizeGpsRecord(
            config.destinationTable,
            mapped,
            sourceRow,
            new Set(columns.map(column => column.name)),
          );
          validateRequiredColumns(config.destinationTable, mapped, columns);
        } catch (error: any) {
          invalid = true;
          if (sampleErrors.length < 10) {
            sampleErrors.push(`Row ${index + 1}: ${error.message}`);
          }
        }

        if (invalid) {
          estimatedErrors++;
          continue;
        }

        valid.push(mapped);
      }

      const existingKeys = await findExistingBatch(targetDb, config.destinationTable, keys, valid);

      for (const mapped of valid) {
        const hasKey = keys.length > 0 && keys.every(key => !isEmpty(mapped[key]));
        const exists = hasKey && existingKeys.has(keyString(keys, mapped));

        if (exists) {
          if (config.conflictMode === 'skip') estimatedSkip++;
          else estimatedUpdate++;
        } else if (config.conflictMode === 'update') {
          estimatedSkip++;
        } else {
          estimatedInsert++;
        }
      }

      estimates.push({
        sourceTable: config.sourceTable,
        destinationTable: config.destinationTable,
        dependencyOrder: getDependencyOrder(config.destinationTable),
        totalRows: sourceRows.length,
        estimatedInsert,
        estimatedUpdate,
        estimatedSkip,
        estimatedErrors,
        requiredMissing,
        sampleErrors,
      });
    }

    return { estimates };
  } finally {
    sqlite.close();
  }
}

export interface MultiImportJobProgress {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  totalTables: number;
  completedTables: number;
  currentTable: string | null;
  tableResults: Array<{
    sourceTable: string;
    destinationTable: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    ambiguousMissionCount: number;
    errorLog: string[];
  }>;
  error?: string;
}

const multiImportJobs = new Map<string, MultiImportJobProgress>();
const cancelledImportJobs = new Set<string>();

export function getMultiImportProgress(
  jobId: string,
): MultiImportJobProgress | null {
  return multiImportJobs.get(jobId) ?? null;
}

export function cancelMultiSqliteImport(jobId: string): boolean {
  const progress = multiImportJobs.get(jobId);
  if (!progress) return false;

  cancelledImportJobs.add(jobId);

  if (progress.status === 'PENDING' || progress.status === 'RUNNING') {
    progress.status = 'CANCELLED';
  }

  return true;
}

function topoSortTables(
  configs: MultiSqliteTableConfig[],
): MultiSqliteTableConfig[] {
  const byName = new Map(configs.map(config => [config.destinationTable, config]));
  const names = configs.map(config => config.destinationTable);

  const parents: Record<string, string[]> = {
    mission_extras: ['missions'],
    location_extras: ['missions'],
    targets: ['missions'],
    map_cell_databases: ['missions'],
    wifi_access_points: ['missions'],
    registrations: ['missions'],
    network_cells: ['missions'],
    gps_history: ['missions'],
    sms_calls: ['missions'],
    map_user_markers: ['missions'],
    map_user_polygons: ['missions'],
    map_user_circles: ['missions'],
    mission_files: ['mission_extras'],
    location_files: ['location_extras'],
    target_files: ['targets'],
    map_cells: ['map_cell_databases'],
    wifi_access_point_clients: ['wifi_access_points'],
  };

  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular table dependency detected at ${name}`);
    }

    visiting.add(name);

    for (const parent of parents[name] ?? []) {
      if (names.includes(parent)) visit(parent);
    }

    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  [...names]
    .sort((a, b) => getDependencyOrder(a) - getDependencyOrder(b))
    .forEach(visit);

  return ordered
    .map(name => byName.get(name)!)
    .filter(Boolean);
}

async function importMissionRows(
  rows: Record<string, any>[],
  mapping: Record<string, string>,
  mode: 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE',
  batchId: string,
  idMaps: IdMapStore,
  targetDb: any = db,
  shouldCancel?: () => boolean,
) {
  const columns = await getMeta('missions');
  const allowed = new Set(columns.map(column => column.name));
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const errorLog: string[] = [];
  const primaryKeys = primaryKeyColumns(columns);

  for (let index = 0; index < rows.length; index++) {
    if (shouldCancel?.()) break;

    const sourceRow = rows[index];

    try {
      const record: Record<string, any> = {};

      for (const [sourceColumn, destinationColumn] of Object.entries(mapping)) {
        if (!allowed.has(destinationColumn)) continue;
        if (!(sourceColumn in sourceRow)) continue;

        const meta = columns.find(column => column.name === destinationColumn)!;
        const converted = coerceValueForColumn(
          sourceRow[sourceColumn],
          meta.type,
          destinationColumn,
        );

        if (converted.error) throw new Error(converted.error);
        if (converted.value !== null) record[destinationColumn] = converted.value;
      }

      // Do not silently invent mission values. These are required fields in
      // the current Prisma schema and must be mapped from the source.
      validateRequiredColumns('missions', record, columns);

      const sourceId = sourceRow.id;

      await runInTransaction(targetDb, async (tx: any) => {
        let existing: any = null;

        // Existing behavior: mission ID is the only identity used for matching.
        // Never use mission label or location because labels may be duplicated.
        if (!isEmpty(sourceId)) {
          const sourceNumericId = Number(sourceId);

          if (!Number.isSafeInteger(sourceNumericId)) {
            throw new Error(`Invalid source mission ID: ${sourceId}`);
          }

          const found = await tx.$queryRaw`
            SELECT * FROM missions WHERE id = ${sourceNumericId} LIMIT 1
          `;

          existing = found[0] ?? null;

          // A matching numeric ID in a different database is not proof of the
          // same mission: the ID may already belong to an unrelated one.
          if (
            existing &&
            ((record.mission !== undefined && existing.mission !== record.mission) ||
              (record.location !== undefined && existing.location !== record.location))
          ) {
            existing = null;
          }
        }

        if (existing && mode === 'INSERT_ONLY') {
          counts.skipped++;
          registerIdMapping(idMaps, 'missions', sourceId, existing.id);
          return;
        }

        if (!existing && mode === 'UPDATE_EXISTING') {
          counts.skipped++;
          return;
        }

        if (existing) {
          const updated = await updateRow(
            tx,
            'missions',
            existing,
            record,
            ['id'],
          );

          await recordChange(
            tx,
            batchId,
            'missions',
            'UPDATE',
            existing,
            updated,
            primaryKeys.length ? primaryKeys : ['id'],
          );

          counts.updated++;
          registerIdMapping(idMaps, 'missions', sourceId, updated.id);
        } else {
          // Destination PostgreSQL allocates its own primary key.
          delete record.id;

          const inserted = await insertRow(tx, 'missions', record);

          await recordChange(
            tx,
            batchId,
            'missions',
            'INSERT',
            null,
            inserted,
            primaryKeys.length ? primaryKeys : ['id'],
          );

          counts.inserted++;
          registerIdMapping(idMaps, 'missions', sourceId, inserted.id);
        }
      });
    } catch (error: any) {
      counts.errors++;

      if (errorLog.length < 100) {
        errorLog.push(`Row ${index + 1}: ${error?.message ?? String(error)}`);
      }
    }
  }

  return { ...counts, errorLog };
}

export async function executeMultiSqliteImport(
  options: {
    filePath: string;
    originalName: string;
    tables: MultiSqliteTableConfig[];
    userId?: number;
    username?: string;
    jobId?: string;
  },
  targetDb: any = db,
) {
  if (!options.tables.length) {
    throw new Error('No SQLite tables were selected for import');
  }

  const ordered = topoSortTables(options.tables);

  for (const config of ordered) {
    assertTable(config.destinationTable);
  }

  const jobId = options.jobId || `job_${Date.now()}`;

  const progress: MultiImportJobProgress = {
    jobId,
    status: 'RUNNING',
    totalTables: ordered.length,
    completedTables: 0,
    currentTable: null,
    tableResults: ordered.map(config => ({
      sourceTable: config.sourceTable,
      destinationTable: config.destinationTable,
      status: 'PENDING',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      ambiguousMissionCount: 0,
      errorLog: [],
    })),
  };

  multiImportJobs.set(jobId, progress);

  const sqlite = new DatabaseSync(options.filePath, { readOnly: true });
  const idMaps: IdMapStore = new Map();
  const results: MultiImportJobProgress['tableResults'] = [];

  const isCancelled = () => cancelledImportJobs.has(jobId);

  try {
    // Validate every source table before writing anything to PostgreSQL.
    for (const config of ordered) {
      sqliteRows(sqlite, config.sourceTable);
    }

    for (let index = 0; index < ordered.length; index++) {
      if (isCancelled()) {
        progress.status = 'CANCELLED';

        for (let remaining = index; remaining < progress.tableResults.length; remaining++) {
          progress.tableResults[remaining].status = 'CANCELLED';
          results.push({ ...progress.tableResults[remaining] });
        }

        break;
      }

      const config = ordered[index];
      const entry = progress.tableResults[index];

      entry.status = 'RUNNING';
      progress.currentTable = config.sourceTable;

      try {
      const rawRows = sqliteRows(sqlite, config.sourceTable);
      const columns = await getMeta(config.destinationTable);
      const matchKeys = matchKeysFor(
        config.destinationTable,
        columns,
        config.matchKey,
      );

      const mode = mapConflictMode(config.conflictMode);
      const batchId = `batch_${jobId}_${index}_${config.destinationTable}`;

      await createBatch(
        batchId,
        `${options.originalName}::${config.sourceTable}`,
        '.sqlite-multi',
        config.destinationTable,
        mode,
        config.destinationTable === 'missions' ? 'id' : matchKeys.join(','),
        rawRows.length,
        options.userId,
        targetDb,
      );

      let result: any;

      if (config.destinationTable === 'missions') {
        result = await importMissionRows(
          rawRows,
          config.columnMapping,
          mode,
          batchId,
          idMaps,
          targetDb,
          isCancelled,
        );
      } else {
        const mappedRows: Record<string, any>[] = [];
        const preErrors: string[] = [];
        const errorKinds = new Map<string, { count: number; example: string }>();

        // Visible in the progress endpoint while the table is still running.
        entry.errorLog = preErrors;

        const notePre = (message: string) => {
          const kind = message.replace(/^Row \d+: /, '').replace(/-?\d+(\.\d+)?/g, '#');
          const known = errorKinds.get(kind);
          if (known) known.count++;
          else errorKinds.set(kind, { count: 1, example: message });
          if (preErrors.length < 100) preErrors.push(message);
        };

        for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex++) {
          if (isCancelled()) break;

          if (rowIndex % 300 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }

          const sourceRow = rawRows[rowIndex];
          const record: Record<string, any> = {};
          let invalid = false;

          for (const [sourceColumn, destinationColumn] of Object.entries(
            config.columnMapping,
          )) {
            const meta = columns.find(
              column => column.name === destinationColumn,
            );

            if (!meta || !(sourceColumn in sourceRow)) continue;

            const converted = coerceValueForColumn(
              sourceRow[sourceColumn],
              meta.type,
              destinationColumn,
            );

            if (converted.error) {
              invalid = true;

              notePre(`Row ${rowIndex + 1}: ${converted.error}`);
            } else if (converted.value !== null) {
              record[destinationColumn] = converted.value;
            }
          }

          if (invalid) {
            entry.errors++;
            continue;
          }

          try {
            normalizeGpsRecord(
              config.destinationTable,
              record,
              sourceRow,
              new Set(columns.map(column => column.name)),
            );

            // Foreign keys (including mission_id) are remapped exactly once,
            // inside importMappedRows, using the source-ID -> new-ID maps.
            validateRequiredColumns(config.destinationTable, record, columns);
            mappedRows.push(record);
          } catch (error: any) {
            entry.errors++;

            notePre(`Row ${rowIndex + 1}: ${error.message}`);
          }
        }

        if (isCancelled()) {
          entry.status = 'CANCELLED';
          entry.errorLog = [
            ...preErrors,
            'Import cancelled before all rows were processed',
          ].slice(0, 100);

          progress.status = 'CANCELLED';
          results.push({ ...entry });

          for (let remaining = index + 1; remaining < progress.tableResults.length; remaining++) {
            progress.tableResults[remaining].status = 'CANCELLED';
            results.push({ ...progress.tableResults[remaining] });
          }

          break;
        }

        result = await importMappedRows({
          table: config.destinationTable,
          rows: mappedRows,
          columns,
          mode,
          matchKeys,
          batchId,
          idMaps,
          targetDb,
          shouldCancel: isCancelled,
          onProgress: live => {
            entry.inserted = live.inserted;
            entry.updated = live.updated;
            entry.skipped = live.skipped;
          },
        });

        entry.inserted = result.inserted;
        entry.updated = result.updated;
        entry.skipped = result.skipped;
        entry.errors += result.errors;
        entry.ambiguousMissionCount = result.errorLog.filter((e: string) => /ambiguous/i.test(e)).length;
        const summary = [...errorKinds.values()]
          .sort((x, y) => y.count - x.count)
          .slice(0, 10)
          .map(kind => `${kind.count} x ${kind.example}`);

        entry.errorLog = [
          ...(summary.length ? ['--- most common problems ---', ...summary, '--- first rows ---'] : []),
          ...preErrors,
          ...result.errorLog,
        ].slice(0, 120);
      }

      if (config.destinationTable === 'missions') {
        entry.inserted = result.inserted;
        entry.updated = result.updated;
        entry.skipped = result.skipped;
        entry.errors += result.errors;
        entry.errorLog = result.errorLog.slice(0, 100);
      }

      if (isCancelled()) {
        entry.status = 'CANCELLED';
        progress.status = 'CANCELLED';
      } else {
        entry.status = entry.errors > 0 ? 'ERROR' : 'COMPLETED';
      }

      await updateBatch(
        batchId,
        {
          inserted: entry.inserted,
          updated: entry.updated,
          skipped: entry.skipped,
          errors: entry.errors,
        },
        entry.errorLog,
        targetDb,
      );

      await writeImportHistory({
        filename: `${options.originalName}::${config.sourceTable}`,
        fileType: '.sqlite-multi',
        destinationTable: config.destinationTable,
        insertedCount: entry.inserted,
        updatedCount: entry.updated,
        skippedCount: entry.skipped,
        errorCount: entry.errors,
        errorLog: entry.errorLog.join('\n'),
        userId: options.userId ?? null,
      }, targetDb);

      } catch (tableError: any) {
        // A failure in one table must not stop the tables after it.
        entry.status = 'ERROR';
        entry.errors++;
        entry.errorLog = [
          ...entry.errorLog,
          `${config.destinationTable}: ${tableError?.message ?? String(tableError)}`,
        ].slice(0, 100);
        console.error(`Import of ${config.sourceTable} failed:`, tableError);
      }

      progress.completedTables++;
      results.push({ ...entry });

      if (isCancelled()) {
        for (let remaining = index + 1; remaining < progress.tableResults.length; remaining++) {
          progress.tableResults[remaining].status = 'CANCELLED';
          results.push({ ...progress.tableResults[remaining] });
        }
        break;
      }
    }

    const status = isCancelled() ? 'CANCELLED' : 'COMPLETED';

    progress.status = status;
    progress.currentTable = null;
    cancelledImportJobs.delete(jobId);

    await writeAudit({
      username: options.username || 'admin',
      action: status === 'CANCELLED'
        ? 'MULTI_SQLITE_IMPORT_CANCELLED'
        : 'MULTI_SQLITE_IMPORT',
      module: 'import_center',
      recordId: options.originalName,
      ipAddress: '127.0.0.1',
      result: status === 'CANCELLED' ? 'CANCELLED' : 'SUCCESS',
      details:
        `${status}: ${results.length} tables; ` +
        `${results.reduce((sum, row) => sum + row.inserted, 0)} inserted, ` +
        `${results.reduce((sum, row) => sum + row.updated, 0)} updated.`,
    }, targetDb);

    return {
      jobId,
      status,
      tableResults: results,
      totals: {
        inserted: results.reduce((sum, row) => sum + row.inserted, 0),
        updated: results.reduce((sum, row) => sum + row.updated, 0),
        skipped: results.reduce((sum, row) => sum + row.skipped, 0),
        errors: results.reduce((sum, row) => sum + row.errors, 0),
        ambiguousMissions: results.reduce(
          (sum, row) => sum + row.ambiguousMissionCount,
          0,
        ),
      },
    };
  } catch (error: any) {
    progress.status = 'FAILED';
    progress.error = error?.message ?? String(error);
    throw error;
  } finally {
    sqlite.close();
    cancelledImportJobs.delete(jobId);
  }
}

export async function executeImport(options: {
  filePath: string;
  originalName: string;
  destinationTable: string;
  sheetOrTable?: string;
  columnMapping: Record<string, string>;
  importMode: 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE';
  matchKey?: string;
  userId?: number;
  username?: string;
  coordinateConfig?: {
    latCol?: string;
    lngCol?: string;
    combinedCol?: string;
    targetLatCol?: string;
    targetLngCol?: string;
    order?: 'LAT_LNG' | 'LNG_LAT';
  };
}, targetDb: any = db) {
  assertTable(options.destinationTable);

  const ext = options.originalName
    .slice(options.originalName.lastIndexOf('.'))
    .toLowerCase();

  const rawRecords = await readTabularFile(
    options.filePath,
    options.originalName,
    options.sheetOrTable,
  );

  const columns = await getMeta(options.destinationTable);
  const allowed = new Set(columns.map(column => column.name));
  const errors: string[] = [];
  const transformed: Record<string, any>[] = [];

  for (let index = 0; index < rawRecords.length; index++) {
    const row = rawRecords[index];
    const record: Record<string, any> = {};
    let invalid = false;

    for (const [sourceColumn, destinationColumn] of Object.entries(
      options.columnMapping,
    )) {
      const meta = columns.find(
        column => column.name === destinationColumn,
      );

      if (!meta || !(sourceColumn in row)) continue;

      const converted = coerceValueForColumn(
        row[sourceColumn],
        meta.type,
        destinationColumn,
      );

      if (converted.error) {
        invalid = true;

        if (errors.length < 100) {
          errors.push(`Row ${index + 1}: ${converted.error}`);
        }
      } else if (converted.value !== null) {
        record[destinationColumn] = converted.value;
      }
    }

    const coordinateConfig = options.coordinateConfig;

    if (coordinateConfig) {
      let parsed: CoordinateParseResult | null = null;

      if (
        coordinateConfig.combinedCol &&
        !isEmpty(row[coordinateConfig.combinedCol])
      ) {
        parsed = parseCoordinates(
          row[coordinateConfig.combinedCol],
          undefined,
          coordinateConfig.order || 'LAT_LNG',
        );
      } else if (
        coordinateConfig.latCol &&
        coordinateConfig.lngCol &&
        !isEmpty(row[coordinateConfig.latCol]) &&
        !isEmpty(row[coordinateConfig.lngCol])
      ) {
        parsed = parseCoordinates(
          row[coordinateConfig.latCol],
          row[coordinateConfig.lngCol],
          coordinateConfig.order || 'LAT_LNG',
        );
      }

      if (parsed?.isValid) {
        if (
          coordinateConfig.targetLatCol &&
          allowed.has(coordinateConfig.targetLatCol)
        ) {
          record[coordinateConfig.targetLatCol] = parsed.latitude;
        }

        if (
          coordinateConfig.targetLngCol &&
          allowed.has(coordinateConfig.targetLngCol)
        ) {
          record[coordinateConfig.targetLngCol] = parsed.longitude;
        }
      } else if (parsed) {
        invalid = true;

        if (errors.length < 100) {
          errors.push(`Row ${index + 1}: ${parsed.error}`);
        }
      }
    }

    try {
      normalizeGpsRecord(
        options.destinationTable,
        record,
        row,
        allowed,
      );

      validateRequiredColumns(options.destinationTable, record, columns);
    } catch (error: any) {
      invalid = true;

      if (errors.length < 100) {
        errors.push(`Row ${index + 1}: ${error.message}`);
      }
    }

    if (!invalid && Object.keys(record).length) {
      transformed.push(record);
    } else if (!invalid) {
      if (errors.length < 100) {
        errors.push(`Row ${index + 1}: no destination columns were mapped`);
      }
    }
  }

  const batchId =
    `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const keys = matchKeysFor(
    options.destinationTable,
    columns,
    options.matchKey,
  );

  await createBatch(
    batchId,
    options.originalName,
    ext,
    options.destinationTable,
    options.importMode,
    options.destinationTable === 'missions' ? 'id' : keys.join(','),
    rawRecords.length,
    options.userId,
    targetDb,
  );

  let result: any;

  if (options.destinationTable === 'missions') {
    const idMaps: IdMapStore = new Map();

    // Mission import uses the raw source records so it can retain the
    // original source IDs for foreign-key remapping.
    result = await importMissionRows(
      rawRecords,
      options.columnMapping,
      options.importMode,
      batchId,
      idMaps,
      targetDb,
    );
  } else {
    result = await importMappedRows({
      table: options.destinationTable,
      rows: transformed,
      columns,
      mode: options.importMode,
      matchKeys: keys,
      batchId,
      targetDb,
    });
  }

  const combinedErrors = [...errors, ...(result.errorLog || [])];
  const totalErrors = errors.length + result.errors;

  await updateBatch(
    batchId,
    {
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: totalErrors,
    },
    combinedErrors,
    targetDb,
  );

  await writeImportHistory({
    filename: options.originalName,
    fileType: ext,
    destinationTable: options.destinationTable,
    insertedCount: result.inserted,
    updatedCount: result.updated,
    skippedCount: result.skipped,
    errorCount: totalErrors,
    errorLog: combinedErrors.slice(0, 100).join('\n'),
    userId: options.userId ?? null,
  }, targetDb);

  await writeAudit({
    username: options.username || 'admin',
    action: 'DATA_IMPORT',
    module: options.destinationTable,
    recordId: options.originalName,
    ipAddress: '127.0.0.1',
    result: totalErrors ? 'PARTIAL' : 'SUCCESS',
    details:
      `Imported ${result.inserted}, updated ${result.updated}, ` +
      `skipped ${result.skipped}, errors ${totalErrors}.`,
  }, targetDb);

  return {
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    errors: totalErrors,
    errorLog: combinedErrors,
    batchId,
  };
}