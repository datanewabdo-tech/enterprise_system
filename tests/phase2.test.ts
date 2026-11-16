import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initDatabase, runMissionIdMigration } from '../server/db.js';
import {
  parseBtsLocationString,
  getRegistrationsByCountry,
  getBtsMapData,
  getNetworkCellsByMcc,
  getMilitaryNetworks,
  getCivilianNetworks,
  getDashboardKPIs,
} from '../server/analytics.js';
import {
  inspectFile,
  estimateMultiSqliteImport,
  executeMultiSqliteImport,
  MultiSqliteTableConfig,
} from '../server/importers.js';
import { generateDashboardExport } from '../server/dashboardExporter.js';
import { generateToken, ROLE_PERMISSIONS } from '../server/auth.js';

const tempFiles: string[] = [];

function createTempDbPath(prefix: string): string {
  const p = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
  tempFiles.push(p);
  return p;
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

describe('Phase 2: Mission ID Migration & Ambiguity Preservation', () => {
  test('Preserves duplicate mission labels, backfills unambiguous links, and flags ambiguous links without guessing', () => {
    const dbPath = createTempDbPath('migration_test');
    const testDb = new DatabaseSync(dbPath);
    try {
      initDatabase(testDb);

      // Insert 1 unique mission and 2 duplicate-labeled missions
      testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (10, 'UNIQUE_OP', 'Unique Op', 'Sector A')`).run();
      testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (20, 'SHARED_OP', 'Shared North', 'North Gate')`).run();
      testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (21, 'SHARED_OP', 'Shared South', 'South Gate')`).run();

      // Insert 1 unambiguous registration & 1 ambiguous registration (mission_id IS NULL)
      testDb.prepare(`INSERT INTO registrations (id, reg_id, mission, country, imsi) VALUES (100, 'R1', 'UNIQUE_OP', 'Palestine', '425051111111111')`).run();
      testDb.prepare(`INSERT INTO registrations (id, reg_id, mission, country, imsi) VALUES (101, 'R2', 'SHARED_OP', 'Jordan', '416011111111111')`).run();
      testDb.prepare(`INSERT INTO network_cells (id, mission, mcc, mnc, cell_id) VALUES (200, 'SHARED_OP', 425, 25, 9001)`).run();

      runMissionIdMigration(testDb);

      const r1 = testDb.prepare(`SELECT mission_id, mission FROM registrations WHERE id = 100`).get() as any;
      const r2 = testDb.prepare(`SELECT mission_id, mission FROM registrations WHERE id = 101`).get() as any;
      const nc = testDb.prepare(`SELECT mission_id, mission FROM network_cells WHERE id = 200`).get() as any;

      assert.equal(r1.mission_id, 10, 'Unambiguous label should backfill mission_id = 10');
      assert.equal(r2.mission_id, null, 'Ambiguous label must NOT be guessed');
      assert.equal(nc.mission_id, null, 'Ambiguous network_cell mission must NOT be guessed');

      const missionsCount = (testDb.prepare(`SELECT COUNT(*) as c FROM missions WHERE mission = 'SHARED_OP'`).get() as any).c;
      assert.equal(missionsCount, 2, 'Duplicate mission labels must remain distinct rows');

      const ambiguities = testDb.prepare(`SELECT * FROM migration_ambiguities WHERE status = 'PENDING'`).all() as any[];
      assert.equal(ambiguities.length, 2, 'Both ambiguous child records must be logged for review');
    } finally {
      testDb.close();
    }
  });
});

describe('Phase 2: Analytical Queries, Country Exclusion, BTS Parsing & Filter Isolation', () => {
  test('parseBtsLocationString handles newline, comma, semicolon, whitespace, WKT and rejects (0,0) / out-of-range', () => {
    const res1 = parseBtsLocationString('31.5017 34.4668\n31.5120, 34.4780\n30.0444;31.2357\nPOINT(34.8516 32.1093)');
    assert.equal(res1.points.length, 4);
    assert.equal(res1.invalidCount, 0);
    assert.deepEqual(res1.points[3], { lat: 32.1093, lng: 34.8516 });

    const res2 = parseBtsLocationString('0 0\n95.12 31.0\nnot-a-coord\n31.90 35.20');
    assert.equal(res2.points.length, 1);
    assert.equal(res2.invalidCount, 3);
    assert.deepEqual(res2.points[0], { lat: 31.9, lng: 35.2 });
  });

  test('Aggregations enforce Egypt exclusion, distinct counts, MCC/Military/Civilian rules, BTS privacy, and strict filter isolation', () => {
    const dbPath = createTempDbPath('analytics_test');
    const testDb = new DatabaseSync(dbPath);
    try {
      initDatabase(testDb);

      testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (1, 'M_ALPHA', 'Alpha', 'Site A')`).run();
      testDb.prepare(`INSERT INTO missions (id, mission, mission_name, location) VALUES (2, 'M_BETA', 'Beta', 'Site B')`).run();

      testDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('425', '1', 'Israel', 'ISR', 'Partner')`).run();
      testDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('425', '5', 'Palestine', 'PSE', 'Jawwal')`).run();
      testDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('424', '2', 'United Arab Emirates', 'ARE', 'Etisalat UAE')`).run();
      testDb.prepare(`INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES ('602', '10', 'Egypt', 'EGY', 'Egyptian Military')`).run();

      // Registrations: duplicate IMSI for Palestine, excluded Egypt/EG/zero/null
      const insReg = testDb.prepare(`
        INSERT INTO registrations (reg_id, mission_id, mission, country, country_code, imsi, imei, tmsi, bts_name, bts_location, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insReg.run('R1', 1, 'M_ALPHA', 'Palestine', 'PS', '425050001', '350001', 'T1', 'BTS_GAZA', '31.5017 34.4668', '2026-11-10T10:00:00Z');
      insReg.run('R2', 1, 'M_ALPHA', 'Palestine', 'PS', '425050001', '350001', 'T2', 'BTS_GAZA', '31.5017 34.4668', '2026-11-10T11:00:00Z'); // same IMSI
      insReg.run('R3', 1, 'M_ALPHA', 'Palestine', 'PS', '425050002', '350002', 'T3', 'BTS_WEST', '31.9038, 35.2034', '2026-11-11T10:00:00Z');
      insReg.run('R4', 2, 'M_BETA', 'Egypt', 'EG', '602010001', '350003', 'T4', 'BTS_CAIRO', '30.0444;31.2357', '2026-11-11T12:00:00Z'); // excluded Egypt
      insReg.run('R5', 2, 'M_BETA', 'Jordan', 'JO', '0', '350004', 'T5', 'BTS_AMMAN', '0 0', '2026-11-12T12:00:00Z'); // zero IMSI + (0,0)

      // NetworkCells: Military (602/10, 425/25), Civilian (425/1, 425/5, 424/2), Excluded Civilian (602/1, 425/24)
      const insNc = testDb.prepare(`
        INSERT INTO network_cells (mission_id, mission, mcc, mnc, cell_id, rat, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insNc.run(1, 'M_ALPHA', '602', '10', '1001', 'LTE', 31.2000, 34.2000);
      insNc.run(1, 'M_ALPHA', '602', '10', '1001', 'LTE', 31.2000, 34.2000); // duplicate cell_id
      insNc.run(1, 'M_ALPHA', '425', '25', '2001', 'LTE', 31.5017, 34.4668); // overlaps BTS_GAZA
      insNc.run(1, 'M_ALPHA', '425', '1', '3001', 'LTE', 32.0853, 34.7818);
      insNc.run(1, 'M_ALPHA', '425', '5', '4001', 'UMTS', 31.5200, 34.4700);
      insNc.run(2, 'M_BETA', '424', '2', '5001', 'LTE', 25.2048, 55.2708);
      insNc.run(2, 'M_BETA', '602', '1', '6001', 'GSM', null, null); // excluded from civilian
      insNc.run(2, 'M_BETA', '425', '24', '7001', 'LTE', null, null); // excluded from civilian

      // 2.1 Registrations by Country
      const regByCountry = getRegistrationsByCountry({}, testDb);
      assert.equal(regByCountry.items.length, 1, 'Only Palestine should appear (Egypt & zero IMSI excluded)');
      assert.equal(regByCountry.items[0].country, 'Palestine');
      assert.equal(regByCountry.items[0].distinctImsiCount, 2);
      assert.equal(regByCountry.items[0].color, '#00B894');

      // 2.2 BTS Map & Privacy Check
      const btsMap = getBtsMapData({}, testDb);
      assert.ok(btsMap.locations.length >= 4);
      const sharedLoc = btsMap.locations.find(l => Math.abs(l.lat - 31.5017) < 0.001);
      assert.ok(sharedLoc, 'Shared location (31.5017, 34.4668) must exist');
      assert.equal(sharedLoc.source, 'both', 'Shared location must combine registration and network_cell sources');
      const serializedMap = JSON.stringify(btsMap.locations);
      assert.ok(!serializedMap.includes('425050001'), 'BTS Map must never expose IMSI');
      assert.ok(!serializedMap.includes('350001'), 'BTS Map must never expose IMEI');
      assert.ok(!serializedMap.includes('"T1"'), 'BTS Map must never expose TMSI');

      // 2.3 MCC Aggregation
      const byMcc = getNetworkCellsByMcc({}, testDb);
      assert.equal(byMcc.totalDistinctCells, 7);

      // 2.4 Military Networks
      const mil = getMilitaryNetworks({}, testDb);
      assert.equal(mil.totalDistinctCells, 2);
      assert.equal(mil.totalRecords, 3);
      assert.ok(
        mil.items.every(
          i => (String(i.mcc) === '602' && (String(i.mnc) === '10' || String(i.mnc) === '11')) || (String(i.mcc) === '425' && String(i.mnc) === '25')
        )
      );

      // 2.5 Civilian Networks
      const civ = getCivilianNetworks({}, testDb);
      const pairs = civ.items.map(i => `${i.mcc}/${i.mnc}`);
      assert.ok(!pairs.includes('602/1'), '602/1 must be excluded from civilian');
      assert.ok(!pairs.includes('425/24'), '425/24 must be excluded from civilian');
      assert.ok(pairs.includes('425/1') && pairs.includes('425/5') && pairs.includes('424/2'));

      // Filter Isolation: Registration date filter MUST NOT filter NetworkCells
      const baselineKpis = getDashboardKPIs({}, testDb);
      const regDateFiltered = getDashboardKPIs({ lastSeenFrom: '2099-01-01', lastSeenTo: '2099-01-02' }, testDb);
      assert.equal(regDateFiltered.kpis.totalRegistrations, 0, 'Date filter filters registrations');
      assert.equal(
        regDateFiltered.kpis.totalNetworkCells,
        baselineKpis.kpis.totalNetworkCells,
        'Registration date filter MUST NOT alter NetworkCell KPIs'
      );

      // NetworkCell RAT filter MUST NOT alter Registration KPIs
      const ratFiltered = getDashboardKPIs({ rat: ['UMTS'] }, testDb);
      assert.equal(ratFiltered.kpis.distinctNetworkCells, 1);
      assert.equal(
        ratFiltered.kpis.totalRegistrations,
        baselineKpis.kpis.totalRegistrations,
        'NetworkCell RAT filter MUST NOT alter Registration KPIs'
      );
    } finally {
      testDb.close();
    }
  });
});

describe('Phase 2: Multi-Table SQLite Import', () => {
  test('Inspects non-system tables, validates dry-run estimates, and executes dependency-ordered import preserving duplicate missions', async () => {
    const extSqlitePath = createTempDbPath('external_source');
    const targetDbPath = createTempDbPath('import_target');

    const srcDb = new DatabaseSync(extSqlitePath);
    srcDb.exec(`
      CREATE TABLE missions (id INTEGER PRIMARY KEY, mission TEXT, mission_name TEXT, location TEXT);
      CREATE TABLE registrations (id INTEGER PRIMARY KEY, reg_id TEXT, mission_id INTEGER, mission TEXT, country TEXT, imsi TEXT, bts_location TEXT);
      CREATE TABLE network_cells (id INTEGER PRIMARY KEY, mission_id INTEGER, mission TEXT, mcc INTEGER, mnc INTEGER, cell_id INTEGER, rat TEXT);

      INSERT INTO missions VALUES (1, 'DUP_LABEL', 'North Sector', 'North');
      INSERT INTO missions VALUES (2, 'DUP_LABEL', 'South Sector', 'South');
      INSERT INTO registrations VALUES (1, 'IMP_R1', 1, 'DUP_LABEL', 'Lebanon', '415010001', '33.8938 35.5018');
      INSERT INTO registrations VALUES (2, 'IMP_R2', 2, 'DUP_LABEL', 'Syria', '417010002', '33.5138 36.2765');
      INSERT INTO network_cells VALUES (1, 1, 'DUP_LABEL', 425, 25, 8881, 'LTE');
    `);
    srcDb.close();

    const inspection = await inspectFile(extSqlitePath, 'field_export.sqlite');
    assert.equal(inspection.type, 'SQLITE');
    assert.ok(inspection.tables && inspection.tables.length === 3);
    assert.ok(!inspection.tables.some(t => t.tableName.startsWith('sqlite_')));
    assert.equal(inspection.tables[0].tableName, 'missions', 'Missions should sort first by dependencyOrder');

    const targetDb = new DatabaseSync(targetDbPath);
    try {
      initDatabase(targetDb);

      const configs: MultiSqliteTableConfig[] = [
        {
          sourceTable: 'network_cells',
          destinationTable: 'network_cells',
          columnMapping: { mission_id: 'mission_id', mission: 'mission', mcc: 'mcc', mnc: 'mnc', cell_id: 'cell_id', rat: 'rat' },
          conflictMode: 'skip' as const,
        },
        {
          sourceTable: 'missions',
          destinationTable: 'missions',
          columnMapping: { id: 'id', mission: 'mission', mission_name: 'mission_name', location: 'location' },
          conflictMode: 'skip' as const,
        },
        {
          sourceTable: 'registrations',
          destinationTable: 'registrations',
          columnMapping: { reg_id: 'reg_id', mission_id: 'mission_id', mission: 'mission', country: 'country', imsi: 'imsi', bts_location: 'bts_location' },
          conflictMode: 'skip' as const,
        },
      ];

      const est = estimateMultiSqliteImport(extSqlitePath, configs, targetDb);
      assert.equal(est.estimates[0].sourceTable, 'missions', 'Estimator should order missions before child tables');
      assert.equal(est.estimates[0].estimatedInsert, 2);

      const execRes = await executeMultiSqliteImport(
        {
          filePath: extSqlitePath,
          originalName: 'field_export.sqlite',
          tables: configs,
          userId: 1,
          username: 'admin',
        },
        targetDb
      );

      assert.equal(execRes.totals.inserted, 5);
      const importedMissions = targetDb.prepare(`SELECT * FROM missions WHERE mission = 'DUP_LABEL'`).all() as any[];
      assert.equal(importedMissions.length, 2, 'Duplicate mission labels must be imported separately without merging');

      const importedReg2 = targetDb.prepare(`SELECT mission_id FROM registrations WHERE reg_id = 'IMP_R2'`).get() as any;
      assert.equal(importedReg2.mission_id, importedMissions[1].id, 'Child record should remap to exact second mission ID');
    } finally {
      targetDb.close();
    }
  });
});

describe('Phase 2: RBAC Permissions & PDF/Excel/Word Export Generation', () => {
  test('RBAC restricts Viewer exports & unmasked identifiers while allowing Admin', () => {
    assert.equal(ROLE_PERMISSIONS.VIEWER.canExport, false);
    assert.equal(ROLE_PERMISSIONS.VIEWER.canViewUnmaskedData, false);
    assert.equal(ROLE_PERMISSIONS.DATA_ANALYST.canExport, true);
    assert.equal(ROLE_PERMISSIONS.DATA_ANALYST.canViewUnmaskedData, false);
    assert.equal(ROLE_PERMISSIONS.SUPER_ADMIN.canExport, true);
    assert.equal(ROLE_PERMISSIONS.SUPER_ADMIN.canViewUnmaskedData, true);

    const tok = generateToken({
      id: 1,
      username: 'admin',
      email: 'admin@enterprise.local',
      fullName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    assert.ok(tok.split('.').length === 3);
  });

  test('Generates valid PDF, Excel (.xlsx), and Word (.docx) dashboard reports with Arabic & English support', async () => {
    initDatabase();
    const baseScope = {
      kpis: true,
      appliedFilters: true,
      registrationsByCountry: true,
      btsMap: true,
      networkCellsByMcc: true,
      militaryNetworks: true,
      civilianNetworks: true,
      includeDetailedRecords: false,
      includeSensitiveIdentifiers: false,
    };

    const pdfRes = await generateDashboardExport({
      format: 'pdf',
      language: 'ar',
      filters: {},
      scope: baseScope,
      username: 'test_runner',
      canUnmask: true,
    });
    assert.equal(pdfRes.buffer.subarray(0, 5).toString('utf8'), '%PDF-', 'Generated PDF must start with %PDF- signature');
    assert.ok(pdfRes.buffer.length > 2000);

    const xlsxRes = await generateDashboardExport({
      format: 'xlsx',
      language: 'en',
      filters: {},
      scope: baseScope,
      username: 'test_runner',
      canUnmask: true,
    });
    assert.equal(xlsxRes.buffer.subarray(0, 2).toString('utf8'), 'PK', 'Generated XLSX must be a valid ZIP archive');

    const docxRes = await generateDashboardExport({
      format: 'docx',
      language: 'ar',
      filters: {},
      scope: baseScope,
      username: 'test_runner',
      canUnmask: true,
    });
    assert.equal(docxRes.buffer.subarray(0, 2).toString('utf8'), 'PK', 'Generated DOCX must be a valid ZIP archive');

    // Remove temporary generated test export files & records cleanly
    for (const r of [pdfRes, xlsxRes, docxRes]) {
      try {
        if (fs.existsSync(r.filePath)) fs.unlinkSync(r.filePath);
      } catch {
        // ignore
      }
    }
  });
});
