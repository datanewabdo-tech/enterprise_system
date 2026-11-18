import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { db, initDatabase, runPhase3TypeAlignmentMigration } from '../server/db.js';
import {
  getNetworkCellsByMcc,
  getMilitaryNetworks,
  getCivilianNetworks,
  getBtsMapData,
} from '../server/analytics.js';
import {
  executeMultiSqliteImport,
  cancelMultiSqliteImport,
  MultiSqliteTableConfig,
} from '../server/importers.js';
import { generateChartExport } from '../server/dashboardExporter.js';
import { generateToken } from '../server/auth.js';
import { apiRouter } from '../server/routes.js';

const tempFiles: string[] = [];

function createTempDbPath(prefix: string): string {
  const p = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
  tempFiles.push(p);
  return p;
}

function collectFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectFilesRecursive(full));
    } else if (/\.(ts|tsx|js|jsx|css|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

after(() => {
  for (const f of tempFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore cleanup failures
    }
  }
});

describe('Phase 3: SQLite Type Alignment, Leading Zeros & Foreign Keys', () => {
  test('Schema includes all 28 registrations cols, network_cells.psc, TEXT identifiers, and parent FKs', () => {
    const dbPath = createTempDbPath('p3_schema');
    const testDb = new DatabaseSync(dbPath);
    try {
      initDatabase();

      const regCols = testDb.prepare(`PRAGMA table_info("registrations")`).all() as Array<{ name: string; type: string }>;
      const regColNames = new Set(regCols.map(c => c.name));
      for (const expected of ['reg_id', 'mcc', 'mnc', 'lac', 'rat', 'last_event', 'time', 'target_name', 'uplink_power', 'bts_location']) {
        assert.ok(regColNames.has(expected), `registrations must contain ${expected}`);
      }
      assert.equal(regCols.length, 29, 'registrations must match 28 aligned source columns plus relational mission_id');

      const ncCols = testDb.prepare(`PRAGMA table_info("network_cells")`).all() as Array<{ name: string; type: string }>;
      const ncMap = new Map(ncCols.map(c => [c.name, c.type.toUpperCase()]));
      assert.ok(ncMap.has('psc'), 'network_cells must contain psc');
      for (const textCol of ['lac', 'mcc', 'mnc', 'cell_id', 'bsic', 'psc', 'pci']) {
        assert.equal(ncMap.get(textCol), 'TEXT', `network_cells.${textCol} must be TEXT`);
      }

      const mcCols = testDb.prepare(`PRAGMA table_info("map_cells")`).all() as Array<{ name: string; type: string }>;
      const mcMap = new Map(mcCols.map(c => [c.name, c.type.toUpperCase()]));
      for (const textCol of ['mcc', 'mnc', 'lac', 'cid']) {
        assert.equal(mcMap.get(textCol), 'TEXT', `map_cells.${textCol} must be TEXT`);
      }
      const mcFks = testDb.prepare(`PRAGMA foreign_key_list("map_cells")`).all() as Array<{ table: string; from: string }>;
      assert.ok(mcFks.some(f => f.from === 'db_id' && f.table === 'map_cell_databases'));

      for (const [tbl, parentTbl, fkCol] of [
        ['location_extras', 'missions', 'mission_id'],
        ['mission_files', 'mission_extras', 'mission_extra_id'],
        ['location_files', 'location_extras', 'location_extra_id'],
        ['target_files', 'targets', 'target_id'],
      ]) {
        const fks = testDb.prepare(`PRAGMA foreign_key_list("${tbl}")`).all() as Array<{ table: string; from: string }>;
        assert.ok(fks.some(f => f.from === fkCol && f.table === parentTbl), `${tbl}.${fkCol} must reference ${parentTbl}`);
      }
    } finally {
      testDb.close();
    }
  });

  test('Non-destructive Phase 3 migration preserves existing rows and converts legacy types cleanly', () => {
    const dbPath = createTempDbPath('p3_legacy_mig');
    const legacyDb = new DatabaseSync(dbPath);
    try {
      // Create minimal pre-Phase-3 tables matching Phase 2 layout before alignment
      legacyDb.exec(`
        CREATE TABLE missions (id INTEGER PRIMARY KEY AUTOINCREMENT, mission TEXT NOT NULL, mission_name TEXT, location TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE registrations (id INTEGER PRIMARY KEY AUTOINCREMENT, reg_id TEXT, mission_id INTEGER, mission TEXT, bts TEXT, bts_name TEXT, country TEXT, tmsi TEXT, imsi TEXT, imei TEXT, ue_model TEXT, bts_location TEXT, bts_altitude REAL, bts_location_outdated INTEGER DEFAULT 0, distance_min REAL, distance_max REAL, country_code TEXT, device_location TEXT, last_seen DATETIME, "update" TEXT, action TEXT);
        CREATE TABLE targets (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER, mission TEXT, mission_name TEXT, imsi TEXT, imei TEXT, name TEXT NOT NULL, action TEXT, redirect_tech TEXT, redirect_bsic TEXT, redirect_channel TEXT, description TEXT, is_p_c_s1900 INTEGER DEFAULT 0);
        CREATE TABLE mission_extras (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER, mission_name TEXT, description TEXT NOT NULL);
        CREATE TABLE location_extras (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER NOT NULL, description TEXT NOT NULL);
        CREATE TABLE mission_files (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_extra_id INTEGER NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, original_file_name TEXT NOT NULL, added_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE location_files (id INTEGER PRIMARY KEY AUTOINCREMENT, location_extra_id INTEGER NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, original_file_name TEXT NOT NULL, added_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE target_files (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, original_file_name TEXT NOT NULL, added_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE network_cells (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER, mission TEXT, channel INTEGER, lac INTEGER, mcc INTEGER, mnc INTEGER, rx_lev REAL, cell_id INTEGER, rat TEXT, bsic INTEGER, pci INTEGER, is_pcs1900 INTEGER DEFAULT 0, rx_lev_dbm REAL, downlink REAL, dl_bandwidth REAL, latitude REAL, longitude REAL, direction REAL, is_neighbour INTEGER DEFAULT 0, cid_lac_mnc TEXT);
        CREATE TABLE map_cell_databases (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER, mission TEXT, db_name TEXT NOT NULL);
        CREATE TABLE map_cells (id INTEGER PRIMARY KEY AUTOINCREMENT, db_id INTEGER NOT NULL, contents TEXT, lat REAL NOT NULL, lng REAL NOT NULL, mcc INTEGER, mnc INTEGER, lac INTEGER, cid INTEGER, mcc_mnc_junction TEXT, address TEXT, direction REAL, format_hex TEXT, opening_angle REAL, radius REAL, sc_pci INTEGER, channel INTEGER, antenna_type TEXT);
        CREATE TABLE plmn_storage (mcc INTEGER NOT NULL, mnc INTEGER NOT NULL, country TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (mcc, mnc));
        CREATE TABLE map_user_markers (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER, mission TEXT, direction REAL, type TEXT, description String, image TEXT, color TEXT DEFAULT '#ef4444', width REAL DEFAULT 32, height REAL DEFAULT 32, latitude REAL NOT NULL, longitude REAL NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);

        INSERT INTO missions (id, mission, location) VALUES (1, 'LEGACY_OP', 'Sector 1');
        INSERT INTO registrations (id, reg_id, mission_id, mission, country, imsi, bts_location) VALUES (10, 'R-10', 1, 'LEGACY_OP', 'Palestine', '42505000999', '31.5017 34.4668');
        INSERT INTO network_cells (id, mission_id, mission, mcc, mnc, lac, cell_id, rat) VALUES (20, 1, 'LEGACY_OP', 425, 5, 101, 5511, 'LTE');
        INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES (602, 10, 'Egypt', 'EGY', 'Egyptian Military');
      `);

      runPhase3TypeAlignmentMigration();

      const regCount = (legacyDb.prepare(`SELECT COUNT(*) as c FROM registrations`).get() as any).c;
      assert.equal(regCount, 1);

      const ncRow = legacyDb.prepare(`SELECT mcc, mnc, cell_id FROM network_cells WHERE id = 20`).get() as any;
      assert.equal(typeof ncRow.mcc, 'string');
      assert.equal(ncRow.mcc, '425');
      assert.equal(ncRow.cell_id, '5511');

      // Leading zero insertion after migration succeeds cleanly
      legacyDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('003', '03', 'Testland', 'TST', 'Zero Operator')`).run();
      const zeroPlmn = legacyDb.prepare(`SELECT mcc, mnc FROM plmn_storage WHERE name = 'Zero Operator'`).get() as any;
      assert.equal(zeroPlmn.mcc, '003');
      assert.equal(zeroPlmn.mnc, '03');

      const markerInfo = (legacyDb.prepare(`PRAGMA table_info("map_user_markers")`).all() as any[]).find(c => c.name === 'description');
      assert.equal(markerInfo.type.toUpperCase(), 'TEXT');
    } finally {
      legacyDb.close();
    }
  });
});

describe('Phase 3: SQLite Batch Import Conversions, Parent FK Validation & Cancellation', () => {
  test('Converts Unix epoch to ISO on DATETIME, preserves registrations.time integer, validates parent FKs, and preserves leading zeros', async () => {
    const srcPath = createTempDbPath('p3_imp_src');
    const dstPath = createTempDbPath('p3_imp_dst');

    const srcDb = new DatabaseSync(srcPath);
    srcDb.exec(`
      CREATE TABLE missions (id INTEGER PRIMARY KEY, mission TEXT, location TEXT);
      CREATE TABLE registrations (id INTEGER PRIMARY KEY, reg_id TEXT, mission INTEGER, country TEXT, mcc TEXT, mnc TEXT, imsi TEXT, time INTEGER, last_seen INTEGER);
      CREATE TABLE location_extras (id INTEGER PRIMARY KEY, mission_id INTEGER, description TEXT);

      INSERT INTO missions VALUES (1, 'SHARED_OP', 'Site North');
      INSERT INTO missions VALUES (2, 'SHARED_OP', 'Site South');
      INSERT INTO registrations VALUES (1, '00042', 2, 'TestState', '001', '03', '001031234567890', 1731700000, 1731700000);
      INSERT INTO location_extras VALUES (1, 9999, 'Orphaned extra missing parent mission');
    `);
    srcDb.close();

    const dstDb = new DatabaseSync(dstPath);
    try {
      await initDatabase();

      const configs: MultiSqliteTableConfig[] = [
        {
          sourceTable: 'missions',
          destinationTable: 'missions',
          columnMapping: { id: 'id', mission: 'mission', location: 'location' },
          conflictMode: 'skip',
        },
        {
          sourceTable: 'registrations',
          destinationTable: 'registrations',
          columnMapping: {
            reg_id: 'reg_id',
            mission: 'mission',
            country: 'country',
            mcc: 'mcc',
            mnc: 'mnc',
            imsi: 'imsi',
            time: 'time',
            last_seen: 'last_seen',
          },
          conflictMode: 'skip',
        },
        {
          sourceTable: 'location_extras',
          destinationTable: 'location_extras',
          columnMapping: { mission_id: 'mission_id', description: 'description' },
          conflictMode: 'skip',
        },
      ];

      const res = await executeMultiSqliteImport(
        {
          filePath: srcPath,
          originalName: 'p3_source.sqlite',
          tables: configs,
          userId: 1,
          username: 'admin',
        },
        dstDb
      );

      assert.equal(res.status, 'COMPLETED');
      const reg = dstDb.prepare(`SELECT reg_id, mission_id, mcc, mnc, imsi, time, last_seen FROM registrations WHERE reg_id = '00042'`).get() as any;
      assert.ok(reg, 'Imported registration with leading zeros must exist');
      assert.equal(reg.mcc, '001', 'Leading zeros in MCC must be preserved');
      assert.equal(reg.mnc, '03', 'Leading zeros in MNC must be preserved');
      assert.equal(reg.imsi, '001031234567890', 'Leading zeros in IMSI must be preserved');
      assert.equal(reg.time, 1731700000, 'registrations.time must stay integer epoch');
      assert.ok(String(reg.last_seen).startsWith('2024-11-15T'), 'DATETIME last_seen should convert Unix epoch to ISO string');

      const importedMissions = dstDb.prepare(`SELECT id FROM missions WHERE mission = 'SHARED_OP' ORDER BY id ASC`).all() as Array<{ id: number }>;
      assert.equal(importedMissions.length, 2);
      assert.equal(reg.mission_id, importedMissions[1].id, 'Integer mission=2 must map directly to second SHARED_OP mission row');

      const locRes = res.tableResults.find(r => r.sourceTable === 'location_extras');
      assert.ok(locRes && locRes.errors === 1, 'Missing parent FK on location_extras must be rejected and reported');
      assert.ok(locRes.errorLog.some(e => e.includes('Missing parent foreign key')), 'Error log must explain missing parent FK');
    } finally {
      dstDb.close();
    }
  });

  test('Cancellation stops multi-table SQLite import cleanly mid-batch', async () => {
    const srcPath = createTempDbPath('p3_cancel_src');
    const dstPath = createTempDbPath('p3_cancel_dst');

    const srcDb = new DatabaseSync(srcPath);
    srcDb.exec(`
      CREATE TABLE missions (id INTEGER PRIMARY KEY, mission TEXT, location TEXT);
      CREATE TABLE registrations (id INTEGER PRIMARY KEY, reg_id TEXT, mission_id INTEGER, country TEXT, imsi TEXT);
      INSERT INTO missions VALUES (1, 'CANCEL_OP', 'Zone X');
    `);
    const ins = srcDb.prepare(`INSERT INTO registrations VALUES (?, ?, 1, 'Palestine', ?)`);
    for (let i = 1; i <= 1200; i++) {
      ins.run(i, `CR_${i}`, `42505000${i}`);
    }
    srcDb.close();

    const dstDb = new DatabaseSync(dstPath);
    try {
      await initDatabase();
      const jobId = `job_cancel_${Date.now()}`;
      const promise = executeMultiSqliteImport(
        {
          filePath: srcPath,
          originalName: 'cancel_test.sqlite',
          jobId,
          tables: [
            {
              sourceTable: 'missions',
              destinationTable: 'missions',
              columnMapping: { id: 'id', mission: 'mission', location: 'location' },
              conflictMode: 'skip',
            },
            {
              sourceTable: 'registrations',
              destinationTable: 'registrations',
              columnMapping: { reg_id: 'reg_id', mission_id: 'mission_id', country: 'country', imsi: 'imsi' },
              conflictMode: 'skip',
            },
          ],
        },
        dstDb
      );

      setTimeout(() => {
        cancelMultiSqliteImport(jobId);
      }, 5);

      const res = await promise;
      assert.equal(res.status, 'CANCELLED');
      assert.ok(res.tableResults.some(r => r.status === 'CANCELLED'));
    } finally {
      dstDb.close();
    }
  });
});

describe('Phase 3: String Leading-Zero Analytics & Per-Chart / Per-Map Exports', () => {
  test('NetworkCells MCC/MNC preserve leading zeros ("03") across aggregations', async () => {
    const dbPath = createTempDbPath('p3_analytics');
    const testDb = new DatabaseSync(dbPath);
    try {
      await initDatabase();
      testDb.prepare(`INSERT INTO missions (id, mission, location) VALUES (1, 'OP_ZERO', 'Sector Z')`).run();
      testDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('425', '03', 'Israel', 'ISR', 'Pelephone 03')`).run();
      testDb.prepare(`INSERT INTO network_cells (mission_id, mission, mcc, mnc, cell_id, rat, latitude, longitude) VALUES (1, 'OP_ZERO', '425', '03', '00981', 'LTE', 31.77, 35.21)`).run();
      testDb.prepare(`INSERT INTO network_cells (mission_id, mission, mcc, mnc, cell_id, rat, latitude, longitude) VALUES (1, 'OP_ZERO', '602', '10', '00112', 'LTE', 30.05, 31.24)`).run();

      const byMcc = await getNetworkCellsByMcc({}, testDb as any);
      assert.equal(byMcc.totalDistinctCells, 2);
      assert.ok(byMcc.items.some(i => i.mcc === '425'));

      const mil = await getMilitaryNetworks({}, testDb as any);
      assert.equal(mil.totalDistinctCells, 1);
      assert.equal(mil.items[0].mnc, '10');

      const civ = await getCivilianNetworks({}, testDb as any);
      assert.ok(civ.items.some(i => i.mcc === '425' && i.mnc === '03'));

      const mapData = await getBtsMapData({}, testDb as any);
      const cellLoc = mapData.locations.find(l => l.cellIds.includes('00981'));
      assert.ok(cellLoc, 'Leading-zero cell_id "00981" must appear on BTS map');
      assert.ok(cellLoc.mncs.includes('03'), 'Leading-zero MNC "03" must be preserved in map metadata');
    } finally {
      testDb.close();
    }
  });

  test('generateChartExport produces CSV, XLSX (with @ text numFmt), PDF, GeoJSON, and PNG without leaking IMSI/IMEI/TMSI', async () => {
    initDatabase();
    const generatedFiles: string[] = [];

    try {
      // 1. CSV export for registrationsByCountry
      const csvExp = await generateChartExport({
        chartId: 'registrationsByCountry',
        format: 'csv',
        language: 'ar',
        filters: {},
        username: 'phase3_tester',
      });
      generatedFiles.push(csvExp.filePath);
      const csvText = csvExp.buffer.toString('utf8');
      assert.ok(csvText.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
      assert.ok(!csvText.toLowerCase().includes('imei'));
      assert.ok(!csvText.toLowerCase().includes('tmsi'));

      // 2. Excel export for civilianNetworks (verify '@' text formatting for MCC/MNC column)
      const xlsxExp = await generateChartExport({
        chartId: 'civilianNetworks',
        format: 'xlsx',
        language: 'en',
        filters: {},
        username: 'phase3_tester',
      });
      generatedFiles.push(xlsxExp.filePath);
      assert.equal(xlsxExp.buffer.subarray(0, 2).toString('utf8'), 'PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsxExp.buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const ws = wb.worksheets[0];
      assert.ok(ws.rowCount >= 4);
      if (ws.rowCount >= 5) {
        assert.equal(ws.getRow(5).getCell(4).numFmt, '@', 'MCC/MNC column must use text format "@"');
      }

      // 3. PDF export for btsMap (Arabic RTL with tiny valid PNG snapshot)
      const tinyPngBase64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const pdfExp = await generateChartExport({
        chartId: 'btsMap',
        format: 'pdf',
        language: 'ar',
        filters: {},
        chartImage: tinyPngBase64,
        username: 'phase3_tester',
      });
      generatedFiles.push(pdfExp.filePath);
      assert.equal(pdfExp.buffer.subarray(0, 5).toString('utf8'), '%PDF-');

      // 4. GeoJSON export for btsMap
      const geoExp = await generateChartExport({
        chartId: 'btsMap',
        format: 'geojson',
        language: 'en',
        filters: {},
        username: 'phase3_tester',
      });
      generatedFiles.push(geoExp.filePath);
      const geo = JSON.parse(geoExp.buffer.toString('utf8'));
      assert.equal(geo.type, 'FeatureCollection');
      assert.equal(geo.crs?.properties?.name, 'EPSG:4326');
      assert.equal(geo.metadata?.attribution, '© OpenStreetMap contributors');
      assert.ok(Array.isArray(geo.features));
      const geoRaw = JSON.stringify(geo);
      assert.ok(!geoRaw.includes('"imsi"'), 'GeoJSON must never contain raw IMSI');
      assert.ok(!geoRaw.includes('"imei"'), 'GeoJSON must never contain raw IMEI');
      assert.ok(!geoRaw.includes('"tmsi"'), 'GeoJSON must never contain raw TMSI');

      // 5. PNG export passthrough
      const pngExp = await generateChartExport({
        chartId: 'networkCellsByMcc',
        format: 'png',
        language: 'en',
        filters: {},
        chartImage: tinyPngBase64,
        username: 'phase3_tester',
      });
      generatedFiles.push(pngExp.filePath);
      assert.deepEqual([...pngExp.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

      // 6. Reject GeoJSON on non-map chart
      await assert.rejects(
        () =>
          generateChartExport({
            chartId: 'militaryNetworks',
            format: 'geojson',
            language: 'en',
            filters: {},
            username: 'phase3_tester',
          }),
        /only supported for the geographic BTS map/i
      );
    } finally {
      for (const fp of generatedFiles) {
        try {
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch {
          // ignore
        }
      }
    }
  });
});

describe('Phase 3: HTTP Security, RBAC, Path Traversal, Saved View Ownership & Map Tile Proxy', () => {
  test('Enforces 401/403 RBAC, blocks path traversal & cross-user view deletion, serves valid PNG map tiles, and has zero CARTO references', async () => {
    initDatabase();

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/v1', apiRouter);

    const server = await new Promise<http.Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;

    const adminToken = generateToken({
      id: 1,
      username: 'admin',
      email: 'admin@enterprise.local',
      fullName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    const analystToken = generateToken({
      id: 901,
      username: 'analyst_test',
      email: 'analyst@enterprise.local',
      fullName: 'Analyst',
      role: 'DATA_ANALYST',
      status: 'ACTIVE',
    });
    const viewerToken = generateToken({
      id: 902,
      username: 'viewer_test',
      email: 'viewer@enterprise.local',
      fullName: 'Viewer',
      role: 'VIEWER',
      status: 'ACTIVE',
    });

    let createdViewId: number | null = null;
    try {
      // Unauthenticated protected endpoints -> 401
      for (const endpoint of ['/tables/registrations', '/users', '/saved-views']) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        assert.equal(res.status, 401, `GET ${endpoint} without token must return 401`);
      }

      // Viewer blocked from exporting -> 403
      const viewerChartRes = await fetch(`${baseUrl}/exports/chart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chartId: 'registrationsByCountry',
          format: 'csv',
          language: 'en',
          filters: {},
        }),
      });
      assert.equal(viewerChartRes.status, 403, 'VIEWER must receive 403 on chart export');

      // Analyst blocked from TMSI filtering -> 403
      const analystTmsiRes = await fetch(`${baseUrl}/exports/chart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${analystToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chartId: 'registrationsByCountry',
          format: 'csv',
          language: 'en',
          filters: { tmsi: '123456' },
        }),
      });
      assert.equal(analystTmsiRes.status, 403, 'DATA_ANALYST must receive 403 when filtering by TMSI');

      // Admin CSV chart export succeeds -> 200
      const adminChartRes = await fetch(`${baseUrl}/exports/chart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chartId: 'militaryNetworks',
          format: 'csv',
          language: 'ar',
          filters: {},
        }),
      });
      assert.equal(adminChartRes.status, 200, 'SUPER_ADMIN must export chart CSV with 200');
      const exportId = adminChartRes.headers.get('x-export-id');
      assert.ok(exportId, 'X-Export-Id response header must be populated');
      const exportedRows = await db.$queryRawUnsafe<any[]>(`SELECT file_path FROM export_history WHERE id = $1`, Number(exportId));
      const exportedRow = exportedRows[0];      if (exportedRow?.file_path && fs.existsSync(exportedRow.file_path)) {
        fs.unlinkSync(exportedRow.file_path);
      }

      // Saved View ownership check: admin creates view, analyst cannot delete it -> 403
      const svCreateRes = await fetch(`${baseUrl}/saved-views`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tableName: 'dashboard', viewName: 'Phase3 Ownership Test View', filters: {} }),
      });
      assert.equal(svCreateRes.status, 201);
      const svJson = await svCreateRes.json();
      createdViewId = svJson.id;

      const analystDeleteRes = await fetch(`${baseUrl}/saved-views/${createdViewId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${analystToken}` },
      });
      assert.equal(analystDeleteRes.status, 403, 'Non-admin user must not delete another user saved view');

      // Path traversal containment -> 403
      const traversalRes = await fetch(`${baseUrl}/imports/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath: '/etc/passwd',
          originalName: 'passwd.csv',
          destinationTable: 'registrations',
          columnMapping: { a: 'country' },
        }),
      });
      assert.equal(traversalRes.status, 403, 'Path outside uploads directory must be rejected with 403');

      // Tile proxy returns valid PNG & rejects out-of-range coords
      const tileRes = await fetch(`${baseUrl}/map/tiles/3/4/2.png`);
      assert.equal(tileRes.status, 200);
      assert.equal(tileRes.headers.get('content-type'), 'image/png');
      const tileBuf = Buffer.from(await tileRes.arrayBuffer());
      assert.deepEqual([...tileBuf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'Tile response must be a valid PNG binary');

      const badTileRes = await fetch(`${baseUrl}/map/tiles/25/0/0.png`);
      assert.equal(badTileRes.status, 400);

      // Zero CARTO references anywhere in src/ or server/
      const codeFiles = [
        ...collectFilesRecursive(path.resolve(process.cwd(), 'src')),
        ...collectFilesRecursive(path.resolve(process.cwd(), 'server')),
      ];
      for (const file of codeFiles) {
        const content = fs.readFileSync(file, 'utf8');
        assert.ok(!content.includes('cartocdn'), `Forbidden CARTO URL found in ${file}`);
      }
    } finally {
      if (createdViewId) {
        await db.$executeRawUnsafe(`DELETE FROM saved_views WHERE id = $1`, createdViewId);      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});


