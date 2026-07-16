PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sub_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`chat_id` text NOT NULL,
	`session_id` text,
	`stream_id` text,
	`mode` text DEFAULT 'write' NOT NULL,
	`harness` text,
	`model` text,
	`permission_mode` text,
	`worktree_path` text,
	`run_status` text,
	`messages` text DEFAULT '[]' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sub_chats`("id", "name", "chat_id", "session_id", "stream_id", "mode", "harness", "model", "permission_mode", "worktree_path", "run_status", "messages", "created_at", "updated_at") SELECT "id", "name", "chat_id", "session_id", "stream_id", CASE WHEN "mode" = 'agent' THEN 'write' ELSE "mode" END, "harness", "model", "permission_mode", "worktree_path", "run_status", "messages", "created_at", "updated_at" FROM `sub_chats`;--> statement-breakpoint
DROP TABLE `sub_chats`;--> statement-breakpoint
ALTER TABLE `__new_sub_chats` RENAME TO `sub_chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
