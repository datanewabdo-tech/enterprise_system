import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'enterprise.sqlite');
export const db = new DatabaseSync(DB_PATH);

// Enable foreign keys, busy timeout, and WAL mode for high performance and concurrency safety
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export const MISSION_LINKED_TABLES: Array<{ table: string; labelCol: string }> = [
  { table: 'registrations', labelCol: 'mission' },
  { table: 'targets', labelCol: 'mission' },
  { table: 'mission_extras', labelCol: 'mission_name' },
  { table: 'location_extras', labelCol: 'mission_id' }, // already uses mission_id
  { table: 'network_cells', labelCol: 'mission' },
  { table: 'wifi_access_points', labelCol: 'mission' },
  { table: 'gps_history', labelCol: 'mission' },
  { table: 'map_cell_databases', labelCol: 'mission' },
  { table: 'sms_calls', labelCol: 'mission' },
  { table: 'map_user_markers', labelCol: 'mission' },
  { table: 'map_user_polygons', labelCol: 'mission' },
  { table: 'map_user_circles', labelCol: 'mission' },
];

// Initialize all 23 Domain Tables + System Tables + Phase 2 Schema Migration
export function initDatabase(targetDb: DatabaseSync = db) {
  targetDb.exec('PRAGMA busy_timeout = 5000;');
  targetDb.exec(`
    -- 1. Missions (non-unique mission label allowed; id is primary key)
    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission TEXT NOT NULL,
      mission_name TEXT,
      location TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Registrations
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reg_id TEXT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      bts TEXT,
      bts_name TEXT,
      country TEXT,
      tmsi TEXT,
      imsi TEXT,
      imei TEXT,
      ue_model TEXT,
      mcc TEXT,
      mnc TEXT,
      lac INTEGER,
      rat INTEGER,
      last_event TEXT,
      time INTEGER,
      target_name TEXT,
      uplink_power REAL,
      bts_location TEXT,
      bts_altitude REAL,
      bts_location_outdated INTEGER DEFAULT 0,
      distance_min REAL,
      distance_max REAL,
      country_code TEXT,
      device_location TEXT,
      last_seen DATETIME,
      "update" TEXT,
      action TEXT
    );

    -- 3. Targets
    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      mission_name TEXT,
      imsi TEXT,
      imei TEXT,
      name TEXT NOT NULL,
      action TEXT,
      redirect_tech TEXT,
      redirect_bsic TEXT,
      redirect_channel TEXT,
      description TEXT,
      is_p_c_s1900 INTEGER DEFAULT 0
    );

    -- 4. Mission Extras
    CREATE TABLE IF NOT EXISTS mission_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission_name TEXT,
      description TEXT NOT NULL
    );

    -- 5. Location Extras
    CREATE TABLE IF NOT EXISTS location_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      description TEXT NOT NULL
    );

    -- 6. Mission Files
    CREATE TABLE IF NOT EXISTS mission_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_extra_id INTEGER NOT NULL REFERENCES mission_extras(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 7. Location Files
    CREATE TABLE IF NOT EXISTS location_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_extra_id INTEGER NOT NULL REFERENCES location_extras(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 8. Network Cells
    CREATE TABLE IF NOT EXISTS network_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      channel INTEGER,
      lac TEXT,
      mcc TEXT,
      mnc TEXT,
      rx_lev REAL,
      cell_id TEXT,
      rat TEXT,
      bsic TEXT,
      psc TEXT,
      pci TEXT,
      is_pcs1900 INTEGER DEFAULT 0,
      rx_lev_dbm REAL,
      downlink REAL,
      dl_bandwidth REAL,
      latitude REAL,
      longitude REAL,
      direction REAL,
      is_neighbour INTEGER DEFAULT 0,
      cid_lac_mnc TEXT
    );

    -- 9. WiFi Access Points
    CREATE TABLE IF NOT EXISTS wifi_access_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      bssid TEXT UNIQUE NOT NULL,
      essid TEXT,
      enc TEXT,
      channel INTEGER,
      first_seen DATETIME,
      last_seen DATETIME,
      strength REAL,
      hidden INTEGER DEFAULT 0,
      manufacturer TEXT,
      wanted INTEGER DEFAULT 0,
      essid_bssid_id TEXT
    );

    -- 10. WiFi Access Point Clients
    CREATE TABLE IF NOT EXISTS wifi_access_point_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wifi_access_point_essid_bssid TEXT NOT NULL,
      mac TEXT NOT NULL,
      first_seen DATETIME,
      last_seen DATETIME,
      wants TEXT,
      manufacturer TEXT
    );

    -- 11. GPS History
    CREATE TABLE IF NOT EXISTS gps_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      bts_id TEXT,
      silent_target_reg_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      dl_pow REAL,
      ul_pow REAL,
      distance_min REAL,
      distance_max REAL,
      time_dl REAL
    );

    -- 12. Map Cell Databases
    CREATE TABLE IF NOT EXISTS map_cell_databases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      name TEXT NOT NULL,
      header TEXT,
      color TEXT DEFAULT '#3b82f6'
    );

    -- 13. Map Cells
    CREATE TABLE IF NOT EXISTS map_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      db_id INTEGER NOT NULL REFERENCES map_cell_databases(id) ON DELETE CASCADE,
      contents TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      mcc TEXT,
      mnc TEXT,
      lac TEXT,
      cid TEXT,
      mcc_mnc_junction TEXT,
      address TEXT,
      direction REAL,
      format_hex TEXT,
      opening_angle REAL,
      radius REAL,
      sc_pci INTEGER,
      channel INTEGER,
      antenna_type TEXT
    );

    -- 14. PLMN Storage
    CREATE TABLE IF NOT EXISTS plmn_storage (
      mcc TEXT NOT NULL,
      mnc TEXT NOT NULL,
      country TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (mcc, mnc)
    );

    -- 15. SMS & Calls
    CREATE TABLE IF NOT EXISTS sms_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sms_id TEXT,
      call_id TEXT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      incoming INTEGER DEFAULT 1,
      is_sms INTEGER DEFAULT 1,
      source TEXT,
      destination TEXT,
      bts_id TEXT,
      bts_name TEXT,
      status TEXT,
      sms_content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. Map User Markers
    CREATE TABLE IF NOT EXISTS map_user_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      direction REAL,
      type TEXT,
      description TEXT,
      image TEXT,
      color TEXT DEFAULT '#ef4444',
      width REAL DEFAULT 32,
      height REAL DEFAULT 32,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 17. Map User Polygons
    CREATE TABLE IF NOT EXISTS map_user_polygons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      points TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT DEFAULT '#8b5cf6',
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 18. Map User Circles
    CREATE TABLE IF NOT EXISTS map_user_circles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
      mission TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius REAL NOT NULL,
      label TEXT NOT NULL,
      color TEXT DEFAULT '#10b981',
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. Target Files
    CREATE TABLE IF NOT EXISTS target_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 20. Whitelist Targets
    CREATE TABLE IF NOT EXISTS whitelist_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      imsi TEXT,
      imei TEXT
    );

    -- 21. TAC Numbers
    CREATE TABLE IF NOT EXISTS tac_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tac_id TEXT,
      name TEXT NOT NULL,
      tac TEXT UNIQUE NOT NULL
    );

    -- 22. Scheduled Tasks
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      execution_time DATETIME NOT NULL,
      json_params TEXT NOT NULL,
      prettified_params TEXT,
      status TEXT DEFAULT 'PENDING'
    );

    -- 23. Map Layers
    CREATE TABLE IF NOT EXISTS map_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL
    );

    -- System Tables
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'VIEWER',
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      record_id TEXT,
      ip_address TEXT,
      result TEXT DEFAULT 'SUCCESS',
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      destination_table TEXT NOT NULL,
      inserted_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_log TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS export_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      format TEXT NOT NULL,
      scope TEXT NOT NULL,
      selected_missions TEXT,
      applied_filters TEXT,
      status TEXT DEFAULT 'COMPLETED',
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      error_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS migration_ambiguities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      mission_label TEXT NOT NULL,
      candidate_mission_ids TEXT NOT NULL,
      resolved_mission_id INTEGER,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saved_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      table_name TEXT NOT NULL,
      view_name TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      sort_json TEXT,
      columns_json TEXT,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  runMissionIdMigration(targetDb);
  runPhase3TypeAlignmentMigration(targetDb);
  ensurePhase2Indexes(targetDb);

  if (targetDb === db) {
    seedDefaultData();
    seedPhase2Enrichment();
  }
}

/**
 * Safely migrates an existing Phase 1 database (or freshly opened DB) to Phase 2:
 * - Removes UNIQUE constraint from missions.mission and adds missions.mission_name
 * - Adds mission_id column to all 12 mission-related tables
 * - Backfills mission_id ONLY when exactly 1 mission matches the label
 * - Flags ambiguous matches (>1 mission with same label) in migration_ambiguities without guessing
 */
export function runMissionIdMigration(targetDb: DatabaseSync = db) {
  const getCols = (tbl: string) =>
    (targetDb.prepare(`PRAGMA table_info("${tbl}")`).all() as Array<{ name: string }>).map(c => c.name);

  // 1. Check if missions table has UNIQUE on mission or lacks mission_name
  const missionSqlRow = targetDb
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='missions'`)
    .get() as { sql?: string } | undefined;
  const missionCols = getCols('missions');
  const hasUniqueConstraint = missionSqlRow?.sql ? /mission\s+TEXT\s+UNIQUE/i.test(missionSqlRow.sql) : false;

  if (hasUniqueConstraint) {
    targetDb.exec('PRAGMA foreign_keys = OFF;');
    targetDb.exec('BEGIN TRANSACTION;');
    try {
      targetDb.exec(`
        CREATE TABLE missions_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mission TEXT NOT NULL,
          mission_name TEXT,
          location TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO missions_v2 (id, mission, mission_name, location, created_at)
        SELECT id, mission, ${missionCols.includes('mission_name') ? 'mission_name' : 'mission'}, location, created_at FROM missions;
        DROP TABLE missions;
        ALTER TABLE missions_v2 RENAME TO missions;
      `);
      targetDb.exec('COMMIT;');
    } catch (e) {
      targetDb.exec('ROLLBACK;');
      throw e;
    } finally {
      targetDb.exec('PRAGMA foreign_keys = ON;');
    }
  } else if (!missionCols.includes('mission_name')) {
    targetDb.exec('ALTER TABLE missions ADD COLUMN mission_name TEXT;');
    targetDb.exec('UPDATE missions SET mission_name = mission WHERE mission_name IS NULL;');
  }

  // 2. Ensure mission_id exists on all 12 mission-linked tables and backfill unambiguously
  for (const { table, labelCol } of MISSION_LINKED_TABLES) {
    const cols = getCols(table);
    if (!cols.includes('mission_id')) {
      targetDb.exec(`ALTER TABLE "${table}" ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL;`);
    }

    if (labelCol === 'mission_id') {
      continue;
    }

    // Backfill unambiguous exact matches (COUNT(*) = 1)
    targetDb.exec(`
      UPDATE "${table}"
      SET mission_id = (
        SELECT m.id FROM missions m WHERE m.mission = "${table}"."${labelCol}" LIMIT 1
      )
      WHERE mission_id IS NULL
        AND "${labelCol}" IS NOT NULL
        AND "${labelCol}" != ''
        AND (SELECT COUNT(*) FROM missions m2 WHERE m2.mission = "${table}"."${labelCol}") = 1;
    `);

    // Detect and flag ambiguous matches (> 1 mission sharing the same label) without guessing
    const ambiguousRows = targetDb.prepare(`
      SELECT id, "${labelCol}" as label
      FROM "${table}"
      WHERE mission_id IS NULL
        AND "${labelCol}" IS NOT NULL
        AND "${labelCol}" != ''
        AND (SELECT COUNT(*) FROM missions m WHERE m.mission = "${table}"."${labelCol}") > 1
    `).all() as Array<{ id: number; label: string }>;

    for (const row of ambiguousRows) {
      const existingFlag = targetDb
        .prepare(`SELECT id FROM migration_ambiguities WHERE table_name = ? AND record_id = ? AND status = 'PENDING'`)
        .get(table, row.id);
      if (!existingFlag) {
        const candidates = (
          targetDb.prepare(`SELECT id FROM missions WHERE mission = ? ORDER BY id ASC`).all(row.label) as Array<{ id: number }>
        ).map(c => c.id);
        targetDb.prepare(`
          INSERT INTO migration_ambiguities (table_name, record_id, mission_label, candidate_mission_ids, status)
          VALUES (?, ?, ?, ?, 'PENDING')
        `).run(table, row.id, row.label, candidates.join(','));
      }
    }
  }
}

/**
 * Phase 3 Non-Destructive Type & Foreign-Key Alignment Migration:
 * - Adds missing source columns on registrations (mcc, mnc, lac, rat, last_event, time, target_name, uplink_power)
 * - Adds missing psc column on network_cells
 * - Converts network_cells (lac, mcc, mnc, cell_id, bsic, pci), plmn_storage (mcc, mnc),
 *   and map_cells (mcc, mnc, lac, cid) to TEXT losslessly (preserving NULLs and identifiers)
 * - Restores missing SQLite foreign keys and fixes map_user_markers.description TEXT
 * - Idempotent and verifies row counts before & after any table rebuild
 */
export function runPhase3TypeAlignmentMigration(targetDb: DatabaseSync = db) {
  const getColInfos = (tbl: string) =>
    targetDb.prepare(`PRAGMA table_info("${tbl}")`).all() as Array<{ name: string; type: string }>;
  const getFks = (tbl: string) =>
    targetDb.prepare(`PRAGMA foreign_key_list("${tbl}")`).all() as Array<{ table: string; from: string; to: string }>;

  // 1. Add missing registrations columns
  const regCols = new Set(getColInfos('registrations').map(c => c.name));
  const regAdditions: Array<[string, string]> = [
    ['mcc', 'TEXT'],
    ['mnc', 'TEXT'],
    ['lac', 'INTEGER'],
    ['rat', 'INTEGER'],
    ['last_event', 'TEXT'],
    ['time', 'INTEGER'],
    ['target_name', 'TEXT'],
    ['uplink_power', 'REAL'],
  ];
  for (const [col, type] of regAdditions) {
    if (!regCols.has(col)) {
      targetDb.exec(`ALTER TABLE registrations ADD COLUMN "${col}" ${type};`);
    }
  }

  // 2. Add missing network_cells.psc
  const ncInfos = getColInfos('network_cells');
  if (!ncInfos.some(c => c.name === 'psc')) {
    targetDb.exec(`ALTER TABLE network_cells ADD COLUMN psc TEXT;`);
  }

  const rebuildTable = (tableName: string, createV2Sql: string, insertCols: string[], selectExprs: string[]) => {
    const beforeCount = (targetDb.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get() as { c: number }).c;
    const tempName = `${tableName}_p3_v2`;
    targetDb.exec('PRAGMA foreign_keys = OFF;');
    targetDb.exec('BEGIN TRANSACTION;');
    try {
      targetDb.exec(`DROP TABLE IF EXISTS "${tempName}";`);
      targetDb.exec(createV2Sql.replace(`"${tableName}"`, `"${tempName}"`));
      targetDb.exec(`
        INSERT INTO "${tempName}" (${insertCols.map(c => `"${c}"`).join(', ')})
        SELECT ${selectExprs.join(', ')} FROM "${tableName}";
      `);
      const afterCount = (targetDb.prepare(`SELECT COUNT(*) as c FROM "${tempName}"`).get() as { c: number }).c;
      if (afterCount !== beforeCount) {
        throw new Error(`Phase 3 migration row count mismatch for ${tableName}: before=${beforeCount}, after=${afterCount}`);
      }
      targetDb.exec(`DROP TABLE "${tableName}";`);
      targetDb.exec(`ALTER TABLE "${tempName}" RENAME TO "${tableName}";`);
      targetDb.exec('COMMIT;');
    } catch (e) {
      targetDb.exec('ROLLBACK;');
      throw e;
    } finally {
      targetDb.exec('PRAGMA foreign_keys = ON;');
    }
  };

  // 3. Align network_cells identifier columns (lac, mcc, mnc, cell_id, bsic, pci) to TEXT
  const ncTypeMap = new Map(getColInfos('network_cells').map(c => [c.name, c.type.toUpperCase()]));
  const ncNeedsText = ['lac', 'mcc', 'mnc', 'cell_id', 'bsic', 'pci'].some(c => ncTypeMap.get(c) !== 'TEXT');
  if (ncNeedsText) {
    const cols = [
      'id', 'mission_id', 'mission', 'channel', 'lac', 'mcc', 'mnc', 'rx_lev',
      'cell_id', 'rat', 'bsic', 'psc', 'pci', 'is_pcs1900', 'rx_lev_dbm',
      'downlink', 'dl_bandwidth', 'latitude', 'longitude', 'direction', 'is_neighbour', 'cid_lac_mnc',
    ];
    const castCols = new Set(['lac', 'mcc', 'mnc', 'cell_id', 'bsic', 'psc', 'pci']);
    rebuildTable(
      'network_cells',
      `CREATE TABLE "network_cells" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
        mission TEXT,
        channel INTEGER,
        lac TEXT,
        mcc TEXT,
        mnc TEXT,
        rx_lev REAL,
        cell_id TEXT,
        rat TEXT,
        bsic TEXT,
        psc TEXT,
        pci TEXT,
        is_pcs1900 INTEGER DEFAULT 0,
        rx_lev_dbm REAL,
        downlink REAL,
        dl_bandwidth REAL,
        latitude REAL,
        longitude REAL,
        direction REAL,
        is_neighbour INTEGER DEFAULT 0,
        cid_lac_mnc TEXT
      );`,
      cols,
      cols.map(c => (castCols.has(c) ? `CASE WHEN "${c}" IS NULL THEN NULL ELSE CAST("${c}" AS TEXT) END` : `"${c}"`))
    );
  }

  // 4. Align plmn_storage composite PK (mcc, mnc) to TEXT
  const plmnTypeMap = new Map(getColInfos('plmn_storage').map(c => [c.name, c.type.toUpperCase()]));
  if (plmnTypeMap.get('mcc') !== 'TEXT' || plmnTypeMap.get('mnc') !== 'TEXT') {
    rebuildTable(
      'plmn_storage',
      `CREATE TABLE "plmn_storage" (
        mcc TEXT NOT NULL,
        mnc TEXT NOT NULL,
        country TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (mcc, mnc)
      );`,
      ['mcc', 'mnc', 'country', 'code', 'name'],
      ['CAST("mcc" AS TEXT)', 'CAST("mnc" AS TEXT)', '"country"', '"code"', '"name"']
    );
  }

  // 5. Align map_cells (mcc, mnc, lac, cid -> TEXT) + FK db_id -> map_cell_databases(id)
  const mcTypeMap = new Map(getColInfos('map_cells').map(c => [c.name, c.type.toUpperCase()]));
  const mcHasFk = getFks('map_cells').some(f => f.from === 'db_id' && f.table === 'map_cell_databases');
  if (['mcc', 'mnc', 'lac', 'cid'].some(c => mcTypeMap.get(c) !== 'TEXT') || !mcHasFk) {
    const cols = [
      'id', 'db_id', 'contents', 'lat', 'lng', 'mcc', 'mnc', 'lac', 'cid',
      'mcc_mnc_junction', 'address', 'direction', 'format_hex', 'opening_angle',
      'radius', 'sc_pci', 'channel', 'antenna_type',
    ];
    const castCols = new Set(['mcc', 'mnc', 'lac', 'cid']);
    rebuildTable(
      'map_cells',
      `CREATE TABLE "map_cells" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        db_id INTEGER NOT NULL REFERENCES map_cell_databases(id) ON DELETE CASCADE,
        contents TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        mcc TEXT,
        mnc TEXT,
        lac TEXT,
        cid TEXT,
        mcc_mnc_junction TEXT,
        address TEXT,
        direction REAL,
        format_hex TEXT,
        opening_angle REAL,
        radius REAL,
        sc_pci INTEGER,
        channel INTEGER,
        antenna_type TEXT
      );`,
      cols,
      cols.map(c => (castCols.has(c) ? `CASE WHEN "${c}" IS NULL THEN NULL ELSE CAST("${c}" AS TEXT) END` : `"${c}"`))
    );
  }

  // 6. Ensure missing SQLite foreign keys on location_extras, mission_files, location_files, target_files
  if (!getFks('location_extras').some(f => f.from === 'mission_id' && f.table === 'missions')) {
    rebuildTable(
      'location_extras',
      `CREATE TABLE "location_extras" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        description TEXT NOT NULL
      );`,
      ['id', 'mission_id', 'description'],
      ['"id"', '"mission_id"', '"description"']
    );
  }
  if (!getFks('mission_files').some(f => f.from === 'mission_extra_id' && f.table === 'mission_extras')) {
    rebuildTable(
      'mission_files',
      `CREATE TABLE "mission_files" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_extra_id INTEGER NOT NULL REFERENCES mission_extras(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      ['id', 'mission_extra_id', 'file_path', 'file_type', 'original_file_name', 'added_at'],
      ['"id"', '"mission_extra_id"', '"file_path"', '"file_type"', '"original_file_name"', '"added_at"']
    );
  }
  if (!getFks('location_files').some(f => f.from === 'location_extra_id' && f.table === 'location_extras')) {
    rebuildTable(
      'location_files',
      `CREATE TABLE "location_files" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_extra_id INTEGER NOT NULL REFERENCES location_extras(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      ['id', 'location_extra_id', 'file_path', 'file_type', 'original_file_name', 'added_at'],
      ['"id"', '"location_extra_id"', '"file_path"', '"file_type"', '"original_file_name"', '"added_at"']
    );
  }
  if (!getFks('target_files').some(f => f.from === 'target_id' && f.table === 'targets')) {
    rebuildTable(
      'target_files',
      `CREATE TABLE "target_files" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      ['id', 'target_id', 'file_path', 'file_type', 'original_file_name', 'added_at'],
      ['"id"', '"target_id"', '"file_path"', '"file_type"', '"original_file_name"', '"added_at"']
    );
  }

  // 7. Fix map_user_markers.description column type if declared as 'String'
  const markerDesc = getColInfos('map_user_markers').find(c => c.name === 'description');
  if (markerDesc && markerDesc.type.toUpperCase() !== 'TEXT') {
    const cols = ['id', 'mission_id', 'mission', 'direction', 'type', 'description', 'image', 'color', 'width', 'height', 'latitude', 'longitude', 'timestamp'];
    rebuildTable(
      'map_user_markers',
      `CREATE TABLE "map_user_markers" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
        mission TEXT,
        direction REAL,
        type TEXT,
        description TEXT,
        image TEXT,
        color TEXT DEFAULT '#ef4444',
        width REAL DEFAULT 32,
        height REAL DEFAULT 32,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      cols,
      cols.map(c => `"${c}"`)
    );
  }
}

export function ensurePhase2Indexes(targetDb: DatabaseSync = db) {
  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_missions_mission ON missions(mission);
    CREATE INDEX IF NOT EXISTS idx_missions_location ON missions(location);

    CREATE INDEX IF NOT EXISTS idx_reg_mission_id ON registrations(mission_id);
    CREATE INDEX IF NOT EXISTS idx_reg_mission ON registrations(mission);
    CREATE INDEX IF NOT EXISTS idx_reg_country ON registrations(country);
    CREATE INDEX IF NOT EXISTS idx_reg_country_code ON registrations(country_code);
    CREATE INDEX IF NOT EXISTS idx_reg_imsi ON registrations(imsi);
    CREATE INDEX IF NOT EXISTS idx_reg_imei ON registrations(imei);
    CREATE INDEX IF NOT EXISTS idx_reg_mcc ON registrations(mcc);
    CREATE INDEX IF NOT EXISTS idx_reg_lac ON registrations(lac);
    CREATE INDEX IF NOT EXISTS idx_reg_last_seen ON registrations(last_seen);
    CREATE INDEX IF NOT EXISTS idx_reg_bts_name ON registrations(bts_name);
    CREATE INDEX IF NOT EXISTS idx_reg_ue_model ON registrations(ue_model);

    CREATE INDEX IF NOT EXISTS idx_targets_mission_id ON targets(mission_id);
    CREATE INDEX IF NOT EXISTS idx_targets_imsi ON targets(imsi);
    CREATE INDEX IF NOT EXISTS idx_targets_imei ON targets(imei);
    CREATE INDEX IF NOT EXISTS idx_mission_extras_mission_id ON mission_extras(mission_id);
    CREATE INDEX IF NOT EXISTS idx_location_extras_mission_id ON location_extras(mission_id);

    CREATE INDEX IF NOT EXISTS idx_nc_mission_id ON network_cells(mission_id);
    CREATE INDEX IF NOT EXISTS idx_nc_mission ON network_cells(mission);
    CREATE INDEX IF NOT EXISTS idx_nc_mcc ON network_cells(mcc);
    CREATE INDEX IF NOT EXISTS idx_nc_mcc_mnc ON network_cells(mcc, mnc);
    CREATE INDEX IF NOT EXISTS idx_nc_cell_id ON network_cells(cell_id);
    CREATE INDEX IF NOT EXISTS idx_nc_rat ON network_cells(rat);
    CREATE INDEX IF NOT EXISTS idx_nc_lac ON network_cells(lac);
    CREATE INDEX IF NOT EXISTS idx_nc_coords ON network_cells(latitude, longitude);

    CREATE INDEX IF NOT EXISTS idx_wifi_mission_id ON wifi_access_points(mission_id);
    CREATE INDEX IF NOT EXISTS idx_gps_mission_id ON gps_history(mission_id);
    CREATE INDEX IF NOT EXISTS idx_gps_coords ON gps_history(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_mcdb_mission_id ON map_cell_databases(mission_id);
    CREATE INDEX IF NOT EXISTS idx_mc_coords ON map_cells(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_sms_mission_id ON sms_calls(mission_id);
    CREATE INDEX IF NOT EXISTS idx_markers_mission_id ON map_user_markers(mission_id);
    CREATE INDEX IF NOT EXISTS idx_polygons_mission_id ON map_user_polygons(mission_id);
    CREATE INDEX IF NOT EXISTS idx_circles_mission_id ON map_user_circles(mission_id);
    CREATE INDEX IF NOT EXISTS idx_plmn_country ON plmn_storage(country);
    CREATE INDEX IF NOT EXISTS idx_export_history_created ON export_history(created_at);
  `);
}

// Seed default users, settings, and rich operational datasets
function seedDefaultData() {
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCheck.count === 0) {
    const adminHash = '$2a$10$f3Fz9UqG1L7n2D6fW2T0p.Z1lRkP5D9m2zX3vC4b5N6m7A8s9D0e1';
    db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, role, status)
      VALUES
        ('admin', 'admin@enterprise.local', '${adminHash}', 'System Administrator', 'SUPER_ADMIN', 'ACTIVE'),
        ('analyst', 'analyst@enterprise.local', '${adminHash}', 'Senior Data Analyst', 'DATA_ANALYST', 'ACTIVE'),
        ('manager', 'manager@enterprise.local', '${adminHash}', 'Operations Manager', 'DATA_MANAGER', 'ACTIVE'),
        ('viewer', 'viewer@enterprise.local', '${adminHash}', 'Read-Only Observer', 'VIEWER', 'ACTIVE')
    `).run();

    db.prepare(`
      INSERT INTO app_settings (key, value, description)
      VALUES
        ('system_name', 'Enterprise Data Management & Mapping Platform', 'System Title'),
        ('retention_days', '180', 'Default audit and telemetry retention in days'),
        ('mask_sensitive_data', 'true', 'Mask IMSI, IMEI, and private contents for analyst & viewer roles'),
        ('max_upload_size_mb', '100', 'Maximum allowed upload file size')
    `).run();

    // Seed Missions
    const missions = [
      { mission: 'ALPHA_RED_01', mission_name: 'Operation Alpha Red', location: 'Metropolitan Central Sector' },
      { mission: 'BRAVO_SURVEIL_04', mission_name: 'Operation Bravo Surveil', location: 'Northern Border Corridor' },
      { mission: 'DELTA_SENTINEL_09', mission_name: 'Operation Delta Sentinel', location: 'Maritime Coastal Zone' },
      { mission: 'ECHO_SHADOW_12', mission_name: 'Operation Echo Shadow', location: 'Eastern Transit Hub' },
      { mission: 'OMEGA_FORTRESS_22', mission_name: 'Operation Omega Fortress', location: 'Capital Diplomatic Enclave' },
    ];
    const insertMission = db.prepare('INSERT INTO missions (mission, mission_name, location) VALUES (?, ?, ?)');
    for (const m of missions) insertMission.run(m.mission, m.mission_name, m.location);

    // Seed PLMN Storage
    const plmns = [
      { mcc: '602', mnc: '1', country: 'Egypt', code: 'EGY', name: 'Vodafone Egypt' },
      { mcc: '602', mnc: '2', country: 'Egypt', code: 'EGY', name: 'Orange Egypt' },
      { mcc: '602', mnc: '3', country: 'Egypt', code: 'EGY', name: 'Etisalat Egypt' },
      { mcc: '602', mnc: '4', country: 'Egypt', code: 'EGY', name: 'Telecom Egypt (WE)' },
      { mcc: '420', mnc: '1', country: 'Saudi Arabia', code: 'SAU', name: 'STC' },
      { mcc: '420', mnc: '3', country: 'Saudi Arabia', code: 'SAU', name: 'Mobily' },
      { mcc: '424', mnc: '2', country: 'United Arab Emirates', code: 'ARE', name: 'Etisalat UAE (e&)' },
      { mcc: '424', mnc: '3', country: 'United Arab Emirates', code: 'ARE', name: 'du' },
      { mcc: '208', mnc: '1', country: 'France', code: 'FRA', name: 'Orange France' },
      { mcc: '234', mnc: '15', country: 'United Kingdom', code: 'GBR', name: 'Vodafone UK' },
      { mcc: '310', mnc: '410', country: 'United States', code: 'USA', name: 'AT&T Mobility' },
    ];
    const insertPlmn = db.prepare('INSERT INTO plmn_storage (mcc, mnc, country, code, name) VALUES (?, ?, ?, ?, ?)');
    for (const p of plmns) insertPlmn.run(p.mcc, p.mnc, p.country, p.code, p.name);

    // Seed TAC Numbers
    const tacs = [
      { tac_id: 'TAC_001', name: 'Apple iPhone 15 Pro Max', tac: '35678211' },
      { tac_id: 'TAC_002', name: 'Samsung Galaxy S24 Ultra', tac: '35489022' },
      { tac_id: 'TAC_003', name: 'Google Pixel 8 Pro', tac: '35789100' },
      { tac_id: 'TAC_004', name: 'Huawei Mate 60 Pro', tac: '86923405' },
      { tac_id: 'TAC_005', name: 'Xiaomi 14 Ultra', tac: '86457102' },
      { tac_id: 'TAC_006', name: 'Quectel EC25-E LTE Modem', tac: '86134503' },
    ];
    const insertTac = db.prepare('INSERT INTO tac_numbers (tac_id, name, tac) VALUES (?, ?, ?)');
    for (const t of tacs) insertTac.run(t.tac_id, t.name, t.tac);

    // Seed Targets
    const targets = [
      {
        mission_id: 1, mission: 'ALPHA_RED_01', mission_name: 'Metropolitan Central Sector',
        imsi: '602019948271044', imei: '356782110948210', name: 'Target Phoenix (Falcon-1)',
        action: 'MONITOR_REDIRECT', redirect_tech: 'LTE-to-GSM', redirect_bsic: '45', redirect_channel: '108',
        description: 'High value target monitored in metropolitan downtown', is_p_c_s1900: 0,
      },
      {
        mission_id: 2, mission: 'BRAVO_SURVEIL_04', mission_name: 'Northern Border Corridor',
        imsi: '602028837190245', imei: '354890227189033', name: 'Target Griffin (Transport Node)',
        action: 'SILENT_PROBE', redirect_tech: 'GSM-900', redirect_bsic: '22', redirect_channel: '64',
        description: 'Cross-border logistics and convoy tracking identifier', is_p_c_s1900: 0,
      },
      {
        mission_id: 3, mission: 'DELTA_SENTINEL_09', mission_name: 'Maritime Coastal Zone',
        imsi: '420017726354112', imei: '869234051189440', name: 'Target Poseidon (Vessel Comm)',
        action: 'INTERCEPT', redirect_tech: 'LTE_B3', redirect_bsic: '18', redirect_channel: '1350',
        description: 'Vessel satellite-GSM relay station', is_p_c_s1900: 0,
      },
    ];
    const insertTarget = db.prepare(`
      INSERT INTO targets (mission_id, mission, mission_name, imsi, imei, name, action, redirect_tech, redirect_bsic, redirect_channel, description, is_p_c_s1900)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of targets) {
      insertTarget.run(t.mission_id, t.mission, t.mission_name, t.imsi, t.imei, t.name, t.action, t.redirect_tech, t.redirect_bsic, t.redirect_channel, t.description, t.is_p_c_s1900);
    }

    // Seed Whitelist Targets
    const whitelist = [
      { name: 'Friendly Escort Unit 01', imsi: '602010000000001', imei: '356782110000001' },
      { name: 'Field Command Mobile Hub', imsi: '602010000000002', imei: '356782110000002' },
      { name: 'Liaison Diplomatic Vehicle', imsi: '602020000000003', imei: '354890220000003' },
    ];
    const insertWhitelist = db.prepare('INSERT INTO whitelist_targets (name, imsi, imei) VALUES (?, ?, ?)');
    for (const w of whitelist) insertWhitelist.run(w.name, w.imsi, w.imei);

    // Seed Map Cell Databases & Map Cells
    db.prepare(`
      INSERT INTO map_cell_databases (mission_id, mission, name, header, color)
      VALUES
        (1, 'ALPHA_RED_01', 'Downtown Core Cells 4G/5G', 'Tower Cluster A', '#3b82f6'),
        (2, 'BRAVO_SURVEIL_04', 'Highway Surveillance Masts', 'Corridor Grid B', '#10b981'),
        (3, 'DELTA_SENTINEL_09', 'Harbor Coastal Transmitters', 'Port Sector C', '#f59e0b')
    `).run();

    const mapCells = [
      { db_id: 1, contents: 'Downtown Macro Cell Sector 1', lat: 30.0444, lng: 31.2357, mcc: '602', mnc: '1', lac: '1045', cid: '20491', address: 'Tahrir Square Central Hub', direction: 120, radius: 850, sc_pci: 312, channel: 1850 },
      { db_id: 1, contents: 'Downtown Macro Cell Sector 2', lat: 30.0489, lng: 31.2401, mcc: '602', mnc: '1', lac: '1045', cid: '20492', address: 'Nile Corniche Tower', direction: 240, radius: 950, sc_pci: 313, channel: 1850 },
      { db_id: 1, contents: 'Downtown Macro Cell Sector 3', lat: 30.0521, lng: 31.2312, mcc: '602', mnc: '1', lac: '1045', cid: '20493', address: 'Opera Island Relay', direction: 350, radius: 780, sc_pci: 314, channel: 1850 },
      { db_id: 2, contents: 'Highway Toll Station Mast', lat: 30.1205, lng: 31.3504, mcc: '602', mnc: '2', lac: '2033', cid: '45012', address: 'Desert Road Gate KM 14', direction: 45, radius: 1500, sc_pci: 188, channel: 2100 },
      { db_id: 2, contents: 'Industrial Depot Microcell', lat: 30.1450, lng: 31.3780, mcc: '602', mnc: '2', lac: '2033', cid: '45015', address: 'Logistics Park Tower 4', direction: 180, radius: 1200, sc_pci: 190, channel: 2100 },
      { db_id: 3, contents: 'Port Entry Light Tower Cell', lat: 31.2001, lng: 29.9187, mcc: '602', mnc: '3', lac: '5010', cid: '33100', address: 'Alexandria Harbor Gate 2', direction: 290, radius: 2200, sc_pci: 94, channel: 2600 },
      { db_id: 3, contents: 'Maritime Terminal Cell', lat: 31.2150, lng: 29.9320, mcc: '602', mnc: '3', lac: '5010', cid: '33105', address: 'Dry Dock Station B', direction: 60, radius: 1800, sc_pci: 96, channel: 2600 },
    ];
    const insertMapCell = db.prepare(`
      INSERT INTO map_cells (db_id, contents, lat, lng, mcc, mnc, lac, cid, address, direction, radius, sc_pci, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of mapCells) {
      insertMapCell.run(c.db_id, c.contents, c.lat, c.lng, c.mcc, c.mnc, c.lac, c.cid, c.address, c.direction, c.radius, c.sc_pci, c.channel);
    }

    // Seed Network Cells
    const netCells = [
      { mission_id: 1, mission: 'ALPHA_RED_01', channel: 1850, lac: '1045', mcc: '602', mnc: '1', rx_lev: 42.5, cell_id: '20491', rat: 'LTE', bsic: '45', pci: '312', is_pcs1900: 0, rx_lev_dbm: -68.4, downlink: 1805.0, dl_bandwidth: 20.0, latitude: 30.0444, longitude: 31.2357, direction: 120, is_neighbour: 0, cid_lac_mnc: '20491-1045-1' },
      { mission_id: 1, mission: 'ALPHA_RED_01', channel: 1850, lac: '1045', mcc: '602', mnc: '1', rx_lev: 38.0, cell_id: '20492', rat: 'LTE', bsic: '45', pci: '313', is_pcs1900: 0, rx_lev_dbm: -75.1, downlink: 1805.0, dl_bandwidth: 20.0, latitude: 30.0489, longitude: 31.2401, direction: 240, is_neighbour: 1, cid_lac_mnc: '20492-1045-1' },
      { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 2100, lac: '2033', mcc: '602', mnc: '2', rx_lev: 50.2, cell_id: '45012', rat: 'UMTS', bsic: '22', pci: '188', is_pcs1900: 0, rx_lev_dbm: -61.2, downlink: 2110.0, dl_bandwidth: 15.0, latitude: 30.1205, longitude: 31.3504, direction: 45, is_neighbour: 0, cid_lac_mnc: '45012-2033-2' },
      { mission_id: 3, mission: 'DELTA_SENTINEL_09', channel: 2600, lac: '5010', mcc: '602', mnc: '3', rx_lev: 32.1, cell_id: '33100', rat: 'LTE', bsic: '18', pci: '94', is_pcs1900: 0, rx_lev_dbm: -82.6, downlink: 2620.0, dl_bandwidth: 20.0, latitude: 31.2001, longitude: 29.9187, direction: 290, is_neighbour: 0, cid_lac_mnc: '33100-5010-3' },
      { mission_id: 4, mission: 'ECHO_SHADOW_12', channel: 900, lac: '3012', mcc: '602', mnc: '4', rx_lev: 44.0, cell_id: '11200', rat: 'GSM', bsic: '31', pci: '0', is_pcs1900: 0, rx_lev_dbm: -65.0, downlink: 935.2, dl_bandwidth: 5.0, latitude: 30.0820, longitude: 31.3120, direction: 90, is_neighbour: 0, cid_lac_mnc: '11200-3012-4' },
    ];
    const insertNetCell = db.prepare(`
      INSERT INTO network_cells (mission_id, mission, channel, lac, mcc, mnc, rx_lev, cell_id, rat, bsic, pci, is_pcs1900, rx_lev_dbm, downlink, dl_bandwidth, latitude, longitude, direction, is_neighbour, cid_lac_mnc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of netCells) {
      insertNetCell.run(n.mission_id, n.mission, n.channel, n.lac, n.mcc, n.mnc, n.rx_lev, n.cell_id, n.rat, n.bsic, n.pci, n.is_pcs1900, n.rx_lev_dbm, n.downlink, n.dl_bandwidth, n.latitude, n.longitude, n.direction, n.is_neighbour, n.cid_lac_mnc);
    }

    // Seed Registrations
    const registrations = [
      { reg_id: 'REG-2026-0081', mission_id: 1, mission: 'ALPHA_RED_01', bts: 'BTS-CORE-01', bts_name: 'Downtown Tower Alpha', country: 'Egypt', tmsi: '7F4A91B2', imsi: '602019948271044', imei: '356782110948210', ue_model: 'Apple iPhone 15 Pro Max', bts_location: '30.0444;31.2357', bts_altitude: 45.2, bts_location_outdated: 0, distance_min: 120.5, distance_max: 340.0, country_code: 'EGY', device_location: '30.0451;31.2365', last_seen: new Date(Date.now() - 1000 * 60 * 15).toISOString(), update: 'LOCATION_UPDATE_PERIODIC', action: 'TRACKED' },
      { reg_id: 'REG-2026-0082', mission_id: 1, mission: 'ALPHA_RED_01', bts: 'BTS-CORE-01', bts_name: 'Downtown Tower Alpha', country: 'Egypt', tmsi: '3D2E89F0', imsi: '602014491823100', imei: '354890227189033', ue_model: 'Samsung Galaxy S24 Ultra', bts_location: '30.0444;31.2357', bts_altitude: 45.2, bts_location_outdated: 0, distance_min: 250.0, distance_max: 520.0, country_code: 'EGY', device_location: '30.0468;31.2390', last_seen: new Date(Date.now() - 1000 * 60 * 42).toISOString(), update: 'ATTACH_REQUEST', action: 'LOGGED' },
      { reg_id: 'REG-2026-0083', mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts: 'BTS-HW-04', bts_name: 'Highway Station Beta', country: 'Egypt', tmsi: '91AA03C4', imsi: '602028837190245', imei: '869234051189440', ue_model: 'Huawei Mate 60 Pro', bts_location: '30.1205;31.3504', bts_altitude: 28.0, bts_location_outdated: 0, distance_min: 400.0, distance_max: 850.0, country_code: 'EGY', device_location: '30.1240;31.3540', last_seen: new Date(Date.now() - 1000 * 60 * 120).toISOString(), update: 'HANDOVER_IN', action: 'FLAGGED' },
      { reg_id: 'REG-2026-0084', mission_id: 3, mission: 'DELTA_SENTINEL_09', bts: 'BTS-PORT-02', bts_name: 'Harbor Gate Relay', country: 'Saudi Arabia', tmsi: '55BC7712', imsi: '420017726354112', imei: '861345039912044', ue_model: 'Quectel EC25-E LTE Modem', bts_location: '31.2001;29.9187', bts_altitude: 15.0, bts_location_outdated: 0, distance_min: 80.0, distance_max: 200.0, country_code: 'SAU', device_location: '31.2012;29.9201', last_seen: new Date(Date.now() - 1000 * 60 * 200).toISOString(), update: 'DATA_SESSION_INIT', action: 'CAPTURED' },
      { reg_id: 'REG-2026-0085', mission_id: 4, mission: 'ECHO_SHADOW_12', bts: 'BTS-AIR-03', bts_name: 'Airport Perimeter North', country: 'France', tmsi: '22EE99A1', imsi: '208016629910344', imei: '357891004455112', ue_model: 'Google Pixel 8 Pro', bts_location: '30.0820;31.3120', bts_altitude: 60.5, bts_location_outdated: 0, distance_min: 300.0, distance_max: 600.0, country_code: 'FRA', device_location: '30.0850;31.3150', last_seen: new Date(Date.now() - 1000 * 60 * 310).toISOString(), update: 'ROAMING_REGISTRATION', action: 'VERIFIED' },
    ];
    const insertReg = db.prepare(`
      INSERT INTO registrations (reg_id, mission_id, mission, bts, bts_name, country, tmsi, imsi, imei, ue_model, bts_location, bts_altitude, bts_location_outdated, distance_min, distance_max, country_code, device_location, last_seen, "update", action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of registrations) {
      insertReg.run(r.reg_id, r.mission_id, r.mission, r.bts, r.bts_name, r.country, r.tmsi, r.imsi, r.imei, r.ue_model, r.bts_location, r.bts_altitude, r.bts_location_outdated, r.distance_min, r.distance_max, r.country_code, r.device_location, r.last_seen, r.update, r.action);
    }

    // Seed GPS History
    const gpsData = [
      { mission_id: 1, mission: 'ALPHA_RED_01', bts_id: 'BTS-CORE-01', silent_target_reg_id: 'REG-2026-0081', timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), latitude: 30.0440, longitude: 31.2350, dl_pow: -65.2, ul_pow: 18.0, distance_min: 100.0, distance_max: 200.0, time_dl: 4.2 },
      { mission_id: 1, mission: 'ALPHA_RED_01', bts_id: 'BTS-CORE-01', silent_target_reg_id: 'REG-2026-0081', timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(), latitude: 30.0452, longitude: 31.2362, dl_pow: -67.0, ul_pow: 19.5, distance_min: 140.0, distance_max: 260.0, time_dl: 4.5 },
      { mission_id: 1, mission: 'ALPHA_RED_01', bts_id: 'BTS-CORE-01', silent_target_reg_id: 'REG-2026-0081', timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(), latitude: 30.0468, longitude: 31.2378, dl_pow: -70.4, ul_pow: 20.1, distance_min: 180.0, distance_max: 320.0, time_dl: 4.8 },
      { mission_id: 1, mission: 'ALPHA_RED_01', bts_id: 'BTS-CORE-01', silent_target_reg_id: 'REG-2026-0081', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), latitude: 30.0480, longitude: 31.2395, dl_pow: -72.1, ul_pow: 21.0, distance_min: 220.0, distance_max: 380.0, time_dl: 5.1 },
      { mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts_id: 'BTS-HW-04', silent_target_reg_id: 'REG-2026-0083', timestamp: new Date(Date.now() - 1000 * 60 * 110).toISOString(), latitude: 30.1200, longitude: 31.3510, dl_pow: -62.8, ul_pow: 16.5, distance_min: 350.0, distance_max: 700.0, time_dl: 6.0 },
      { mission_id: 3, mission: 'DELTA_SENTINEL_09', bts_id: 'BTS-PORT-02', silent_target_reg_id: 'REG-2026-0084', timestamp: new Date(Date.now() - 1000 * 60 * 190).toISOString(), latitude: 31.2010, longitude: 29.9195, dl_pow: -81.0, ul_pow: 22.0, distance_min: 90.0, distance_max: 210.0, time_dl: 3.9 },
    ];
    const insertGps = db.prepare(`
      INSERT INTO gps_history (mission_id, mission, bts_id, silent_target_reg_id, timestamp, latitude, longitude, dl_pow, ul_pow, distance_min, distance_max, time_dl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const g of gpsData) {
      insertGps.run(g.mission_id, g.mission, g.bts_id, g.silent_target_reg_id, g.timestamp, g.latitude, g.longitude, g.dl_pow, g.ul_pow, g.distance_min, g.distance_max, g.time_dl);
    }

    // Seed WiFi Access Points & Clients
    db.prepare(`
      INSERT INTO wifi_access_points (mission_id, mission, bssid, essid, enc, channel, first_seen, last_seen, strength, hidden, manufacturer, wanted, essid_bssid_id)
      VALUES
        (1, 'ALPHA_RED_01', 'F4:F2:6D:88:99:A1', 'Gov_Central_Guest', 'WPA2-PSK', 6, datetime('now', '-2 days'), datetime('now', '-5 minutes'), -58.0, 0, 'Cisco Systems', 0, 'WIFI-001'),
        (1, 'ALPHA_RED_01', '00:14:D1:E2:33:44', 'SecureCorp_Staff', 'WPA3-Enterprise', 36, datetime('now', '-5 days'), datetime('now', '-12 minutes'), -46.5, 1, 'Aruba Networks', 1, 'WIFI-002'),
        (2, 'BRAVO_SURVEIL_04', '70:3A:CB:11:22:33', 'BorderCheck_Radio', 'WPA2-PSK', 11, datetime('now', '-10 days'), datetime('now', '-1 hour'), -62.0, 0, 'MikroTik', 0, 'WIFI-003')
    `).run();

    db.prepare(`
      INSERT INTO wifi_access_point_clients (wifi_access_point_essid_bssid, mac, first_seen, last_seen, wants, manufacturer)
      VALUES
        ('WIFI-001', 'A4:C3:F0:11:22:99', datetime('now', '-1 day'), datetime('now', '-10 minutes'), 'Gov_Central_Guest', 'Apple Inc.'),
        ('WIFI-002', 'C8:2A:14:77:88:99', datetime('now', '-3 days'), datetime('now', '-20 minutes'), 'SecureCorp_Staff', 'Samsung Electronics'),
        ('WIFI-003', '50:EB:71:44:55:66', datetime('now', '-8 days'), datetime('now', '-2 hours'), 'BorderCheck_Radio', 'Intel Mobile')
    `).run();

    // Seed SMS & Calls
    db.prepare(`
      INSERT INTO sms_calls (sms_id, call_id, mission_id, mission, incoming, is_sms, source, destination, bts_id, bts_name, status, sms_content, timestamp)
      VALUES
        ('SMS-901', NULL, 1, 'ALPHA_RED_01', 1, 1, '+201009182310', '+201118273645', 'BTS-CORE-01', 'Downtown Tower Alpha', 'DELIVERED', 'Consignment reached checkpoint Bravo safely.', datetime('now', '-1 hour')),
        (NULL, 'CALL-402', 1, 'ALPHA_RED_01', 0, 0, '+201118273645', '+201229988771', 'BTS-CORE-01', 'Downtown Tower Alpha', 'COMPLETED', 'Duration: 142s / Encrypted Voice', datetime('now', '-2 hours')),
        ('SMS-902', NULL, 2, 'BRAVO_SURVEIL_04', 1, 1, '+201550099881', '+201009182310', 'BTS-HW-04', 'Highway Station Beta', 'FORWARDED', 'Frequency alignment shift scheduled for 22:00.', datetime('now', '-4 hours'))
    `).run();

    // Seed Map User Markers, Polygons, Circles
    db.prepare(`
      INSERT INTO map_user_markers (mission_id, mission, direction, type, description, color, latitude, longitude)
      VALUES
        (1, 'ALPHA_RED_01', 90.0, 'COMMAND_POST', 'Forward Tactical Operations Base', '#3b82f6', 30.0470, 31.2330),
        (1, 'ALPHA_RED_01', 180.0, 'CHECKPOINT', 'South Access Control Point #4', '#ef4444', 30.0410, 31.2380),
        (2, 'BRAVO_SURVEIL_04', 45.0, 'RADAR_SITE', 'Border Surveillance Radar Dome', '#f59e0b', 30.1300, 31.3650)
    `).run();

    db.prepare(`
      INSERT INTO map_user_polygons (mission_id, mission, points, label, color, description)
      VALUES
        (1, 'ALPHA_RED_01', '[[30.0400, 31.2300], [30.0550, 31.2300], [30.0550, 31.2450], [30.0400, 31.2450]]', 'High Priority Perimeter', '#6366f1', 'Zone of heightened continuous radio observation'),
        (2, 'BRAVO_SURVEIL_04', '[[30.1100, 31.3400], [30.1500, 31.3400], [30.1400, 31.3900], [30.1000, 31.3800]]', 'Border Corridor Buffer Zone', '#ec4899', 'Restricted transit zone monitored via RF sensors')
    `).run();

    db.prepare(`
      INSERT INTO map_user_circles (mission_id, mission, lat, lng, radius, label, color, description)
      VALUES
        (1, 'ALPHA_RED_01', 30.0444, 31.2357, 1200.0, 'Central Exclusion Radius', '#10b981', 'Primary exclusion boundary centered on BTS Alpha'),
        (3, 'DELTA_SENTINEL_09', 31.2001, 29.9187, 2500.0, 'Maritime Sector Perimeter', '#06b6d4', 'Harbor anchorage monitoring range')
    `).run();

    // Seed Mission Extras & Location Extras
    db.prepare(`
      INSERT INTO mission_extras (mission_id, mission_name, description)
      VALUES
        (1, 'ALPHA_RED_01', 'Joint multi-agency telemetry monitoring deployment for metropolitan sectors.'),
        (2, 'BRAVO_SURVEIL_04', 'Highway cargo logistics surveillance corridor operation.'),
        (3, 'DELTA_SENTINEL_09', 'Maritime coast security grid and RF beacon analysis.')
    `).run();

    db.prepare(`
      INSERT INTO location_extras (mission_id, description)
      VALUES
        (1, 'Metropolitan central sector including financial and administrative zones.'),
        (2, 'High-speed transit highway connecting industrial nodes.'),
        (3, 'Commercial port facilities and international anchorage perimeter.')
    `).run();

    // Seed Scheduled Tasks
    db.prepare(`
      INSERT INTO scheduled_tasks (task_type, execution_time, json_params, prettified_params, status)
      VALUES
        ('DATA_RETENTION_CLEANUP', datetime('now', '+12 hours'), '{"retention_days": 180, "target_tables": ["gps_history", "sms_calls"]}', 'Clean records older than 180 days in GPS and SMS tables', 'PENDING'),
        ('GEO_HEATMAP_AGGREGATION', datetime('now', '+2 hours'), '{"mission": "ALPHA_RED_01", "resolution": "50m"}', 'Compute 50m RF density matrix for Mission Alpha', 'PENDING'),
        ('BACKUP_DATABASE_POSTGRES', datetime('now', '+24 hours'), '{"type": "FULL", "compression": "gzip"}', 'Daily full system snapshot and encryption', 'PENDING')
    `).run();

    // Seed Map Layers
    db.prepare(`
      INSERT INTO map_layers (name, type, path)
      VALUES
        ('OpenStreetMap Standard', 'TileLayer', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        ('Administrative Boundaries', 'GeoJSON', '/api/v1/map/geojson/boundaries'),
        ('Cellular Sector Cones', 'MarkerLayer', '/api/v1/map/layers/cells')
    `).run();

    // Seed Audit Log
    db.prepare(`
      INSERT INTO audit_logs (username, action, module, record_id, ip_address, result, details)
      VALUES
        ('admin', 'SYSTEM_INITIALIZE', 'System', '0', '127.0.0.1', 'SUCCESS', 'Enterprise database schemas and seed datasets initialized successfully.')
    `).run();
  }
}

/**
 * Enriches an existing or fresh Phase 1 seed DB with Phase 2 representative data:
 * - Duplicate mission labels at distinct locations (proving Mission.id non-unique separation)
 * - Viewer user if absent
 * - Full PLMN Storage entries for Egypt, Israel, Palestine, UAE, Saudi Arabia, Jordan, UK, France, USA
 * - Multi-country registrations with distinct IMSIs and multi-format bts_location strings
 * - Military & Civilian NetworkCell records matching Phase 2 analytical categories
 */
function seedPhase2Enrichment() {
  const viewerExists = db.prepare(`SELECT 1 FROM users WHERE username = 'viewer'`).get();
  if (!viewerExists) {
    const adminHash = '$2a$10$f3Fz9UqG1L7n2D6fW2T0p.Z1lRkP5D9m2zX3vC4b5N6m7A8s9D0e1';
    db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, role, status)
      VALUES ('viewer', 'viewer@enterprise.local', ?, 'Read-Only Observer', 'VIEWER', 'ACTIVE')
    `).run(adminHash);
  }

  // Ensure PLMN entries cover all Phase 2 countries/operators
  const phase2Plmns = [
    { mcc: '602', mnc: '10', country: 'Egypt', code: 'EGY', name: 'المحمول العسكري المصري' },
    { mcc: '602', mnc: '11', country: 'Egypt', code: 'EGY', name: 'المحمول العسكري المصري' },
    { mcc: '425', mnc: '1', country: 'Israel', code: 'ISR', name: 'Partner' },
    { mcc: '425', mnc: '2', country: 'Israel', code: 'ISR', name: 'Cellcom' },
    { mcc: '425', mnc: '3', country: 'Israel', code: 'ISR', name: 'Pelephone' },
    { mcc: '425', mnc: '5', country: 'Palestine', code: 'PSE', name: 'Jawwal' },
    { mcc: '425', mnc: '6', country: 'Palestine', code: 'PSE', name: 'Wataniya' },
    { mcc: '425', mnc: '7', country: 'Israel', code: 'ISR', name: 'Hot Mobile' },
    { mcc: '425', mnc: '9', country: 'Israel', code: 'ISR', name: 'We4G' },
    { mcc: '425', mnc: '24', country: 'Israel', code: 'ISR', name: 'Excluded Operator 24' },
    { mcc: '425', mnc: '25', country: 'Israel', code: 'ISR', name: 'IMOD' },
    { mcc: '425', mnc: '28', country: 'Israel', code: 'ISR', name: 'PHI Networks' },
    { mcc: '425', mnc: '29', country: 'Israel', code: 'ISR', name: 'CG Networks' },
    { mcc: '416', mnc: '1', country: 'Jordan', code: 'JOR', name: 'Zain Jordan' },
  ];
  const upsertPlmn = db.prepare(`
    INSERT INTO plmn_storage (mcc, mnc, country, code, name)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(mcc, mnc) DO UPDATE SET country = excluded.country, code = excluded.code, name = excluded.name
  `);
  for (const p of phase2Plmns) {
    upsertPlmn.run(p.mcc, p.mnc, p.country, p.code, p.name);
  }

  // Only add Phase 2 operational dataset once
  const hasPhase2Cells = db.prepare(`SELECT COUNT(*) as c FROM network_cells WHERE mcc = '425'`).get() as { c: number };
  if (hasPhase2Cells.c > 0) return;

  // Add two missions sharing the exact same mission label at distinct locations (demonstrates duplicate mission labels)
  const existingShared = db.prepare(`SELECT id FROM missions WHERE mission = 'SHARED_SECTOR_OP'`).all() as Array<{ id: number }>;
  let m6Id: number;
  let m7Id: number;
  if (existingShared.length === 0) {
    const info6 = db.prepare(`INSERT INTO missions (mission, mission_name, location) VALUES (?, ?, ?)`).run(
      'SHARED_SECTOR_OP',
      'Sector Sweep North',
      'Sinai North Corridor'
    );
    const info7 = db.prepare(`INSERT INTO missions (mission, mission_name, location) VALUES (?, ?, ?)`).run(
      'SHARED_SECTOR_OP',
      'Sector Sweep South',
      'Red Sea Coastal Zone'
    );
    m6Id = Number(info6.lastInsertRowid);
    m7Id = Number(info7.lastInsertRowid);
  } else {
    m6Id = existingShared[0].id;
    m7Id = existingShared[1]?.id || existingShared[0].id;
  }

  // Enrich registrations across diverse countries (Egypt + non-Egypt) and multi-format bts_location
  const extraRegs = [
    { reg_id: 'REG-2026-0101', mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts: 'BTS-NE-01', bts_name: 'Sinai Relay Alpha', country: 'Israel', tmsi: 'A1B2C301', imsi: '425010011223301', imei: '356782119001101', ue_model: 'Apple iPhone 15 Pro Max', bts_location: '31.2519, 34.2510', bts_altitude: 112.0, bts_location_outdated: 0, distance_min: 150, distance_max: 420, country_code: 'ISR', device_location: '31.2530, 34.2525', last_seen: new Date(Date.now() - 1000 * 60 * 50).toISOString(), update: 'LOCATION_UPDATE_PERIODIC', action: 'TRACKED' },
    { reg_id: 'REG-2026-0102', mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts: 'BTS-NE-01', bts_name: 'Sinai Relay Alpha', country: 'Israel', tmsi: 'A1B2C302', imsi: '425020011223302', imei: '354890229001102', ue_model: 'Samsung Galaxy S24 Ultra', bts_location: '31.2519, 34.2510', bts_altitude: 112.0, bts_location_outdated: 0, distance_min: 210, distance_max: 510, country_code: 'ISR', device_location: '31.2542, 34.2540', last_seen: new Date(Date.now() - 1000 * 60 * 55).toISOString(), update: 'ATTACH_REQUEST', action: 'TRACKED' },
    { reg_id: 'REG-2026-0103', mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts: 'BTS-NE-02', bts_name: 'Gaza Border Tower', country: 'Israel', tmsi: 'A1B2C303', imsi: '425030011223303', imei: '357891009001103', ue_model: 'Google Pixel 8 Pro', bts_location: '31.5017 34.4668\n31.5120 34.4780', bts_altitude: 85.5, bts_location_outdated: 0, distance_min: 95, distance_max: 290, country_code: 'ISR', device_location: '31.5030 34.4680', last_seen: new Date(Date.now() - 1000 * 60 * 70).toISOString(), update: 'HANDOVER_IN', action: 'LOGGED' },
    { reg_id: 'REG-2026-0104', mission_id: m6Id, mission: 'SHARED_SECTOR_OP', bts: 'BTS-PS-01', bts_name: 'Rafah Crossing Mast', country: 'Palestine', tmsi: 'B1B2C304', imsi: '425050022334401', imei: '869234059002201', ue_model: 'Xiaomi 14 Ultra', bts_location: '31.2850;34.2480', bts_altitude: 68.0, bts_location_outdated: 0, distance_min: 180, distance_max: 490, country_code: 'PSE', device_location: '31.2870;34.2495', last_seen: new Date(Date.now() - 1000 * 60 * 80).toISOString(), update: 'ATTACH_REQUEST', action: 'CAPTURED' },
    { reg_id: 'REG-2026-0105', mission_id: m6Id, mission: 'SHARED_SECTOR_OP', bts: 'BTS-PS-01', bts_name: 'Rafah Crossing Mast', country: 'Palestine', tmsi: 'B1B2C305', imsi: '425060022334402', imei: '864571029002202', ue_model: 'Samsung Galaxy S24 Ultra', bts_location: '31.2850;34.2480', bts_altitude: 68.0, bts_location_outdated: 0, distance_min: 200, distance_max: 540, country_code: 'PSE', device_location: '31.2881;34.2501', last_seen: new Date(Date.now() - 1000 * 60 * 90).toISOString(), update: 'LOCATION_UPDATE_PERIODIC', action: 'TRACKED' },
    { reg_id: 'REG-2026-0106', mission_id: 3, mission: 'DELTA_SENTINEL_09', bts: 'BTS-SA-01', bts_name: 'Harbor Gate Relay', country: 'Saudi Arabia', tmsi: 'C1B2C306', imsi: '420017726354901', imei: '356782119003301', ue_model: 'Apple iPhone 15 Pro Max', bts_location: '31.2001;29.9187', bts_altitude: 15.0, bts_location_outdated: 0, distance_min: 110, distance_max: 320, country_code: 'SAU', device_location: '31.2015;29.9199', last_seen: new Date(Date.now() - 1000 * 60 * 95).toISOString(), update: 'ROAMING_REGISTRATION', action: 'VERIFIED' },
    { reg_id: 'REG-2026-0107', mission_id: 5, mission: 'OMEGA_FORTRESS_22', bts: 'BTS-AE-01', bts_name: 'Diplomatic Tower West', country: 'United Arab Emirates', tmsi: 'D1B2C307', imsi: '424028811223301', imei: '354890229004401', ue_model: 'Apple iPhone 15 Pro Max', bts_location: '30.0626, 31.2197', bts_altitude: 94.0, bts_location_outdated: 0, distance_min: 70, distance_max: 210, country_code: 'ARE', device_location: '30.0631, 31.2202', last_seen: new Date(Date.now() - 1000 * 60 * 110).toISOString(), update: 'ROAMING_REGISTRATION', action: 'TRACKED' },
    { reg_id: 'REG-2026-0108', mission_id: 5, mission: 'OMEGA_FORTRESS_22', bts: 'BTS-AE-01', bts_name: 'Diplomatic Tower West', country: 'United Arab Emirates', tmsi: 'D1B2C308', imsi: '424028811223302', imei: '356782119004402', ue_model: 'Samsung Galaxy S24 Ultra', bts_location: '30.0626, 31.2197', bts_altitude: 94.0, bts_location_outdated: 0, distance_min: 95, distance_max: 240, country_code: 'ARE', device_location: '30.0635, 31.2208', last_seen: new Date(Date.now() - 1000 * 60 * 115).toISOString(), update: 'ATTACH_REQUEST', action: 'VERIFIED' },
    { reg_id: 'REG-2026-0109', mission_id: 4, mission: 'ECHO_SHADOW_12', bts: 'BTS-GB-01', bts_name: 'Transit Terminal East', country: 'United Kingdom', tmsi: 'E1B2C309', imsi: '234150099887701', imei: '357891009005501', ue_model: 'Google Pixel 8 Pro', bts_location: '30.1120;31.4010', bts_altitude: 55.0, bts_location_outdated: 1, distance_min: 220, distance_max: 580, country_code: 'GBR', device_location: '30.1140;31.4030', last_seen: new Date(Date.now() - 1000 * 60 * 140).toISOString(), update: 'ROAMING_REGISTRATION', action: 'LOGGED' },
    { reg_id: 'REG-2026-0110', mission_id: m7Id, mission: 'SHARED_SECTOR_OP', bts: 'BTS-JO-01', bts_name: 'Red Sea Relay South', country: 'Jordan', tmsi: 'F1B2C310', imsi: '416010077665501', imei: '861345039006601', ue_model: 'Quectel EC25-E LTE Modem', bts_location: '29.5321, 35.0063', bts_altitude: 32.0, bts_location_outdated: 0, distance_min: 310, distance_max: 790, country_code: 'JOR', device_location: '29.5340, 35.0081', last_seen: new Date(Date.now() - 1000 * 60 * 160).toISOString(), update: 'DATA_SESSION_INIT', action: 'FLAGGED' },
    // Duplicate IMSI for Israel to verify DISTINCT IMSI counting works properly
    { reg_id: 'REG-2026-0111', mission_id: 2, mission: 'BRAVO_SURVEIL_04', bts: 'BTS-NE-01', bts_name: 'Sinai Relay Alpha', country: 'Israel', tmsi: 'A1B2C399', imsi: '425010011223301', imei: '356782119001101', ue_model: 'Apple iPhone 15 Pro Max', bts_location: '31.2519, 34.2510', bts_altitude: 112.0, bts_location_outdated: 0, distance_min: 145, distance_max: 410, country_code: 'ISR', device_location: '31.2528, 34.2520', last_seen: new Date(Date.now() - 1000 * 60 * 35).toISOString(), update: 'LOCATION_UPDATE_PERIODIC', action: 'TRACKED' },
  ];

  const insertReg = db.prepare(`
    INSERT INTO registrations (reg_id, mission_id, mission, bts, bts_name, country, tmsi, imsi, imei, ue_model, bts_location, bts_altitude, bts_location_outdated, distance_min, distance_max, country_code, device_location, last_seen, "update", action)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of extraRegs) {
    insertReg.run(r.reg_id, r.mission_id, r.mission, r.bts, r.bts_name, r.country, r.tmsi, r.imsi, r.imei, r.ue_model, r.bts_location, r.bts_altitude, r.bts_location_outdated, r.distance_min, r.distance_max, r.country_code, r.device_location, r.last_seen, r.update, r.action);
  }

  // Enrich NetworkCells for Military, Civilian, and MCC Analytics
  const extraNetCells = [
    // Military Egyptian (602/10, 602/11)
    { mission_id: m6Id, mission: 'SHARED_SECTOR_OP', channel: 1950, lac: 6010, mcc: 602, mnc: 10, rx_lev: 46.0, cell_id: 70011, rat: 'LTE', bsic: 12, pci: 101, is_pcs1900: 0, rx_lev_dbm: -64.0, downlink: 1840.0, dl_bandwidth: 20.0, latitude: 31.1100, longitude: 33.7900, direction: 90, is_neighbour: 0, cid_lac_mnc: '70011-6010-10' },
    { mission_id: m6Id, mission: 'SHARED_SECTOR_OP', channel: 1950, lac: 6010, mcc: 602, mnc: 10, rx_lev: 43.0, cell_id: 70012, rat: 'LTE', bsic: 14, pci: 102, is_pcs1900: 0, rx_lev_dbm: -69.5, downlink: 1840.0, dl_bandwidth: 20.0, latitude: 31.1180, longitude: 33.8050, direction: 210, is_neighbour: 0, cid_lac_mnc: '70012-6010-10' },
    { mission_id: m7Id, mission: 'SHARED_SECTOR_OP', channel: 1960, lac: 6011, mcc: 602, mnc: 11, rx_lev: 41.2, cell_id: 70021, rat: 'UMTS', bsic: 19, pci: 111, is_pcs1900: 0, rx_lev_dbm: -71.0, downlink: 2140.0, dl_bandwidth: 10.0, latitude: 29.9668, longitude: 32.5498, direction: 135, is_neighbour: 0, cid_lac_mnc: '70021-6011-11' },
    // Military Israeli + Civilian IMOD (425/25)
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1750, lac: 4250, mcc: 425, mnc: 25, rx_lev: 39.4, cell_id: 80025, rat: 'LTE', bsic: 25, pci: 250, is_pcs1900: 0, rx_lev_dbm: -73.0, downlink: 1825.0, dl_bandwidth: 20.0, latitude: 31.2600, longitude: 34.2800, direction: 270, is_neighbour: 0, cid_lac_mnc: '80025-4250-25' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1750, lac: 4250, mcc: 425, mnc: 25, rx_lev: 37.8, cell_id: 80026, rat: 'LTE', bsic: 26, pci: 251, is_pcs1900: 0, rx_lev_dbm: -75.8, downlink: 1825.0, dl_bandwidth: 20.0, latitude: 31.2720, longitude: 34.2910, direction: 300, is_neighbour: 1, cid_lac_mnc: '80026-4250-25' },
    // Civilian Israeli Operators
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1300, lac: 4101, mcc: 425, mnc: 1, rx_lev: 45.0, cell_id: 81001, rat: 'LTE', bsic: 10, pci: 11, is_pcs1900: 0, rx_lev_dbm: -66.0, downlink: 1815.0, dl_bandwidth: 20.0, latitude: 31.2550, longitude: 34.2580, direction: 60, is_neighbour: 0, cid_lac_mnc: '81001-4101-1' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1300, lac: 4101, mcc: 425, mnc: 1, rx_lev: 44.0, cell_id: 81002, rat: 'LTE', bsic: 11, pci: 12, is_pcs1900: 0, rx_lev_dbm: -67.5, downlink: 1815.0, dl_bandwidth: 20.0, latitude: 31.2610, longitude: 34.2620, direction: 180, is_neighbour: 0, cid_lac_mnc: '81002-4101-1' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1300, lac: 4101, mcc: 425, mnc: 1, rx_lev: 40.0, cell_id: 81003, rat: '5G', bsic: 12, pci: 13, is_pcs1900: 0, rx_lev_dbm: -70.0, downlink: 3500.0, dl_bandwidth: 40.0, latitude: 31.2680, longitude: 34.2700, direction: 300, is_neighbour: 0, cid_lac_mnc: '81003-4101-1' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1450, lac: 4102, mcc: 425, mnc: 2, rx_lev: 43.2, cell_id: 82001, rat: 'LTE', bsic: 20, pci: 21, is_pcs1900: 0, rx_lev_dbm: -68.2, downlink: 1830.0, dl_bandwidth: 20.0, latitude: 31.5200, longitude: 34.5900, direction: 90, is_neighbour: 0, cid_lac_mnc: '82001-4102-2' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1450, lac: 4102, mcc: 425, mnc: 2, rx_lev: 41.0, cell_id: 82002, rat: 'UMTS', bsic: 21, pci: 22, is_pcs1900: 0, rx_lev_dbm: -71.4, downlink: 2120.0, dl_bandwidth: 15.0, latitude: 31.5250, longitude: 34.5980, direction: 210, is_neighbour: 0, cid_lac_mnc: '82002-4102-2' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1600, lac: 4103, mcc: 425, mnc: 3, rx_lev: 46.5, cell_id: 83001, rat: 'LTE', bsic: 30, pci: 31, is_pcs1900: 0, rx_lev_dbm: -64.5, downlink: 1850.0, dl_bandwidth: 20.0, latitude: 31.6688, longitude: 34.5743, direction: 120, is_neighbour: 0, cid_lac_mnc: '83001-4103-3' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1600, lac: 4103, mcc: 425, mnc: 3, rx_lev: 42.1, cell_id: 83002, rat: 'LTE', bsic: 31, pci: 32, is_pcs1900: 0, rx_lev_dbm: -69.1, downlink: 1850.0, dl_bandwidth: 20.0, latitude: 31.6740, longitude: 34.5810, direction: 240, is_neighbour: 1, cid_lac_mnc: '83002-4103-3' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1700, lac: 4107, mcc: 425, mnc: 7, rx_lev: 38.5, cell_id: 87001, rat: 'LTE', bsic: 40, pci: 71, is_pcs1900: 0, rx_lev_dbm: -74.0, downlink: 1860.0, dl_bandwidth: 15.0, latitude: 31.2580, longitude: 34.7913, direction: 45, is_neighbour: 0, cid_lac_mnc: '87001-4107-7' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1720, lac: 4109, mcc: 425, mnc: 9, rx_lev: 36.2, cell_id: 89001, rat: 'LTE', bsic: 42, pci: 91, is_pcs1900: 0, rx_lev_dbm: -76.5, downlink: 1870.0, dl_bandwidth: 10.0, latitude: 31.2650, longitude: 34.8010, direction: 150, is_neighbour: 0, cid_lac_mnc: '89001-4109-9' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1880, lac: 4128, mcc: 425, mnc: 28, rx_lev: 40.4, cell_id: 88001, rat: 'LTE', bsic: 51, pci: 281, is_pcs1900: 0, rx_lev_dbm: -72.0, downlink: 1880.0, dl_bandwidth: 20.0, latitude: 31.7683, longitude: 35.2137, direction: 0, is_neighbour: 0, cid_lac_mnc: '88001-4128-28' },
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1890, lac: 4129, mcc: 425, mnc: 29, rx_lev: 37.0, cell_id: 89501, rat: 'UMTS', bsic: 52, pci: 291, is_pcs1900: 0, rx_lev_dbm: -76.0, downlink: 2150.0, dl_bandwidth: 10.0, latitude: 31.7710, longitude: 35.2200, direction: 180, is_neighbour: 0, cid_lac_mnc: '89501-4129-29' },
    // Excluded operator (425/24) - must appear in MCC chart but be excluded from Civilian Networks!
    { mission_id: 2, mission: 'BRAVO_SURVEIL_04', channel: 1680, lac: 4124, mcc: 425, mnc: 24, rx_lev: 35.0, cell_id: 84001, rat: 'GSM', bsic: 60, pci: 0, is_pcs1900: 0, rx_lev_dbm: -79.0, downlink: 945.0, dl_bandwidth: 5.0, latitude: 31.2605, longitude: 34.3010, direction: 90, is_neighbour: 0, cid_lac_mnc: '84001-4124-24' },
    // Civilian Palestinian Operators (425/5 Jawwal, 425/6 Wataniya)
    { mission_id: m6Id, mission: 'SHARED_SECTOR_OP', channel: 920, lac: 4505, mcc: 425, mnc: 5, rx_lev: 48.0, cell_id: 95001, rat: 'GSM', bsic: 15, pci: 0, is_pcs1900: 0, rx_lev_dbm: -62.0, downlink: 938.0, dl_bandwidth: 5.0, latitude: 31.2850, longitude: 34.2480, direction: 60, is_neighbour: 0, cid_lac_mnc: '95001-4505-5' },
    { mission_id: m6Id, mission: 'SHARED_SECTOR_OP', channel: 920, lac: 4505, mcc: 425, mnc: 5, rx_lev: 46.1, cell_id: 95002, rat: 'UMTS', bsic: 16, pci: 52, is_pcs1900: 0, rx_lev_dbm: -64.8, downlink: 2115.0, dl_bandwidth: 10.0, latitude: 31.3450, longitude: 34.3030, direction: 180, is_neighbour: 0, cid_lac_mnc: '95002-4505-5' },
    { mission_id: m6Id, mission: 'SHARED_SECTOR_OP', channel: 940, lac: 4506, mcc: 425, mnc: 6, rx_lev: 41.5, cell_id: 96001, rat: 'UMTS', bsic: 17, pci: 61, is_pcs1900: 0, rx_lev_dbm: -70.5, downlink: 2125.0, dl_bandwidth: 10.0, latitude: 31.5017, longitude: 34.4668, direction: 270, is_neighbour: 0, cid_lac_mnc: '96001-4506-6' },
    // Civilian UAE Operator (424/2 Etisalat UAE)
    { mission_id: 5, mission: 'OMEGA_FORTRESS_22', channel: 1810, lac: 4242, mcc: 424, mnc: 2, rx_lev: 49.0, cell_id: 62001, rat: 'LTE', bsic: 22, pci: 202, is_pcs1900: 0, rx_lev_dbm: -60.5, downlink: 1835.0, dl_bandwidth: 20.0, latitude: 25.2048, longitude: 55.2708, direction: 90, is_neighbour: 0, cid_lac_mnc: '62001-4242-2' },
    { mission_id: 5, mission: 'OMEGA_FORTRESS_22', channel: 1810, lac: 4242, mcc: 424, mnc: 2, rx_lev: 47.0, cell_id: 62002, rat: '5G', bsic: 23, pci: 203, is_pcs1900: 0, rx_lev_dbm: -63.0, downlink: 3600.0, dl_bandwidth: 50.0, latitude: 24.4539, longitude: 54.3773, direction: 210, is_neighbour: 0, cid_lac_mnc: '62002-4242-2' },
    // Saudi Arabia & Jordan cells for MCC breakdown
    { mission_id: 3, mission: 'DELTA_SENTINEL_09', channel: 1920, lac: 4201, mcc: 420, mnc: 1, rx_lev: 44.0, cell_id: 51001, rat: 'LTE', bsic: 33, pci: 151, is_pcs1900: 0, rx_lev_dbm: -67.0, downlink: 1810.0, dl_bandwidth: 20.0, latitude: 24.7136, longitude: 46.6753, direction: 120, is_neighbour: 0, cid_lac_mnc: '51001-4201-1' },
    { mission_id: m7Id, mission: 'SHARED_SECTOR_OP', channel: 1830, lac: 4161, mcc: 416, mnc: 1, rx_lev: 40.2, cell_id: 54001, rat: 'LTE', bsic: 34, pci: 161, is_pcs1900: 0, rx_lev_dbm: -72.0, downlink: 1820.0, dl_bandwidth: 15.0, latitude: 29.5321, longitude: 35.0063, direction: 240, is_neighbour: 0, cid_lac_mnc: '54001-4161-1' },
  ];

  const insertNetCell = db.prepare(`
    INSERT INTO network_cells (mission_id, mission, channel, lac, mcc, mnc, rx_lev, cell_id, rat, bsic, pci, is_pcs1900, rx_lev_dbm, downlink, dl_bandwidth, latitude, longitude, direction, is_neighbour, cid_lac_mnc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const n of extraNetCells) {
    insertNetCell.run(n.mission_id, n.mission, n.channel, n.lac, n.mcc, n.mnc, n.rx_lev, n.cell_id, n.rat, n.bsic, n.pci, n.is_pcs1900, n.rx_lev_dbm, n.downlink, n.dl_bandwidth, n.latitude, n.longitude, n.direction, n.is_neighbour, n.cid_lac_mnc);
  }
}

export interface QueryOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  mission?: string;
  missionIds?: number[];
  filters?: Array<{
    column: string;
    operator: string;
    value: any;
    value2?: any;
    condition?: 'AND' | 'OR';
  }>;
}

export function queryTable(tableName: string, options: QueryOptions = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(10000, Math.max(1, Number(options.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const validCols = getTableColumns(tableName).map(c => c.name);
  const whereClauses: string[] = [];
  const params: any[] = [];

  // Filter by missionIds first (Phase 2 authoritative ID filter)
  if (options.missionIds && options.missionIds.length > 0) {
    const placeholders = options.missionIds.map(() => '?').join(', ');
    if (tableName === 'missions') {
      whereClauses.push(`id IN (${placeholders})`);
      params.push(...options.missionIds);
    } else if (validCols.includes('mission_id')) {
      whereClauses.push(`mission_id IN (${placeholders})`);
      params.push(...options.missionIds);
    }
  } else if (options.mission && options.mission !== 'ALL') {
    const asId = Number(options.mission);
    if (!Number.isNaN(asId) && Number.isInteger(asId) && asId > 0) {
      if (tableName === 'missions') {
        whereClauses.push(`id = ?`);
        params.push(asId);
      } else if (validCols.includes('mission_id')) {
        whereClauses.push(`mission_id = ?`);
        params.push(asId);
      }
    } else if (validCols.includes('mission')) {
      whereClauses.push(`mission = ?`);
      params.push(options.mission);
    }
  }

  // Global search across text columns
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim()}%`;
    const cols = getTableColumns(tableName);
    const searchCols = cols.filter(c => ['TEXT', 'VARCHAR', 'CHAR'].some(t => c.type.toUpperCase().includes(t)));
    if (searchCols.length > 0) {
      const searchClauses = searchCols.map(c => `"${c.name}" LIKE ?`);
      whereClauses.push(`(${searchClauses.join(' OR ')})`);
      for (let i = 0; i < searchCols.length; i++) {
        params.push(term);
      }
    }
  }

  // Multi-column filter builder
  if (options.filters && Array.isArray(options.filters) && options.filters.length > 0) {
    const filterConditions: string[] = [];
    for (const f of options.filters) {
      if (!f.column || !validCols.includes(f.column)) continue;
      const col = `"${f.column}"`;
      switch (f.operator) {
        case 'equals':
          filterConditions.push(`${col} = ?`);
          params.push(f.value);
          break;
        case 'not_equals':
          filterConditions.push(`${col} != ?`);
          params.push(f.value);
          break;
        case 'contains':
          filterConditions.push(`${col} LIKE ?`);
          params.push(`%${f.value}%`);
          break;
        case 'not_contains':
          filterConditions.push(`${col} NOT LIKE ?`);
          params.push(`%${f.value}%`);
          break;
        case 'starts_with':
          filterConditions.push(`${col} LIKE ?`);
          params.push(`${f.value}%`);
          break;
        case 'ends_with':
          filterConditions.push(`${col} LIKE ?`);
          params.push(`%${f.value}`);
          break;
        case 'greater_than':
          filterConditions.push(`${col} > ?`);
          params.push(f.value);
          break;
        case 'less_than':
          filterConditions.push(`${col} < ?`);
          params.push(f.value);
          break;
        case 'between':
          filterConditions.push(`${col} BETWEEN ? AND ?`);
          params.push(f.value, f.value2);
          break;
        case 'is_empty':
          filterConditions.push(`(${col} IS NULL OR ${col} = '')`);
          break;
        case 'is_not_empty':
          filterConditions.push(`(${col} IS NOT NULL AND ${col} != '')`);
          break;
        case 'before_date':
          filterConditions.push(`${col} < ?`);
          params.push(f.value);
          break;
        case 'after_date':
          filterConditions.push(`${col} > ?`);
          params.push(f.value);
          break;
      }
    }
    if (filterConditions.length > 0) {
      whereClauses.push(`(${filterConditions.join(' AND ')})`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  let orderSql = '';
  if (options.sortBy && validCols.includes(options.sortBy)) {
    const dir = options.sortOrder === 'DESC' ? 'DESC' : 'ASC';
    orderSql = `ORDER BY "${options.sortBy}" ${dir}`;
  } else if (validCols.includes('id')) {
    orderSql = 'ORDER BY id DESC';
  } else if (validCols.includes('timestamp')) {
    orderSql = 'ORDER BY timestamp DESC';
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM "${tableName}" ${whereSql}`);
  const countRow = countStmt.get(...params) as { total: number };
  const total = countRow ? countRow.total : 0;

  const dataStmt = db.prepare(`SELECT * FROM "${tableName}" ${whereSql} ${orderSql} LIMIT ? OFFSET ?`);
  const data = dataStmt.all(...params, pageSize, offset);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export function getTableColumns(tableName: string): Array<{ name: string; type: string; notnull: number; pk: number }> {
  try {
    const stmt = db.prepare(`PRAGMA table_info("${tableName}")`);
    return stmt.all() as any;
  } catch {
    return [];
  }
}

export function getRecord(tableName: string, id: any) {
  const stmt = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`);
  return stmt.get(id);
}

function normalizeMissionFieldsForRecord(tableName: string, record: Record<string, any>): Record<string, any> {
  const copy = { ...record };
  const cols = getTableColumns(tableName).map(c => c.name);
  if (cols.includes('mission_id')) {
    if (copy.mission_id !== undefined && copy.mission_id !== null && copy.mission_id !== '') {
      const mId = Number(copy.mission_id);
      if (!Number.isNaN(mId)) {
        copy.mission_id = mId;
        const mRow = db.prepare(`SELECT mission FROM missions WHERE id = ?`).get(mId) as { mission: string } | undefined;
        if (mRow) {
          if (cols.includes('mission') && !copy.mission) copy.mission = mRow.mission;
          if (tableName === 'mission_extras' && cols.includes('mission_name') && !copy.mission_name) {
            copy.mission_name = mRow.mission;
          }
        }
      }
    } else if (copy.mission && cols.includes('mission')) {
      const matches = db.prepare(`SELECT id FROM missions WHERE mission = ?`).all(copy.mission) as Array<{ id: number }>;
      if (matches.length === 1) {
        copy.mission_id = matches[0].id;
      }
    }
  }
  return copy;
}

export function insertRecord(tableName: string, record: Record<string, any>) {
  const normalized = normalizeMissionFieldsForRecord(tableName, record);
  const validCols = getTableColumns(tableName).map(c => c.name);
  const keys = Object.keys(normalized).filter(k => k !== 'id' && validCols.includes(k) && normalized[k] !== '');
  if (keys.length === 0) throw new Error('No valid columns provided');
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => normalized[k]);

  const stmt = db.prepare(`INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`);
  const info = stmt.run(...values);
  return { id: info.lastInsertRowid, ...normalized };
}

export function updateRecord(tableName: string, id: any, record: Record<string, any>) {
  const normalized = normalizeMissionFieldsForRecord(tableName, record);
  const validCols = getTableColumns(tableName).map(c => c.name);
  const keys = Object.keys(normalized).filter(k => k !== 'id' && validCols.includes(k));
  if (keys.length === 0) return getRecord(tableName, id);
  const assignments = keys.map(k => `"${k}" = ?`).join(', ');
  const values = keys.map(k => normalized[k] === '' ? null : normalized[k]);

  const stmt = db.prepare(`UPDATE "${tableName}" SET ${assignments} WHERE id = ?`);
  stmt.run(...values, id);
  return getRecord(tableName, id);
}

export function deleteRecord(tableName: string, id: any) {
  const stmt = db.prepare(`DELETE FROM "${tableName}" WHERE id = ?`);
  return stmt.run(id);
}

export function batchImport(
  tableName: string,
  records: Array<Record<string, any>>,
  mode: 'INSERT_ONLY' | 'UPDATE_EXISTING' | 'INSERT_OR_UPDATE' = 'INSERT_OR_UPDATE',
  matchKey: string = 'id',
  targetDb: DatabaseSync = db
) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const errorLog: string[] = [];

  const validCols = (targetDb.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>).map(c => c.name);

  targetDb.exec('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < records.length; i++) {
      const rawRec = records[i];
      const rec: Record<string, any> = {};
      for (const k of Object.keys(rawRec)) {
        if (validCols.includes(k)) {
          rec[k] = rawRec[k];
        }
      }

      try {
        const hasKey = matchKey && validCols.includes(matchKey) && rec[matchKey] !== undefined && rec[matchKey] !== null && rec[matchKey] !== '';
        let existing = null;
        if (hasKey) {
          existing = targetDb.prepare(`SELECT 1 FROM "${tableName}" WHERE "${matchKey}" = ?`).get(rec[matchKey]);
        }

        if (existing) {
          if (mode === 'INSERT_ONLY') {
            skipped++;
          } else {
            const keys = Object.keys(rec).filter(k => k !== matchKey && k !== 'id');
            if (keys.length > 0) {
              const setClause = keys.map(k => `"${k}" = ?`).join(', ');
              const vals = keys.map(k => rec[k]);
              targetDb.prepare(`UPDATE "${tableName}" SET ${setClause} WHERE "${matchKey}" = ?`).run(...vals, rec[matchKey]);
              updated++;
            } else {
              skipped++;
            }
          }
        } else {
          if (mode === 'UPDATE_EXISTING') {
            skipped++;
          } else {
            const keys = Object.keys(rec).filter(k => !(k === 'id' && (rec[k] === undefined || rec[k] === null || rec[k] === '')));
            if (keys.length === 0) {
              skipped++;
              continue;
            }
            const cols = keys.map(k => `"${k}"`).join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const vals = keys.map(k => rec[k]);
            targetDb.prepare(`INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`).run(...vals);
            inserted++;
          }
        }
      } catch (err: any) {
        errors++;
        if (errorLog.length < 50) {
          errorLog.push(`Row ${i + 1}: ${err.message}`);
        }
      }
    }
    targetDb.exec('COMMIT');
  } catch (fatal: any) {
    targetDb.exec('ROLLBACK');
    throw fatal;
  }

  return { inserted, updated, skipped, errors, errorLog };
}
