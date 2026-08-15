-- Agent Studio MySQL — one-shot init (create DB + schema)
--
--   mysql -u root -p < apps/studio-api/sql/init.sql
--
-- Safe to re-run: CREATE IF NOT EXISTS; is_admin column added only when missing.
-- Connection settings: apps/studio-api/.env (STUDIO_MYSQL_*).

CREATE DATABASE IF NOT EXISTS `agent_studio`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `agent_studio`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(128) NOT NULL DEFAULT '',
  `is_admin` tinyint NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teams` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `name` varchar(128) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_teams_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `team_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `role` varchar(16) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_team_members_team_user` (`team_id`, `user_id`),
  KEY `IDX_team_members_team_id` (`team_id`),
  KEY `IDX_team_members_user_id` (`user_id`),
  CONSTRAINT `FK_team_members_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FK_team_members_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `projects` (
  `id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text NOT NULL,
  `clone_root` varchar(512) NOT NULL DEFAULT '',
  `repos` json NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `tags` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_projects_team_id` (`team_id`),
  CONSTRAINT `FK_projects_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_orders` (
  `id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `project_id` varchar(64) NOT NULL DEFAULT '',
  `title` varchar(256) NOT NULL,
  `requirement` text NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'draft',
  `pipeline_id` varchar(64) NOT NULL DEFAULT '',
  `category` varchar(32) NOT NULL DEFAULT 'requirement',
  `priority` varchar(16) NOT NULL DEFAULT 'medium',
  `tags` json NOT NULL,
  `clarifications` json NOT NULL,
  `run` json NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_work_orders_team_id` (`team_id`),
  KEY `IDX_work_orders_project_id` (`project_id`),
  CONSTRAINT `FK_work_orders_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `run_logs` (
  `run_id` varchar(64) NOT NULL,
  `work_order_id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL DEFAULT '',
  `title` varchar(256) NOT NULL DEFAULT '',
  `pipeline_id` varchar(64) NOT NULL DEFAULT '',
  `pipeline_name` varchar(256) NOT NULL DEFAULT '',
  `executor` varchar(64) NOT NULL DEFAULT '',
  `project_id` varchar(64) NOT NULL DEFAULT '',
  `work_order_status` varchar(32) NOT NULL DEFAULT '',
  `bridge_run_id` varchar(64) NOT NULL DEFAULT '',
  `bridge_stage` varchar(64) NOT NULL DEFAULT '',
  `last_error` text NOT NULL,
  `started_at` varchar(40) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  `entry_count` int NOT NULL DEFAULT 0,
  `sources` json NOT NULL,
  PRIMARY KEY (`run_id`),
  KEY `IDX_run_logs_work_order_id` (`work_order_id`),
  KEY `IDX_run_logs_team_id` (`team_id`),
  KEY `IDX_run_logs_bridge_run_id` (`bridge_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `run_log_entries` (
  `run_id` varchar(64) NOT NULL,
  `id` varchar(64) NOT NULL,
  `work_order_id` varchar(64) NOT NULL,
  `at` varchar(40) NOT NULL,
  `source` varchar(16) NOT NULL,
  `level` varchar(16) NOT NULL DEFAULT 'info',
  `message` text NOT NULL,
  `body` mediumtext NOT NULL,
  `step_id` varchar(64) NOT NULL DEFAULT '',
  `agent` varchar(64) NOT NULL DEFAULT '',
  `bridge_stage` varchar(64) NOT NULL DEFAULT '',
  `event_type` varchar(64) NOT NULL DEFAULT '',
  `detail` json NULL,
  PRIMARY KEY (`run_id`, `id`),
  KEY `IDX_run_log_entries_work_order_id` (`work_order_id`),
  CONSTRAINT `FK_run_log_entries_run`
    FOREIGN KEY (`run_id`) REFERENCES `run_logs` (`run_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bridge artifact file bodies (survive Bridge disk GC; basename matches Bridge API)
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

CREATE TABLE IF NOT EXISTS `digital_humans` (
  `id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `role` varchar(64) NOT NULL,
  `description` text NOT NULL,
  `responsibilities` json NOT NULL,
  `permissions` json NOT NULL,
  `inputs` json NOT NULL,
  `outputs` json NOT NULL,
  `commands` json NOT NULL,
  `human_gate_default` tinyint NOT NULL DEFAULT 1,
  `prompt_hints` json NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `avatar_label` varchar(64) NOT NULL DEFAULT '',
  `tags` json NOT NULL,
  `bridge` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_digital_humans_team_id` (`team_id`),
  CONSTRAINT `FK_digital_humans_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pipelines` (
  `id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `tags` json NOT NULL,
  `source` json NOT NULL,
  `defaults` json NOT NULL,
  `steps` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_pipelines_team_id` (`team_id`),
  CONSTRAINT `FK_pipelines_team`
    FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bridges` (
  `id` varchar(64) NOT NULL,
  `team_id` varchar(36) NOT NULL DEFAULT '',
  `name` varchar(128) NOT NULL,
  `base_url` varchar(512) NOT NULL,
  `driver` varchar(64) NOT NULL DEFAULT 'auto',
  `driver_label` varchar(128) NOT NULL DEFAULT '',
  `dry_run` tinyint NOT NULL DEFAULT 0,
  `model` varchar(128) NOT NULL DEFAULT '',
  `platform` varchar(64) NOT NULL DEFAULT '',
  `link_type` varchar(16) NOT NULL DEFAULT 'cli',
  `available_drivers` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'offline',
  `current_run_id` varchar(64) NOT NULL DEFAULT '',
  `last_seen_at` varchar(40) NOT NULL DEFAULT '',
  `note` text NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_bridges_team_id` (`team_id`),
  KEY `IDX_bridges_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Upgrade path: older installs may have `users` without `is_admin`
SET @__col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'is_admin'
);
SET @__sql := IF(
  @__col_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `is_admin` tinyint NOT NULL DEFAULT 0 AFTER `display_name`',
  'SELECT ''is_admin already present'' AS info'
);
PREPARE `__stmt` FROM @__sql;
EXECUTE `__stmt`;
DEALLOCATE PREPARE `__stmt`;

-- Promote bootstrap admin if present
UPDATE `users` SET `is_admin` = 1 WHERE `username` = 'admin' LIMIT 1;

-- Upgrade path: older installs may lack bridges.link_type
SET @__col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bridges'
    AND COLUMN_NAME = 'link_type'
);
SET @__sql := IF(
  @__col_exists = 0,
  'ALTER TABLE `bridges` ADD COLUMN `link_type` varchar(16) NOT NULL DEFAULT ''cli'' AFTER `platform`',
  'SELECT ''link_type already present'' AS info'
);
PREPARE `__stmt` FROM @__sql;
EXECUTE `__stmt`;
DEALLOCATE PREPARE `__stmt`;
