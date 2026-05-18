CREATE TABLE "archive_daily_merge_progress" (
  "target_day" timestamp NOT NULL,
  "current_hour" timestamp NOT NULL,
  "source_partition" varchar(255),
  "next_batch_start" integer NOT NULL DEFAULT 0,
  "max_validator" integer NOT NULL DEFAULT 0,
  "completed" boolean NOT NULL DEFAULT false,
  "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamp,

  CONSTRAINT "archive_daily_merge_progress_pkey" PRIMARY KEY ("target_day")
);

CREATE INDEX "archive_daily_merge_progress_completed_target_day_idx"
  ON "archive_daily_merge_progress" ("completed", "target_day");

CREATE INDEX "validator_daily_archive_detail_cleanup_idx"
  ON "validator_daily_archive" ("timestamp", "validator_index")
  WHERE "data_by_slot" IS NOT NULL OR "data_by_epoch" IS NOT NULL;
