CREATE TABLE `project_vault_custom_notes` (
	`project_id` text NOT NULL,
	`stable_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`trash_id` text,
	`deleted_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `stable_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project_vaults`(`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_custom_notes_version_check" CHECK("project_vault_custom_notes"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vault_custom_notes_path_idx` ON `project_vault_custom_notes` (`project_id`,`relative_path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vault_custom_notes_trash_idx` ON `project_vault_custom_notes` (`project_id`,`trash_id`);
