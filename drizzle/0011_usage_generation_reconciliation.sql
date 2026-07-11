CREATE TABLE `usage_generation_reconciliation` (
	`provider_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`next_attempt_at` integer,
	`detail` text,
	`updated_at` integer,
	PRIMARY KEY(`provider_id`, `generation_id`)
);
--> statement-breakpoint
CREATE INDEX `usage_generation_reconcile_state_idx` ON `usage_generation_reconciliation` (`provider_id`,`state`,`next_attempt_at`);
--> statement-breakpoint
ALTER TABLE `usage_samples` ADD `quota_unit` text;
