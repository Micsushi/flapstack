CREATE TABLE `workspace_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`root_identity` text NOT NULL,
	`canonical_path` text NOT NULL,
	`relative_path` text NOT NULL,
	`base_sha256` text NOT NULL,
	`content` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_drafts_contract_check" CHECK(
      length("workspace_drafts"."base_sha256") = 64 and "workspace_drafts"."revision" >= 0
      and length(cast("workspace_drafts"."content" as blob)) <= 2097152
      and length("workspace_drafts"."relative_path") between 1 and 4096)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_drafts_target_idx` ON `workspace_drafts` (`chat_id`,`root_identity`,`canonical_path`);