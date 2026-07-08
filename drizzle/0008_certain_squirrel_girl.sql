CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`sub_chat_id` text,
	`harness` text NOT NULL,
	`model` text,
	`permission_mode` text NOT NULL,
	`worktree_path` text,
	`prompt_message_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`before_checkpoint_id` text,
	`after_checkpoint_id` text,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_runs_chat_id_idx` ON `agent_runs` (`chat_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`task_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`source_path` text,
	`stored_path` text,
	`content_text` text,
	`created_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_chat_id_idx` ON `attachments` (`chat_id`);--> statement-breakpoint
CREATE INDEX `attachments_task_id_idx` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`worktree_path` text,
	`git_commit` text,
	`git_status_json` text,
	`created_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkpoints_run_id_idx` ON `checkpoints` (`run_id`);--> statement-breakpoint
CREATE TABLE `file_change_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`file_path` text NOT NULL,
	`change_type` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`before_hash` text,
	`after_hash` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_change_manifests_run_id_idx` ON `file_change_manifests` (`run_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`default_permission_mode` text DEFAULT 'ask-before-edits' NOT NULL,
	`primary_worktree_path` text,
	`primary_branch` text,
	`pinned_at` integer,
	`archived_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`project_id` text,
	`task_id` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`permission_mode` text DEFAULT 'ask-before-edits' NOT NULL,
	`harness` text,
	`model` text,
	`created_at` integer,
	`updated_at` integer,
	`archived_at` integer,
	`pinned_at` integer,
	`worktree_path` text,
	`branch` text,
	`base_branch` text,
	`pr_url` text,
	`pr_number` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chats`("id", "name", "project_id", "task_id", "scope", "permission_mode", "harness", "model", "created_at", "updated_at", "archived_at", "pinned_at", "worktree_path", "branch", "base_branch", "pr_url", "pr_number") SELECT "id", "name", "project_id", NULL, 'project', 'ask-before-edits', NULL, NULL, "created_at", "updated_at", "archived_at", NULL, "worktree_path", "branch", "base_branch", "pr_url", "pr_number" FROM `chats`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chats_worktree_path_idx` ON `chats` (`worktree_path`);--> statement-breakpoint
CREATE INDEX `chats_task_id_idx` ON `chats` (`task_id`);--> statement-breakpoint
CREATE INDEX `chats_scope_idx` ON `chats` (`scope`);--> statement-breakpoint
ALTER TABLE `projects` ADD `default_permission_mode` text DEFAULT 'ask-before-edits' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `harness` text;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `model` text;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `permission_mode` text;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `worktree_path` text;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `run_status` text;
