PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER `agent_runs_require_runtime_snapshot`;--> statement-breakpoint
DROP TRIGGER `agent_runs_require_runtime_snapshot_on_active_transition`;--> statement-breakpoint
DROP TRIGGER `agent_runs_runtime_snapshot_immutable`;--> statement-breakpoint
CREATE TABLE `__new_agent_runtime_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`harness` text NOT NULL,
	`preference` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`scope_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runtime_defaults_scope_check" CHECK((
        ("__new_agent_runtime_defaults"."scope_type" = 'global' and "__new_agent_runtime_defaults"."scope_id" is null) or
        ("__new_agent_runtime_defaults"."scope_type" = 'project' and "__new_agent_runtime_defaults"."scope_id" is not null)
      )),
	CONSTRAINT "agent_runtime_defaults_preference_check" CHECK("__new_agent_runtime_defaults"."preference" in ('auto', 'codex', 'codex-enhanced', 'claude-code', 'claude-code-enhanced', 'flapstack-native')),
	CONSTRAINT "agent_runtime_defaults_version_check" CHECK("__new_agent_runtime_defaults"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_agent_runtime_defaults`("id", "scope_type", "scope_id", "harness", "preference", "version", "created_at", "updated_at")
SELECT "id", "scope_type", "scope_id", "harness",
  CASE
    WHEN "preference" = 'codex' THEN 'codex-enhanced'
    WHEN "preference" = 'claude-code' THEN 'claude-code-enhanced'
    ELSE "preference"
  END,
  "version", "created_at", "updated_at"
FROM `agent_runtime_defaults`;--> statement-breakpoint
DROP TABLE `agent_runtime_defaults`;--> statement-breakpoint
ALTER TABLE `__new_agent_runtime_defaults` RENAME TO `agent_runtime_defaults`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_defaults_global_idx` ON `agent_runtime_defaults` (`harness`) WHERE "agent_runtime_defaults"."scope_type" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_defaults_project_idx` ON `agent_runtime_defaults` (`scope_id`,`harness`) WHERE "agent_runtime_defaults"."scope_type" = 'project';
--> statement-breakpoint
UPDATE `agent_runs`
SET `runtime_preference` = CASE
  WHEN `resolved_runtime` = 'codex' AND `runtime_preference` IN ('auto', 'codex') THEN 'codex-enhanced'
  WHEN `resolved_runtime` = 'claude-code' AND `runtime_preference` IN ('auto', 'claude-code') THEN 'claude-code-enhanced'
  ELSE `runtime_preference`
END
WHERE `runtime_snapshot_version` > 0;--> statement-breakpoint
UPDATE `chats`
SET `runtime_preference` = CASE
  WHEN `runtime_preference` = 'codex' THEN 'codex-enhanced'
  WHEN `runtime_preference` = 'claude-code' THEN 'claude-code-enhanced'
  ELSE `runtime_preference`
END
WHERE `runtime_preference` IN ('codex', 'claude-code');--> statement-breakpoint
UPDATE `chats`
SET `runtime_preference` = CASE
  WHEN (SELECT `resolved_runtime` FROM `agent_runs`
        WHERE `agent_runs`.`chat_id` = `chats`.`id`
        ORDER BY `started_at` DESC, rowid DESC LIMIT 1) = 'codex'
    THEN 'codex-enhanced'
  WHEN (SELECT `resolved_runtime` FROM `agent_runs`
        WHERE `agent_runs`.`chat_id` = `chats`.`id`
        ORDER BY `started_at` DESC, rowid DESC LIMIT 1) = 'claude-code'
    THEN 'claude-code-enhanced'
  ELSE `runtime_preference`
END
WHERE COALESCE(`runtime_preference`, 'auto') = 'auto'
  AND EXISTS (SELECT 1 FROM `agent_runs` WHERE `agent_runs`.`chat_id` = `chats`.`id`);--> statement-breakpoint
UPDATE `chats`
SET `runtime_preference` = CASE
  WHEN COALESCE(`harness`, '') = 'codex' THEN 'codex-enhanced'
  WHEN COALESCE(`harness`, '') = 'claude-code' THEN 'claude-code-enhanced'
  ELSE `runtime_preference`
END
WHERE COALESCE(`runtime_preference`, 'auto') = 'auto'
  AND EXISTS (
    SELECT 1 FROM `sub_chats`
    WHERE `sub_chats`.`chat_id` = `chats`.`id`
      AND `sub_chats`.`session_id` IS NOT NULL
  );--> statement-breakpoint
CREATE TRIGGER `agent_runs_require_runtime_snapshot`
BEFORE INSERT ON `agent_runs`
WHEN NEW.`status` IN ('pending', 'running') AND (
  NEW.`runtime_snapshot_version` < 1 OR
  NEW.`runtime_preference` NOT IN ('auto', 'codex', 'codex-enhanced', 'claude-code', 'claude-code-enhanced', 'flapstack-native') OR
  NEW.`runtime_preference_source` NOT IN ('chat', 'project', 'global', 'product') OR
  NEW.`resolved_runtime` NOT IN ('codex', 'claude-code', 'flapstack-native') OR
  length(trim(NEW.`runtime_adapter_version`)) = 0 OR
  length(trim(NEW.`runtime_protocol_version`)) = 0 OR
  json_valid(NEW.`runtime_capability_snapshot`) <> 1 OR
  json_valid(NEW.`runtime_control_snapshot`) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'pending/running agent run requires Runtime snapshot');
END;--> statement-breakpoint
CREATE TRIGGER `agent_runs_require_runtime_snapshot_on_active_transition`
BEFORE UPDATE OF `status` ON `agent_runs`
WHEN OLD.`status` NOT IN ('pending', 'running') AND NEW.`status` IN ('pending', 'running') AND (
  NEW.`runtime_snapshot_version` < 1 OR
  NEW.`runtime_preference` NOT IN ('auto', 'codex', 'codex-enhanced', 'claude-code', 'claude-code-enhanced', 'flapstack-native') OR
  NEW.`runtime_preference_source` NOT IN ('chat', 'project', 'global', 'product') OR
  NEW.`resolved_runtime` NOT IN ('codex', 'claude-code', 'flapstack-native') OR
  length(trim(NEW.`runtime_adapter_version`)) = 0 OR
  length(trim(NEW.`runtime_protocol_version`)) = 0 OR
  json_valid(NEW.`runtime_capability_snapshot`) <> 1 OR
  json_valid(NEW.`runtime_control_snapshot`) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'pending/running agent run requires Runtime snapshot');
END;--> statement-breakpoint
CREATE TRIGGER `agent_runs_runtime_snapshot_immutable`
BEFORE UPDATE ON `agent_runs`
WHEN OLD.`runtime_snapshot_version` > 0 AND (
  NEW.`runtime_snapshot_version` IS NOT OLD.`runtime_snapshot_version` OR
  NEW.`runtime_preference` IS NOT OLD.`runtime_preference` OR
  NEW.`runtime_preference_source` IS NOT OLD.`runtime_preference_source` OR
  NEW.`resolved_runtime` IS NOT OLD.`resolved_runtime` OR
  NEW.`runtime_adapter_version` IS NOT OLD.`runtime_adapter_version` OR
  NEW.`runtime_protocol_version` IS NOT OLD.`runtime_protocol_version` OR
  NEW.`runtime_capability_snapshot` IS NOT OLD.`runtime_capability_snapshot` OR
  NEW.`runtime_control_snapshot` IS NOT OLD.`runtime_control_snapshot`
)
BEGIN
  SELECT RAISE(ABORT, 'agent Runtime snapshot is immutable');
END;
