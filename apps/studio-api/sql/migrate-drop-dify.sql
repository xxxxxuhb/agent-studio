-- Drop Dify compatibility columns / remap digital_humans.dify → bridge.
-- Safe to re-run (checks information_schema before ALTER).

SET @db := DATABASE();

-- digital_humans: rename dify → bridge (if still named dify)
SET @has_dh_dify := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'digital_humans' AND COLUMN_NAME = 'dify'
);
SET @has_dh_bridge := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'digital_humans' AND COLUMN_NAME = 'bridge'
);
SET @sql := IF(
  @has_dh_dify > 0 AND @has_dh_bridge = 0,
  'ALTER TABLE `digital_humans` CHANGE COLUMN `dify` `bridge` json NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Remap legacy JSON keys agent_id/agent_name → stage_id/stage_name
UPDATE `digital_humans`
SET `bridge` = JSON_OBJECT(
  'stage_id', COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(`bridge`, '$.stage_id')),
    JSON_UNQUOTE(JSON_EXTRACT(`bridge`, '$.agent_id')),
    ''
  ),
  'stage_name', COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(`bridge`, '$.stage_name')),
    JSON_UNQUOTE(JSON_EXTRACT(`bridge`, '$.agent_name')),
    ''
  ),
  'note', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`bridge`, '$.note')), '')
)
WHERE `bridge` IS NOT NULL;

-- pipelines: drop dify column
SET @has_p_dify := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'pipelines' AND COLUMN_NAME = 'dify'
);
SET @sql := IF(
  @has_p_dify > 0,
  'ALTER TABLE `pipelines` DROP COLUMN `dify`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- run_logs: drop dify_workflow_run_id index + column
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND INDEX_NAME = 'IDX_run_logs_dify_workflow_run_id'
);
SET @sql := IF(
  @has_idx > 0,
  'ALTER TABLE `run_logs` DROP INDEX `IDX_run_logs_dify_workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'run_logs' AND COLUMN_NAME = 'dify_workflow_run_id'
);
SET @sql := IF(
  @has_col > 0,
  'ALTER TABLE `run_logs` DROP COLUMN `dify_workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
