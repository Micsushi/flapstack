CREATE TABLE `record_task_worktrees` (
  `id` text PRIMARY KEY NOT NULL,
  `endpoint` text NOT NULL,
  `record_path` text NOT NULL,
  `record_id` text NOT NULL,
  `canonical_project_id` text NOT NULL,
  `local_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE RESTRICT,
  `source_revision` text NOT NULL,
  `claim_id` text NOT NULL,
  `chat_id` text UNIQUE REFERENCES `chats`(`id`) ON DELETE SET NULL,
  `worktree_path` text NOT NULL UNIQUE,
  `branch` text NOT NULL,
  `base_commit` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_task_worktrees_canonical_idx` ON `record_task_worktrees` (`endpoint`, `record_path`, `record_id`, `canonical_project_id`);
