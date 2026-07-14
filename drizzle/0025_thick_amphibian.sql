CREATE TABLE `project_vault_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`section_id` text NOT NULL,
	`version` integer NOT NULL,
	`relative_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`project_id`,`section_id`) REFERENCES `project_vault_sections`(`project_id`,`section_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_backups_version_check" CHECK("project_vault_backups"."version" >= 1),
	CONSTRAINT "project_vault_backups_byte_length_check" CHECK("project_vault_backups"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vault_backups_version_idx` ON `project_vault_backups` (`project_id`,`section_id`,`version`);--> statement-breakpoint
CREATE INDEX `project_vault_backups_section_idx` ON `project_vault_backups` (`project_id`,`section_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_vault_sections` (
	`project_id` text NOT NULL,
	`section_id` text NOT NULL,
	`section_type` text NOT NULL,
	`title` text NOT NULL,
	`relative_path` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`project_id`, `section_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project_vaults`(`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_sections_version_check" CHECK("project_vault_sections"."version" >= 1),
	CONSTRAINT "project_vault_sections_byte_length_check" CHECK("project_vault_sections"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vault_sections_path_idx` ON `project_vault_sections` (`project_id`,`relative_path`);--> statement-breakpoint
CREATE TABLE `project_vaults` (
	`project_id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vaults_schema_version_check" CHECK("project_vaults"."schema_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vaults_root_path_idx` ON `project_vaults` (`root_path`);