CREATE TABLE "archive_hour_merge_progress" (
  "hour_start" timestamp NOT NULL,
  "day_start" timestamp NOT NULL,
  "source_partition" varchar(255) NOT NULL,
  "next_batch_start" integer NOT NULL DEFAULT 0,
  "max_validator" integer NOT NULL,
  "completed" boolean NOT NULL DEFAULT false,
  "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamp,

  CONSTRAINT "archive_hour_merge_progress_pkey" PRIMARY KEY ("hour_start")
);

CREATE INDEX "archive_hour_merge_progress_day_start_completed_idx"
  ON "archive_hour_merge_progress" ("day_start", "completed");
