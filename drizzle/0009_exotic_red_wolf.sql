CREATE TABLE `usage_alert_arm_states` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`alert_type` text NOT NULL,
	`threshold_value` integer,
	`armed` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_alert_arm_states_key_idx` ON `usage_alert_arm_states` (`provider_id`,`account_tag`,`alert_type`,`threshold_value`);--> statement-breakpoint
CREATE TABLE `usage_alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`alert_type` text NOT NULL,
	`threshold_value` integer,
	`observed_value` integer,
	`cost_quality` text DEFAULT 'unknown' NOT NULL,
	`channel` text DEFAULT 'discord' NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivery_error` text,
	`message` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `usage_alert_events_provider_idx` ON `usage_alert_events` (`provider_id`);--> statement-breakpoint
CREATE INDEX `usage_alert_events_created_at_idx` ON `usage_alert_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `usage_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`cycle_start` integer,
	`cycle_end` integer,
	`reset_at` integer,
	`total_cost_usd_micros` integer,
	`total_cost_usd_estimated_micros` integer,
	`total_tokens` integer,
	`cost_quality` text DEFAULT 'unknown' NOT NULL,
	`raw_payload` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `usage_cycles_provider_idx` ON `usage_cycles` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_cycles_dedupe_key_idx` ON `usage_cycles` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `usage_daemon_status` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`host` text,
	`pid` integer,
	`enabled` integer DEFAULT false NOT NULL,
	`running` integer DEFAULT false NOT NULL,
	`cadence_seconds` integer DEFAULT 300 NOT NULL,
	`started_at` integer,
	`last_heartbeat_at` integer,
	`last_poll_at` integer,
	`last_alert_at` integer,
	`last_error` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `usage_provider_states` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'not-configured' NOT NULL,
	`status_detail` text,
	`configured` integer DEFAULT false NOT NULL,
	`supports_daemon` integer DEFAULT false NOT NULL,
	`supports_historical` integer DEFAULT false NOT NULL,
	`last_poll_at` integer,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_provider_states_key_idx` ON `usage_provider_states` (`provider_id`,`account_tag`);--> statement-breakpoint
CREATE TABLE `usage_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_tag` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`cost_quality` text DEFAULT 'unknown' NOT NULL,
	`source_tag` text,
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
	`reset_at` integer,
	`model` text,
	`generation_id` text,
	`run_id` text,
	`raw_payload` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_samples_provider_idx` ON `usage_samples` (`provider_id`);--> statement-breakpoint
CREATE INDEX `usage_samples_captured_at_idx` ON `usage_samples` (`captured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_samples_dedupe_key_idx` ON `usage_samples` (`dedupe_key`);
