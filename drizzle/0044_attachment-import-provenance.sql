PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`task_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`source_path` text,
	`source_kind` text,
	`stored_path` text,
	`content_text` text,
	`byte_length` integer,
	`mime_type` text,
	`sha256` text,
	`created_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `attachments_upload_provenance_check` CHECK(
		(
			`source_kind` IS NULL
			AND `byte_length` IS NULL
			AND `mime_type` IS NULL
			AND `sha256` IS NULL
		)
		OR
		(
			`source_kind` IS 'upload'
			AND `kind` IN ('file', 'image')
			AND `stored_path` IS NOT NULL
			AND `content_text` IS NULL
			AND typeof(`byte_length`) = 'integer'
			AND `byte_length` BETWEEN 0 AND 16777216
			AND `mime_type` IS NOT NULL
			AND (
				(
					`kind` = 'image'
					AND `mime_type` IN ('image/gif', 'image/jpeg', 'image/png', 'image/webp')
				)
				OR
				(
					`kind` = 'file'
					AND `mime_type` IN (
						'application/gzip',
						'application/octet-stream',
						'application/pdf',
						'application/wasm',
						'application/x-7z-compressed',
						'application/x-tar',
						'application/zip',
						'application/vnd.ms-excel',
						'application/vnd.ms-powerpoint',
						'application/vnd.openxmlformats-officedocument.presentationml.presentation',
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
						'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
						'text/calendar',
						'text/csv',
						'text/css',
						'text/html',
						'text/javascript',
						'text/markdown',
						'text/plain',
						'text/tab-separated-values',
						'text/typescript',
						'text/xml'
					)
				)
			)
			AND `sha256` IS NOT NULL
			AND length(`sha256`) = 64
			AND `sha256` NOT GLOB '*[^0-9a-f]*'
		)
	)
);--> statement-breakpoint
INSERT INTO `__new_attachments`(
	`id`,
	`chat_id`,
	`task_id`,
	`kind`,
	`name`,
	`source_path`,
	`source_kind`,
	`stored_path`,
	`content_text`,
	`byte_length`,
	`mime_type`,
	`sha256`,
	`created_at`
)
SELECT
	`id`,
	`chat_id`,
	`task_id`,
	`kind`,
	`name`,
	`source_path`,
	NULL,
	`stored_path`,
	`content_text`,
	NULL,
	NULL,
	NULL,
	`created_at`
FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
CREATE INDEX `attachments_chat_id_idx` ON `attachments` (`chat_id`);--> statement-breakpoint
CREATE INDEX `attachments_task_id_idx` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE TRIGGER `attachments_provenance_immutable`
BEFORE UPDATE OF `source_kind`, `byte_length`, `mime_type`, `sha256` ON `attachments`
WHEN OLD.`source_kind` IS NOT NEW.`source_kind`
  OR OLD.`byte_length` IS NOT NEW.`byte_length`
  OR OLD.`mime_type` IS NOT NEW.`mime_type`
  OR OLD.`sha256` IS NOT NEW.`sha256`
BEGIN
  SELECT RAISE(ABORT, 'Attachment provenance is immutable');
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
