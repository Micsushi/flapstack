ALTER TABLE `agent_runs` ADD `custom_permissions` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `default_custom_permissions` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `default_custom_permissions` text;