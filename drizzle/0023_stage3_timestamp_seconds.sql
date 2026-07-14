-- Drizzle's integer timestamp mode stores Unix seconds. Early Stage 3 raw-SQL
-- paths wrote JavaScript milliseconds or SQLite datetime text into these
-- columns. Normalize every affected Stage 3/shared table in place.
UPDATE `projects` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END,
  `pinned_at` = CASE WHEN typeof(`pinned_at`) = 'text' AND unixepoch(`pinned_at`) IS NOT NULL THEN unixepoch(`pinned_at`) WHEN CAST(`pinned_at` AS integer) > 9999999999 THEN CAST(CAST(`pinned_at` AS integer) / 1000 AS integer) ELSE CAST(`pinned_at` AS integer) END,
  `archived_at` = CASE WHEN typeof(`archived_at`) = 'text' AND unixepoch(`archived_at`) IS NOT NULL THEN unixepoch(`archived_at`) WHEN CAST(`archived_at` AS integer) > 9999999999 THEN CAST(CAST(`archived_at` AS integer) / 1000 AS integer) ELSE CAST(`archived_at` AS integer) END
;
--> statement-breakpoint
UPDATE `tasks` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END,
  `pinned_at` = CASE WHEN typeof(`pinned_at`) = 'text' AND unixepoch(`pinned_at`) IS NOT NULL THEN unixepoch(`pinned_at`) WHEN CAST(`pinned_at` AS integer) > 9999999999 THEN CAST(CAST(`pinned_at` AS integer) / 1000 AS integer) ELSE CAST(`pinned_at` AS integer) END,
  `archived_at` = CASE WHEN typeof(`archived_at`) = 'text' AND unixepoch(`archived_at`) IS NOT NULL THEN unixepoch(`archived_at`) WHEN CAST(`archived_at` AS integer) > 9999999999 THEN CAST(CAST(`archived_at` AS integer) / 1000 AS integer) ELSE CAST(`archived_at` AS integer) END
;
--> statement-breakpoint
UPDATE `chats` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END,
  `pinned_at` = CASE WHEN typeof(`pinned_at`) = 'text' AND unixepoch(`pinned_at`) IS NOT NULL THEN unixepoch(`pinned_at`) WHEN CAST(`pinned_at` AS integer) > 9999999999 THEN CAST(CAST(`pinned_at` AS integer) / 1000 AS integer) ELSE CAST(`pinned_at` AS integer) END,
  `archived_at` = CASE WHEN typeof(`archived_at`) = 'text' AND unixepoch(`archived_at`) IS NOT NULL THEN unixepoch(`archived_at`) WHEN CAST(`archived_at` AS integer) > 9999999999 THEN CAST(CAST(`archived_at` AS integer) / 1000 AS integer) ELSE CAST(`archived_at` AS integer) END
;
--> statement-breakpoint
UPDATE `sub_chats` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END;
--> statement-breakpoint
UPDATE `agent_runs` SET
  `started_at` = CASE WHEN `started_at` IS NULL THEN unixepoch() WHEN typeof(`started_at`) = 'text' AND unixepoch(`started_at`) IS NOT NULL THEN unixepoch(`started_at`) WHEN CAST(`started_at` AS integer) > 9999999999 THEN CAST(CAST(`started_at` AS integer) / 1000 AS integer) ELSE CAST(`started_at` AS integer) END,
  `completed_at` = CASE WHEN typeof(`completed_at`) = 'text' AND unixepoch(`completed_at`) IS NOT NULL THEN unixepoch(`completed_at`) WHEN CAST(`completed_at` AS integer) > 9999999999 THEN CAST(CAST(`completed_at` AS integer) / 1000 AS integer) ELSE CAST(`completed_at` AS integer) END
;
--> statement-breakpoint
UPDATE `attachments` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END;
--> statement-breakpoint
UPDATE `filesystem_root_registrations` SET
  `bound_at` = CASE WHEN typeof(`bound_at`) = 'text' AND unixepoch(`bound_at`) IS NOT NULL THEN unixepoch(`bound_at`) WHEN CAST(`bound_at` AS integer) > 9999999999 THEN CAST(CAST(`bound_at` AS integer) / 1000 AS integer) ELSE CAST(`bound_at` AS integer) END;
--> statement-breakpoint
UPDATE `task_orchestrations` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END,
  `started_at` = CASE WHEN typeof(`started_at`) = 'text' AND unixepoch(`started_at`) IS NOT NULL THEN unixepoch(`started_at`) WHEN CAST(`started_at` AS integer) > 9999999999 THEN CAST(CAST(`started_at` AS integer) / 1000 AS integer) ELSE CAST(`started_at` AS integer) END,
  `completed_at` = CASE WHEN typeof(`completed_at`) = 'text' AND unixepoch(`completed_at`) IS NOT NULL THEN unixepoch(`completed_at`) WHEN CAST(`completed_at` AS integer) > 9999999999 THEN CAST(CAST(`completed_at` AS integer) / 1000 AS integer) ELSE CAST(`completed_at` AS integer) END
;
--> statement-breakpoint
UPDATE `orchestration_agents` SET
  `lease_expires_at` = CASE WHEN typeof(`lease_expires_at`) = 'text' AND unixepoch(`lease_expires_at`) IS NOT NULL THEN unixepoch(`lease_expires_at`) WHEN CAST(`lease_expires_at` AS integer) > 9999999999 THEN CAST(CAST(`lease_expires_at` AS integer) / 1000 AS integer) ELSE CAST(`lease_expires_at` AS integer) END,
  `queued_at` = CASE WHEN `queued_at` IS NULL THEN unixepoch() WHEN typeof(`queued_at`) = 'text' AND unixepoch(`queued_at`) IS NOT NULL THEN unixepoch(`queued_at`) WHEN CAST(`queued_at` AS integer) > 9999999999 THEN CAST(CAST(`queued_at` AS integer) / 1000 AS integer) ELSE CAST(`queued_at` AS integer) END,
  `started_at` = CASE WHEN typeof(`started_at`) = 'text' AND unixepoch(`started_at`) IS NOT NULL THEN unixepoch(`started_at`) WHEN CAST(`started_at` AS integer) > 9999999999 THEN CAST(CAST(`started_at` AS integer) / 1000 AS integer) ELSE CAST(`started_at` AS integer) END,
  `completed_at` = CASE WHEN typeof(`completed_at`) = 'text' AND unixepoch(`completed_at`) IS NOT NULL THEN unixepoch(`completed_at`) WHEN CAST(`completed_at` AS integer) > 9999999999 THEN CAST(CAST(`completed_at` AS integer) / 1000 AS integer) ELSE CAST(`completed_at` AS integer) END,
  `updated_at` = CASE WHEN `updated_at` IS NULL THEN unixepoch() WHEN typeof(`updated_at`) = 'text' AND unixepoch(`updated_at`) IS NOT NULL THEN unixepoch(`updated_at`) WHEN CAST(`updated_at` AS integer) > 9999999999 THEN CAST(CAST(`updated_at` AS integer) / 1000 AS integer) ELSE CAST(`updated_at` AS integer) END;
--> statement-breakpoint
UPDATE `usage_samples` SET
  `captured_at` = CASE WHEN `captured_at` IS NULL THEN unixepoch() WHEN typeof(`captured_at`) = 'text' AND unixepoch(`captured_at`) IS NOT NULL THEN unixepoch(`captured_at`) WHEN CAST(`captured_at` AS integer) > 9999999999 THEN CAST(CAST(`captured_at` AS integer) / 1000 AS integer) ELSE CAST(`captured_at` AS integer) END,
  `created_at` = CASE WHEN `created_at` IS NULL THEN CASE WHEN `captured_at` IS NULL THEN unixepoch() WHEN typeof(`captured_at`) = 'text' AND unixepoch(`captured_at`) IS NOT NULL THEN unixepoch(`captured_at`) WHEN CAST(`captured_at` AS integer) > 9999999999 THEN CAST(CAST(`captured_at` AS integer) / 1000 AS integer) ELSE CAST(`captured_at` AS integer) END WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END
;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `mcp_audit_records_no_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `mcp_audit_records_no_delete`;
--> statement-breakpoint
UPDATE `mcp_audit_records` SET
  `created_at` = CASE WHEN `created_at` IS NULL THEN unixepoch() WHEN typeof(`created_at`) = 'text' AND unixepoch(`created_at`) IS NOT NULL THEN unixepoch(`created_at`) WHEN CAST(`created_at` AS integer) > 9999999999 THEN CAST(CAST(`created_at` AS integer) / 1000 AS integer) ELSE CAST(`created_at` AS integer) END;
--> statement-breakpoint
CREATE TRIGGER `mcp_audit_records_no_update`
BEFORE UPDATE ON `mcp_audit_records`
BEGIN
  SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `mcp_audit_records_no_delete`
BEFORE DELETE ON `mcp_audit_records`
BEGIN
  SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
END;
