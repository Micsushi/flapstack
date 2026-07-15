CREATE TABLE `saved_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_type` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`owner_kind` text DEFAULT 'manual' NOT NULL,
	`orchestration_id` text,
	`layout_version` integer DEFAULT 1 NOT NULL,
	`layout_json` text NOT NULL,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "saved_workspaces_name_check" CHECK(length(trim("saved_workspaces"."name")) between 1 and 256),
	CONSTRAINT "saved_workspaces_scope_check" CHECK((
        ("saved_workspaces"."scope_type" = 'project' and "saved_workspaces"."project_id" is not null and "saved_workspaces"."task_id" is null) or
        ("saved_workspaces"."scope_type" = 'task' and "saved_workspaces"."project_id" is null and "saved_workspaces"."task_id" is not null)
      )),
	CONSTRAINT "saved_workspaces_owner_check" CHECK((
        ("saved_workspaces"."owner_kind" = 'manual' and "saved_workspaces"."orchestration_id" is null) or
        ("saved_workspaces"."owner_kind" = 'orchestration' and "saved_workspaces"."scope_type" = 'task' and "saved_workspaces"."task_id" is not null and "saved_workspaces"."orchestration_id" is not null)
      )),
	CONSTRAINT "saved_workspaces_layout_version_check" CHECK("saved_workspaces"."layout_version" = 1),
	CONSTRAINT "saved_workspaces_version_check" CHECK("saved_workspaces"."version" >= 1),
	CONSTRAINT "saved_workspaces_sort_order_check" CHECK(length(trim("saved_workspaces"."sort_order")) between 1 and 512),
	CONSTRAINT "saved_workspaces_layout_json_check" CHECK(json_valid("saved_workspaces"."layout_json") = 1 and json_extract("saved_workspaces"."layout_json", '$.version') = "saved_workspaces"."layout_version" and length(cast("saved_workspaces"."layout_json" as blob)) <= 262144)
);
--> statement-breakpoint
CREATE INDEX `saved_workspaces_project_order_idx` ON `saved_workspaces` (`project_id`,`archived_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `saved_workspaces_task_order_idx` ON `saved_workspaces` (`task_id`,`archived_at`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `saved_workspaces_orchestration_idx` ON `saved_workspaces` (`orchestration_id`);
