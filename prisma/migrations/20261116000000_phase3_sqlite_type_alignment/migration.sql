-- Phase 3 Migration: SQLite Source Type Alignment & Identifier String Preservation
-- NON-DESTRUCTIVE: Adds missing source columns, converts string identifiers
-- (mcc, mnc, lac, cell_id, cid, bsic, pci, psc) to TEXT losslessly, and ensures indexes.

BEGIN;

-- 1. Add missing source columns to registrations
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "mcc" TEXT;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "mnc" TEXT;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "lac" INTEGER;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "rat" INTEGER;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "last_event" TEXT;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "time" BIGINT;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "target_name" TEXT;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "uplink_power" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "registrations_mcc_idx" ON "registrations"("mcc");
CREATE INDEX IF NOT EXISTS "registrations_lac_idx" ON "registrations"("lac");
CREATE INDEX IF NOT EXISTS "registrations_imsi_idx" ON "registrations"("imsi");
CREATE INDEX IF NOT EXISTS "registrations_imei_idx" ON "registrations"("imei");

-- 2. Align network_cells identifier columns to TEXT and add missing psc column
ALTER TABLE "network_cells" ADD COLUMN IF NOT EXISTS "psc" TEXT;
ALTER TABLE "network_cells" ALTER COLUMN "lac" TYPE TEXT USING CASE WHEN "lac" IS NULL THEN NULL ELSE "lac"::TEXT END;
ALTER TABLE "network_cells" ALTER COLUMN "mcc" TYPE TEXT USING CASE WHEN "mcc" IS NULL THEN NULL ELSE "mcc"::TEXT END;
ALTER TABLE "network_cells" ALTER COLUMN "mnc" TYPE TEXT USING CASE WHEN "mnc" IS NULL THEN NULL ELSE "mnc"::TEXT END;
ALTER TABLE "network_cells" ALTER COLUMN "cell_id" TYPE TEXT USING CASE WHEN "cell_id" IS NULL THEN NULL ELSE "cell_id"::TEXT END;
ALTER TABLE "network_cells" ALTER COLUMN "bsic" TYPE TEXT USING CASE WHEN "bsic" IS NULL THEN NULL ELSE "bsic"::TEXT END;
ALTER TABLE "network_cells" ALTER COLUMN "pci" TYPE TEXT USING CASE WHEN "pci" IS NULL THEN NULL ELSE "pci"::TEXT END;

CREATE INDEX IF NOT EXISTS "network_cells_mcc_mnc_idx" ON "network_cells"("mcc", "mnc");
CREATE INDEX IF NOT EXISTS "network_cells_cell_id_idx" ON "network_cells"("cell_id");

-- 3. Align plmn_storage composite primary key identifiers to TEXT
ALTER TABLE "plmn_storage" ALTER COLUMN "mcc" TYPE TEXT USING "mcc"::TEXT;
ALTER TABLE "plmn_storage" ALTER COLUMN "mnc" TYPE TEXT USING "mnc"::TEXT;

-- 4. Align map_cells identifier columns to TEXT
ALTER TABLE "map_cells" ALTER COLUMN "mcc" TYPE TEXT USING CASE WHEN "mcc" IS NULL THEN NULL ELSE "mcc"::TEXT END;
ALTER TABLE "map_cells" ALTER COLUMN "mnc" TYPE TEXT USING CASE WHEN "mnc" IS NULL THEN NULL ELSE "mnc"::TEXT END;
ALTER TABLE "map_cells" ALTER COLUMN "lac" TYPE TEXT USING CASE WHEN "lac" IS NULL THEN NULL ELSE "lac"::TEXT END;
ALTER TABLE "map_cells" ALTER COLUMN "cid" TYPE TEXT USING CASE WHEN "cid" IS NULL THEN NULL ELSE "cid"::TEXT END;

COMMIT;

-- ROLLBACK INSTRUCTIONS (Manual recovery if needed; only safe if no non-numeric strings exist):
-- BEGIN;
-- ALTER TABLE "registrations" DROP COLUMN IF EXISTS "mcc", DROP COLUMN IF EXISTS "mnc", DROP COLUMN IF EXISTS "lac", DROP COLUMN IF EXISTS "rat", DROP COLUMN IF EXISTS "last_event", DROP COLUMN IF EXISTS "time", DROP COLUMN IF EXISTS "target_name", DROP COLUMN IF EXISTS "uplink_power";
-- ALTER TABLE "network_cells" DROP COLUMN IF EXISTS "psc";
-- ALTER TABLE "network_cells" ALTER COLUMN "lac" TYPE INTEGER USING NULLIF("lac", '')::INTEGER;
-- ALTER TABLE "network_cells" ALTER COLUMN "mcc" TYPE INTEGER USING NULLIF("mcc", '')::INTEGER;
-- ALTER TABLE "network_cells" ALTER COLUMN "mnc" TYPE INTEGER USING NULLIF("mnc", '')::INTEGER;
-- ALTER TABLE "network_cells" ALTER COLUMN "cell_id" TYPE INTEGER USING NULLIF("cell_id", '')::INTEGER;
-- ALTER TABLE "network_cells" ALTER COLUMN "bsic" TYPE INTEGER USING NULLIF("bsic", '')::INTEGER;
-- ALTER TABLE "network_cells" ALTER COLUMN "pci" TYPE INTEGER USING NULLIF("pci", '')::INTEGER;
-- COMMIT;
