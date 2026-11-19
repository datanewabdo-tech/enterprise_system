-- CreateTable
CREATE TABLE "cronologs_import_batches" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "file_hash" TEXT,
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "imported_records" INTEGER NOT NULL DEFAULT 0,
    "failed_records" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,

    CONSTRAINT "cronologs_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cronologs" (
    "id" SERIAL NOT NULL,
    "date_up" TEXT,
    "time_up" TEXT,
    "date_down" TEXT,
    "time_down" TEXT,
    "unique_call_id" TEXT,
    "unit_latitude" DOUBLE PRECISION,
    "unit_longitude" DOUBLE PRECISION,
    "called_tmsi" TEXT,
    "called_contention_resolution_id" TEXT,
    "called_imsi" TEXT,
    "called_imei" TEXT,
    "called_pstn" TEXT,
    "calling_tmsi" TEXT,
    "calling_contention_resolution_id" TEXT,
    "calling_imsi" TEXT,
    "calling_imei" TEXT,
    "calling_pstn" TEXT,
    "mobile_origination" TEXT,
    "reverse_received" TEXT,
    "thuraya_imsi" TEXT,
    "thuraya_imei" TEXT,
    "original_tmsi" TEXT,
    "reallocated_tmsi" TEXT,
    "contention_resolution_id" TEXT,
    "dtmf_digits" TEXT,
    "mobile_latitude" DOUBLE PRECISION,
    "mobile_longitude" DOUBLE PRECISION,
    "system_id" TEXT,
    "thuraya_vocoder_algorithm" TEXT,
    "mode_of_call" TEXT,
    "sub_mode_of_call" TEXT,
    "reason_for_eoc" TEXT,
    "thuraya_srand" TEXT,
    "thuraya_sres" TEXT,
    "ciphering_key_sequence_number" TEXT,
    "kc" TEXT,
    "ki" TEXT,
    "target_identifiers" TEXT,
    "case_notation" TEXT,
    "audio_routed" TEXT,
    "encryption_mode" TEXT,
    "initial_control_channel" TEXT,
    "voice_channel_history" TEXT,
    "voice_channel_history_timestamp" TEXT,
    "message_type" TEXT,
    "message_length" INTEGER,
    "message" TEXT,
    "called_normalized_pstn" TEXT,
    "calling_normalized_pstn" TEXT,
    "target_selection_result" TEXT,
    "target_rule" TEXT,
    "called_party_target_rule" TEXT,
    "calling_party_target_rule" TEXT,
    "hit_list" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "import_batch_id" INTEGER,

    CONSTRAINT "cronologs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cronologs_import_batches_file_hash_idx" ON "cronologs_import_batches"("file_hash");

-- CreateIndex
CREATE INDEX "cronologs_import_batches_uploaded_at_idx" ON "cronologs_import_batches"("uploaded_at");

-- CreateIndex
CREATE INDEX "cronologs_import_batches_status_idx" ON "cronologs_import_batches"("status");

-- CreateIndex
CREATE INDEX "cronologs_unique_call_id_idx" ON "cronologs"("unique_call_id");

-- CreateIndex
CREATE INDEX "cronologs_called_imsi_idx" ON "cronologs"("called_imsi");

-- CreateIndex
CREATE INDEX "cronologs_calling_imsi_idx" ON "cronologs"("calling_imsi");

-- CreateIndex
CREATE INDEX "cronologs_called_imei_idx" ON "cronologs"("called_imei");

-- CreateIndex
CREATE INDEX "cronologs_calling_imei_idx" ON "cronologs"("calling_imei");

-- CreateIndex
CREATE INDEX "cronologs_date_up_idx" ON "cronologs"("date_up");

-- CreateIndex
CREATE INDEX "cronologs_date_down_idx" ON "cronologs"("date_down");

-- CreateIndex
CREATE INDEX "cronologs_system_id_idx" ON "cronologs"("system_id");

-- CreateIndex
CREATE INDEX "cronologs_import_batch_id_idx" ON "cronologs"("import_batch_id");

-- AddForeignKey
ALTER TABLE "cronologs" ADD CONSTRAINT "cronologs_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "cronologs_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
