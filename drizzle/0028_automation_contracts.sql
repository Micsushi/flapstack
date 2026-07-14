CREATE TABLE `automation_budgets` (
	`automation_id` text PRIMARY KEY NOT NULL,
	`max_duration_ms` integer DEFAULT 3600000,
	`max_total_tokens` integer,
	`max_cost_usd_micros` integer,
	`max_concurrent_runs` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_budgets_values_check" CHECK(("automation_budgets"."max_duration_ms" is null or "automation_budgets"."max_duration_ms" between 1000 and 2678400000) and
        ("automation_budgets"."max_total_tokens" is null or "automation_budgets"."max_total_tokens" > 0) and
        ("automation_budgets"."max_cost_usd_micros" is null or "automation_budgets"."max_cost_usd_micros" > 0) and
        ("automation_budgets"."max_cost_usd_micros" is null or "automation_budgets"."max_duration_ms" is not null or "automation_budgets"."max_total_tokens" is not null) and
        "automation_budgets"."max_concurrent_runs" = 1)
);
--> statement-breakpoint
CREATE TABLE `automation_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`run_id` text,
	`authority_snapshot` text NOT NULL,
	`budget_snapshot` text NOT NULL,
	`result_summary` text,
	`stop_reason` text,
	`created_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`occurrence_id`) REFERENCES `automation_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "automation_executions_attempt_check" CHECK("automation_executions"."attempt" between 1 and 10),
	CONSTRAINT "automation_executions_state_check" CHECK("automation_executions"."state" in ('pending', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'timed-out')),
	CONSTRAINT "automation_executions_time_check" CHECK((
        ("automation_executions"."state" = 'pending' and "automation_executions"."started_at" is null and "automation_executions"."completed_at" is null) or
        ("automation_executions"."state" = 'running' and "automation_executions"."started_at" is not null and "automation_executions"."completed_at" is null) or
        ("automation_executions"."state" in ('succeeded', 'failed', 'denied', 'cancelled', 'timed-out') and "automation_executions"."completed_at" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_executions_attempt_idx` ON `automation_executions` (`occurrence_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `automation_executions_state_idx` ON `automation_executions` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_executions_run_idx` ON `automation_executions` (`run_id`);--> statement-breakpoint
CREATE TABLE `automation_inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`occurrence_id` text,
	`execution_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`unread` integer DEFAULT true NOT NULL,
	`created_at` integer,
	`read_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_id`) REFERENCES `automation_occurrences`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `automation_executions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "automation_inbox_kind_check" CHECK("automation_inbox_items"."kind" in ('completed', 'failed', 'denied', 'budget-exhausted', 'cancelled')),
	CONSTRAINT "automation_inbox_title_check" CHECK(length(trim("automation_inbox_items"."title")) between 1 and 256),
	CONSTRAINT "automation_inbox_read_check" CHECK(("automation_inbox_items"."unread" = 1 and "automation_inbox_items"."read_at" is null) or ("automation_inbox_items"."unread" = 0 and "automation_inbox_items"."read_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `automation_inbox_unread_idx` ON `automation_inbox_items` (`unread`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_inbox_automation_idx` ON `automation_inbox_items` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_leases` (
	`occurrence_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`token` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`occurrence_id`) REFERENCES `automation_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_leases_expiry_check" CHECK("automation_leases"."expires_at" > "automation_leases"."acquired_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_leases_token_idx` ON `automation_leases` (`token`);--> statement-breakpoint
CREATE INDEX `automation_leases_expiry_idx` ON `automation_leases` (`expires_at`);--> statement-breakpoint
CREATE TABLE `automation_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`scheduled_for` integer NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer,
	`terminal_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_id`) REFERENCES `automation_triggers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_occurrences_state_check" CHECK("automation_occurrences"."state" in ('pending', 'leased', 'running', 'completed', 'cancelled', 'skipped')),
	CONSTRAINT "automation_occurrences_terminal_check" CHECK((
        ("automation_occurrences"."state" in ('completed', 'cancelled', 'skipped') and "automation_occurrences"."terminal_at" is not null) or
        ("automation_occurrences"."state" in ('pending', 'leased', 'running') and "automation_occurrences"."terminal_at" is null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_occurrences_dedupe_idx` ON `automation_occurrences` (`automation_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `automation_occurrences_state_due_idx` ON `automation_occurrences` (`state`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `automation_occurrences_trigger_idx` ON `automation_occurrences` (`trigger_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_retry_policies` (
	`automation_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'none' NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`initial_delay_ms` integer DEFAULT 0 NOT NULL,
	`max_delay_ms` integer DEFAULT 0 NOT NULL,
	`deadline_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_retry_policies_check" CHECK((
        ("automation_retry_policies"."mode" = 'none' and "automation_retry_policies"."max_attempts" = 1 and "automation_retry_policies"."initial_delay_ms" = 0 and "automation_retry_policies"."max_delay_ms" = 0 and "automation_retry_policies"."deadline_ms" = 0) or
        ("automation_retry_policies"."mode" = 'exponential' and "automation_retry_policies"."max_attempts" between 2 and 10 and
          "automation_retry_policies"."initial_delay_ms" between 100 and 86400000 and
          "automation_retry_policies"."max_delay_ms" between "automation_retry_policies"."initial_delay_ms" and 86400000 and
          "automation_retry_policies"."deadline_ms" between "automation_retry_policies"."initial_delay_ms" and 2678400000)
      ))
);
--> statement-breakpoint
CREATE TABLE `automation_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cron` text,
	`timezone` text,
	`catch_up` text,
	`run_project_id` text,
	`run_task_id` text,
	`run_chat_id` text,
	`run_statuses` text,
	`root_path` text,
	`include_globs` text,
	`exclude_globs` text,
	`debounce_ms` integer,
	`next_fire_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_path`) REFERENCES `filesystem_root_registrations`(`path`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "automation_triggers_config_check" CHECK((
        ("automation_triggers"."type" = 'manual' and
          "automation_triggers"."cron" is null and "automation_triggers"."timezone" is null and "automation_triggers"."catch_up" is null and
          "automation_triggers"."run_project_id" is null and "automation_triggers"."run_task_id" is null and "automation_triggers"."run_chat_id" is null and "automation_triggers"."run_statuses" is null and
          "automation_triggers"."root_path" is null and "automation_triggers"."include_globs" is null and "automation_triggers"."exclude_globs" is null and "automation_triggers"."debounce_ms" is null) or
        ("automation_triggers"."type" = 'schedule' and
          "automation_triggers"."cron" is not null and "automation_triggers"."timezone" is not null and "automation_triggers"."catch_up" in ('none', 'one') and
          "automation_triggers"."run_project_id" is null and "automation_triggers"."run_task_id" is null and "automation_triggers"."run_chat_id" is null and "automation_triggers"."run_statuses" is null and
          "automation_triggers"."root_path" is null and "automation_triggers"."include_globs" is null and "automation_triggers"."exclude_globs" is null and "automation_triggers"."debounce_ms" is null) or
        ("automation_triggers"."type" = 'run-complete' and
          (("automation_triggers"."run_project_id" is not null) + ("automation_triggers"."run_task_id" is not null) + ("automation_triggers"."run_chat_id" is not null)) = 1 and
          "automation_triggers"."run_statuses" is not null and
          "automation_triggers"."cron" is null and "automation_triggers"."timezone" is null and "automation_triggers"."catch_up" is null and
          "automation_triggers"."root_path" is null and "automation_triggers"."include_globs" is null and "automation_triggers"."exclude_globs" is null and "automation_triggers"."debounce_ms" is null) or
        ("automation_triggers"."type" = 'file-change' and
          "automation_triggers"."root_path" is not null and "automation_triggers"."include_globs" is not null and "automation_triggers"."exclude_globs" is not null and
          "automation_triggers"."debounce_ms" between 100 and 60000 and
          "automation_triggers"."cron" is null and "automation_triggers"."timezone" is null and "automation_triggers"."catch_up" is null and
          "automation_triggers"."run_project_id" is null and "automation_triggers"."run_task_id" is null and "automation_triggers"."run_chat_id" is null and "automation_triggers"."run_statuses" is null)
      ))
);
--> statement-breakpoint
CREATE INDEX `automation_triggers_automation_type_idx` ON `automation_triggers` (`automation_id`,`type`);--> statement-breakpoint
CREATE INDEX `automation_triggers_due_idx` ON `automation_triggers` (`enabled`,`next_fire_at`);--> statement-breakpoint
CREATE INDEX `automation_triggers_run_project_idx` ON `automation_triggers` (`run_project_id`);--> statement-breakpoint
CREATE INDEX `automation_triggers_run_task_idx` ON `automation_triggers` (`run_task_id`);--> statement-breakpoint
CREATE INDEX `automation_triggers_run_chat_idx` ON `automation_triggers` (`run_chat_id`);--> statement-breakpoint
CREATE INDEX `automation_triggers_root_idx` ON `automation_triggers` (`root_path`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`scope_type` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`chat_id` text,
	`action_type` text NOT NULL,
	`action_config` text DEFAULT '{}' NOT NULL,
	`prompt` text NOT NULL,
	`harness` text NOT NULL,
	`model` text,
	`permission_mode` text NOT NULL,
	`custom_permissions` text,
	`worktree_strategy` text DEFAULT 'inherit' NOT NULL,
	`worktree_path` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`approval_state` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`approval_audit_id` text,
	`created_by_type` text DEFAULT 'user' NOT NULL,
	`created_by_chat_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automations_name_check" CHECK(length(trim("automations"."name")) between 1 and 256),
	CONSTRAINT "automations_scope_check" CHECK((
        ("automations"."scope_type" = 'global' and "automations"."project_id" is null and "automations"."task_id" is null and "automations"."chat_id" is null) or
        ("automations"."scope_type" = 'project' and "automations"."project_id" is not null and "automations"."task_id" is null and "automations"."chat_id" is null) or
        ("automations"."scope_type" = 'task' and "automations"."project_id" is null and "automations"."task_id" is not null and "automations"."chat_id" is null) or
        ("automations"."scope_type" = 'chat' and "automations"."project_id" is null and "automations"."task_id" is null and "automations"."chat_id" is not null)
      )),
	CONSTRAINT "automations_action_check" CHECK((
        ("automations"."action_type" = 'run-chat' and "automations"."scope_type" = 'chat') or
        ("automations"."action_type" = 'create-chat-run' and "automations"."scope_type" in ('global', 'project', 'task')) or
        ("automations"."action_type" = 'create-task-run' and "automations"."scope_type" = 'project')
      )),
	CONSTRAINT "automations_harness_check" CHECK("automations"."harness" in ('codex', 'claude-code', 'cursor-agent', 'openrouter', 'nanogpt', 'local')),
	CONSTRAINT "automations_permission_check" CHECK((
        ("automations"."permission_mode" = 'custom' and "automations"."custom_permissions" is not null) or
        ("automations"."permission_mode" in ('read-only', 'ask-before-edits', 'auto-edit-project-only', 'full-access') and "automations"."custom_permissions" is null)
      )),
	CONSTRAINT "automations_worktree_check" CHECK((
        ("automations"."worktree_strategy" = 'existing' and "automations"."worktree_path" is not null) or
        ("automations"."worktree_strategy" in ('inherit', 'task-primary', 'none') and "automations"."worktree_path" is null)
      )),
	CONSTRAINT "automations_state_check" CHECK("automations"."state" in ('draft', 'active', 'paused', 'archived')),
	CONSTRAINT "automations_approval_state_check" CHECK("automations"."approval_state" in ('pending', 'approved', 'denied', 'revoked')),
	CONSTRAINT "automations_enabled_approval_check" CHECK(("automations"."enabled" = 0 and "automations"."state" in ('draft', 'paused', 'archived')) or (
        "automations"."enabled" = 1 and
        "automations"."state" = 'active' and "automations"."approval_state" = 'approved' and
        "automations"."approved_by" is not null and "automations"."approved_at" is not null
      )),
	CONSTRAINT "automations_approval_provenance_check" CHECK((
        ("automations"."approval_state" = 'pending' and "automations"."approved_by" is null and "automations"."approved_at" is null and "automations"."approval_audit_id" is null) or
        ("automations"."approval_state" in ('approved', 'denied', 'revoked') and "automations"."approved_by" is not null and "automations"."approved_at" is not null and "automations"."approval_audit_id" is not null)
      )),
	CONSTRAINT "automations_creator_check" CHECK((
        ("automations"."created_by_type" = 'user') or
        ("automations"."created_by_type" = 'agent' and "automations"."created_by_chat_id" is not null)
      )),
	CONSTRAINT "automations_version_check" CHECK("automations"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `automations_scope_idx` ON `automations` (`scope_type`,`project_id`,`task_id`,`chat_id`);--> statement-breakpoint
CREATE INDEX `automations_state_enabled_idx` ON `automations` (`state`,`enabled`);--> statement-breakpoint
CREATE INDEX `automations_approval_idx` ON `automations` (`approval_state`,`created_by_type`);
