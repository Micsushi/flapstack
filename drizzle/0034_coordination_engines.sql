CREATE TABLE `coordination_engine_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`engine` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scope_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coordination_engine_defaults_scope_check" CHECK((
        ("coordination_engine_defaults"."scope_type" = 'global' and "coordination_engine_defaults"."scope_id" is null) or
        ("coordination_engine_defaults"."scope_type" = 'project' and "coordination_engine_defaults"."scope_id" is not null)
      )),
	CONSTRAINT "coordination_engine_defaults_engine_check" CHECK("coordination_engine_defaults"."engine" in ('workflow', 'codex-v2', 'codex-v1')),
	CONSTRAINT "coordination_engine_defaults_version_check" CHECK("coordination_engine_defaults"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordination_engine_defaults_global_idx` ON `coordination_engine_defaults` (`scope_type`) WHERE "coordination_engine_defaults"."scope_type" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX `coordination_engine_defaults_project_idx` ON `coordination_engine_defaults` (`scope_id`) WHERE "coordination_engine_defaults"."scope_type" = 'project';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_orchestrations` (
	`task_id` text PRIMARY KEY NOT NULL,
	`initiating_chat_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`max_parallel_agents` integer DEFAULT 1 NOT NULL,
	`max_depth` integer DEFAULT 8 NOT NULL,
	`stop_conditions` text DEFAULT '{}' NOT NULL,
	`stop_reason` text,
	`blocker_count` integer DEFAULT 0 NOT NULL,
	`engine_snapshot_version` integer DEFAULT 0 NOT NULL,
	`coordination_engine` text DEFAULT 'workflow' NOT NULL,
	`coordination_engine_version` text DEFAULT 'workflow-legacy-graph' NOT NULL,
	`coordination_engine_source` text DEFAULT 'legacy' NOT NULL,
	`coordination_engine_capability_snapshot` text DEFAULT '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-legacy-graph","status":"legacy","capturedAt":null,"capabilities":["durable-workflow"],"limitations":["Historical Stage 3 graph orchestration."],"unavailableReason":null}' NOT NULL,
	`coordination_engine_provider_identity` text DEFAULT 'null' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiating_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_orchestrations_engine_check" CHECK("__new_task_orchestrations"."coordination_engine" in ('workflow', 'codex-v2', 'codex-v1')),
	CONSTRAINT "task_orchestrations_engine_source_check" CHECK("__new_task_orchestrations"."coordination_engine_source" in ('per-launch', 'project', 'global', 'product', 'legacy')),
	CONSTRAINT "task_orchestrations_engine_snapshot_check" CHECK(coalesce((
        "__new_task_orchestrations"."engine_snapshot_version" = 0
        and "__new_task_orchestrations"."coordination_engine" = 'workflow'
        and "__new_task_orchestrations"."coordination_engine_version" = 'workflow-legacy-graph'
        and "__new_task_orchestrations"."coordination_engine_source" = 'legacy'
        and "__new_task_orchestrations"."coordination_engine_capability_snapshot" = '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-legacy-graph","status":"legacy","capturedAt":null,"capabilities":["durable-workflow"],"limitations":["Historical Stage 3 graph orchestration."],"unavailableReason":null}'
        and "__new_task_orchestrations"."coordination_engine_provider_identity" = 'null'
      ) or (
        "__new_task_orchestrations"."engine_snapshot_version" = 1
        and "__new_task_orchestrations"."coordination_engine_source" in ('per-launch', 'project', 'global', 'product')
        and length(trim("__new_task_orchestrations"."coordination_engine_version")) between 1 and 128
        and (
          ("__new_task_orchestrations"."coordination_engine" = 'workflow' and "__new_task_orchestrations"."coordination_engine_version" = 'workflow-v1') or
          ("__new_task_orchestrations"."coordination_engine" = 'codex-v2' and "__new_task_orchestrations"."coordination_engine_version" = 'codex-v2-v1') or
          ("__new_task_orchestrations"."coordination_engine" = 'codex-v1' and "__new_task_orchestrations"."coordination_engine_version" = 'codex-v1-v1')
        )
        and json_valid("__new_task_orchestrations"."coordination_engine_capability_snapshot") = 1
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$') = 'object'
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.schemaVersion') = 'integer'
        and json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.schemaVersion') = 1
        and json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.engine') = "__new_task_orchestrations"."coordination_engine"
        and json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.engineVersion') = "__new_task_orchestrations"."coordination_engine_version"
        and json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.status') = 'available'
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.capturedAt') = 'text'
        and length(trim(json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.capturedAt'))) between 1 and 128
        and julianday(json_extract("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.capturedAt')) is not null
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.capabilities') = 'array'
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.limitations') = 'array'
        and json_type("__new_task_orchestrations"."coordination_engine_capability_snapshot", '$.unavailableReason') = 'null'
        and json_valid("__new_task_orchestrations"."coordination_engine_provider_identity") = 1
        and (
          json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$') = 'null' or
          (
            json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$') = 'object'
            and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.schemaVersion') = 'integer'
            and json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.schemaVersion') = 1
            and json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.engine') = "__new_task_orchestrations"."coordination_engine"
            and (
              ("__new_task_orchestrations"."coordination_engine" = 'workflow'
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.workflowRunId') = 'text'
                and length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.workflowRunId'))) between 1 and 512) or
              ("__new_task_orchestrations"."coordination_engine" = 'codex-v2'
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.canonicalTaskPath') = 'text'
                and length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.canonicalTaskPath'))) between 1 and 1024
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.taskName') = 'text'
                and length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.taskName'))) between 1 and 200
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.providerTaskId') in ('null', 'text')
                and (json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.providerTaskId') = 'null'
                  or length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.providerTaskId'))) between 1 and 512)) or
              ("__new_task_orchestrations"."coordination_engine" = 'codex-v1'
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.providerAgentId') = 'text'
                and length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.providerAgentId'))) between 1 and 512
                and json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.nickname') in ('null', 'text')
                and (json_type("__new_task_orchestrations"."coordination_engine_provider_identity", '$.nickname') = 'null'
                  or length(trim(json_extract("__new_task_orchestrations"."coordination_engine_provider_identity", '$.nickname'))) between 1 and 160))
            )
          )
        )
      ), 0))
);
--> statement-breakpoint
INSERT INTO `__new_task_orchestrations`("task_id", "initiating_chat_id", "status", "max_parallel_agents", "max_depth", "stop_conditions", "stop_reason", "blocker_count", "engine_snapshot_version", "coordination_engine", "coordination_engine_version", "coordination_engine_source", "coordination_engine_capability_snapshot", "coordination_engine_provider_identity", "created_at", "updated_at", "started_at", "completed_at") SELECT "task_id", "initiating_chat_id", "status", "max_parallel_agents", "max_depth", "stop_conditions", "stop_reason", "blocker_count", 0, 'workflow', 'workflow-legacy-graph', 'legacy', '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-legacy-graph","status":"legacy","capturedAt":null,"capabilities":["durable-workflow"],"limitations":["Historical Stage 3 graph orchestration."],"unavailableReason":null}', 'null', "created_at", "updated_at", "started_at", "completed_at" FROM `task_orchestrations`;--> statement-breakpoint
DROP TABLE `task_orchestrations`;--> statement-breakpoint
ALTER TABLE `__new_task_orchestrations` RENAME TO `task_orchestrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_orchestrations_status_idx` ON `task_orchestrations` (`status`);--> statement-breakpoint
CREATE INDEX `task_orchestrations_engine_idx` ON `task_orchestrations` (`coordination_engine`,`status`);--> statement-breakpoint
CREATE TRIGGER `task_orchestrations_engine_snapshot_required`
BEFORE INSERT ON `task_orchestrations`
WHEN NEW.`engine_snapshot_version` <> 1
BEGIN
  SELECT RAISE(ABORT, 'New orchestration requires a resolved coordination engine snapshot');
END;--> statement-breakpoint
CREATE TRIGGER `task_orchestrations_engine_snapshot_canonical`
BEFORE INSERT ON `task_orchestrations`
WHEN NEW.`engine_snapshot_version` = 1 AND (
  (SELECT count(*) FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities')) > 13 OR
  (SELECT count(*) FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities')) <>
    (SELECT count(DISTINCT value) FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities')) OR
  EXISTS (
    SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities')
    WHERE type <> 'text' OR value NOT IN (
      'durable-workflow', 'checkpoints', 'mixed-runtimes', 'named-task-paths',
      'selective-context-fork', 'queued-messages', 'follow-up', 'mailbox',
      'interrupt-without-destroy', 'resident-workers', 'legacy-agent-ids',
      'legacy-resume', 'legacy-close'
    )
  ) OR
  (NEW.`coordination_engine` = 'workflow' AND (
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'durable-workflow') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'checkpoints') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'mixed-runtimes')
  )) OR
  (NEW.`coordination_engine` = 'codex-v2' AND (
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'named-task-paths') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'selective-context-fork') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'queued-messages') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'follow-up') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'mailbox') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'interrupt-without-destroy') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'resident-workers')
  )) OR
  (NEW.`coordination_engine` = 'codex-v1' AND (
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'legacy-agent-ids') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'legacy-resume') OR
    NOT EXISTS (SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.capabilities') WHERE value = 'legacy-close')
  )) OR
  (SELECT count(*) FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.limitations')) > 32 OR
  EXISTS (
    SELECT 1 FROM json_each(NEW.`coordination_engine_capability_snapshot`, '$.limitations')
    WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 1000
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Coordination engine snapshot is non-canonical');
END;--> statement-breakpoint
CREATE TRIGGER `task_orchestrations_engine_snapshot_immutable`
BEFORE UPDATE OF `engine_snapshot_version`, `coordination_engine`, `coordination_engine_version`,
  `coordination_engine_source`, `coordination_engine_capability_snapshot`,
  `coordination_engine_provider_identity`
ON `task_orchestrations`
WHEN NEW.`engine_snapshot_version` IS NOT OLD.`engine_snapshot_version`
  OR NEW.`coordination_engine` IS NOT OLD.`coordination_engine`
  OR NEW.`coordination_engine_version` IS NOT OLD.`coordination_engine_version`
  OR NEW.`coordination_engine_source` IS NOT OLD.`coordination_engine_source`
  OR NEW.`coordination_engine_capability_snapshot` IS NOT OLD.`coordination_engine_capability_snapshot`
  OR NEW.`coordination_engine_provider_identity` IS NOT OLD.`coordination_engine_provider_identity`
BEGIN
  SELECT RAISE(ABORT, 'Coordination engine snapshot is immutable; create a new orchestration');
END;--> statement-breakpoint
CREATE TRIGGER `task_orchestrations_legacy_reactivation_blocked`
BEFORE UPDATE OF `status` ON `task_orchestrations`
WHEN OLD.`engine_snapshot_version` = 0
  AND NEW.`status` IN ('queued', 'running', 'paused')
  AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'Legacy orchestration history cannot be reactivated');
END;--> statement-breakpoint
PRAGMA foreign_key_check;
