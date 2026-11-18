-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "batch_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "destination_table" TEXT,
    "import_mode" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "total_processed" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_log" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "undo_status" TEXT NOT NULL DEFAULT 'NOT_UNDONE',
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_changes" (
    "id" SERIAL NOT NULL,
    "batch_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_batch_id_key" ON "import_batches"("batch_id");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batches_created_at_idx" ON "import_batches"("created_at");

-- CreateIndex
CREATE INDEX "import_batches_user_id_idx" ON "import_batches"("user_id");

-- CreateIndex
CREATE INDEX "import_changes_batch_id_idx" ON "import_changes"("batch_id");

-- CreateIndex
CREATE INDEX "import_changes_table_name_record_id_idx" ON "import_changes"("table_name", "record_id");

-- AddForeignKey
ALTER TABLE "import_changes" ADD CONSTRAINT "import_changes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("batch_id") ON DELETE CASCADE ON UPDATE CASCADE;
