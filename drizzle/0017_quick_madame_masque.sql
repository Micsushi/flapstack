ALTER TABLE `attachments` ADD `grant_expires_at` text;--> statement-breakpoint
ALTER TABLE `flapshot_operations` ADD `task_id` text REFERENCES tasks(id);