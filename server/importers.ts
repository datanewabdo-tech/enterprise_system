import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { DatabaseSync } from 'node:sqlite';
import { db, batchImport, getTableColumns } from './db.js';

export interface CoordinateParseResult {
  latitude: number | null;
  longitude: number | null;
  isValid: boolean;
  error?: string;
}

export const KNOWN_DOMAIN_TABLES = [
  'missions',
  'plmn_storage',
  'tac_numbers',
  'whitelist_targets',
  'scheduled_tasks',
  'map_layers',
  'mission_extras',
  'location_extras',
  'targets',
  'map_cell_databases',
  'wifi_access_points',
  'registrations',
  'network_cells',
  'gps_history',
  'sms_calls',
  'map_user_markers',
  'map_user_polygons',
  'map_user_circles',
  'mission_files',
  'location_files',
  'target_files',
  'map_cells',
  'wifi_access_point_clients',
];

const TABLE_DEPENDENCY_ORDER: Record<string, number> = {
  missions: 1,
  plmn_storage: 1,
  tac_numbers: 1,
  whitelist_targets: 1,
  scheduled_tasks: 1,
  map_layers: 1,
  mission_extras: 2,
  location_extras: 2,
  targets: 2,
  map_cell_databases: 2,
  wifi_access_points: 2,
  registrations: 3,
  network_cells: 3,
  gps_history: 3,
  sms_calls: 3,
  map_user_markers: 3,
  map_user_polygons: 3,
  map_user_circles: 3,
  mission_files: 4,
  location_files: 4,
  target_files: 4,
  map_cells: 4,
  wifi_access_point_clients: 4,
};

export function getDependencyOrder(tableName: string): number {
  return TABLE_DEPENDENCY_ORDER[tableName] ?? 5;
}

export function suggestDestinationTable(sourceTable: string): string {
  const clean = sourceTable.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (KNOWN_DOMAIN_TABLES.includes(clean)) return clean;
  // Handle camelCase -> snake_case (e.g. NetworkCells -> network_cells)
  const snake = sourceTable
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (KNOWN_DOMAIN_TABLES.includes(snake)) return snake;
  // Common plural/singular variants
  if (KNOWN_DOMAIN_TABLES.includes(`${snake}s`)) return `${snake}s`;
  return 'registrations';
}

export function autoMapColumns(sourceCols: string[], destTable: string): Record<string, string> {
  const destCols = getTableColumns(destTable).map(c => c.name);
  const mapping: Record<string, string> = {};
  for (const src of sourceCols) {
    const normSrc = src.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = destCols.find(d => d.toLowerCase().replace(/[^a-z0-9]/g, '') === normSrc);
    if (exact) {
      mapping[src] = exact;
    }
  }
  return mapping;
}

// Configurable multi-format coordinate parser
export function parseCoordinates(
  input: any,
  secondaryInput?: any,
  order: 'LAT_LNG' | 'LNG_LAT' = 'LAT_LNG'
): CoordinateParseResult {
  if (input === null || input === undefined || input === '') {
    return { latitude: null, longitude: null, isValid: false, error: 'Empty coordinate input' };
  }

  let lat: number | null = null;
  let lng: number | null = null;

  if (secondaryInput !== undefined && secondaryInput !== null && secondaryInput !== '') {
    const num1 = parseFloat(String(input).trim());
    const num2 = parseFloat(String(secondaryInput).trim());
    if (isNaN(num1) || isNaN(num2)) {
      return { latitude: null, longitude: null, isValid: false, error: 'Non-numeric coordinate value' };
    }
    if (order === 'LAT_LNG') {
      lat = num1;
      lng = num2;
    } else {
      lng = num1;
      lat = num2;
    }
  } else {
    const str = String(input).trim();
    const wktMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (wktMatch) {
      lng = parseFloat(wktMatch[1]);
      lat = parseFloat(wktMatch[2]);
    } else if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const geojson = JSON.parse(str);
        if (geojson.type === 'Point' && Array.isArray(geojson.coordinates) && geojson.coordinates.length >= 2) {
          lng = parseFloat(geojson.coordinates[0]);
          lat = parseFloat(geojson.coordinates[1]);
        }
      } catch {
        // fallback
      }
    }

    if (lat === null || lng === null) {
      let parts: string[] = [];
      if (str.includes(';')) parts = str.split(';');
      else if (str.includes(',')) parts = str.split(',');
      else if (str.includes('/')) parts = str.split('/');
      else if (str.includes(' ')) parts = str.split(/\s+/);

      if (parts.length >= 2) {
        const num1 = parseFloat(parts[0].trim());
        const num2 = parseFloat(parts[1].trim());
        if (!isNaN(num1) && !isNaN(num2)) {
          if (order === 'LAT_LNG') {
            lat = num1;
            lng = num2;
          } else {
            lng = num1;
            lat = num2;
          }
        }
      }
    }
  }

  if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
    return { latitude: null, longitude: null, isValid: false, error: 'Could not extract valid coordinate pair' };
  }
  if (lat < -90 || lat > 90) {
    return { latitude: lat, longitude: lng, isValid: false, error: `Latitude ${lat} out of range [-90, 90]` };
  }
  if (lng < -180 || lng > 180) {
    return { latitude: lat, longitude: lng, isValid: false, error: `Longitude ${lng} out of range [-180, 180]` };
  }

  return { latitude: lat, longitude: lng, isValid: true };
}

// Inspect uploaded file (Excel, CSV, SQLite)
export async function inspectFile(filePath: string, originalName: string) {
  const ext = originalName.substring(originalName.lastIndexOf('.')).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = workbook.worksheets.map(ws => {
      const firstRow = ws.getRow(1);
      const headers: string[] = [];
      firstRow.eachCell((cell, colNumber) => {
        headers.push(String(cell.value || `col_${colNumber}`));
      });

      const previewRows: any[] = [];
      for (let r = 2; r <= Math.min(ws.rowCount, 12); r++) {
        const row = ws.getRow(r);
        const obj: Record<string, any> = {};
        headers.forEach((h, idx) => {
          obj[h] = row.getCell(idx + 1).value;
        });
        previewRows.push(obj);
      }

      return {
        sheetName: ws.name,
        rowCount: Math.max(0, ws.rowCount - 1),
        columns: headers,
        preview: previewRows,
      };
    });

    return { type: 'EXCEL', sheets };
  } else if (ext === '.csv') {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parseCsv(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      to: 100,
    });

    const typedRecords = records as Record<string, any>[];
    const columns = typedRecords.length > 0 ? Object.keys(typedRecords[0]) : [];
    return {
      type: 'CSV',
      columns,
      preview: typedRecords.slice(0, 10),
      totalSampled: typedRecords.length,
    };
  } else if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    const sqliteDb = new DatabaseSync(filePath, { readOnly: true });
    try {
      const tablesStmt = sqliteDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC
      `);
      const tables = tablesStmt.all() as { name: string }[];

      const inspectedTables = tables.map(t => {
        const colStmt = sqliteDb.prepare(`PRAGMA table_info("${t.name}")`);
        const cols = colStmt.all() as Array<{ name: string; type: string; pk: number; notnull: number }>;
        const countStmt = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`);
        const rowCount = (countStmt.get() as any)?.count || 0;
        const previewStmt = sqliteDb.prepare(`SELECT * FROM "${t.name}" LIMIT 10`);
        const preview = previewStmt.all();

        const suggestedDestination = suggestDestinationTable(t.name);
        const suggestedMapping = autoMapColumns(cols.map(c => c.name), suggestedDestination);
        const destColumns = getTableColumns(suggestedDestination);

        return {
          tableName: t.name,
          rowCount,
          columns: cols.map(c => ({ name: c.name, type: c.type, pk: c.pk, notnull: c.notnull })),
          preview,
          suggestedDestination,
          suggestedMapping,
          destColumns,
          dependencyOrder: getDependencyOrder(suggestedDestination),
        };
      });

      // Sort by dependency order by default for user clarity
      inspectedTables.sort((a, b) => a.dependencyOrder - b.dependencyOrder);

      return { type: 'SQLITE', tables: inspectedTables };
    } finally {
      sqliteDb.close();
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

function mapConflictMode(mode: 'skip' | 'update' | 'replace'): 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE' {
  if (mode === 'skip') return 'INSERT_ONLY';
  if (mode === 'update') return 'UPDATE_EXISTING';
  return 'INSERT_OR_UPDATE';
}

function coerceValueForColumn(val: any, colType: string, colName?: string): { value: any; error?: string } {
  if (val === undefined || val === null || val === '') return { value: null };
  const t = colType.toUpperCase();
  if (t.includes('DATETIME') || t.includes('TIMESTAMP')) {
    if (typeof val === 'number' || (typeof val === 'string' && /^\d{10,13}$/.test(val.trim()))) {
      const n = Number(val);
      if (Number.isFinite(n)) {
        const ms = n >= 1e12 ? n : n >= 1e9 ? n * 1000 : null;
        if (ms !== null) {
          const d = new Date(ms);
          if (!Number.isNaN(d.getTime())) return { value: d.toISOString() };
        }
      }
    }
    return { value: String(val) };
  }
  if (t.includes('INT')) {
    if (typeof val === 'boolean') return { value: val ? 1 : 0 };
    const n = Number(val);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { value: val, error: `Expected integer for ${colName || 'column'}, got "${val}"` };
    }
    return { value: n };
  }
  if (t.includes('REAL') || t.includes('FLOAT') || t.includes('NUMERIC') || t.includes('DOUBLE')) {
    const n = Number(val);
    if (!Number.isFinite(n)) {
      return { value: val, error: `Expected number for ${colName || 'column'}, got "${val}"` };
    }
    return { value: n };
  }
  return { value: typeof val === 'object' ? JSON.stringify(val) : String(val) };
}

/**
 * Dry-run validation & estimation for multi-table SQLite import.
 */
export function estimateMultiSqliteImport(
  filePath: string,
  tableConfigs: MultiSqliteTableConfig[],
  targetDb: DatabaseSync = db
) {
  const sqliteDb = new DatabaseSync(filePath, { readOnly: true });
  try {
    const ordered = [...tableConfigs].sort(
      (a, b) => getDependencyOrder(a.destinationTable) - getDependencyOrder(b.destinationTable)
    );

    const estimates = ordered.map(cfg => {
      const destCols = getTableColumns(cfg.destinationTable);
      const destColMap = new Map(destCols.map(c => [c.name, c]));
      const rows = sqliteDb.prepare(`SELECT * FROM "${cfg.sourceTable}"`).all() as Record<string, any>[];
      const matchKey = cfg.matchKey && destColMap.has(cfg.matchKey)
        ? cfg.matchKey
        : destColMap.has('id')
        ? 'id'
        : destCols[0]?.name || 'id';

      const requiredMissing: string[] = [];
      for (const dc of destCols) {
        if (dc.notnull === 1 && dc.pk !== 1) {
          const isMapped = Object.values(cfg.columnMapping).includes(dc.name);
          if (!isMapped && dc.name !== 'mission_id') {
            requiredMissing.push(dc.name);
          }
        }
      }

      let estimatedInsert = 0;
      let estimatedUpdate = 0;
      let estimatedSkip = 0;
      let estimatedErrors = 0;
      const sampleErrors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const srcRow = rows[i];
        let rowHasError = false;
        const mapped: Record<string, any> = {};

        for (const [srcCol, dstCol] of Object.entries(cfg.columnMapping)) {
          if (!dstCol || !destColMap.has(dstCol)) continue;
          const colMeta = destColMap.get(dstCol)!;
          const coerced = coerceValueForColumn(srcRow[srcCol], colMeta.type, dstCol);
          if (coerced.error) {
            rowHasError = true;
            if (sampleErrors.length < 10) sampleErrors.push(`Row ${i + 1} (${dstCol}): ${coerced.error}`);
          }
          mapped[dstCol] = coerced.value;
        }

        if (rowHasError) {
          estimatedErrors++;
          continue;
        }

        const keyVal = mapped[matchKey];
        let exists = false;
        if (keyVal !== undefined && keyVal !== null && keyVal !== '') {
          try {
            exists = Boolean(
              targetDb.prepare(`SELECT 1 FROM "${cfg.destinationTable}" WHERE "${matchKey}" = ?`).get(keyVal)
            );
          } catch {
            exists = false;
          }
        }

        if (exists) {
          if (cfg.conflictMode === 'skip') estimatedSkip++;
          else estimatedUpdate++;
        } else {
          if (cfg.conflictMode === 'update') estimatedSkip++;
          else estimatedInsert++;
        }
      }

      return {
        sourceTable: cfg.sourceTable,
        destinationTable: cfg.destinationTable,
        dependencyOrder: getDependencyOrder(cfg.destinationTable),
        totalRows: rows.length,
        estimatedInsert,
        estimatedUpdate,
        estimatedSkip,
        estimatedErrors,
        requiredMissing,
        sampleErrors,
      };
    });

    return { estimates };
  } finally {
    sqliteDb.close();
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

export function getMultiImportProgress(jobId: string): MultiImportJobProgress | null {
  return multiImportJobs.get(jobId) || null;
}

export function cancelMultiSqliteImport(jobId: string): boolean {
  const prog = multiImportJobs.get(jobId);
  if (!prog) return false;
  cancelledImportJobs.add(jobId);
  if (prog.status === 'PENDING' || prog.status === 'RUNNING') {
    prog.status = 'CANCELLED';
  }
  return true;
}

const PARENT_FK_RULES: Record<string, { fkCol: string; parentTable: string; parentCol: string }> = {
  location_extras: { fkCol: 'mission_id', parentTable: 'missions', parentCol: 'id' },
  mission_files: { fkCol: 'mission_extra_id', parentTable: 'mission_extras', parentCol: 'id' },
  location_files: { fkCol: 'location_extra_id', parentTable: 'location_extras', parentCol: 'id' },
  target_files: { fkCol: 'target_id', parentTable: 'targets', parentCol: 'id' },
  map_cells: { fkCol: 'db_id', parentTable: 'map_cell_databases', parentCol: 'id' },
};

/**
 * Dependency-ordered transactional SQLite multi-table import.
 */
export async function executeMultiSqliteImport(
  options: {
    filePath: string;
    originalName: string;
    tables: MultiSqliteTableConfig[];
    userId?: number;
    username?: string;
    jobId?: string;
  },
  targetDb: DatabaseSync = db
) {
  const ordered = [...options.tables].sort(
    (a, b) => getDependencyOrder(a.destinationTable) - getDependencyOrder(b.destinationTable)
  );

  const jobId = options.jobId || `job_${Date.now()}`;
  const progress: MultiImportJobProgress = {
    jobId,
    status: 'RUNNING',
    totalTables: ordered.length,
    completedTables: 0,
    currentTable: null,
    tableResults: ordered.map(t => ({
      sourceTable: t.sourceTable,
      destinationTable: t.destinationTable,
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

  const sqliteDb = new DatabaseSync(options.filePath, { readOnly: true });
  const sourceMissionIdMap = new Map<number, number>();
  const summaryResults: MultiImportJobProgress['tableResults'] = [];

  try {
    for (let idx = 0; idx < ordered.length; idx++) {
      if (cancelledImportJobs.has(jobId)) {
        progress.status = 'CANCELLED';
        progress.currentTable = null;
        for (let k = idx; k < progress.tableResults.length; k++) {
          progress.tableResults[k].status = 'CANCELLED';
          summaryResults.push({ ...progress.tableResults[k] });
        }
        break;
      }

      const cfg = ordered[idx];
      const progEntry = progress.tableResults[idx];
      progress.currentTable = cfg.sourceTable;
      progEntry.status = 'RUNNING';

      const destCols = (
        targetDb.prepare(`PRAGMA table_info("${cfg.destinationTable}")`).all() as Array<{
          name: string;
          type: string;
          pk: number;
          notnull: number;
        }>
      );
      const destColNames = destCols.map(c => c.name);
      const destColTypes = new Map(destCols.map(c => [c.name, c.type]));

      const rawRows = sqliteDb.prepare(`SELECT * FROM "${cfg.sourceTable}"`).all() as Record<string, any>[];
      const batchMode = mapConflictMode(cfg.conflictMode);
      const matchKey =
        cfg.matchKey && destColNames.includes(cfg.matchKey)
          ? cfg.matchKey
          : cfg.destinationTable === 'plmn_storage'
          ? 'mcc'
          : cfg.destinationTable === 'tac_numbers'
          ? 'tac'
          : cfg.destinationTable === 'wifi_access_points'
          ? 'bssid'
          : 'id';

      const preparedRecords: Record<string, any>[] = [];
      let ambiguousMissionCount = 0;
      const preErrors: string[] = [];

      // Special handling for missions so duplicate mission labels don't collapse and IDs are mapped
      if (cfg.destinationTable === 'missions') {
        targetDb.exec('BEGIN TRANSACTION');
        try {
          for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
            const raw = rawRows[rIdx];
            const rec: Record<string, any> = {};
            for (const [srcCol, dstCol] of Object.entries(cfg.columnMapping)) {
              if (!dstCol || !destColNames.includes(dstCol)) continue;
              const coerced = coerceValueForColumn(raw[srcCol], destColTypes.get(dstCol) || 'TEXT', dstCol);
              if (coerced.error) {
                progEntry.errors++;
                preErrors.push(`Row ${rIdx + 1}: ${coerced.error}`);
                continue;
              }
              rec[dstCol] = coerced.value;
            }
            const srcId = raw.id !== undefined ? Number(raw.id) : undefined;
            const missionLabel = rec.mission || raw.mission || 'IMPORTED_MISSION';
            const locationVal = rec.location || raw.location || 'Unknown Location';
            const missionNameVal = rec.mission_name || raw.mission_name || missionLabel;

            const existingById = srcId && Number.isInteger(srcId)
              ? (targetDb.prepare(`SELECT id FROM missions WHERE id = ?`).get(srcId) as { id: number } | undefined)
              : undefined;
            const existingByPair = targetDb
              .prepare(`SELECT id FROM missions WHERE mission = ? AND location = ?`)
              .get(missionLabel, locationVal) as { id: number } | undefined;

            const matched = existingById || existingByPair;
            if (matched) {
              if (cfg.conflictMode === 'skip') {
                progEntry.skipped++;
              } else {
                targetDb
                  .prepare(`UPDATE missions SET mission = ?, mission_name = ?, location = ? WHERE id = ?`)
                  .run(missionLabel, missionNameVal, locationVal, matched.id);
                progEntry.updated++;
              }
              if (srcId) sourceMissionIdMap.set(srcId, matched.id);
            } else if (cfg.conflictMode === 'update') {
              progEntry.skipped++;
            } else {
              const info = targetDb
                .prepare(`INSERT INTO missions (mission, mission_name, location) VALUES (?, ?, ?)`)
                .run(missionLabel, missionNameVal, locationVal);
              const newId = Number(info.lastInsertRowid);
              progEntry.inserted++;
              if (srcId) sourceMissionIdMap.set(srcId, newId);
            }
          }
          targetDb.exec('COMMIT');
          progEntry.status = 'COMPLETED';
          progEntry.errorLog = preErrors.slice(0, 20);
        } catch (err: any) {
          targetDb.exec('ROLLBACK');
          progEntry.status = 'ERROR';
          progEntry.errors++;
          progEntry.errorLog.push(err.message);
        }
      } else {
        const fkRule = PARENT_FK_RULES[cfg.destinationTable];
        let tableCancelled = false;
        for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
          if (rIdx % 500 === 0) {
            await new Promise(resolve => setImmediate(resolve));
            if (cancelledImportJobs.has(jobId)) {
              tableCancelled = true;
              break;
            }
          }
          const raw = rawRows[rIdx];
          const rec: Record<string, any> = {};
          let hasTypeErr = false;

          for (const [srcCol, dstCol] of Object.entries(cfg.columnMapping)) {
            if (!dstCol || !destColNames.includes(dstCol)) continue;
            const coerced = coerceValueForColumn(raw[srcCol], destColTypes.get(dstCol) || 'TEXT', dstCol);
            if (coerced.error) {
              hasTypeErr = true;
              if (preErrors.length < 25) preErrors.push(`Row ${rIdx + 1} (${dstCol}): ${coerced.error}`);
            } else if (coerced.value !== null) {
              rec[dstCol] = coerced.value;
            }
          }

          if (hasTypeErr) {
            progEntry.errors++;
            continue;
          }

          // Remap or resolve mission_id cleanly (supports integer mission_id or integer source mission references)
          if (destColNames.includes('mission_id')) {
            const rawMissionId = rec.mission_id ?? raw.mission_id;
            if (rawMissionId !== undefined && rawMissionId !== null && rawMissionId !== '') {
              const numId = Number(rawMissionId);
              if (sourceMissionIdMap.has(numId)) {
                rec.mission_id = sourceMissionIdMap.get(numId);
              } else {
                const exists = targetDb.prepare(`SELECT id FROM missions WHERE id = ?`).get(numId);
                if (exists) rec.mission_id = numId;
                else if (fkRule?.fkCol === 'mission_id') rec.mission_id = numId;
                else delete rec.mission_id;
              }
            }

            if (rec.mission_id === undefined) {
              const mVal = rec.mission ?? raw.mission;
              if (mVal !== undefined && mVal !== null && /^\d+$/.test(String(mVal).trim())) {
                const mInt = Number(String(mVal).trim());
                if (sourceMissionIdMap.has(mInt)) {
                  rec.mission_id = sourceMissionIdMap.get(mInt);
                } else {
                  const exists = targetDb.prepare(`SELECT id FROM missions WHERE id = ?`).get(mInt);
                  if (exists) rec.mission_id = mInt;
                }
              }
            }

            if (rec.mission_id === undefined) {
              const mLabel = rec.mission || rec.mission_name || raw.mission || raw.mission_name;
              if (mLabel) {
                const matches = targetDb
                  .prepare(`SELECT id FROM missions WHERE mission = ? ORDER BY id ASC`)
                  .all(String(mLabel)) as Array<{ id: number }>;
                if (matches.length === 1) {
                  rec.mission_id = matches[0].id;
                } else if (matches.length > 1) {
                  ambiguousMissionCount++;
                }
              }
            }
          }

          // Pre-validate strict parent foreign keys so missing parent records are explicitly reported
          if (fkRule) {
            const fkVal = rec[fkRule.fkCol];
            if (fkVal === undefined || fkVal === null || fkVal === '') {
              progEntry.errors++;
              if (preErrors.length < 25) {
                preErrors.push(`Row ${rIdx + 1}: Missing required foreign key ${fkRule.fkCol} -> ${fkRule.parentTable}`);
              }
              continue;
            }
            const parentExists = targetDb
              .prepare(`SELECT 1 FROM "${fkRule.parentTable}" WHERE "${fkRule.parentCol}" = ?`)
              .get(fkVal);
            if (!parentExists) {
              progEntry.errors++;
              if (preErrors.length < 25) {
                preErrors.push(`Row ${rIdx + 1}: Missing parent foreign key (${fkRule.fkCol}=${fkVal} not found in ${fkRule.parentTable})`);
              }
              continue;
            }
          }

          if (Object.keys(rec).length > 0) {
            preparedRecords.push(rec);
          }
        }

        if (tableCancelled) {
          progEntry.status = 'CANCELLED';
          progEntry.errors += 0;
          progEntry.errorLog = [...preErrors, 'Import cancelled by user before table commit'].slice(0, 25);
          progress.status = 'CANCELLED';
          summaryResults.push({ ...progEntry });
          for (let k = idx + 1; k < progress.tableResults.length; k++) {
            progress.tableResults[k].status = 'CANCELLED';
            summaryResults.push({ ...progress.tableResults[k] });
          }
          break;
        }

        // Preserve source IDs unless inserting fresh rows into autoincrement tables without replace
        const cleanRecords = preparedRecords.map(r => {
          const copy = { ...r };
          if (cfg.conflictMode === 'skip' && matchKey !== 'id') {
            delete copy.id;
          }
          return copy;
        });

        const batchRes = batchImport(cfg.destinationTable, cleanRecords, batchMode, matchKey, targetDb);
        progEntry.inserted = batchRes.inserted;
        progEntry.updated = batchRes.updated;
        progEntry.skipped = batchRes.skipped;
        progEntry.errors += batchRes.errors;
        progEntry.ambiguousMissionCount = ambiguousMissionCount;
        progEntry.errorLog = [...preErrors, ...batchRes.errorLog].slice(0, 25);
        progEntry.status = 'COMPLETED';
      }

      // Record per-table ImportHistory
      targetDb.prepare(`
        INSERT INTO import_history (filename, file_type, destination_table, inserted_count, updated_count, skipped_count, error_count, error_log, user_id)
        VALUES (?, '.sqlite-multi', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${options.originalName}::${cfg.sourceTable}`,
        cfg.destinationTable,
        progEntry.inserted,
        progEntry.updated,
        progEntry.skipped,
        progEntry.errors,
        progEntry.errorLog.join('\n'),
        options.userId || null
      );

      progress.completedTables++;
      summaryResults.push({ ...progEntry });
    }

    const finalStatus = cancelledImportJobs.has(jobId) ? 'CANCELLED' : 'COMPLETED';
    cancelledImportJobs.delete(jobId);
    progress.status = finalStatus;
    progress.currentTable = null;

    targetDb.prepare(`
      INSERT INTO audit_logs (username, action, module, record_id, ip_address, result, details)
      VALUES (?, ?, 'import_center', ?, '127.0.0.1', ?, ?)
    `).run(
      options.username || 'admin',
      finalStatus === 'CANCELLED' ? 'MULTI_SQLITE_IMPORT_CANCELLED' : 'MULTI_SQLITE_IMPORT',
      options.originalName,
      finalStatus === 'CANCELLED' ? 'CANCELLED' : 'SUCCESS',
      `${finalStatus}: ${summaryResults.length} tables (${summaryResults.reduce((s, r) => s + r.inserted, 0)} inserted, ${summaryResults.reduce((s, r) => s + r.updated, 0)} updated, ${summaryResults.reduce((s, r) => s + r.errors, 0)} errors)`
    );

    return {
      jobId,
      status: finalStatus,
      tableResults: summaryResults,
      totals: {
        inserted: summaryResults.reduce((s, r) => s + r.inserted, 0),
        updated: summaryResults.reduce((s, r) => s + r.updated, 0),
        skipped: summaryResults.reduce((s, r) => s + r.skipped, 0),
        errors: summaryResults.reduce((s, r) => s + r.errors, 0),
        ambiguousMissions: summaryResults.reduce((s, r) => s + r.ambiguousMissionCount, 0),
      },
    };
  } catch (fatal: any) {
    progress.status = 'FAILED';
    progress.error = fatal.message;
    throw fatal;
  } finally {
    sqliteDb.close();
  }
}

// Legacy Single-Table Import Execution (preserved cleanly for Phase 1 compatibility)
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
}) {
  const ext = options.originalName.substring(options.originalName.lastIndexOf('.')).toLowerCase();
  let rawRecords: any[] = [];

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(options.filePath);
    const sheet = options.sheetOrTable ? workbook.getWorksheet(options.sheetOrTable) : workbook.worksheets[0];
    if (!sheet) throw new Error('Worksheet not found');

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value || `col_${colNumber}`);
    });

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, any> = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rec[header] = cell.value;
        }
      });
      rawRecords.push(rec);
    });
  } else if (ext === '.csv') {
    const fileContent = fs.readFileSync(options.filePath, 'utf-8');
    rawRecords = parseCsv(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } else if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    const sqliteDb = new DatabaseSync(options.filePath, { readOnly: true });
    try {
      const tableName = options.sheetOrTable || 'registrations';
      const stmt = sqliteDb.prepare(`SELECT * FROM "${tableName}"`);
      rawRecords = stmt.all();
    } finally {
      sqliteDb.close();
    }
  }

  const transformedRecords: Record<string, any>[] = [];
  const targetCols = getTableColumns(options.destinationTable).map(c => c.name);

  for (const row of rawRecords) {
    const newRecord: Record<string, any> = {};
    for (const [srcCol, tgtCol] of Object.entries(options.columnMapping)) {
      if (tgtCol && targetCols.includes(tgtCol) && row[srcCol] !== undefined) {
        newRecord[tgtCol] = row[srcCol];
      }
    }

    if (options.coordinateConfig) {
      const cfg = options.coordinateConfig;
      if (cfg.combinedCol && row[cfg.combinedCol]) {
        const parsed = parseCoordinates(row[cfg.combinedCol], undefined, cfg.order || 'LAT_LNG');
        if (parsed.isValid) {
          if (cfg.targetLatCol && targetCols.includes(cfg.targetLatCol)) newRecord[cfg.targetLatCol] = parsed.latitude;
          if (cfg.targetLngCol && targetCols.includes(cfg.targetLngCol)) newRecord[cfg.targetLngCol] = parsed.longitude;
        }
      } else if (cfg.latCol && cfg.lngCol && row[cfg.latCol] && row[cfg.lngCol]) {
        const parsed = parseCoordinates(row[cfg.latCol], row[cfg.lngCol], cfg.order || 'LAT_LNG');
        if (parsed.isValid) {
          if (cfg.targetLatCol && targetCols.includes(cfg.targetLatCol)) newRecord[cfg.targetLatCol] = parsed.latitude;
          if (cfg.targetLngCol && targetCols.includes(cfg.targetLngCol)) newRecord[cfg.targetLngCol] = parsed.longitude;
        }
      }
    }

    if (targetCols.includes('mission_id') && newRecord.mission_id === undefined && newRecord.mission) {
      const matches = db.prepare(`SELECT id FROM missions WHERE mission = ?`).all(newRecord.mission) as Array<{ id: number }>;
      if (matches.length === 1) newRecord.mission_id = matches[0].id;
    }

    if (Object.keys(newRecord).length > 0) {
      transformedRecords.push(newRecord);
    }
  }

  const result = batchImport(
    options.destinationTable,
    transformedRecords,
    options.importMode,
    options.matchKey || 'id'
  );

  db.prepare(`
    INSERT INTO import_history (filename, file_type, destination_table, inserted_count, updated_count, skipped_count, error_count, error_log, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.originalName,
    ext,
    options.destinationTable,
    result.inserted,
    result.updated,
    result.skipped,
    result.errors,
    result.errorLog.slice(0, 10).join('\n'),
    options.userId || null
  );

  db.prepare(`
    INSERT INTO audit_logs (username, action, module, record_id, ip_address, result, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.username || 'admin',
    'DATA_IMPORT',
    options.destinationTable,
    options.originalName,
    '127.0.0.1',
    result.errors > 0 ? 'PARTIAL' : 'SUCCESS',
    `Imported ${result.inserted} rows, updated ${result.updated}, skipped ${result.skipped}, errors: ${result.errors}`
  );

  return result;
}
