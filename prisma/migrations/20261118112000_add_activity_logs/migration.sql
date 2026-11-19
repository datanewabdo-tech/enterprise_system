-- CreateTable
CREATE TABLE "activity_logs_import_batches" (
    "id" BIGSERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "total_records" INTEGER NOT NULL,
    "imported_records" INTEGER NOT NULL,
    "failed_records" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "uploaded_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" INTEGER,

    CONSTRAINT "activity_logs_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "line_number" INTEGER,
    "record_type" VARCHAR(50),
    "field_1" TEXT,
    "field_2" TEXT,
    "field_3" TEXT,
    "field_4" TEXT,
    "field_5" TEXT,
    "field_6" TEXT,
    "field_7" TEXT,
    "field_8" TEXT,
    "field_9" TEXT,
    "field_10" TEXT,
    "field_11" TEXT,
    "field_12" TEXT,
    "field_13" TEXT,
    "field_14" TEXT,
    "field_15" TEXT,
    "field_16" TEXT,
    "original_record" TEXT,
    "source_file" TEXT,
    "import_batch_id" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_import_batches_file_hash_idx" ON "activity_logs_import_batches"("file_hash");

-- CreateIndex
CREATE INDEX "activity_logs_import_batches_uploaded_at_idx" ON "activity_logs_import_batches"("uploaded_at");

-- CreateIndex
CREATE INDEX "activity_logs_import_batches_status_idx" ON "activity_logs_import_batches"("status");

-- CreateIndex
CREATE INDEX "activity_logs_record_type_idx" ON "activity_logs"("record_type");

-- CreateIndex
CREATE INDEX "activity_logs_source_file_idx" ON "activity_logs"("source_file");

-- CreateIndex
CREATE INDEX "activity_logs_line_number_idx" ON "activity_logs"("line_number");

-- CreateIndex
CREATE INDEX "activity_logs_import_batch_id_idx" ON "activity_logs"("import_batch_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- AddForeignKey
ALTER TABLE "activity_logs_import_batches" ADD CONSTRAINT "activity_logs_import_batches_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "activity_logs_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
