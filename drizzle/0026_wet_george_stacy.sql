CREATE TABLE `plan_source_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text DEFAULT 'markdown' NOT NULL,
	`relative_path` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_source_registrations_type_check" CHECK("plan_source_registrations"."source_type" = 'markdown')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_source_registrations_project_path_idx` ON `plan_source_registrations` (`project_id`,`relative_path`);