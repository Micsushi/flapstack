CREATE TABLE `extension_enablement_policies` (
	`extension_id` text NOT NULL,
	`harness` text NOT NULL,
	`kind` text NOT NULL,
	`native_scope` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`enabled` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	PRIMARY KEY(`extension_id`, `scope_type`, `scope_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "extension_enablement_policies_harness_check" CHECK("extension_enablement_policies"."harness" in ('claude-code', 'codex', 'cursor-agent', 'opencode')),
	CONSTRAINT "extension_enablement_policies_kind_check" CHECK("extension_enablement_policies"."kind" in ('skill', 'command', 'plugin', 'custom-agent', 'mcp', 'hook')),
	CONSTRAINT "extension_enablement_policies_native_scope_check" CHECK("extension_enablement_policies"."native_scope" in ('user', 'project', 'plugin')),
	CONSTRAINT "extension_enablement_policies_scope_check" CHECK((
        ("extension_enablement_policies"."scope_type" = 'user' and "extension_enablement_policies"."scope_id" = 'user' and "extension_enablement_policies"."project_id" is null and "extension_enablement_policies"."task_id" is null) or
        ("extension_enablement_policies"."scope_type" = 'project' and "extension_enablement_policies"."scope_id" = "extension_enablement_policies"."project_id" and "extension_enablement_policies"."project_id" is not null and "extension_enablement_policies"."task_id" is null) or
        ("extension_enablement_policies"."scope_type" = 'task' and "extension_enablement_policies"."scope_id" = "extension_enablement_policies"."task_id" and "extension_enablement_policies"."project_id" is not null and "extension_enablement_policies"."task_id" is not null)
      ))
);
--> statement-breakpoint
CREATE INDEX `extension_enablement_policies_project_idx` ON `extension_enablement_policies` (`project_id`,`extension_id`);--> statement-breakpoint
CREATE INDEX `extension_enablement_policies_task_idx` ON `extension_enablement_policies` (`task_id`,`extension_id`);