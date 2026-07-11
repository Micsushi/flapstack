CREATE TABLE `flapshot_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`connection_key` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`request_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`audit_correlation_id` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text NOT NULL,
	`progress_completed` integer DEFAULT 0 NOT NULL,
	`progress_total` integer,
	`progress_unit` text,
	`progress_message` text,
	`error_code` text,
	`error_reason` text,
	`error_message` text,
	`result_attachment_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flapshot_operations_operation_id_unique` ON `flapshot_operations` (`operation_id`);--> statement-breakpoint
CREATE INDEX `flapshot_operations_chat_id_idx` ON `flapshot_operations` (`chat_id`);--> statement-breakpoint
CREATE INDEX `flapshot_operations_connection_state_idx` ON `flapshot_operations` (`connection_key`,`state`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `byte_length` integer;--> statement-breakpoint
ALTER TABLE `attachments` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `source_artifact_id` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `source_uri` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `source_application` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `grant_client_id` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `provenance_json` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `integrity_status` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `correlation_id` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `audit_correlation_id` text;