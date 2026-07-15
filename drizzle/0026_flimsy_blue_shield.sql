CREATE TABLE IF NOT EXISTS `project_vault_policies` (
	`project_id` text PRIMARY KEY NOT NULL,
	`location_mode` text DEFAULT 'app-managed' NOT NULL,
	`central_path` text NOT NULL,
	`project_owned_path` text,
	`git_tracking_enabled` integer DEFAULT false NOT NULL,
	`portability_mode` text DEFAULT 'export-required' NOT NULL,
	`worktree_mode` text DEFAULT 'shared-across-worktrees' NOT NULL,
	`deletion_mode` text DEFAULT 'retain-until-explicit-delete' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`proposed_by_chat_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_status` text DEFAULT 'backlog' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_type` text,
	`source_path` text,
	`source_candidate_id` text,
	`source_fingerprint` text,
	`created_at` integer,
	`updated_at` integer,
	`decided_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_proposals_target_status_check" CHECK("task_proposals"."target_status" in ('backlog', 'planned')),
	CONSTRAINT "task_proposals_status_check" CHECK("task_proposals"."status" in ('pending', 'approved', 'denied', 'cancelled')),
	CONSTRAINT "task_proposals_version_check" CHECK("task_proposals"."version" >= 1),
	CONSTRAINT "task_proposals_name_check" CHECK(length(trim("task_proposals"."name")) between 1 and 256)
);
--> statement-breakpoint
CREATE INDEX `task_proposals_project_status_idx` ON `task_proposals` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_proposals_caller_idx` ON `task_proposals` (`proposed_by_chat_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`board_order` text DEFAULT 'a0' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_type` text,
	`source_path` text,
	`source_candidate_id` text,
	`source_fingerprint` text,
	`default_permission_mode` text DEFAULT 'ask-before-edits' NOT NULL,
	`default_custom_permissions` text,
	`primary_worktree_path` text,
	`primary_branch` text,
	`pinned_at` integer,
	`archived_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" in ('backlog', 'planned', 'in-progress', 'review', 'done')),
	CONSTRAINT "tasks_version_check" CHECK("__new_tasks"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(
	"id", "project_id", "name", "description", "status", "board_order", "version",
	"source_type", "source_path", "source_candidate_id", "source_fingerprint",
	"default_permission_mode", "default_custom_permissions", "primary_worktree_path",
	"primary_branch", "pinned_at", "archived_at", "created_at", "updated_at"
)
SELECT
	"id", "project_id", "name", "description",
	CASE
		WHEN "status" = 'active' THEN 'in-progress'
		WHEN "status" IN ('backlog', 'planned', 'in-progress', 'review', 'done') THEN "status"
		ELSE 'backlog'
	END,
	printf('%020d:%s', coalesce("created_at", 0), "id"), 1,
	NULL, NULL, NULL, NULL,
	"default_permission_mode", "default_custom_permissions", "primary_worktree_path",
	"primary_branch", "pinned_at", "archived_at", "created_at", "updated_at"
FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_project_status_order_idx` ON `tasks` (`project_id`,`status`,`board_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_candidate_idx` ON `tasks` (`project_id`,`source_path`,`source_candidate_id`);
