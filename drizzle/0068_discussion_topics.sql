CREATE TABLE `discussion_revisions` (
	`topic_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`topic_id`, `revision`),
	FOREIGN KEY (`topic_id`) REFERENCES `discussion_topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discussion_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text,
	`host_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussion_topics_scope_idx` ON `discussion_topics` (`project_id`,`chat_id`,`host_id`,`updated_at`);