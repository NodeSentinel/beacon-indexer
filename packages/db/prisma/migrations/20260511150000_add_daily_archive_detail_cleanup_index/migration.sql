CREATE INDEX "validator_daily_archive_detail_cleanup_idx"
  ON "validator_daily_archive" ("timestamp", "validator_index")
  WHERE "data_by_slot" IS NOT NULL OR "data_by_epoch" IS NOT NULL;
