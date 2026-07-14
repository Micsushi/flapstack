CREATE TABLE `orchestration_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`chat_id` text,
	`run_id` text,
	`parent_agent_id` text,
	`replaced_agent_id` text,
	`ancestor_agent_ids` text DEFAULT '[]' NOT NULL,
	`depth` integer DEFAULT 1 NOT NULL,
	`definition` text NOT NULL,
	`dependency_agent_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd_micros` integer,
	`cost_quality` text DEFAULT 'unknown' NOT NULL,
	`result_summary` text,
	`stop_reason` text,
	`blocker_count` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`queued_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `orchestration_agents_task_status_idx` ON `orchestration_agents` (`task_id`,`status`);--> statement-breakpoint
CREATE INDEX `orchestration_agents_chat_idx` ON `orchestration_agents` (`chat_id`);--> statement-breakpoint
CREATE INDEX `orchestration_agents_lease_idx` ON `orchestration_agents` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `task_orchestrations` (
	`task_id` text PRIMARY KEY NOT NULL,
	`initiating_chat_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`max_parallel_agents` integer DEFAULT 1 NOT NULL,
	`max_depth` integer DEFAULT 8 NOT NULL,
	`stop_conditions` text DEFAULT '{}' NOT NULL,
	`stop_reason` text,
	`blocker_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiating_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `task_orchestrations_status_idx` ON `task_orchestrations` (`status`);
