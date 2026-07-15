CREATE TABLE `agent_profile_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`action` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_profile_audit_summary_check" CHECK(json_valid("agent_profile_audit_events"."summary_json") = 1 and length(cast("agent_profile_audit_events"."summary_json" as blob)) <= 65536)
);
--> statement-breakpoint
CREATE INDEX `agent_profile_audit_profile_idx` ON `agent_profile_audit_events` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_profile_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`runtime` text NOT NULL,
	`model` text NOT NULL,
	`state` text NOT NULL,
	`fixture_set_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`evidence_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_evaluations_runtime_check" CHECK("agent_profile_evaluations"."runtime" in ('codex','claude-code','flapstack-native')),
	CONSTRAINT "agent_profile_evaluations_state_check" CHECK("agent_profile_evaluations"."state" in ('untested','tested-local','supported','failed'))
);
--> statement-breakpoint
CREATE INDEX `agent_profile_evaluations_lookup_idx` ON `agent_profile_evaluations` (`profile_id`,`profile_version`,`runtime`,`model`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_profile_import_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`source_label` text NOT NULL,
	`bundle_json` text NOT NULL,
	`preview_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed_at` integer,
	CONSTRAINT "agent_profile_import_previews_digest_check" CHECK(length("agent_profile_import_previews"."digest") = 64),
	CONSTRAINT "agent_profile_import_previews_bundle_check" CHECK(json_valid("agent_profile_import_previews"."bundle_json") = 1 and length(cast("agent_profile_import_previews"."bundle_json" as blob)) <= 4000000),
	CONSTRAINT "agent_profile_import_previews_preview_check" CHECK(json_valid("agent_profile_import_previews"."preview_json") = 1 and length(cast("agent_profile_import_previews"."preview_json" as blob)) <= 1048576)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_import_previews_digest_idx` ON `agent_profile_import_previews` (`digest`);--> statement-breakpoint
CREATE TABLE `agent_profile_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`resolved_json` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_snapshots_digest_check" CHECK(length("agent_profile_snapshots"."digest") = 64),
	CONSTRAINT "agent_profile_snapshots_json_check" CHECK(json_valid("agent_profile_snapshots"."resolved_json") = 1 and json_extract("agent_profile_snapshots"."resolved_json", '$.schemaVersion') = 1 and length(cast("agent_profile_snapshots"."resolved_json" as blob)) <= 1048576)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_snapshots_digest_idx` ON `agent_profile_snapshots` (`digest`);--> statement-breakpoint
CREATE INDEX `agent_profile_snapshots_profile_idx` ON `agent_profile_snapshots` (`profile_id`,`profile_version`);--> statement-breakpoint
CREATE TABLE `agent_profile_standalone_launches` (
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
	FOREIGN KEY (`snapshot_id`) REFERENCES `agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_standalone_source_check" CHECK("agent_profile_standalone_launches"."source_kind" in ('task','chat','studio')),
	CONSTRAINT "agent_profile_standalone_state_check" CHECK("agent_profile_standalone_launches"."state" in ('pending','launching','running','completed','cancelled','failed','uncertain'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_standalone_request_idx` ON `agent_profile_standalone_launches` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profile_standalone_run_idx` ON `agent_profile_standalone_launches` (`run_id`);--> statement-breakpoint
CREATE TABLE `agent_profile_versions` (
	`profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`base_profile_id` text,
	`base_profile_version` integer,
	`capability_json` text NOT NULL,
	`presentation_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `version`),
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_profile_id`,`base_profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_versions_version_check" CHECK("agent_profile_versions"."version" >= 1),
	CONSTRAINT "agent_profile_versions_base_check" CHECK(("agent_profile_versions"."base_profile_id" is null and "agent_profile_versions"."base_profile_version" is null) or ("agent_profile_versions"."base_profile_id" is not null and "agent_profile_versions"."base_profile_version" is not null)),
	CONSTRAINT "agent_profile_versions_capability_check" CHECK(json_valid("agent_profile_versions"."capability_json") = 1 and json_extract("agent_profile_versions"."capability_json", '$.schemaVersion') = 1 and length(cast("agent_profile_versions"."capability_json" as blob)) <= 524288),
	CONSTRAINT "agent_profile_versions_presentation_check" CHECK(json_valid("agent_profile_versions"."presentation_json") = 1 and json_extract("agent_profile_versions"."presentation_json", '$.schemaVersion') = 1 and length(cast("agent_profile_versions"."presentation_json" as blob)) <= 65536),
	CONSTRAINT "agent_profile_versions_provenance_check" CHECK(json_valid("agent_profile_versions"."provenance_json") = 1 and length(cast("agent_profile_versions"."provenance_json" as blob)) <= 65536)
);
--> statement-breakpoint
CREATE TABLE `agent_profile_workflow_bindings` (
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
	FOREIGN KEY (`snapshot_id`) REFERENCES `agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_workflow_binding_version_check" CHECK("agent_profile_workflow_bindings"."version" >= 1),
	CONSTRAINT "agent_profile_workflow_binding_json_check" CHECK(json_valid("agent_profile_workflow_bindings"."binding_json") = 1 and json_extract("agent_profile_workflow_bindings"."binding_json", '$.schemaVersion') = 1 and length(cast("agent_profile_workflow_bindings"."binding_json" as blob)) <= 262144)
);
--> statement-breakpoint
CREATE TABLE `agent_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`scope_type` text NOT NULL,
	`project_id` text,
	`source` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "agent_profiles_scope_check" CHECK(("agent_profiles"."scope_type" in ('built-in','user') and "agent_profiles"."project_id" is null) or ("agent_profiles"."scope_type" = 'project' and "agent_profiles"."project_id" is not null)),
	CONSTRAINT "agent_profiles_source_check" CHECK("agent_profiles"."source" in ('built-in','user','imported')),
	CONSTRAINT "agent_profiles_version_check" CHECK("agent_profiles"."current_version" >= 1),
	CONSTRAINT "agent_profiles_name_check" CHECK(length(trim("agent_profiles"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE INDEX `agent_profiles_scope_name_idx` ON `agent_profiles` (`scope_type`,`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `agent_profiles_source_idx` ON `agent_profiles` (`source`,`archived_at`);
--> statement-breakpoint
CREATE TRIGGER `agent_profile_versions_no_update`
BEFORE UPDATE ON `agent_profile_versions`
BEGIN SELECT RAISE(ABORT, 'agent profile versions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_profile_versions_no_delete`
BEFORE DELETE ON `agent_profile_versions`
BEGIN SELECT RAISE(ABORT, 'agent profile versions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_profile_snapshots_no_update`
BEFORE UPDATE ON `agent_profile_snapshots`
BEGIN SELECT RAISE(ABORT, 'agent profile snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_profile_snapshots_no_delete`
BEFORE DELETE ON `agent_profile_snapshots`
BEGIN SELECT RAISE(ABORT, 'agent profile snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_profile_evaluations_no_update`
BEFORE UPDATE ON `agent_profile_evaluations`
BEGIN SELECT RAISE(ABORT, 'agent profile evaluations are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_profile_evaluations_no_delete`
BEFORE DELETE ON `agent_profile_evaluations`
BEGIN SELECT RAISE(ABORT, 'agent profile evaluations are append-only'); END;
