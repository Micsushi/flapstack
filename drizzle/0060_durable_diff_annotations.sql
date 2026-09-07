CREATE TABLE `diff_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`creation_hash` text NOT NULL,
	`diff_hash` text NOT NULL,
	`file_path` text NOT NULL,
	`side` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "diff_annotations_contract_check" CHECK(length("diff_annotations"."diff_hash") = 64
    and length("diff_annotations"."creation_hash") = 64 and "diff_annotations"."side" in ('left', 'right')
    and "diff_annotations"."start_line" >= 1 and "diff_annotations"."end_line" >= "diff_annotations"."start_line"
    and "diff_annotations"."end_line" - "diff_annotations"."start_line" < 1000 and "diff_annotations"."end_line" <= 10000000
    and length(cast("diff_annotations"."body" as blob)) between 1 and 16384
    and length("diff_annotations"."file_path") between 1 and 4096 and "diff_annotations"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `diff_annotations_chat_idx` ON `diff_annotations` (`chat_id`,`created_at`);