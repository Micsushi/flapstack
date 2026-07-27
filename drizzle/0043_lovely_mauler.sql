CREATE TABLE `__new_agent_profile_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`resolved_json` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_snapshots_digest_check" CHECK(length("__new_agent_profile_snapshots"."digest") = 64),
	CONSTRAINT "agent_profile_snapshots_json_check" CHECK(json_valid("__new_agent_profile_snapshots"."resolved_json") = 1 and json_extract("__new_agent_profile_snapshots"."resolved_json", '$.schemaVersion') in (1, 2) and length(cast("__new_agent_profile_snapshots"."resolved_json" as blob)) <= 1048576)
);
--> statement-breakpoint
INSERT INTO `__new_agent_profile_snapshots`("id", "profile_id", "profile_version", "resolved_json", "digest", "created_at") SELECT "id", "profile_id", "profile_version", "resolved_json", "digest", "created_at" FROM `agent_profile_snapshots`;--> statement-breakpoint
CREATE TABLE `__new_agent_profile_workflow_bindings` (
	`workflow_run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`binding_json` text NOT NULL,
	`snapshot_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workflow_run_id`, `step_id`),
	FOREIGN KEY (`workflow_run_id`) REFERENCES `orchestration_workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `__new_agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_workflow_binding_version_check" CHECK("__new_agent_profile_workflow_bindings"."version" >= 1),
	CONSTRAINT "agent_profile_workflow_binding_json_check" CHECK(json_valid("__new_agent_profile_workflow_bindings"."binding_json") = 1 and json_extract("__new_agent_profile_workflow_bindings"."binding_json", '$.schemaVersion') = 1 and length(cast("__new_agent_profile_workflow_bindings"."binding_json" as blob)) <= 262144)
);
--> statement-breakpoint
INSERT INTO `__new_agent_profile_workflow_bindings`("workflow_run_id", "step_id", "profile_id", "profile_version", "binding_json", "snapshot_id", "version", "created_at", "updated_at") SELECT "workflow_run_id", "step_id", "profile_id", "profile_version", "binding_json", "snapshot_id", "version", "created_at", "updated_at" FROM `agent_profile_workflow_bindings`;--> statement-breakpoint
CREATE TABLE `__new_agent_profile_standalone_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`sub_chat_id` text NOT NULL,
	`run_id` text NOT NULL,
	`orchestration_task_id` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `__new_agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_standalone_source_check" CHECK("__new_agent_profile_standalone_launches"."source_kind" in ('task','chat','studio')),
	CONSTRAINT "agent_profile_standalone_state_check" CHECK("__new_agent_profile_standalone_launches"."state" in ('pending','launching','running','completed','cancelled','failed','uncertain'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_profile_standalone_launches`("id", "request_id", "request_fingerprint", "source_kind", "source_id", "snapshot_id", "chat_id", "sub_chat_id", "run_id", "orchestration_task_id", "state", "created_at", "updated_at") SELECT "id", "request_id", "request_fingerprint", "source_kind", "source_id", "snapshot_id", "chat_id", "sub_chat_id", "run_id", "orchestration_task_id", "state", "created_at", "updated_at" FROM `agent_profile_standalone_launches`;--> statement-breakpoint
DROP TABLE `agent_profile_workflow_bindings`;--> statement-breakpoint
DROP TABLE `agent_profile_standalone_launches`;--> statement-breakpoint
DROP TABLE `agent_profile_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_agent_profile_snapshots` RENAME TO `agent_profile_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_agent_profile_workflow_bindings` RENAME TO `agent_profile_workflow_bindings`;--> statement-breakpoint
ALTER TABLE `__new_agent_profile_standalone_launches` RENAME TO `agent_profile_standalone_launches`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_snapshots_digest_idx` ON `agent_profile_snapshots` (`digest`);--> statement-breakpoint
CREATE INDEX `agent_profile_snapshots_profile_idx` ON `agent_profile_snapshots` (`profile_id`,`profile_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_standalone_request_idx` ON `agent_profile_standalone_launches` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_standalone_run_idx` ON `agent_profile_standalone_launches` (`run_id`);--> statement-breakpoint
CREATE TRIGGER `agent_profile_snapshots_no_update`
BEFORE UPDATE ON `agent_profile_snapshots`
BEGIN SELECT RAISE(ABORT, 'agent profile snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `agent_profile_snapshots_no_delete`
BEFORE DELETE ON `agent_profile_snapshots`
BEGIN SELECT RAISE(ABORT, 'agent profile snapshots are immutable'); END;
