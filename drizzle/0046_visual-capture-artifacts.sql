CREATE TABLE `visual_artifact_links` (
	`artifact_id` text NOT NULL,
	`consumer_kind` text NOT NULL,
	`consumer_id` text NOT NULL,
	`context_sha256` text NOT NULL,
	`selected_at` integer NOT NULL,
	PRIMARY KEY(`artifact_id`, `consumer_kind`, `consumer_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `visual_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visual_artifact_links_contract_check" CHECK(
        "visual_artifact_links"."consumer_kind" in ('chat', 'task', 'knowledge', 'run')
        and length("visual_artifact_links"."consumer_id") between 1 and 200
        and length("visual_artifact_links"."context_sha256") = 64
      )
);
--> statement-breakpoint
CREATE INDEX `visual_artifact_links_consumer_idx` ON `visual_artifact_links` (`consumer_kind`,`consumer_id`);--> statement-breakpoint
CREATE TABLE `visual_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text,
	`task_id` text,
	`source_class` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text DEFAULT 'image/png' NOT NULL,
	`byte_length` integer NOT NULL,
	`original_sha256` text NOT NULL,
	`derivative_sha256` text NOT NULL,
	`preview_sha256` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`approval_id` text,
	`captured_at` integer NOT NULL,
	`confirmed_at` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`scale_factor` integer NOT NULL,
	`redaction_state` text NOT NULL,
	`redaction_count` integer DEFAULT 0 NOT NULL,
	`annotation_count` integer DEFAULT 0 NOT NULL,
	`retained_until` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "visual_artifacts_contract_check" CHECK(
        "visual_artifacts"."source_class" in ('screen', 'window', 'application-window', 'region')
        and "visual_artifacts"."mime_type" = 'image/png'
        and "visual_artifacts"."byte_length" between 1 and 33554432
        and length("visual_artifacts"."original_sha256") = 64
        and length("visual_artifacts"."derivative_sha256") = 64
        and "visual_artifacts"."preview_sha256" = "visual_artifacts"."derivative_sha256"
        and "visual_artifacts"."actor_kind" in ('user', 'agent')
        and ("visual_artifacts"."actor_kind" = 'user' or "visual_artifacts"."approval_id" is not null)
        and "visual_artifacts"."width" between 1 and 20000
        and "visual_artifacts"."height" between 1 and 20000
        and "visual_artifacts"."width" * "visual_artifacts"."height" <= 16000000
        and "visual_artifacts"."scale_factor" between 1 and 8000
        and "visual_artifacts"."redaction_state" in ('none', 'redacted')
        and "visual_artifacts"."redaction_count" between 0 and 100
        and "visual_artifacts"."annotation_count" between 0 and 100
      )
);
--> statement-breakpoint
CREATE INDEX `visual_artifacts_project_created_idx` ON `visual_artifacts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `visual_artifacts_chat_created_idx` ON `visual_artifacts` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `visual_artifacts_task_created_idx` ON `visual_artifacts` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `visual_capture_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` text,
	`request_id` text,
	`action` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`project_id` text NOT NULL,
	`outcome` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `visual_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "visual_capture_audit_contract_check" CHECK(
        "visual_capture_audit"."action" in ('request', 'select', 'confirm', 'read', 'link', 'export', 'delete')
        and "visual_capture_audit"."actor_kind" in ('user', 'agent', 'system')
        and "visual_capture_audit"."outcome" in ('allowed', 'denied', 'cancelled', 'failed')
      )
);
--> statement-breakpoint
CREATE INDEX `visual_capture_audit_project_occurred_idx` ON `visual_capture_audit` (`project_id`,`occurred_at`);