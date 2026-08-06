CREATE TABLE `chat_tag_assignments` (
	`chat_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer,
	PRIMARY KEY(`chat_id`, `tag_id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `chat_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_tag_assignments_tag_idx` ON `chat_tag_assignments` (`tag_id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `chat_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "chat_tags_color_check" CHECK("chat_tags"."color" in ('slate','blue','cyan','green','amber','orange','rose','violet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_tags_normalized_name_idx` ON `chat_tags` (`normalized_name`);