CREATE TABLE `mobile_authority_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`authority` text NOT NULL,
	`capabilities` text NOT NULL,
	`resources` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`scope_version` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `mobile_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_authority_grants_scope_version_check" CHECK("mobile_authority_grants"."scope_version" >= 1),
	CONSTRAINT "mobile_authority_grants_expiry_check" CHECK("mobile_authority_grants"."expires_at" is null or "mobile_authority_grants"."expires_at" > "mobile_authority_grants"."issued_at")
);
--> statement-breakpoint
CREATE INDEX `mobile_authority_grants_device_idx` ON `mobile_authority_grants` (`device_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_event_log` (
	`grant_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`resource_kind` text,
	`resource_id` text,
	`occurred_at` integer NOT NULL,
	PRIMARY KEY(`grant_id`, `sequence`),
	FOREIGN KEY (`grant_id`) REFERENCES `mobile_authority_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_event_log_sequence_check" CHECK("mobile_event_log"."sequence" >= 1 and "mobile_event_log"."sequence" <= 9007199254740991),
	CONSTRAINT "mobile_event_log_resource_check" CHECK(("mobile_event_log"."resource_kind" is null and "mobile_event_log"."resource_id" is null) or ("mobile_event_log"."resource_kind" in ('project', 'task', 'chat', 'run', 'orchestration', 'automation') and length(trim("mobile_event_log"."resource_id")) between 1 and 200))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_event_log_event_id_idx` ON `mobile_event_log` (`event_id`);--> statement-breakpoint
CREATE INDEX `mobile_event_log_occurred_idx` ON `mobile_event_log` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `mobile_event_streams` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `mobile_authority_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_event_streams_sequence_check" CHECK("mobile_event_streams"."last_sequence" >= 0 and "mobile_event_streams"."last_sequence" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `mobile_projected_resources` (
	`grant_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`projected_at` integer NOT NULL,
	PRIMARY KEY(`grant_id`, `resource_kind`, `resource_id`),
	FOREIGN KEY (`grant_id`) REFERENCES `mobile_authority_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_projected_resources_kind_check" CHECK("mobile_projected_resources"."resource_kind" in ('project', 'task', 'chat', 'run', 'orchestration', 'automation')),
	CONSTRAINT "mobile_projected_resources_id_check" CHECK(length(trim("mobile_projected_resources"."resource_id")) between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `mobile_projected_resources_time_idx` ON `mobile_projected_resources` (`projected_at`);