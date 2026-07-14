CREATE TABLE `usage_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`scope_type` text NOT NULL,
	`provider_id` text,
	`account_tag` text,
	`project_id` text,
	`task_id` text,
	`automation_id` text,
	`orchestration_id` text,
	`threshold_type` text NOT NULL,
	`threshold_value` integer NOT NULL,
	`action` text NOT NULL,
	`reset_type` text DEFAULT 'none' NOT NULL,
	`reset_timezone` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`orchestration_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "usage_budgets_name_check" CHECK(length(trim("usage_budgets"."name")) between 1 and 256),
	CONSTRAINT "usage_budgets_scope_check" CHECK((
        ("usage_budgets"."scope_type" = 'global' and "usage_budgets"."provider_id" is null and "usage_budgets"."account_tag" is null and "usage_budgets"."project_id" is null and "usage_budgets"."task_id" is null and "usage_budgets"."automation_id" is null and "usage_budgets"."orchestration_id" is null) or
        ("usage_budgets"."scope_type" = 'provider-account' and length(trim("usage_budgets"."provider_id")) between 1 and 200 and ("usage_budgets"."account_tag" is null or length(trim("usage_budgets"."account_tag")) between 1 and 256) and "usage_budgets"."project_id" is null and "usage_budgets"."task_id" is null and "usage_budgets"."automation_id" is null and "usage_budgets"."orchestration_id" is null) or
        ("usage_budgets"."scope_type" = 'project' and "usage_budgets"."provider_id" is null and "usage_budgets"."account_tag" is null and "usage_budgets"."project_id" is not null and "usage_budgets"."task_id" is null and "usage_budgets"."automation_id" is null and "usage_budgets"."orchestration_id" is null) or
        ("usage_budgets"."scope_type" = 'task' and "usage_budgets"."provider_id" is null and "usage_budgets"."account_tag" is null and "usage_budgets"."project_id" is null and "usage_budgets"."task_id" is not null and "usage_budgets"."automation_id" is null and "usage_budgets"."orchestration_id" is null) or
        ("usage_budgets"."scope_type" = 'automation' and "usage_budgets"."provider_id" is null and "usage_budgets"."account_tag" is null and "usage_budgets"."project_id" is null and "usage_budgets"."task_id" is null and "usage_budgets"."automation_id" is not null and "usage_budgets"."orchestration_id" is null) or
        ("usage_budgets"."scope_type" = 'orchestration' and "usage_budgets"."provider_id" is null and "usage_budgets"."account_tag" is null and "usage_budgets"."project_id" is null and "usage_budgets"."task_id" is null and "usage_budgets"."automation_id" is null and "usage_budgets"."orchestration_id" is not null)
      )),
	CONSTRAINT "usage_budgets_threshold_check" CHECK((
        ("usage_budgets"."threshold_type" in ('cost-usd-micros', 'total-tokens', 'request-count') and "usage_budgets"."threshold_value" > 0) or
        ("usage_budgets"."threshold_type" = 'quota-percent-micros' and "usage_budgets"."threshold_value" between 1 and 100000000 and "usage_budgets"."scope_type" = 'provider-account')
      )),
	CONSTRAINT "usage_budgets_action_check" CHECK("usage_budgets"."action" = 'soft-alert' or ("usage_budgets"."action" = 'hard-stop' and "usage_budgets"."scope_type" != 'provider-account')),
	CONSTRAINT "usage_budgets_reset_check" CHECK((
        ("usage_budgets"."reset_type" = 'none' and "usage_budgets"."reset_timezone" is null) or
        ("usage_budgets"."reset_type" in ('daily', 'weekly', 'monthly') and "usage_budgets"."reset_timezone" is not null and length(trim("usage_budgets"."reset_timezone")) between 1 and 200) or
        ("usage_budgets"."reset_type" = 'provider-cycle' and "usage_budgets"."reset_timezone" is null and "usage_budgets"."scope_type" = 'provider-account')
      )),
	CONSTRAINT "usage_budgets_version_check" CHECK("usage_budgets"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `usage_budgets_scope_idx` ON `usage_budgets` (`scope_type`,`provider_id`,`account_tag`,`project_id`,`task_id`,`automation_id`,`orchestration_id`);--> statement-breakpoint
CREATE INDEX `usage_budgets_enabled_action_idx` ON `usage_budgets` (`enabled`,`action`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usage_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`cost_quality` text DEFAULT 'unknown' NOT NULL,
	`source_tag` text,
	`metric_key` text,
	`captured_at` integer,
	`window_start` integer,
	`window_end` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer,
	`request_count` integer,
	`cost_usd_micros` integer,
	`cost_usd_estimated_micros` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`percent_used` integer,
	`quota_used` integer,
	`quota_limit` integer,
	`quota_unit` text,
	`reset_at` integer,
	`model` text,
	`generation_id` text,
	`run_id` text,
	`attribution_state` text DEFAULT 'unknown' NOT NULL,
	`attribution_harness` text,
	`attribution_project_id` text,
	`attribution_project_name` text,
	`attribution_task_id` text,
	`attribution_task_name` text,
	`attribution_chat_id` text,
	`attribution_chat_name` text,
	`attribution_automation_id` text,
	`attribution_automation_name` text,
	`attribution_orchestration_id` text,
	`attribution_orchestration_name` text,
	`attribution_run_id` text,
	`source_class` text DEFAULT 'unknown' NOT NULL,
	`dedupe_strategy` text DEFAULT 'unknown' NOT NULL,
	`dedupe_group_key` text,
	`raw_payload` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_samples_attribution_check" CHECK((
        ("__new_usage_samples"."attribution_state" = 'unknown' and
          "__new_usage_samples"."attribution_harness" is null and "__new_usage_samples"."attribution_project_id" is null and "__new_usage_samples"."attribution_project_name" is null and
          "__new_usage_samples"."attribution_task_id" is null and "__new_usage_samples"."attribution_task_name" is null and
          "__new_usage_samples"."attribution_chat_id" is null and "__new_usage_samples"."attribution_chat_name" is null and
          "__new_usage_samples"."attribution_automation_id" is null and "__new_usage_samples"."attribution_automation_name" is null and
          "__new_usage_samples"."attribution_orchestration_id" is null and "__new_usage_samples"."attribution_orchestration_name" is null and
          "__new_usage_samples"."attribution_run_id" is null) or
        ("__new_usage_samples"."attribution_state" = 'attributed' and
          ("__new_usage_samples"."attribution_harness" is not null or "__new_usage_samples"."attribution_project_id" is not null or "__new_usage_samples"."attribution_project_name" is not null or
           "__new_usage_samples"."attribution_task_id" is not null or "__new_usage_samples"."attribution_task_name" is not null or
           "__new_usage_samples"."attribution_chat_id" is not null or "__new_usage_samples"."attribution_chat_name" is not null or
           "__new_usage_samples"."attribution_automation_id" is not null or "__new_usage_samples"."attribution_automation_name" is not null or
           "__new_usage_samples"."attribution_orchestration_id" is not null or "__new_usage_samples"."attribution_orchestration_name" is not null or
           "__new_usage_samples"."attribution_run_id" is not null))
      )),
	CONSTRAINT "usage_samples_source_class_check" CHECK("__new_usage_samples"."source_class" in ('provider-account-total', 'flapstack-run', 'external-provider', 'unknown')),
	CONSTRAINT "usage_samples_dedupe_strategy_check" CHECK((
        ("__new_usage_samples"."dedupe_strategy" = 'overlap-group' and "__new_usage_samples"."dedupe_group_key" is not null and length(trim("__new_usage_samples"."dedupe_group_key")) between 1 and 512) or
        ("__new_usage_samples"."dedupe_strategy" in ('exact-fact', 'unknown') and "__new_usage_samples"."dedupe_group_key" is null)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_usage_samples`("id", "provider_id", "account_tag", "source", "cost_quality", "source_tag", "metric_key", "captured_at", "window_start", "window_end", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "request_count", "cost_usd_micros", "cost_usd_estimated_micros", "currency", "percent_used", "quota_used", "quota_limit", "quota_unit", "reset_at", "model", "generation_id", "run_id", "attribution_state", "attribution_harness", "attribution_project_id", "attribution_project_name", "attribution_task_id", "attribution_task_name", "attribution_chat_id", "attribution_chat_name", "attribution_automation_id", "attribution_automation_name", "attribution_orchestration_id", "attribution_orchestration_name", "attribution_run_id", "source_class", "dedupe_strategy", "dedupe_group_key", "raw_payload", "dedupe_key", "created_at") SELECT "id", "provider_id", "account_tag", "source", "cost_quality", "source_tag", "metric_key", "captured_at", "window_start", "window_end", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "request_count", "cost_usd_micros", "cost_usd_estimated_micros", "currency", "percent_used", "quota_used", "quota_limit", "quota_unit", "reset_at", "model", "generation_id", "run_id", 'unknown', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unknown', 'unknown', NULL, "raw_payload", "dedupe_key", "created_at" FROM `usage_samples`;--> statement-breakpoint
DROP TABLE `usage_samples`;--> statement-breakpoint
ALTER TABLE `__new_usage_samples` RENAME TO `usage_samples`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usage_samples_provider_idx` ON `usage_samples` (`provider_id`);--> statement-breakpoint
CREATE INDEX `usage_samples_captured_at_idx` ON `usage_samples` (`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_source_class_captured_idx` ON `usage_samples` (`source_class`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_project_captured_idx` ON `usage_samples` (`attribution_project_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_task_captured_idx` ON `usage_samples` (`attribution_task_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_chat_captured_idx` ON `usage_samples` (`attribution_chat_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_automation_captured_idx` ON `usage_samples` (`attribution_automation_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_orchestration_captured_idx` ON `usage_samples` (`attribution_orchestration_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `usage_samples_dedupe_group_idx` ON `usage_samples` (`dedupe_group_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_samples_dedupe_key_idx` ON `usage_samples` (`dedupe_key`);
