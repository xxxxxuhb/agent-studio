-- Human → Agent inbox attachments (team-scoped).
-- Safe to re-run. Fresh installs already have this via init.sql.

CREATE TABLE IF NOT EXISTS `work_order_attachments` (
  `id` varchar(36) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `work_order_id` varchar(64) NOT NULL,
  `filename` varchar(256) NOT NULL,
  `content_type` varchar(128) NOT NULL DEFAULT 'application/octet-stream',
  `bytes` int NOT NULL DEFAULT 0,
  `content` mediumblob NOT NULL,
  `created_by` varchar(36) NOT NULL DEFAULT '',
  `created_at` varchar(40) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_wo_attachments_work_order` (`work_order_id`),
  KEY `IDX_wo_attachments_team` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
