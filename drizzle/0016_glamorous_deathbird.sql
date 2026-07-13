PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_voice_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`sub_chat_id` text,
	`message_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`adapter_id` text NOT NULL,
	`synthesis_key` text,
	`voice_id` text,
	`rate_milli` integer,
	`audio_path` text,
	`mime_type` text,
	`byte_length` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`created_at` integer,
	`last_played_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_voice_artifacts`("id", "chat_id", "sub_chat_id", "message_id", "kind", "text", "adapter_id", "synthesis_key", "voice_id", "rate_milli", "audio_path", "mime_type", "byte_length", "duration_ms", "created_at", "last_played_at") SELECT "id", "chat_id", "sub_chat_id", "message_id", "kind", "text", "adapter_id", "synthesis_key", "voice_id", "rate_milli", "audio_path", "mime_type", "byte_length", NULL, "created_at", "last_played_at" FROM `voice_artifacts`;--> statement-breakpoint
DROP TABLE `voice_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_voice_artifacts` RENAME TO `voice_artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `voice_artifacts_chat_created_idx` ON `voice_artifacts` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `voice_artifacts_message_idx` ON `voice_artifacts` (`message_id`);--> statement-breakpoint
CREATE INDEX `voice_artifacts_synthesis_idx` ON `voice_artifacts` (`message_id`,`synthesis_key`);--> statement-breakpoint
CREATE INDEX `voice_artifacts_kind_created_idx` ON `voice_artifacts` (`kind`,`created_at`);
