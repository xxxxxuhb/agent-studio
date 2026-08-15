-- Upgrade existing DBs: persist Bridge artifact bodies (survive GC).
-- Safe to re-run. Fresh installs already have this via init.sql.

CREATE TABLE IF NOT EXISTS `run_artifacts` (
  `studio_run_id` varchar(64) NOT NULL,
  `name` varchar(256) NOT NULL,
  `rel_path` varchar(512) NOT NULL DEFAULT '',
  `work_order_id` varchar(64) NOT NULL DEFAULT '',
  `team_id` varchar(36) NOT NULL DEFAULT '',
  `step_id` varchar(64) NOT NULL DEFAULT '',
  `role` varchar(64) NOT NULL DEFAULT '',
  `content_type` varchar(128) NOT NULL DEFAULT 'text/plain; charset=utf-8',
  `bytes` int NOT NULL DEFAULT 0,
  `content` mediumtext NOT NULL,
  `captured_at` varchar(40) NOT NULL,
  PRIMARY KEY (`studio_run_id`, `name`),
  KEY `IDX_run_artifacts_work_order_id` (`work_order_id`),
  KEY `IDX_run_artifacts_team_id` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
