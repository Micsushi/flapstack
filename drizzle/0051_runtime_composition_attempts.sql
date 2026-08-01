CREATE TABLE `runtime_composition_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`prior_attempt_id` text,
	`attempt_number` integer NOT NULL,
	`mode` text NOT NULL,
	`source_chat_id` text NOT NULL,
	`child_chat_id` text NOT NULL,
	`child_sub_chat_id` text NOT NULL,
	`run_id` text NOT NULL,
	`preview_digest` text NOT NULL,
	`target_snapshot` text NOT NULL,
	`task_envelope` text NOT NULL,
	`result_envelope` text,
	`worktree_path` text,
	`worktree_lease_id` text,
	`status` text NOT NULL,
	`cancellation_requested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`terminal_at` integer,
	FOREIGN KEY (`child_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runtime_composition_attempts_attempt_check" CHECK("runtime_composition_attempts"."attempt_number" >= 1),
	CONSTRAINT "runtime_composition_attempts_mode_check" CHECK("runtime_composition_attempts"."mode" in ('continue', 'delegate')),
	CONSTRAINT "runtime_composition_attempts_status_check" CHECK("runtime_composition_attempts"."status" in ('running', 'success', 'failure', 'cancelled', 'uncertain')),
	CONSTRAINT "runtime_composition_attempts_task_json_check" CHECK(json_valid("runtime_composition_attempts"."task_envelope") = 1),
	CONSTRAINT "runtime_composition_attempts_result_json_check" CHECK("runtime_composition_attempts"."result_envelope" is null or json_valid("runtime_composition_attempts"."result_envelope") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_composition_attempts_idempotency_idx` ON `runtime_composition_attempts` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_composition_attempts_run_idx` ON `runtime_composition_attempts` (`run_id`);
--> statement-breakpoint
CREATE INDEX `runtime_composition_attempts_source_idx` ON `runtime_composition_attempts` (`source_chat_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `runtime_composition_attempts_child_idx` ON `runtime_composition_attempts` (`child_chat_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_composition_attempts_active_worktree_idx`
ON `runtime_composition_attempts` (`worktree_path`)
WHERE `worktree_path` IS NOT NULL AND `status` = 'running';
