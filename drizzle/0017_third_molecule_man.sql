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
CREATE INDEX `mcp_approval_requests_chat_id_idx` ON `mcp_approval_requests` (`caller_chat_id`);--> statement-breakpoint
CREATE TABLE `mcp_audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`invocation_id` text NOT NULL,
	`status` text NOT NULL,
	`caller_chat_id` text NOT NULL,
	`caller_run_id` text,
	`tool_name` text NOT NULL,
	`tier` integer NOT NULL,
	`caller_snapshot` text NOT NULL,
	`chat_snapshot` text NOT NULL,
	`run_snapshot` text NOT NULL,
	`input_summary` text NOT NULL,
	`result_summary` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_records_created_at_idx` ON `mcp_audit_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_caller_chat_id_idx` ON `mcp_audit_records` (`caller_chat_id`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_tool_name_idx` ON `mcp_audit_records` (`tool_name`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_status_idx` ON `mcp_audit_records` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_invocation_id_idx` ON `mcp_audit_records` (`invocation_id`);--> statement-breakpoint
CREATE TRIGGER `mcp_audit_records_no_update`
BEFORE UPDATE ON `mcp_audit_records`
BEGIN
  SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `mcp_audit_records_no_delete`
BEFORE DELETE ON `mcp_audit_records`
BEGIN
  SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
END;
--> statement-breakpoint
ALTER TABLE `chats` ADD `custom_permissions` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `mcp_exposure_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `parent_chat_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `initiator_chat_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `parent_run_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `ancestor_chat_ids` text;
