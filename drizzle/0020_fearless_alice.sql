CREATE TABLE `mcp_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`invocation_id` text NOT NULL,
	`caller_chat_id` text NOT NULL,
	`caller_run_id` text,
	`tool_name` text NOT NULL,
	`tier` integer NOT NULL,
	`target_summary` text NOT NULL,
	`input_summary` text NOT NULL,
	`decision` text,
	`grant_session` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_approval_requests_pending_idx` ON `mcp_approval_requests` (`decision`,`expires_at`);--> statement-breakpoint
CREATE INDEX `mcp_approval_requests_chat_id_idx` ON `mcp_approval_requests` (`caller_chat_id`);