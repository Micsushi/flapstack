CREATE TABLE `chat_agent_labels` (
	`chat_id` text NOT NULL,
	`key` text NOT NULL,
	`confidence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `key`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_agent_labels_key_check" CHECK("chat_agent_labels"."key" in ('coordinator','reviewer','worker','researcher','planner','verifier')),
	CONSTRAINT "chat_agent_labels_confidence_check" CHECK("chat_agent_labels"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX `chat_agent_labels_key_idx` ON `chat_agent_labels` (`key`,`chat_id`);--> statement-breakpoint
CREATE TABLE `chat_waits` (
	`id` text PRIMARY KEY NOT NULL,
	`waiter_chat_id` text NOT NULL,
	`waiter_run_id` text NOT NULL,
	`target_chat_ids` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`settled_at` integer,
	`resumed_run_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`waiter_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_waits_targets_json_check" CHECK(json_valid("chat_waits"."target_chat_ids") = 1),
	CONSTRAINT "chat_waits_status_check" CHECK("chat_waits"."status" in ('waiting','resuming','completed','cancelled','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_waits_waiter_idempotency_idx` ON `chat_waits` (`waiter_chat_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `chat_waits_status_idx` ON `chat_waits` (`status`,`updated_at`);