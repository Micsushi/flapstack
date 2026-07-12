ALTER TABLE `mcp_audit_records` ADD `invocation_id` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `mcp_audit_records` ADD `duration_ms` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `mcp_audit_records_invocation_id_idx` ON `mcp_audit_records` (`invocation_id`);
