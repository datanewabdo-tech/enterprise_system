-- Phase 2 Migration: Migrate Mission Relationships to Integer mission_id Foreign Keys,
-- Remove Unique Constraint on missions.mission, Add ExportHistory & Performance Indexes.
-- SAFE & NON-DESTRUCTIVE: Preserves all existing records and flags ambiguous mission label matches.

BEGIN;

-- 1. Drop old string-based foreign keys if they exist
ALTER TABLE IF EXISTS "registrations" DROP CONSTRAINT IF EXISTS "registrations_mission_fkey";
ALTER TABLE IF EXISTS "targets" DROP CONSTRAINT IF EXISTS "targets_mission_fkey";
ALTER TABLE IF EXISTS "mission_extras" DROP CONSTRAINT IF EXISTS "mission_extras_mission_name_fkey";
ALTER TABLE IF EXISTS "network_cells" DROP CONSTRAINT IF EXISTS "network_cells_mission_fkey";
ALTER TABLE IF EXISTS "wifi_access_points" DROP CONSTRAINT IF EXISTS "wifi_access_points_mission_fkey";
ALTER TABLE IF EXISTS "gps_history" DROP CONSTRAINT IF EXISTS "gps_history_mission_fkey";
ALTER TABLE IF EXISTS "map_cell_databases" DROP CONSTRAINT IF EXISTS "map_cell_databases_mission_fkey";
ALTER TABLE IF EXISTS "sms_calls" DROP CONSTRAINT IF EXISTS "sms_calls_mission_fkey";
ALTER TABLE IF EXISTS "map_user_markers" DROP CONSTRAINT IF EXISTS "map_user_markers_mission_fkey";
ALTER TABLE IF EXISTS "map_user_polygons" DROP CONSTRAINT IF EXISTS "map_user_polygons_mission_fkey";
ALTER TABLE IF EXISTS "map_user_circles" DROP CONSTRAINT IF EXISTS "map_user_circles_mission_fkey";

-- 2. Allow duplicate mission labels and add mission_name on missions
ALTER TABLE "missions" DROP CONSTRAINT IF EXISTS "missions_mission_key";
DROP INDEX IF EXISTS "missions_mission_key";
ALTER TABLE "missions" ADD COLUMN IF NOT EXISTS "mission_name" TEXT;
CREATE INDEX IF NOT EXISTS "missions_mission_idx" ON "missions"("mission");
CREATE INDEX IF NOT EXISTS "missions_location_idx" ON "missions"("location");

-- 3. Create migration_ambiguities tracking table
CREATE TABLE IF NOT EXISTS "migration_ambiguities" (
  "id" SERIAL PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "record_id" INTEGER NOT NULL,
  "mission_label" TEXT NOT NULL,
  "candidate_mission_ids" TEXT NOT NULL,
  "resolved_mission_id" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "migration_ambiguities_table_name_status_idx" ON "migration_ambiguities"("table_name", "status");

-- 4. Add nullable mission_id to the 11 string-linked mission tables & make string mission optional
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "registrations" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "targets" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "mission_extras" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "mission_extras" ALTER COLUMN "mission_name" DROP NOT NULL;

ALTER TABLE "network_cells" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "network_cells" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "wifi_access_points" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "wifi_access_points" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "gps_history" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "gps_history" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "map_cell_databases" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "map_cell_databases" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "sms_calls" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "sms_calls" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "map_user_markers" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "map_user_markers" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "map_user_polygons" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "map_user_polygons" ALTER COLUMN "mission" DROP NOT NULL;

ALTER TABLE "map_user_circles" ADD COLUMN IF NOT EXISTS "mission_id" INTEGER;
ALTER TABLE "map_user_circles" ALTER COLUMN "mission" DROP NOT NULL;

-- 5. Backfill mission_id ONLY for unambiguous exact matches (COUNT(*) = 1)
--    Log ambiguous matches (COUNT(*) > 1) into migration_ambiguities without guessing
DO $$
DECLARE
  tbl TEXT;
  col_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'registrations', 'targets', 'network_cells', 'wifi_access_points',
    'gps_history', 'map_cell_databases', 'sms_calls',
    'map_user_markers', 'map_user_polygons', 'map_user_circles'
  ]
  LOOP
    EXECUTE format('
      UPDATE %I t
      SET mission_id = m.id
      FROM (
        SELECT mission, MIN(id) AS id
        FROM missions
        GROUP BY mission
        HAVING COUNT(*) = 1
      ) m
      WHERE t.mission_id IS NULL AND t.mission = m.mission
    ', tbl);

    EXECUTE format('
      INSERT INTO migration_ambiguities (table_name, record_id, mission_label, candidate_mission_ids, status)
      SELECT %L, t.id, t.mission,
        (SELECT string_agg(m2.id::text, '','') FROM missions m2 WHERE m2.mission = t.mission),
        ''PENDING''
      FROM %I t
      WHERE t.mission_id IS NULL
        AND t.mission IS NOT NULL
        AND (SELECT COUNT(*) FROM missions m3 WHERE m3.mission = t.mission) > 1
    ', tbl, tbl);
  END LOOP;

  -- Special case: mission_extras links via mission_name
  UPDATE mission_extras t
  SET mission_id = m.id
  FROM (
    SELECT mission, MIN(id) AS id
    FROM missions
    GROUP BY mission
    HAVING COUNT(*) = 1
  ) m
  WHERE t.mission_id IS NULL AND t.mission_name = m.mission;

  INSERT INTO migration_ambiguities (table_name, record_id, mission_label, candidate_mission_ids, status)
  SELECT 'mission_extras', t.id, t.mission_name,
    (SELECT string_agg(m2.id::text, ',') FROM missions m2 WHERE m2.mission = t.mission_name),
    'PENDING'
  FROM mission_extras t
  WHERE t.mission_id IS NULL
    AND t.mission_name IS NOT NULL
    AND (SELECT COUNT(*) FROM missions m3 WHERE m3.mission = t.mission_name) > 1;
END $$;

-- 6. Add foreign keys referencing missions(id)
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "targets" ADD CONSTRAINT "targets_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mission_extras" ADD CONSTRAINT "mission_extras_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "network_cells" ADD CONSTRAINT "network_cells_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wifi_access_points" ADD CONSTRAINT "wifi_access_points_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gps_history" ADD CONSTRAINT "gps_history_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "map_cell_databases" ADD CONSTRAINT "map_cell_databases_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sms_calls" ADD CONSTRAINT "sms_calls_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "map_user_markers" ADD CONSTRAINT "map_user_markers_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "map_user_polygons" ADD CONSTRAINT "map_user_polygons_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "map_user_circles" ADD CONSTRAINT "map_user_circles_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Performance indexes
CREATE INDEX IF NOT EXISTS "registrations_mission_id_idx" ON "registrations"("mission_id");
CREATE INDEX IF NOT EXISTS "registrations_country_idx" ON "registrations"("country");
CREATE INDEX IF NOT EXISTS "registrations_country_code_idx" ON "registrations"("country_code");
CREATE INDEX IF NOT EXISTS "registrations_bts_name_idx" ON "registrations"("bts_name");
CREATE INDEX IF NOT EXISTS "registrations_ue_model_idx" ON "registrations"("ue_model");

CREATE INDEX IF NOT EXISTS "targets_mission_id_idx" ON "targets"("mission_id");
CREATE INDEX IF NOT EXISTS "mission_extras_mission_id_idx" ON "mission_extras"("mission_id");
CREATE INDEX IF NOT EXISTS "location_extras_mission_id_idx" ON "location_extras"("mission_id");

CREATE INDEX IF NOT EXISTS "network_cells_mission_id_idx" ON "network_cells"("mission_id");
CREATE INDEX IF NOT EXISTS "network_cells_mcc_idx" ON "network_cells"("mcc");
CREATE INDEX IF NOT EXISTS "network_cells_rat_idx" ON "network_cells"("rat");
CREATE INDEX IF NOT EXISTS "network_cells_lac_idx" ON "network_cells"("lac");

CREATE INDEX IF NOT EXISTS "wifi_access_points_mission_id_idx" ON "wifi_access_points"("mission_id");
CREATE INDEX IF NOT EXISTS "gps_history_mission_id_idx" ON "gps_history"("mission_id");
CREATE INDEX IF NOT EXISTS "map_cell_databases_mission_id_idx" ON "map_cell_databases"("mission_id");
CREATE INDEX IF NOT EXISTS "sms_calls_mission_id_idx" ON "sms_calls"("mission_id");
CREATE INDEX IF NOT EXISTS "map_user_markers_mission_id_idx" ON "map_user_markers"("mission_id");
CREATE INDEX IF NOT EXISTS "map_user_polygons_mission_id_idx" ON "map_user_polygons"("mission_id");
CREATE INDEX IF NOT EXISTS "map_user_circles_mission_id_idx" ON "map_user_circles"("mission_id");
CREATE INDEX IF NOT EXISTS "plmn_storage_country_idx" ON "plmn_storage"("country");
CREATE INDEX IF NOT EXISTS "plmn_storage_code_idx" ON "plmn_storage"("code");

-- 8. Create ExportHistory table
CREATE TABLE IF NOT EXISTS "export_history" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "username" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "selected_missions" TEXT,
  "applied_filters" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "file_path" TEXT,
  "file_name" TEXT,
  "file_size" INTEGER,
  "error_details" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "export_history_user_id_idx" ON "export_history"("user_id");
CREATE INDEX IF NOT EXISTS "export_history_created_at_idx" ON "export_history"("created_at");

COMMIT;
