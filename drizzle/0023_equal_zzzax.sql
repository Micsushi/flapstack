CREATE TABLE `project_vault_policies` (
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
