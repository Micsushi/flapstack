PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mobile_event_log` (
	`grant_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`resource_kind` text,
	`resource_id` text,
	`occurred_at` integer NOT NULL,
	PRIMARY KEY(`grant_id`, `sequence`),
	FOREIGN KEY (`grant_id`) REFERENCES `mobile_authority_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_event_log_sequence_check" CHECK("__new_mobile_event_log"."sequence" >= 1 and "__new_mobile_event_log"."sequence" <= 9007199254740991),
	CONSTRAINT "mobile_event_log_resource_check" CHECK(("__new_mobile_event_log"."resource_kind" is null and "__new_mobile_event_log"."resource_id" is null) or ("__new_mobile_event_log"."resource_kind" in ('project', 'task', 'chat', 'run', 'orchestration', 'automation', 'approval', 'artifact', 'diff', 'check') and length(trim("__new_mobile_event_log"."resource_id")) between 1 and 200))
);
--> statement-breakpoint
INSERT INTO `__new_mobile_event_log`("grant_id", "sequence", "event_id", "resource_kind", "resource_id", "occurred_at") SELECT "grant_id", "sequence", "event_id", "resource_kind", "resource_id", "occurred_at" FROM `mobile_event_log`;--> statement-breakpoint
DROP TABLE `mobile_event_log`;--> statement-breakpoint
ALTER TABLE `__new_mobile_event_log` RENAME TO `mobile_event_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_event_log_event_id_idx` ON `mobile_event_log` (`event_id`);--> statement-breakpoint
CREATE INDEX `mobile_event_log_occurred_idx` ON `mobile_event_log` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_mobile_projected_resources` (
	`grant_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`projected_at` integer NOT NULL,
	PRIMARY KEY(`grant_id`, `resource_kind`, `resource_id`),
	FOREIGN KEY (`grant_id`) REFERENCES `mobile_authority_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_projected_resources_kind_check" CHECK("__new_mobile_projected_resources"."resource_kind" in ('project', 'task', 'chat', 'run', 'orchestration', 'automation', 'approval', 'artifact', 'diff', 'check', 'agent-input')),
	CONSTRAINT "mobile_projected_resources_id_check" CHECK(length(trim("__new_mobile_projected_resources"."resource_id")) between 1 and 200)
);
--> statement-breakpoint
INSERT INTO `__new_mobile_projected_resources`("grant_id", "resource_kind", "resource_id", "projected_at") SELECT "grant_id", "resource_kind", "resource_id", "projected_at" FROM `mobile_projected_resources`;--> statement-breakpoint
DROP TABLE `mobile_projected_resources`;--> statement-breakpoint
ALTER TABLE `__new_mobile_projected_resources` RENAME TO `mobile_projected_resources`;--> statement-breakpoint
CREATE INDEX `mobile_projected_resources_time_idx` ON `mobile_projected_resources` (`projected_at`);
