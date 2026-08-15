-- Upgrade existing DBs: in-app system notifications (team-scoped).
-- Safe to re-run. Fresh installs already have this via init.sql.

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` varchar(36) NOT NULL,
  `team_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `title` varchar(256) NOT NULL DEFAULT '',
  `body` text NOT NULL,
  `work_order_id` varchar(64) NOT NULL DEFAULT '',
  `actor_user_id` varchar(36) NOT NULL DEFAULT '',
  `actor_name` varchar(128) NOT NULL DEFAULT '',
  `read_at` varchar(40) NULL,
  `created_at` varchar(40) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_notifications_team_user` (`team_id`, `user_id`),
  KEY `IDX_notifications_user_unread` (`user_id`, `read_at`),
  KEY `IDX_notifications_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
