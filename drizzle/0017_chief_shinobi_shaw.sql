CREATE TABLE `mcp_audit_records` (
	`id` text PRIMARY KEY NOT NULL,
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
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_records_created_at_idx` ON `mcp_audit_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_caller_chat_id_idx` ON `mcp_audit_records` (`caller_chat_id`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_tool_name_idx` ON `mcp_audit_records` (`tool_name`);--> statement-breakpoint
CREATE INDEX `mcp_audit_records_status_idx` ON `mcp_audit_records` (`status`);
--> statement-breakpoint
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
