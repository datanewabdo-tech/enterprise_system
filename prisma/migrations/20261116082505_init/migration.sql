-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER', 'DATA_ANALYST', 'VIEWER');

-- CreateTable
CREATE TABLE "missions" (
    "id" SERIAL NOT NULL,
    "mission" TEXT NOT NULL,
    "mission_name" TEXT,
    "location" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" SERIAL NOT NULL,
    "reg_id" TEXT,
    "mission_id" INTEGER,
    "mission" TEXT,
    "bts" TEXT,
    "bts_name" TEXT,
    "country" TEXT,
    "tmsi" TEXT,
    "imsi" TEXT,
    "imei" TEXT,
    "ue_model" TEXT,
    "bts_location" TEXT,
    "bts_altitude" DOUBLE PRECISION,
    "bts_location_outdated" BOOLEAN DEFAULT false,
    "distance_min" DOUBLE PRECISION,
    "distance_max" DOUBLE PRECISION,
    "country_code" TEXT,
    "device_location" TEXT,
    "last_seen" TIMESTAMP(3),
    "update" TEXT,
    "action" TEXT,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "mission_name" TEXT,
    "imsi" TEXT,
    "imei" TEXT,
    "name" TEXT NOT NULL,
    "action" TEXT,
    "redirect_tech" TEXT,
    "redirect_bsic" TEXT,
    "redirect_channel" TEXT,
    "description" TEXT,
    "is_p_c_s1900" BOOLEAN DEFAULT false,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_extras" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission_name" TEXT,
    "description" TEXT NOT NULL,

    CONSTRAINT "mission_extras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_extras" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "location_extras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_files" (
    "id" SERIAL NOT NULL,
    "mission_extra_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_files" (
    "id" SERIAL NOT NULL,
    "location_extra_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_cells" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "channel" INTEGER,
    "lac" INTEGER,
    "mcc" INTEGER,
    "mnc" INTEGER,
    "rx_lev" DOUBLE PRECISION,
    "cell_id" INTEGER,
    "rat" TEXT,
    "bsic" INTEGER,
    "pci" INTEGER,
    "is_pcs1900" BOOLEAN DEFAULT false,
    "rx_lev_dbm" DOUBLE PRECISION,
    "downlink" DOUBLE PRECISION,
    "dl_bandwidth" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "direction" DOUBLE PRECISION,
    "is_neighbour" BOOLEAN DEFAULT false,
    "cid_lac_mnc" TEXT,

    CONSTRAINT "network_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_access_points" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "bssid" TEXT NOT NULL,
    "essid" TEXT,
    "enc" TEXT,
    "channel" INTEGER,
    "first_seen" TIMESTAMP(3),
    "last_seen" TIMESTAMP(3),
    "strength" DOUBLE PRECISION,
    "hidden" BOOLEAN DEFAULT false,
    "manufacturer" TEXT,
    "wanted" BOOLEAN DEFAULT false,
    "essid_bssid_id" TEXT,

    CONSTRAINT "wifi_access_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_access_point_clients" (
    "id" SERIAL NOT NULL,
    "wifi_access_point_essid_bssid" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3),
    "last_seen" TIMESTAMP(3),
    "wants" TEXT,
    "manufacturer" TEXT,

    CONSTRAINT "wifi_access_point_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_history" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "bts_id" TEXT,
    "silent_target_reg_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "dl_pow" DOUBLE PRECISION,
    "ul_pow" DOUBLE PRECISION,
    "distance_min" DOUBLE PRECISION,
    "distance_max" DOUBLE PRECISION,
    "time_dl" DOUBLE PRECISION,

    CONSTRAINT "gps_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_cell_databases" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "name" TEXT NOT NULL,
    "header" TEXT,
    "color" TEXT DEFAULT '#3b82f6',

    CONSTRAINT "map_cell_databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_cells" (
    "id" SERIAL NOT NULL,
    "db_id" INTEGER NOT NULL,
    "contents" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "mcc" INTEGER,
    "mnc" INTEGER,
    "lac" INTEGER,
    "cid" INTEGER,
    "mcc_mnc_junction" TEXT,
    "address" TEXT,
    "direction" DOUBLE PRECISION,
    "format_hex" TEXT,
    "opening_angle" DOUBLE PRECISION,
    "radius" DOUBLE PRECISION,
    "sc_pci" INTEGER,
    "channel" INTEGER,
    "antenna_type" TEXT,

    CONSTRAINT "map_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plmn_storage" (
    "mcc" INTEGER NOT NULL,
    "mnc" INTEGER NOT NULL,
    "country" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "plmn_storage_pkey" PRIMARY KEY ("mcc","mnc")
);

-- CreateTable
CREATE TABLE "sms_calls" (
    "id" SERIAL NOT NULL,
    "sms_id" TEXT,
    "call_id" TEXT,
    "mission_id" INTEGER,
    "mission" TEXT,
    "incoming" BOOLEAN NOT NULL DEFAULT true,
    "is_sms" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "destination" TEXT,
    "bts_id" TEXT,
    "bts_name" TEXT,
    "status" TEXT,
    "sms_content" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_user_markers" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "direction" DOUBLE PRECISION,
    "type" TEXT,
    "description" TEXT,
    "image" TEXT,
    "color" TEXT DEFAULT '#ef4444',
    "width" DOUBLE PRECISION DEFAULT 32,
    "height" DOUBLE PRECISION DEFAULT 32,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_user_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_user_polygons" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "points" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT DEFAULT '#8b5cf6',
    "description" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_user_polygons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_user_circles" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER,
    "mission" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT DEFAULT '#10b981',
    "description" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_user_circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_files" (
    "id" SERIAL NOT NULL,
    "target_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitelist_targets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "imsi" TEXT,
    "imei" TEXT,

    CONSTRAINT "whitelist_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tac_numbers" (
    "id" SERIAL NOT NULL,
    "tac_id" TEXT,
    "name" TEXT NOT NULL,
    "tac" TEXT NOT NULL,

    CONSTRAINT "tac_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" SERIAL NOT NULL,
    "task_type" TEXT NOT NULL,
    "execution_time" TIMESTAMP(3) NOT NULL,
    "json_params" TEXT NOT NULL,
    "prettified_params" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_layers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,

    CONSTRAINT "map_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "record_id" TEXT,
    "ip_address" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_history" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "destination_table" TEXT NOT NULL,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_log" TEXT,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_history" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_ambiguities" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "mission_label" TEXT NOT NULL,
    "candidate_mission_ids" TEXT NOT NULL,
    "resolved_mission_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_ambiguities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "table_name" TEXT NOT NULL,
    "view_name" TEXT NOT NULL,
    "filters_json" TEXT NOT NULL,
    "sort_json" TEXT,
    "columns_json" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "missions_mission_idx" ON "missions"("mission");

-- CreateIndex
CREATE INDEX "missions_location_idx" ON "missions"("location");

-- CreateIndex
CREATE INDEX "registrations_mission_id_idx" ON "registrations"("mission_id");

-- CreateIndex
CREATE INDEX "registrations_mission_idx" ON "registrations"("mission");

-- CreateIndex
CREATE INDEX "registrations_country_idx" ON "registrations"("country");

-- CreateIndex
CREATE INDEX "registrations_country_code_idx" ON "registrations"("country_code");

-- CreateIndex
CREATE INDEX "registrations_imsi_idx" ON "registrations"("imsi");

-- CreateIndex
CREATE INDEX "registrations_imei_idx" ON "registrations"("imei");

-- CreateIndex
CREATE INDEX "registrations_last_seen_idx" ON "registrations"("last_seen");

-- CreateIndex
CREATE INDEX "registrations_bts_name_idx" ON "registrations"("bts_name");

-- CreateIndex
CREATE INDEX "registrations_ue_model_idx" ON "registrations"("ue_model");

-- CreateIndex
CREATE INDEX "targets_mission_id_idx" ON "targets"("mission_id");

-- CreateIndex
CREATE INDEX "targets_mission_idx" ON "targets"("mission");

-- CreateIndex
CREATE INDEX "targets_imsi_idx" ON "targets"("imsi");

-- CreateIndex
CREATE INDEX "targets_imei_idx" ON "targets"("imei");

-- CreateIndex
CREATE INDEX "mission_extras_mission_id_idx" ON "mission_extras"("mission_id");

-- CreateIndex
CREATE INDEX "location_extras_mission_id_idx" ON "location_extras"("mission_id");

-- CreateIndex
CREATE INDEX "network_cells_mission_id_idx" ON "network_cells"("mission_id");

-- CreateIndex
CREATE INDEX "network_cells_mission_idx" ON "network_cells"("mission");

-- CreateIndex
CREATE INDEX "network_cells_mcc_idx" ON "network_cells"("mcc");

-- CreateIndex
CREATE INDEX "network_cells_mcc_mnc_idx" ON "network_cells"("mcc", "mnc");

-- CreateIndex
CREATE INDEX "network_cells_cell_id_idx" ON "network_cells"("cell_id");

-- CreateIndex
CREATE INDEX "network_cells_rat_idx" ON "network_cells"("rat");

-- CreateIndex
CREATE INDEX "network_cells_lac_idx" ON "network_cells"("lac");

-- CreateIndex
CREATE UNIQUE INDEX "wifi_access_points_bssid_key" ON "wifi_access_points"("bssid");

-- CreateIndex
CREATE INDEX "wifi_access_points_mission_id_idx" ON "wifi_access_points"("mission_id");

-- CreateIndex
CREATE INDEX "wifi_access_points_mission_idx" ON "wifi_access_points"("mission");

-- CreateIndex
CREATE INDEX "wifi_access_points_bssid_idx" ON "wifi_access_points"("bssid");

-- CreateIndex
CREATE INDEX "wifi_access_point_clients_mac_idx" ON "wifi_access_point_clients"("mac");

-- CreateIndex
CREATE INDEX "wifi_access_point_clients_wifi_access_point_essid_bssid_idx" ON "wifi_access_point_clients"("wifi_access_point_essid_bssid");

-- CreateIndex
CREATE INDEX "gps_history_mission_id_idx" ON "gps_history"("mission_id");

-- CreateIndex
CREATE INDEX "gps_history_mission_idx" ON "gps_history"("mission");

-- CreateIndex
CREATE INDEX "gps_history_timestamp_idx" ON "gps_history"("timestamp");

-- CreateIndex
CREATE INDEX "map_cell_databases_mission_id_idx" ON "map_cell_databases"("mission_id");

-- CreateIndex
CREATE INDEX "map_cells_db_id_idx" ON "map_cells"("db_id");

-- CreateIndex
CREATE INDEX "map_cells_lat_lng_idx" ON "map_cells"("lat", "lng");

-- CreateIndex
CREATE INDEX "plmn_storage_country_idx" ON "plmn_storage"("country");

-- CreateIndex
CREATE INDEX "plmn_storage_code_idx" ON "plmn_storage"("code");

-- CreateIndex
CREATE INDEX "sms_calls_mission_id_idx" ON "sms_calls"("mission_id");

-- CreateIndex
CREATE INDEX "sms_calls_mission_idx" ON "sms_calls"("mission");

-- CreateIndex
CREATE INDEX "sms_calls_timestamp_idx" ON "sms_calls"("timestamp");

-- CreateIndex
CREATE INDEX "map_user_markers_mission_id_idx" ON "map_user_markers"("mission_id");

-- CreateIndex
CREATE INDEX "map_user_markers_mission_idx" ON "map_user_markers"("mission");

-- CreateIndex
CREATE INDEX "map_user_polygons_mission_id_idx" ON "map_user_polygons"("mission_id");

-- CreateIndex
CREATE INDEX "map_user_polygons_mission_idx" ON "map_user_polygons"("mission");

-- CreateIndex
CREATE INDEX "map_user_circles_mission_id_idx" ON "map_user_circles"("mission_id");

-- CreateIndex
CREATE INDEX "map_user_circles_mission_idx" ON "map_user_circles"("mission");

-- CreateIndex
CREATE INDEX "whitelist_targets_imsi_idx" ON "whitelist_targets"("imsi");

-- CreateIndex
CREATE INDEX "whitelist_targets_imei_idx" ON "whitelist_targets"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "tac_numbers_tac_key" ON "tac_numbers"("tac");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_username_idx" ON "audit_logs"("username");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "export_history_user_id_idx" ON "export_history"("user_id");

-- CreateIndex
CREATE INDEX "export_history_created_at_idx" ON "export_history"("created_at");

-- CreateIndex
CREATE INDEX "migration_ambiguities_table_name_status_idx" ON "migration_ambiguities"("table_name", "status");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_extras" ADD CONSTRAINT "mission_extras_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_extras" ADD CONSTRAINT "location_extras_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_files" ADD CONSTRAINT "mission_files_mission_extra_id_fkey" FOREIGN KEY ("mission_extra_id") REFERENCES "mission_extras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_files" ADD CONSTRAINT "location_files_location_extra_id_fkey" FOREIGN KEY ("location_extra_id") REFERENCES "location_extras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_cells" ADD CONSTRAINT "network_cells_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_access_points" ADD CONSTRAINT "wifi_access_points_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_history" ADD CONSTRAINT "gps_history_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_cell_databases" ADD CONSTRAINT "map_cell_databases_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_cells" ADD CONSTRAINT "map_cells_db_id_fkey" FOREIGN KEY ("db_id") REFERENCES "map_cell_databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_calls" ADD CONSTRAINT "sms_calls_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_user_markers" ADD CONSTRAINT "map_user_markers_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_user_polygons" ADD CONSTRAINT "map_user_polygons_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_user_circles" ADD CONSTRAINT "map_user_circles_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_files" ADD CONSTRAINT "target_files_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_history" ADD CONSTRAINT "import_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_history" ADD CONSTRAINT "export_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
