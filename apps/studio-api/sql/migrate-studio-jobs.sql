-- Upgrade existing DBs: durable Studio orchestrator job queue.
-- Safe to re-run. Fresh installs already have this via init.sql.

CREATE TABLE IF NOT EXISTS `studio_jobs` (
  `id` varchar(36) NOT NULL,
  `work_order_id` varchar(64) NOT NULL,
  `run_id` varchar(64) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `claimed_by` varchar(64) NOT NULL DEFAULT '',
  `claimed_at` varchar(40) NULL,
  `finished_at` varchar(40) NULL,
  `error` text NULL,
  `created_at` varchar(40) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_studio_jobs_status_created` (`status`, `created_at`),
  KEY `IDX_studio_jobs_work_order` (`work_order_id`),
  KEY `IDX_studio_jobs_run_id` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
