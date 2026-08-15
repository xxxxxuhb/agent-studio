-- Prefer Bridge when project repos use absolute local paths.
-- Safe to re-run.

SET @__col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'projects'
    AND COLUMN_NAME = 'preferred_bridge_id'
);
SET @__sql := IF(
  @__col_exists = 0,
  'ALTER TABLE `projects` ADD COLUMN `preferred_bridge_id` varchar(64) NOT NULL DEFAULT '''' AFTER `clone_root`',
  'SELECT ''preferred_bridge_id already present'' AS info'
);
PREPARE `__stmt` FROM @__sql;
EXECUTE `__stmt`;
DEALLOCATE PREPARE `__stmt`;
