ALTER TABLE `agent_runs` ADD `provider_account_id` text DEFAULT 'legacy-system-default' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `provider_auth_mode` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `provider_runtime_target` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `provider_credential_revision` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `anthropic_accounts` ADD `auth_mode` text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE `anthropic_accounts` ADD `runtime_target` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `anthropic_accounts` ADD `credential_revision` integer DEFAULT 1 NOT NULL;