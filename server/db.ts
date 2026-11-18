import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { columnLabelAr, columnLabelEn } from './statsLabels.js';

// PostgreSQL BIGINT columns and COUNT()/SUM() results arrive as BigInt, which
// JSON.stringify (and therefore res.json) cannot serialize.
if (!(BigInt.prototype as any).toJSON) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint) {
      const n = Number(this);
      return Number.isSafeInteger(n) ? n : this.toString();
    },
    configurable: true,
    writable: true,
  });
}

// The directory is used only for external SQLite files uploaded for import.
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const MISSION_LINKED_TABLES = [
  { table: 'registrations', labelCol: 'mission' },
  { table: 'targets', labelCol: 'mission' },
  { table: 'mission_extras', labelCol: 'mission_name' },
  { table: 'location_extras', labelCol: 'mission_id' },
  { table: 'network_cells', labelCol: 'mission' },
  { table: 'wifi_access_points', labelCol: 'mission' },
  { table: 'gps_history', labelCol: 'mission' },
  { table: 'map_cell_databases', labelCol: 'mission' },
  { table: 'sms_calls', labelCol: 'mission' },
  { table: 'map_user_markers', labelCol: 'mission' },
  { table: 'map_user_polygons', labelCol: 'mission' },
  { table: 'map_user_circles', labelCol: 'mission' },
] as const;

export async function initDatabase(): Promise<void> {
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await db.$disconnect();
}

function assertIdentifier(value: string, kind: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${kind}: ${value}`);
  }
  return `"${value}"`;
}

async function assertTableExists(tableName: string): Promise<void> {
  assertIdentifier(tableName, 'table name');
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists`;
  if (!rows[0]?.exists) throw new Error(`Unknown public table: ${tableName}`);
}

export type TableFilter = {
  column: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'between' | 'is_empty' | 'is_not_empty';
  value?: unknown;
  value2?: unknown;
  condition?: 'AND' | 'OR';
};

export type QueryOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  mission?: string;
  missionIds?: number[];
  filters?: TableFilter[];
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
};

export type ColumnInfo = {
  name: string;
  type: string;
  udt: string;
  notnull: number;
  pk: number;
  default: string | null;
};

const TEXT_UDTS = new Set(['text', 'varchar', 'bpchar', 'name', 'citext', 'uuid']);
const CASTABLE_UDTS = new Set([
  'int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'bool',
  'date', 'timestamp', 'timestamptz', 'time', 'timetz', 'json', 'jsonb',
]);

/**
 * Prisma sends JS strings as TEXT. PostgreSQL (unlike SQLite) will not accept
 * that for integer / boolean / timestamp columns, which is what breaks filters,
 * record edits and undo after the migration. Casting through ::text lets
 * PostgreSQL parse the string into the real column type.
 */
export function typedPlaceholder(
  info: ColumnInfo | undefined,
  value: unknown,
  bind: (v: unknown) => string,
): string {
  if (!info || value === undefined || value === null) return bind(value ?? null);

  if (TEXT_UDTS.has(info.udt)) {
    if (value instanceof Date) return bind(value.toISOString());
    if (typeof value === 'object') return bind(JSON.stringify(value));
    return bind(String(value));
  }

  if (!CASTABLE_UDTS.has(info.udt)) return bind(value);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return bind(null);
    return `${bind(trimmed)}::text::${info.udt}`;
  }

  if (
    typeof value === 'object' &&
    !(value instanceof Date) &&
    (info.udt === 'json' || info.udt === 'jsonb')
  ) {
    return `${bind(JSON.stringify(value))}::text::${info.udt}`;
  }

  return bind(value);
}

function toRecordId(id: number | string): number {
  const n = typeof id === 'number' ? id : Number(String(id).trim());
  if (!Number.isSafeInteger(n)) throw new Error(`Invalid record ID: ${id}`);
  return n;
}

function requireIdColumn(columns: ColumnInfo[], tableName: string): void {
  if (!columns.some(c => c.name === 'id')) {
    throw new Error(`Table "${tableName}" has no "id" column; it cannot be addressed by ID`);
  }
}

export async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  await assertTableExists(tableName);
  return db.$queryRaw<ColumnInfo[]>`
    SELECT c.column_name AS name,
           c.data_type AS type,
           c.udt_name AS udt,
           CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END::int AS notnull,
           CASE WHEN EXISTS (
             SELECT 1 FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage ku
               ON tc.constraint_name = ku.constraint_name
              AND tc.table_schema = ku.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = c.table_schema
               AND tc.table_name = c.table_name
               AND ku.column_name = c.column_name
           ) THEN 1 ELSE 0 END::int AS pk,
           c.column_default AS "default"
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ${tableName}
    ORDER BY c.ordinal_position`;
}

/**
 * Build the WHERE clause (and its bind parameters) shared by queryTable and
 * getTableStats. Keeping this in one place guarantees that statistics use the
 * exact same mission / search / filter rules as the table itself.
 *
 * Every identifier is validated with assertIdentifier and every value is
 * passed as a bind parameter, so this is safe against SQL injection.
 */
function buildTableWhere(
  tableName: string,
  columns: ColumnInfo[],
  options: QueryOptions,
): { whereSql: string; params: unknown[] } {
  const validCols = new Set(columns.map(c => c.name));
  const colInfo = new Map(columns.map(c => [c.name, c]));
  const params: unknown[] = [];
  const clauses: string[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const typed = (column: string, value: unknown) => typedPlaceholder(colInfo.get(column), value, bind);

  if (options.missionIds?.length) {
    if (tableName === 'missions') clauses.push(`"id" = ANY(${bind(options.missionIds)}::int[])`);
    else if (validCols.has('mission_id')) clauses.push(`"mission_id" = ANY(${bind(options.missionIds)}::int[])`);
  } else if (options.mission && options.mission !== 'ALL') {
    const numericMission = Number(options.mission);
    if (Number.isInteger(numericMission) && numericMission > 0) {
      if (tableName === 'missions') clauses.push(`"id" = ${bind(numericMission)}`);
      else if (validCols.has('mission_id')) clauses.push(`"mission_id" = ${bind(numericMission)}`);
      else if (validCols.has('mission')) clauses.push(`"mission" = ${bind(options.mission)}`);
    } else if (validCols.has('mission')) clauses.push(`"mission" = ${bind(options.mission)}`);
  }

  if (options.search?.trim()) {
    const textColumns = columns.filter(c => /char|text|uuid|name/i.test(c.type));
    if (textColumns.length) {
      const searchParam = bind(`%${options.search.trim()}%`);
      clauses.push(`(${textColumns.map(c => `CAST(${assertIdentifier(c.name, 'column name')} AS TEXT) ILIKE ${searchParam}`).join(' OR ')})`);
    }
  }

  for (const filter of options.filters ?? []) {
    if (!validCols.has(filter.column)) continue;
    const col = assertIdentifier(filter.column, 'column name');
    let expression: string | undefined;
    switch (filter.operator) {
      case 'equals': expression = `${col} = ${typed(filter.column, filter.value)}`; break;
      case 'not_equals': expression = `${col} <> ${typed(filter.column, filter.value)}`; break;
      case 'contains': expression = `CAST(${col} AS TEXT) ILIKE ${bind(`%${String(filter.value ?? '')}%`)}`; break;
      case 'not_contains': expression = `CAST(${col} AS TEXT) NOT ILIKE ${bind(`%${String(filter.value ?? '')}%`)}`; break;
      case 'starts_with': expression = `CAST(${col} AS TEXT) ILIKE ${bind(`${String(filter.value ?? '')}%`)}`; break;
      case 'ends_with': expression = `CAST(${col} AS TEXT) ILIKE ${bind(`%${String(filter.value ?? '')}`)}`; break;
      case 'greater_than': expression = `${col} > ${typed(filter.column, filter.value)}`; break;
      case 'less_than': expression = `${col} < ${typed(filter.column, filter.value)}`; break;
      case 'between': expression = `${col} BETWEEN ${typed(filter.column, filter.value)} AND ${typed(filter.column, filter.value2)}`; break;
      case 'is_empty': expression = `(${col} IS NULL OR CAST(${col} AS TEXT) = '')`; break;
      case 'is_not_empty': expression = `(${col} IS NOT NULL AND CAST(${col} AS TEXT) <> '')`; break;
    }
    if (expression) clauses.push(expression);
  }

  return { whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function queryTable(tableName: string, options: QueryOptions = {}): Promise<{ rows: any[]; total: number; page: number; pageSize: number }> {
  await assertTableExists(tableName);
  const columns = await getTableColumns(tableName);
  const validCols = new Set(columns.map(c => c.name));
  const page = Math.max(1, Math.trunc(Number(options.page) || 1));
  const pageSize = Math.min(10000, Math.max(1, Math.trunc(Number(options.pageSize) || 50)));
  const offset = (page - 1) * pageSize;
  const { whereSql, params } = buildTableWhere(tableName, columns, options);

  // plmn_storage (composite key) and app_settings have no "id" column.
  const pkColumns = columns.filter(c => Number(c.pk) > 0).map(c => c.name);
  const defaultOrder = validCols.has('id') ? 'id' : (pkColumns[0] ?? columns[0]?.name);
  const orderColumn = options.sortBy && validCols.has(options.sortBy)
    ? assertIdentifier(options.sortBy, 'sort column')
    : assertIdentifier(defaultOrder, 'sort column');
  const orderDirection = options.sortOrder === 'ASC' ? 'ASC' : 'DESC';
  const countRows = await db.$queryRawUnsafe<Array<{ total: number }>>(
    `SELECT COUNT(*)::int AS total FROM ${assertIdentifier(tableName, 'table name')} ${whereSql}`,
    ...params,
  );
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT * FROM ${assertIdentifier(tableName, 'table name')} ${whereSql} ORDER BY ${orderColumn} ${orderDirection} LIMIT ${pageSize} OFFSET ${offset}`,
    ...params,
  );
  return { rows, total: Number(countRows[0]?.total ?? 0), page, pageSize };
}

export async function getRecord(tableName: string, id: number | string): Promise<any | null> {
  await assertTableExists(tableName);
  requireIdColumn(await getTableColumns(tableName), tableName);
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT * FROM ${assertIdentifier(tableName, 'table name')} WHERE "id" = $1 LIMIT 1`,
    toRecordId(id),
  );
  return rows[0] ?? null;
}

function prepareWritableColumns(
  columns: ColumnInfo[],
  tableName: string,
  record: Record<string, any>,
): string[] {
  const byName = new Map(columns.map(c => [c.name, c]));
  const unknown = Object.keys(record).filter(k => !byName.has(k));
  if (unknown.length) {
    throw new Error(`Unknown column(s) for "${tableName}": ${unknown.join(', ')}`);
  }
  // Never let a request overwrite generated keys.
  return Object.keys(record).filter(k => {
    const info = byName.get(k)!;
    return !(k === 'id' && info.default);
  });
}

export async function insertRecord(tableName: string, record: Record<string, any>): Promise<any> {
  await assertTableExists(tableName);
  const columns = await getTableColumns(tableName);
  const info = new Map(columns.map(c => [c.name, c]));
  const cols = prepareWritableColumns(columns, tableName, record ?? {});
  if (!cols.length) throw new Error('No fields to insert');

  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const colSql = cols.map(c => assertIdentifier(c, 'column name')).join(', ');
  const valueSql = cols.map(c => typedPlaceholder(info.get(c), record[c], bind)).join(', ');

  const rows = await db.$queryRawUnsafe<any[]>(
    `INSERT INTO ${assertIdentifier(tableName, 'table name')} (${colSql}) VALUES (${valueSql}) RETURNING *`,
    ...params,
  );
  return rows[0] ?? null;
}

export async function updateRecord(tableName: string, id: number | string, record: Record<string, any>): Promise<any | null> {
  await assertTableExists(tableName);
  const columns = await getTableColumns(tableName);
  requireIdColumn(columns, tableName);
  const info = new Map(columns.map(c => [c.name, c]));
  const cols = prepareWritableColumns(columns, tableName, record ?? {}).filter(c => c !== 'id');
  if (!cols.length) return getRecord(tableName, id);

  const params: unknown[] = [];
  const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const setSql = cols
    .map(c => `${assertIdentifier(c, 'column name')} = ${typedPlaceholder(info.get(c), record[c], bind)}`)
    .join(', ');
  const idPlaceholder = bind(toRecordId(id));

  const rows = await db.$queryRawUnsafe<any[]>(
    `UPDATE ${assertIdentifier(tableName, 'table name')} SET ${setSql} WHERE "id" = ${idPlaceholder} RETURNING *`,
    ...params,
  );
  return rows[0] ?? null;
}

export async function deleteRecord(tableName: string, id: number | string): Promise<void> {
  await assertTableExists(tableName);
  requireIdColumn(await getTableColumns(tableName), tableName);
  await db.$executeRawUnsafe(
    `DELETE FROM ${assertIdentifier(tableName, 'table name')} WHERE "id" = $1`,
    toRecordId(id),
  );
}

// Import-batch persistence is intentionally not stubbed as a fake success.
// It must be implemented alongside the import-history schema and importer contract.

export interface TableStatsOptions {
  table: string;
  search?: string;
  mission?: string;
  missionIds?: number[];
  filters?: TableFilter[];
}

export interface TableColumnStats {
  /** Actual PostgreSQL column name from information_schema (snake_case/camelCase as stored). */
  column: string;
  /** Alias of `column`, kept for backwards compatibility with older clients. */
  name: string;
  /** Explicit database column name (never a Prisma model field name). */
  dbName: string;
  /** Human readable English display name derived from `column`. */
  displayName: string;
  /** Human readable Arabic display name derived from `column`. */
  displayNameAr: string;
  /** PostgreSQL data_type (e.g. character varying, integer). */
  type: string;
  /** Alias of `type`. */
  dataType: string;
  /** PostgreSQL internal udt_name (e.g. varchar, int4). */
  udt: string;
  /** Number of rows considered for this column (respects active filters). */
  totalCount: number;
  /** Non-null, non-empty values. */
  nonNullCount: number;
  /** NULL (and empty string, for text columns) values. */
  nullCount: number;
  /** Alias of `nullCount` used by the UI. */
  nullOrEmptyCount: number;
  /** Distinct non-null values. */
  distinctCount: number;
  /** nonNullCount - distinctCount. */
  duplicateCount: number;
  min?: number | null;
  max?: number | null;
  avg?: number | null;
  sum?: number | null;
  minDate?: string | null;
  maxDate?: string | null;
  topValues?: Array<{ value: string; count: number; percentage: number }>;
}

export interface TableStats {
  table: string;
  /** Alias of `table` for report headers. */
  tableName: string;
  totalRecords: number;
  filteredRecords: number;
  columns: TableColumnStats[];
  business?: Record<string, number>;
  /** Metadata used by the report exporters (also handy for the UI). */
  meta: {
    generatedAt: string;
    mission?: string;
    search?: string;
    filters: TableFilter[];
    hasFilters: boolean;
  };
}

/**
 * Get table statistics for the table statistics section in the UI.
 *
 * Returns:
 * - Total records in the table.
 * - Records matching the current search/mission/filter selection.
 * - Null and distinct-value counts for every column.
 */
async function scalarCount(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ c: number | bigint }>>(sql, ...params);
  return Number(rows[0]?.c ?? 0);
}

async function computeBusinessTableStats(table: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    switch (table) {
      case 'missions': {
        out.totalMissions = await scalarCount('SELECT COUNT(*) AS c FROM missions');
        out.uniqueLocations = await scalarCount('SELECT COUNT(DISTINCT location) AS c FROM missions');
        out.missionsWithRegistrations = await scalarCount('SELECT COUNT(DISTINCT mission_id) AS c FROM registrations WHERE mission_id IS NOT NULL');
        out.missionsWithTargets = await scalarCount('SELECT COUNT(DISTINCT mission_id) AS c FROM targets WHERE mission_id IS NOT NULL');
        out.missionsWithNetworkCells = await scalarCount('SELECT COUNT(DISTINCT mission_id) AS c FROM network_cells WHERE mission_id IS NOT NULL');
        break;
      }
      case 'registrations': {
        out.totalRegistrations = await scalarCount('SELECT COUNT(*) AS c FROM registrations');
        out.uniqueImsi = await scalarCount("SELECT COUNT(DISTINCT imsi) AS c FROM registrations WHERE imsi IS NOT NULL AND BTRIM(imsi) <> ''");
        out.uniqueImei = await scalarCount("SELECT COUNT(DISTINCT imei) AS c FROM registrations WHERE imei IS NOT NULL AND BTRIM(imei) <> ''");
        out.countriesRepresented = await scalarCount("SELECT COUNT(DISTINCT country) AS c FROM registrations WHERE country IS NOT NULL AND BTRIM(country) <> ''");
        out.missingBtsLocation = await scalarCount("SELECT COUNT(*) AS c FROM registrations WHERE bts_location IS NULL OR BTRIM(bts_location) = ''");
        out.presentBtsLocation = await scalarCount("SELECT COUNT(*) AS c FROM registrations WHERE bts_location IS NOT NULL AND BTRIM(bts_location) <> ''");
        out.duplicateImsiRecords = Math.max(0, out.totalRegistrations - out.uniqueImsi);
        break;
      }
      case 'targets': {
        out.totalTargets = await scalarCount('SELECT COUNT(*) AS c FROM targets');
        out.uniqueIdentifiers = await scalarCount("SELECT COUNT(DISTINCT name) AS c FROM targets WHERE name IS NOT NULL AND BTRIM(name) <> ''");
        out.targetsWithMissions = await scalarCount('SELECT COUNT(DISTINCT mission_id) AS c FROM targets WHERE mission_id IS NOT NULL');
        out.missingIdentifiers = await scalarCount("SELECT COUNT(*) AS c FROM targets WHERE name IS NULL OR BTRIM(name) = ''");
        break;
      }
      case 'network_cells': {
        out.totalNetworkCells = await scalarCount('SELECT COUNT(*) AS c FROM network_cells');
        out.uniqueCellId = await scalarCount("SELECT COUNT(DISTINCT cell_id) AS c FROM network_cells WHERE cell_id IS NOT NULL AND BTRIM(cell_id) <> ''");
        out.uniqueMcc = await scalarCount("SELECT COUNT(DISTINCT mcc) AS c FROM network_cells WHERE mcc IS NOT NULL AND BTRIM(mcc) <> ''");
        out.uniqueMnc = await scalarCount("SELECT COUNT(DISTINCT mnc) AS c FROM network_cells WHERE mnc IS NOT NULL AND BTRIM(mnc) <> ''");
        out.missingMccMnc = await scalarCount("SELECT COUNT(*) AS c FROM network_cells WHERE mcc IS NULL OR BTRIM(mcc) = '' OR mnc IS NULL OR BTRIM(mnc) = ''");
        out.duplicateCellRecords = Math.max(0, out.totalNetworkCells - out.uniqueCellId);
        break;
      }
      case 'gps_history': {
        out.totalGpsRecords = await scalarCount('SELECT COUNT(*) AS c FROM gps_history');
        out.validCoordinates = await scalarCount('SELECT COUNT(*) AS c FROM gps_history WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND NOT (latitude = 0 AND longitude = 0)');
        out.invalidCoordinates = await scalarCount('SELECT COUNT(*) AS c FROM gps_history WHERE latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180 OR (latitude = 0 AND longitude = 0)');
        break;
      }
      case 'audit_logs': {
        out.totalAuditLogs = await scalarCount('SELECT COUNT(*) AS c FROM audit_logs');
        out.uniqueModules = await scalarCount("SELECT COUNT(DISTINCT module) AS c FROM audit_logs WHERE module IS NOT NULL AND BTRIM(module) <> ''");
        break;
      }
      case 'users': {
        out.totalUsers = await scalarCount('SELECT COUNT(*) AS c FROM users');
        out.activeUsers = await scalarCount("SELECT COUNT(*) AS c FROM users WHERE status = 'ACTIVE'");
        break;
      }
      default:
        break;
    }
  } catch {
    // Keep generic statistics working even if a business query is unsupported.
  }
  return out;
}

const NUMERIC_UDTS = /^(int|float|numeric|money)/;
const DATE_UDTS = /^(date|timestamp|time)/;
const TEXT_UDTS_STATS = /^(text|varchar|bpchar|name|citext|uuid)$/;
const MAX_TOP_VALUE_COLUMNS = 12;
const TOP_VALUES_LIMIT = 5;

function toDisplayNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDisplayDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function getTableStats(
  options: TableStatsOptions,
): Promise<TableStats> {
  const tableName = options.table;

  await assertTableExists(tableName);

  const quotedTable = assertIdentifier(tableName, 'table name');
  const columns = await getTableColumns(tableName);
  const { whereSql, params } = buildTableWhere(tableName, columns, options);
  const whereTail = whereSql || '';

  // Global record count (no filters) and filtered record count both come from
  // lightweight COUNT(*) queries - no full dataset is fetched into Node.
  const totalRows = await db.$queryRawUnsafe<Array<{ total: number | bigint }>>(
    `SELECT COUNT(*) AS total FROM ${quotedTable}`,
  );
  const totalRecords = Number(totalRows[0]?.total ?? 0);

  const filteredRows = await db.$queryRawUnsafe<Array<{ total: number | bigint }>>(
    `SELECT COUNT(*) AS total FROM ${quotedTable} ${whereTail}`,
    ...params,
  );
  const filteredRecords = Number(filteredRows[0]?.total ?? 0);

  const columnStats: TableColumnStats[] = [];
  let topValueColumnCount = 0;

  for (const column of columns) {
    // `column.name` is the real PostgreSQL identifier from information_schema.
    const quotedColumn = assertIdentifier(column.name, 'column name');
    const isText = TEXT_UDTS_STATS.test(column.udt);
    const isNumeric = NUMERIC_UDTS.test(column.udt);
    const isDate = DATE_UDTS.test(column.udt);
    const nonEmptyExpr = isText
      ? `${quotedColumn} IS NOT NULL AND BTRIM(CAST(${quotedColumn} AS TEXT)) <> ''`
      : `${quotedColumn} IS NOT NULL`;

    const metricParts: string[] = [
      'COUNT(*)::int AS total_count',
      `(COUNT(*) FILTER (WHERE ${nonEmptyExpr}))::int AS non_null_count`,
      `(COUNT(*) FILTER (WHERE NOT (${nonEmptyExpr})))::int AS null_count`,
      `(COUNT(DISTINCT CAST(${quotedColumn} AS TEXT)) FILTER (WHERE ${quotedColumn} IS NOT NULL))::int AS distinct_count`,
    ];

    if (isNumeric) {
      metricParts.push(
        `MIN(${quotedColumn}) AS min_val`,
        `MAX(${quotedColumn}) AS max_val`,
        `AVG(${quotedColumn}) AS avg_val`,
        `SUM(${quotedColumn}) AS sum_val`,
      );
    }
    if (isDate) {
      metricParts.push(
        `MIN(${quotedColumn}) AS min_date`,
        `MAX(${quotedColumn}) AS max_date`,
      );
    }

    const result = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${metricParts.join(', ')} FROM ${quotedTable} ${whereTail}`,
      ...params,
    );
    const row = result[0] ?? {};

    const nullCount = Number(row.null_count ?? 0);
    const nonNullCount = Number(row.non_null_count ?? 0);
    const distinctCount = Number(row.distinct_count ?? 0);

    let topValues: TableColumnStats['topValues'];
    if (isText && topValueColumnCount < MAX_TOP_VALUE_COLUMNS && nonNullCount > 0) {
      topValueColumnCount += 1;
      const conjunction = whereTail ? 'AND' : 'WHERE';
      const topRows = await db.$queryRawUnsafe<
        Array<{ value: unknown; count: number | bigint }>
      >(
        `SELECT CAST(${quotedColumn} AS TEXT) AS value, COUNT(*)::int AS count
         FROM ${quotedTable}
         ${whereTail} ${conjunction} ${nonEmptyExpr}
         GROUP BY 1
         ORDER BY count DESC, value ASC
         LIMIT ${TOP_VALUES_LIMIT}`,
        ...params,
      );
      topValues = topRows.map((item) => ({
        value: item.value === null || item.value === undefined ? '' : String(item.value),
        count: Number(item.count ?? 0),
        percentage: nonNullCount > 0
          ? Math.round((Number(item.count ?? 0) / nonNullCount) * 1000) / 10
          : 0,
      }));
    }

    const stats: TableColumnStats = {
      // Real database column name, always present and always first-class.
      column: column.name,
      name: column.name,
      dbName: column.name,
      displayName: columnLabelEn(column.name),
      displayNameAr: columnLabelAr(column.name),
      type: column.type,
      dataType: column.type,
      udt: column.udt,
      totalCount: Number(row.total_count ?? filteredRecords),
      nonNullCount,
      nullCount,
      nullOrEmptyCount: nullCount,
      distinctCount,
      duplicateCount: Math.max(0, nonNullCount - distinctCount),
    };

    if (isNumeric) {
      stats.min = toDisplayNumber(row.min_val);
      stats.max = toDisplayNumber(row.max_val);
      stats.avg = toDisplayNumber(row.avg_val);
      stats.sum = toDisplayNumber(row.sum_val);
    }
    if (isDate) {
      stats.minDate = toDisplayDate(row.min_date);
      stats.maxDate = toDisplayDate(row.max_date);
    }
    if (topValues) stats.topValues = topValues;

    columnStats.push(stats);
  }

  const business = await computeBusinessTableStats(tableName);

  return {
    table: tableName,
    tableName,
    totalRecords,
    filteredRecords,
    columns: columnStats,
    business,
    meta: {
      generatedAt: new Date().toISOString(),
      mission: options.mission && options.mission !== 'ALL' ? options.mission : undefined,
      search: options.search?.trim() || undefined,
      filters: options.filters ?? [],
      hasFilters: Boolean(
        options.search?.trim() ||
        (options.mission && options.mission !== 'ALL') ||
        (options.filters?.length ?? 0) > 0,
      ),
    },
  };
}

/**
 * Safely convert JSON data returned from Prisma into a record.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);

      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return null;
}

/**
 * Get the actual primary-key columns for a PostgreSQL table.
 * Supports both normal and composite primary keys.
 */
async function getPrimaryKeyColumns(
  tx: Prisma.TransactionClient,
  tableName: string,
): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<
    Array<{ column_name: string }>
  >(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `,
    tableName,
  );

  return rows.map(row => row.column_name);
}

/**
 * Build primary-key values from the recorded row data and recordId.
 *
 * For a single-column primary key, recordId can be used as a fallback.
 * Composite primary keys must be available in beforeData/afterData
 * or encoded as a JSON object in recordId.
 */
function getRecordPrimaryKey(
  primaryKeys: string[],
  recordId: string,
  data: Record<string, unknown> | null,
): Record<string, unknown> {
  let parsedRecordId: Record<string, unknown> | null = null;

  try {
    const parsed: unknown = JSON.parse(recordId);

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      parsedRecordId = parsed as Record<string, unknown>;
    }
  } catch {
    // A normal scalar record ID is expected for most imported tables.
  }

  const keyValues: Record<string, unknown> = {};

  for (const key of primaryKeys) {
    if (data && data[key] !== undefined) {
      keyValues[key] = data[key];
    } else if (
      parsedRecordId &&
      parsedRecordId[key] !== undefined
    ) {
      keyValues[key] = parsedRecordId[key];
    } else if (primaryKeys.length === 1) {
      keyValues[key] = recordId;
    } else {
      throw new Error(
        `Cannot determine primary key "${key}" for record ${recordId}`,
      );
    }
  }

  return keyValues;
}

/**
 * Undo a completed import batch.
 *
 * INSERT  -> delete the imported record.
 * UPDATE  -> restore the previous record data.
 * DELETE  -> restore the deleted record.
 *
 * Changes are reversed in descending order to preserve dependencies
 * when an import inserted or modified related records.
 */
export async function undoBatch(
  batchId: string,
  userId: number,
): Promise<{ deleted: number; restored: number }> {
  if (!batchId?.trim()) {
    throw new Error('A valid import batch ID is required');
  }

  return db.$transaction(async (tx) => {
    const batches = await tx.$queryRawUnsafe<
      Array<{
        batch_id: string;
        user_id: number | null;
        status: string;
        undo_status: string;
      }>
    >(
      `
        SELECT batch_id, user_id, status, undo_status
        FROM import_batches
        WHERE batch_id = $1
        FOR UPDATE
      `,
      batchId,
    );

    const batch = batches[0];

    if (!batch) {
      throw new Error(`Import batch "${batchId}" was not found`);
    }

    // Prevent one user from undoing another user's import.
    if (
      batch.user_id !== null &&
      Number(batch.user_id) !== Number(userId)
    ) {
      throw new Error('You are not authorized to undo this import batch');
    }

    if (batch.undo_status === 'UNDONE') {
      throw new Error('This import batch has already been undone');
    }

    // updateBatch() stores COMPLETED_WITH_ERRORS when any row failed; the rows
    // that did import must still be undoable.
    if (batch.status !== 'COMPLETED' && batch.status !== 'COMPLETED_WITH_ERRORS') {
      throw new Error(
        `Cannot undo an import batch with status "${batch.status}"`,
      );
    }

    const changes = await tx.$queryRawUnsafe<
      Array<{
        id: number;
        table_name: string;
        record_id: string;
        operation: string;
        before_data: unknown;
        after_data: unknown;
      }>
    >(
      `
        SELECT
          id,
          table_name,
          record_id,
          operation,
          before_data,
          after_data
        FROM import_changes
        WHERE batch_id = $1
        ORDER BY id DESC
        FOR UPDATE
      `,
      batchId,
    );

    if (changes.length === 0) {
      throw new Error(
        'This import batch has no recorded changes to undo',
      );
    }

    let deleted = 0;
    let restored = 0;

    for (const change of changes) {
      const tableName = change.table_name;

      // Validate table existence and retrieve its actual columns.
      await assertTableExists(tableName);

      const tableColumns = await getTableColumns(tableName);
      const validColumns = new Set(
        tableColumns.map(column => column.name),
      );

      const primaryKeys = await getPrimaryKeyColumns(tx, tableName);
      if (primaryKeys.length === 0) {
        throw new Error(
          `Cannot undo changes in "${tableName}": no primary key exists`,
        );
      }

      const beforeData = asRecord(change.before_data);
      const afterData = asRecord(change.after_data);

      const operation = change.operation.trim().toUpperCase();

      const keySource = beforeData ?? afterData;

      const primaryKey = getRecordPrimaryKey(
        primaryKeys,
        change.record_id,
        keySource,
      );

      const columnInfo = new Map(tableColumns.map(column => [column.name, column]));
      const quotedTable = assertIdentifier(tableName, 'table name');

      // Values come back from JSON (dates and bigints are strings), so every
      // placeholder is cast to the real column type.
      const makeBinder = () => {
        const params: unknown[] = [];
        const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
        return { params, bind };
      };

      const buildWhere = (bind: (v: unknown) => string) =>
        Object.entries(primaryKey)
          .map(([column, value]) => {
            if (!validColumns.has(column)) {
              throw new Error(`Invalid primary-key column "${column}" in "${tableName}"`);
            }
            return `${assertIdentifier(column, 'primary key')} = ${typedPlaceholder(columnInfo.get(column), value, bind)}`;
          })
          .join(' AND ');

      if (['INSERT', 'INSERTED', 'CREATE', 'CREATED'].includes(operation)) {
        const { params, bind } = makeBinder();
        const whereSql = buildWhere(bind);

        const result = await tx.$queryRawUnsafe<Array<{ id: number }>>(
          `DELETE FROM ${quotedTable} WHERE ${whereSql} RETURNING 1 AS id`,
          ...params,
        );

        if (result.length === 0) {
          throw new Error(
            `Could not undo inserted record ${change.record_id} in "${tableName}"`,
          );
        }

        deleted++;
        continue;
      }

      if (['UPDATE', 'UPDATED', 'MODIFY', 'MODIFIED'].includes(operation)) {
        if (!beforeData) {
          throw new Error(
            `Missing beforeData for updated record ${change.record_id} in "${tableName}"`,
          );
        }

        const entries = Object.entries(beforeData).filter(
          ([column]) => validColumns.has(column) && !primaryKeys.includes(column),
        );

        if (entries.length === 0) {
          throw new Error(
            `No restorable fields found for record ${change.record_id} in "${tableName}"`,
          );
        }

        const { params, bind } = makeBinder();
        const setSql = entries
          .map(([column, value]) =>
            `${assertIdentifier(column, 'column name')} = ${typedPlaceholder(columnInfo.get(column), value, bind)}`,
          )
          .join(', ');
        const whereSql = buildWhere(bind);

        const result = await tx.$queryRawUnsafe<Array<{ id: number }>>(
          `UPDATE ${quotedTable} SET ${setSql} WHERE ${whereSql} RETURNING 1 AS id`,
          ...params,
        );

        if (result.length === 0) {
          throw new Error(
            `Could not restore updated record ${change.record_id} in "${tableName}"`,
          );
        }

        restored++;
        continue;
      }

      if (['DELETE', 'DELETED', 'REMOVE', 'REMOVED'].includes(operation)) {
        if (!beforeData) {
          throw new Error(
            `Missing beforeData for deleted record ${change.record_id} in "${tableName}"`,
          );
        }

        const entries = Object.entries(beforeData).filter(([column]) => validColumns.has(column));

        if (entries.length === 0) {
          throw new Error(
            `No restorable data found for deleted record ${change.record_id} in "${tableName}"`,
          );
        }

        const { params, bind } = makeBinder();
        const columnsSql = entries.map(([column]) => assertIdentifier(column, 'column name')).join(', ');
        const valuesSql = entries
          .map(([column, value]) => typedPlaceholder(columnInfo.get(column), value, bind))
          .join(', ');

        const result = await tx.$queryRawUnsafe<Array<{ id: number }>>(
          `INSERT INTO ${quotedTable} (${columnsSql}) VALUES (${valuesSql}) ON CONFLICT DO NOTHING RETURNING 1 AS id`,
          ...params,
        );

        if (result.length === 0) {
          throw new Error(
            `Could not restore deleted record ${change.record_id} in "${tableName}". A conflicting record may already exist.`,
          );
        }

        restored++;
        continue;
      }

      throw new Error(
        `Unsupported import operation "${change.operation}" for "${tableName}"`,
      );
    }

    // Mark the batch as undone only after every change has been reversed.
    await tx.$executeRawUnsafe(
      `
        UPDATE import_batches
        SET undo_status = 'UNDONE'
        WHERE batch_id = $1
      `,
      batchId,
    );

    return { deleted, restored };
  });
}

// Schema changes are managed by Prisma migrations, never at runtime.
export async function runMissionIdMigration(): Promise<void> {}
export async function runPhase3TypeAlignmentMigration(): Promise<void> {}
export async function ensurePhase2Indexes(): Promise<void> {}