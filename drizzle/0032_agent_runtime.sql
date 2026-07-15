CREATE TABLE `agent_runtime_defaults` (
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
        ("agent_runtime_defaults"."scope_type" = 'global' and "agent_runtime_defaults"."scope_id" is null) or
        ("agent_runtime_defaults"."scope_type" = 'project' and "agent_runtime_defaults"."scope_id" is not null)
      )),
	CONSTRAINT "agent_runtime_defaults_preference_check" CHECK("agent_runtime_defaults"."preference" in ('auto', 'codex', 'claude-code', 'flapstack-native')),
	CONSTRAINT "agent_runtime_defaults_version_check" CHECK("agent_runtime_defaults"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_defaults_global_idx` ON `agent_runtime_defaults` (`harness`) WHERE "agent_runtime_defaults"."scope_type" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_defaults_project_idx` ON `agent_runtime_defaults` (`scope_id`,`harness`) WHERE "agent_runtime_defaults"."scope_type" = 'project';--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_snapshot_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_preference` text DEFAULT 'flapstack-native' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_preference_source` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `resolved_runtime` text DEFAULT 'flapstack-native' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_adapter_version` text DEFAULT 'legacy-stage3' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_protocol_version` text DEFAULT 'legacy-stage3' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_capability_snapshot` text DEFAULT '{"schemaVersion":1,"status":"legacy"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runtime_control_snapshot` text DEFAULT '{"schemaVersion":1}' NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `runtime_preference` text;
--> statement-breakpoint
CREATE TRIGGER `agent_runs_require_runtime_snapshot`
BEFORE INSERT ON `agent_runs`
WHEN NEW.`status` IN ('pending', 'running') AND (
  NEW.`runtime_snapshot_version` < 1 OR
  NEW.`runtime_preference` NOT IN ('auto', 'codex', 'claude-code', 'flapstack-native') OR
  NEW.`runtime_preference_source` NOT IN ('chat', 'project', 'global', 'product') OR
  NEW.`resolved_runtime` NOT IN ('codex', 'claude-code', 'flapstack-native') OR
  length(trim(NEW.`runtime_adapter_version`)) = 0 OR
  length(trim(NEW.`runtime_protocol_version`)) = 0 OR
  json_valid(NEW.`runtime_capability_snapshot`) <> 1 OR
  json_valid(NEW.`runtime_control_snapshot`) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'pending/running agent run requires Runtime snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER `agent_runs_require_runtime_snapshot_on_active_transition`
BEFORE UPDATE OF `status` ON `agent_runs`
WHEN OLD.`status` NOT IN ('pending', 'running') AND NEW.`status` IN ('pending', 'running') AND (
  NEW.`runtime_snapshot_version` < 1 OR
  NEW.`runtime_preference` NOT IN ('auto', 'codex', 'claude-code', 'flapstack-native') OR
  NEW.`runtime_preference_source` NOT IN ('chat', 'project', 'global', 'product') OR
  NEW.`resolved_runtime` NOT IN ('codex', 'claude-code', 'flapstack-native') OR
  length(trim(NEW.`runtime_adapter_version`)) = 0 OR
  length(trim(NEW.`runtime_protocol_version`)) = 0 OR
  json_valid(NEW.`runtime_capability_snapshot`) <> 1 OR
  json_valid(NEW.`runtime_control_snapshot`) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'pending/running agent run requires Runtime snapshot');
END;
--> statement-breakpoint
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
