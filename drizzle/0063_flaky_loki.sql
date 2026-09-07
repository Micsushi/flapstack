CREATE TABLE `workspace_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`root_path` text NOT NULL,
	`root_identity` text NOT NULL,
	`relative_path` text NOT NULL,
	`request_hash` text NOT NULL,
	`before_content` text NOT NULL,
	`after_content` text NOT NULL,
	`before_sha256` text NOT NULL,
	`after_sha256` text NOT NULL,
	`reverts_id` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_edits_contract_check" CHECK(
    "workspace_edits"."state" in ('prepared', 'applied', 'failed', 'conflict', 'expired')
    and length("workspace_edits"."request_hash") = 64 and length("workspace_edits"."before_sha256") = 64
    and length("workspace_edits"."after_sha256") = 64
    and length(cast("workspace_edits"."before_content" as blob)) <= 2097152
    and length(cast("workspace_edits"."after_content" as blob)) <= 2097152
    and length("workspace_edits"."relative_path") between 1 and 4096)
);
--> statement-breakpoint
CREATE INDEX `workspace_edits_root_idx` ON `workspace_edits` (`root_path`,`state`);--> statement-breakpoint
CREATE INDEX `workspace_edits_chat_idx` ON `workspace_edits` (`chat_id`,`created_at`);