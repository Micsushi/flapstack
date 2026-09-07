CREATE TABLE `diff_feedback_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`sub_chat_id` text NOT NULL,
	`run_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`selection` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_feedback_chat_idx` ON `diff_feedback_batches` (`chat_id`,`created_at`);