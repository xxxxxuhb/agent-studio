-- Upgrade existing DBs: usage events + audit logs.
-- Safe to re-run. Fresh installs already have these via init.sql.

CREATE TABLE IF NOT EXISTS `usage_events` (
  `id` varchar(36) NOT NULL,
  `at` varchar(40) NOT NULL,
  `team_id` varchar(36) NOT NULL DEFAULT '',
  `work_order_id` varchar(64) NOT NULL DEFAULT '',
  `run_id` varchar(64) NOT NULL DEFAULT '',
  `bridge_run_id` varchar(64) NOT NULL DEFAULT '',
  `step_id` varchar(64) NOT NULL DEFAULT '',
  `stage` varchar(64) NOT NULL DEFAULT '',
  `driver` varchar(64) NOT NULL DEFAULT '',
  `prompt_tokens` int NULL,
  `completion_tokens` int NULL,
  `total_tokens` int NULL,
  `cost_usd` decimal(12,6) NULL,
  `dry_run` tinyint NOT NULL DEFAULT 0,
  `detail` json NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_usage_events_team_id` (`team_id`),
  KEY `IDX_usage_events_work_order_id` (`work_order_id`),
  KEY `IDX_usage_events_at` (`at`),
  KEY `IDX_usage_events_driver` (`driver`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` varchar(36) NOT NULL,
  `at` varchar(40) NOT NULL,
  `team_id` varchar(36) NOT NULL DEFAULT '',
  `actor_user_id` varchar(36) NOT NULL DEFAULT '',
  `actor_name` varchar(128) NOT NULL DEFAULT '',
  `action` varchar(64) NOT NULL,
  `resource_type` varchar(64) NOT NULL DEFAULT '',
  `resource_id` varchar(128) NOT NULL DEFAULT '',
  `summary` varchar(512) NOT NULL DEFAULT '',
  `detail` json NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_audit_logs_team_id` (`team_id`),
  KEY `IDX_audit_logs_actor_user_id` (`actor_user_id`),
  KEY `IDX_audit_logs_at` (`at`),
  KEY `IDX_audit_logs_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
