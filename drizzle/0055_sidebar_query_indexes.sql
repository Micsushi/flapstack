CREATE INDEX `chats_project_active_order_idx` ON `chats` (`project_id`,`archived_at`,`pinned_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chats_task_active_order_idx` ON `chats` (`task_id`,`archived_at`,`pinned_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chats_scope_active_order_idx` ON `chats` (`scope`,`archived_at`,`pinned_at`,`updated_at`);