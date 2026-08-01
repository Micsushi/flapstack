CREATE TABLE `agent_profile_chat_bindings` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	`bound_at` integer NOT NULL,
	`frozen_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `agent_profile_chat_bindings_version_fk` FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `agent_profile_chat_bindings_snapshot_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_profile_chat_bindings_version_check" CHECK("agent_profile_chat_bindings"."profile_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `agent_profile_chat_bindings_profile_idx` ON `agent_profile_chat_bindings` (`profile_id`,`profile_version`);
--> statement-breakpoint
CREATE TABLE `agent_profile_run_bindings` (
	`run_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `agent_profile_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_profile_run_bindings_chat_idx` ON `agent_profile_run_bindings` (`chat_id`,`created_at`);
