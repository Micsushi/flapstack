CREATE TABLE `voice_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`sub_chat_id` text,
	`message_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`adapter_id` text NOT NULL,
	`audio_path` text,
	`mime_type` text,
	`byte_length` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`last_played_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `voice_artifacts_chat_created_idx` ON `voice_artifacts` (`chat_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `voice_artifacts_message_idx` ON `voice_artifacts` (`message_id`);
--> statement-breakpoint
CREATE INDEX `voice_artifacts_kind_created_idx` ON `voice_artifacts` (`kind`,`created_at`);
