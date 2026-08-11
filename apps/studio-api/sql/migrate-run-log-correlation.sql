-- Upgrade existing DBs: denormalize Studio↔ Dify ↔ Bridge correlation onto run_logs.
-- Safe to re-run (skips columns that already exist). Fresh installs already have these via init.sql.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND COLUMN_NAME = 'dify_workflow_run_id'
    ),
    'SELECT 1',
    'ALTER TABLE `run_logs` ADD COLUMN `dify_workflow_run_id` varchar(128) NOT NULL DEFAULT '''' AFTER `work_order_status`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND COLUMN_NAME = 'bridge_run_id'
    ),
    'SELECT 1',
    'ALTER TABLE `run_logs` ADD COLUMN `bridge_run_id` varchar(64) NOT NULL DEFAULT '''' AFTER `dify_workflow_run_id`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND COLUMN_NAME = 'bridge_stage'
    ),
    'SELECT 1',
    'ALTER TABLE `run_logs` ADD COLUMN `bridge_stage` varchar(64) NOT NULL DEFAULT '''' AFTER `bridge_run_id`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND COLUMN_NAME = 'last_error'
    ),
    'SELECT 1',
    'ALTER TABLE `run_logs` ADD COLUMN `last_error` text NULL AFTER `bridge_stage`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND INDEX_NAME = 'IDX_run_logs_dify_workflow_run_id'
    ),
    'SELECT 1',
    'CREATE INDEX `IDX_run_logs_dify_workflow_run_id` ON `run_logs` (`dify_workflow_run_id`)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND INDEX_NAME = 'IDX_run_logs_bridge_run_id'
    ),
    'SELECT 1',
    'CREATE INDEX `IDX_run_logs_bridge_run_id` ON `run_logs` (`bridge_run_id`)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
