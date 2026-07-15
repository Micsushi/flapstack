CREATE TABLE `usage_budget_arm_states` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`action` text NOT NULL,
	`threshold_value` integer NOT NULL,
	`armed` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`budget_id`) REFERENCES `usage_budgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_budget_arm_states_key_idx` ON `usage_budget_arm_states` (`budget_id`,`action`,`threshold_value`);
--> statement-breakpoint
INSERT OR IGNORE INTO `usage_budget_arm_states`
  (`id`, `budget_id`, `action`, `threshold_value`, `armed`, `last_fired_at`, `updated_at`)
SELECT
  `id`, `account_tag`, `alert_type`, `threshold_value`, `armed`, `last_fired_at`, `updated_at`
FROM `usage_alert_arm_states`
WHERE `provider_id` = 'flapstack-budget'
  AND `threshold_value` IS NOT NULL
  AND `account_tag` IN (SELECT `id` FROM `usage_budgets`);
--> statement-breakpoint
DELETE FROM `usage_alert_arm_states`
WHERE `provider_id` = 'flapstack-budget';
