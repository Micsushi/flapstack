CREATE TABLE `coordination_action_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`task_id` text NOT NULL,
	`engine` text NOT NULL,
	`action` text NOT NULL,
	`target_agent_id` text,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`provider_identity_json` text NOT NULL,
	`result_json` text,
	`claim_owner` text,
	`claim_expires_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coordination_action_engine_check" CHECK("coordination_action_intents"."engine" in ('codex-v2','codex-v1')),
	CONSTRAINT "coordination_action_state_check" CHECK("coordination_action_intents"."state" in ('dispatching','running','waiting','completed','cancelled','uncertain','failed')),
	CONSTRAINT "coordination_action_payload_check" CHECK(json_valid("coordination_action_intents"."payload_json") = 1 and length(cast("coordination_action_intents"."payload_json" as blob)) <= 65536),
	CONSTRAINT "coordination_action_identity_check" CHECK(json_valid("coordination_action_intents"."provider_identity_json") = 1),
	CONSTRAINT "coordination_action_result_check" CHECK("coordination_action_intents"."result_json" is null or (json_valid("coordination_action_intents"."result_json") = 1 and length(cast("coordination_action_intents"."result_json" as blob)) <= 65536))
	,CONSTRAINT "coordination_action_claim_check" CHECK(("coordination_action_intents"."claim_owner" is null and "coordination_action_intents"."claim_expires_at" is null) or (length("coordination_action_intents"."claim_owner") between 1 and 200 and "coordination_action_intents"."claim_expires_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordination_action_idempotency_idx` ON `coordination_action_intents` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `coordination_action_task_state_idx` ON `coordination_action_intents` (`task_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `coordination_action_claim_idx` ON `coordination_action_intents` (`state`,`claim_expires_at`);--> statement-breakpoint
CREATE TABLE `orchestration_transition_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedup_key` text NOT NULL,
	`task_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`agent_id` text,
	`run_id` text,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_transition_summary_check" CHECK("orchestration_transition_events"."summary" is null or (substr("orchestration_transition_events"."summary",1,17) = 'Activity summary:' and length(cast("orchestration_transition_events"."summary" as blob)) <= 4096))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_transition_dedup_idx` ON `orchestration_transition_events` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `orchestration_transition_task_order_idx` ON `orchestration_transition_events` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `orchestration_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedup_key` text NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text,
	`run_id` text,
	`source_activity_event_id` text,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `orchestration_agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_activity_event_id`) REFERENCES `agent_activity_events`(`event_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orchestration_activity_kind_check" CHECK("orchestration_activity_events"."kind" in ('workflow-phase','checkpoint','dependency','spawn','replacement','mailbox','coordination','warning','usage','aggregate-status')),
	CONSTRAINT "orchestration_activity_summary_check" CHECK("orchestration_activity_events"."summary" is null or (substr("orchestration_activity_events"."summary",1,17) = 'Activity summary:' and length(cast("orchestration_activity_events"."summary" as blob)) <= 4096))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_activity_dedup_idx` ON `orchestration_activity_events` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `orchestration_activity_task_order_idx` ON `orchestration_activity_events` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `orchestration_authority_approvals` (
	`audit_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`consumed_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_authority_tool_check" CHECK("orchestration_authority_approvals"."tool_name" in ('orchestration.policy.relax','orchestration.template.launch'))
);
--> statement-breakpoint
CREATE INDEX `orchestration_authority_task_idx` ON `orchestration_authority_approvals` (`task_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `orchestration_control_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`action` text NOT NULL,
	`state` text NOT NULL,
	`preview_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_control_action_check" CHECK("orchestration_control_intents"."action" in ('pause','resume','stop')),
	CONSTRAINT "orchestration_control_state_check" CHECK("orchestration_control_intents"."state" in ('pending','partial','completed')),
	CONSTRAINT "orchestration_control_preview_check" CHECK(json_valid("orchestration_control_intents"."preview_json") = 1 and length(cast("orchestration_control_intents"."preview_json" as blob)) <= 262144)
);
--> statement-breakpoint
CREATE TABLE `orchestration_control_targets` (
	`intent_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`run_id` text,
	`state` text NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`intent_id`, `agent_id`),
	FOREIGN KEY (`intent_id`) REFERENCES `orchestration_control_intents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_control_target_state_check" CHECK("orchestration_control_targets"."state" in ('pending','processing','no-run','reconciled','failed')),
	CONSTRAINT "orchestration_control_target_error_check" CHECK("orchestration_control_targets"."error" is null or length(cast("orchestration_control_targets"."error" as blob)) <= 1024)
);
--> statement-breakpoint
CREATE TABLE `orchestration_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`body` text,
	`provider_message_id` text,
	`action_intent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `orchestration_agents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orchestration_messages_direction_check" CHECK("orchestration_messages"."direction" in ('inbound','outbound')),
	CONSTRAINT "orchestration_messages_kind_check" CHECK("orchestration_messages"."kind" in ('message','follow-up','interrupt','mailbox')),
	CONSTRAINT "orchestration_messages_state_check" CHECK("orchestration_messages"."state" in ('recorded','queued','delivered','failed','uncertain')),
	CONSTRAINT "orchestration_messages_body_check" CHECK("orchestration_messages"."body" is null or length(cast("orchestration_messages"."body" as blob)) <= 40000)
);
--> statement-breakpoint
CREATE INDEX `orchestration_messages_task_order_idx` ON `orchestration_messages` (`task_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_messages_action_intent_idx` ON `orchestration_messages` (`action_intent_id`) WHERE `action_intent_id` is not null;--> statement-breakpoint
CREATE TABLE `orchestration_policy_versions` (
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`policy_json` text NOT NULL,
	`change_kind` text NOT NULL,
	`approval_audit_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `version`),
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_policy_json_check" CHECK(json_valid("orchestration_policy_versions"."policy_json") = 1 and length(cast("orchestration_policy_versions"."policy_json" as blob)) <= 65536),
	CONSTRAINT "orchestration_policy_change_check" CHECK("orchestration_policy_versions"."change_kind" in ('initial','tighten','relax','mixed','unchanged')),
	CONSTRAINT "orchestration_policy_approval_check" CHECK(("orchestration_policy_versions"."change_kind" in ('relax','mixed') and "orchestration_policy_versions"."approval_audit_id" is not null) or "orchestration_policy_versions"."change_kind" not in ('relax','mixed'))
);
--> statement-breakpoint
CREATE INDEX `orchestration_policy_task_idx` ON `orchestration_policy_versions` (`task_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_policy_approval_once_idx` ON `orchestration_policy_versions` (`approval_audit_id`) WHERE `approval_audit_id` is not null;--> statement-breakpoint
CREATE TABLE `orchestration_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "orchestration_templates_name_check" CHECK(length(trim("orchestration_templates"."name")) between 1 and 256),
	CONSTRAINT "orchestration_templates_version_check" CHECK("orchestration_templates"."version" >= 1),
	CONSTRAINT "orchestration_templates_json_check" CHECK(json_valid("orchestration_templates"."definition_json") = 1 and json_extract("orchestration_templates"."definition_json", '$.schemaVersion') = 1 and length(cast("orchestration_templates"."definition_json" as blob)) <= 262144)
);
--> statement-breakpoint
CREATE TABLE `orchestration_workflow_checkpoints` (
	`workflow_run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`status` text NOT NULL,
	`output_json` text,
	`error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workflow_run_id`, `step_id`),
	FOREIGN KEY (`workflow_run_id`) REFERENCES `orchestration_workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_workflow_checkpoint_status_check" CHECK("orchestration_workflow_checkpoints"."status" in ('pending','running','waiting','blocked','completed','failed','uncertain','skipped')),
	CONSTRAINT "orchestration_workflow_checkpoint_output_check" CHECK("orchestration_workflow_checkpoints"."output_json" is null or (json_valid("orchestration_workflow_checkpoints"."output_json") = 1 and length(cast("orchestration_workflow_checkpoints"."output_json" as blob)) <= 65536))
);
--> statement-breakpoint
CREATE TABLE `orchestration_workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`definition_json` text NOT NULL,
	`approval_audit_id` text,
	`stop_intent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_workflow_status_check" CHECK("orchestration_workflow_runs"."status" in ('queued','running','waiting','blocked','paused','completed','failed','stopped','uncertain')),
	CONSTRAINT "orchestration_workflow_definition_check" CHECK(json_valid("orchestration_workflow_runs"."definition_json") = 1 and length(cast("orchestration_workflow_runs"."definition_json" as blob)) <= 262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_workflow_approval_once_idx` ON `orchestration_workflow_runs` (`approval_audit_id`) WHERE `approval_audit_id` is not null;--> statement-breakpoint
ALTER TABLE `task_orchestrations` ADD `policy_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `orchestration_policy_versions_no_update`
BEFORE UPDATE ON `orchestration_policy_versions`
BEGIN
  SELECT RAISE(ABORT, 'orchestration policy history is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `orchestration_policy_versions_no_delete`
BEFORE DELETE ON `orchestration_policy_versions`
BEGIN
  SELECT RAISE(ABORT, 'orchestration policy history is append-only');
END;
