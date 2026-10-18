CREATE TABLE `side_questions` (
  `id` text PRIMARY KEY NOT NULL,
  `sub_chat_id` text NOT NULL REFERENCES `sub_chats`(`id`) ON DELETE CASCADE,
  `thread_id` text NOT NULL,
  `body` text NOT NULL,
  `context_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `side_questions_source_order_idx` ON `side_questions` (`sub_chat_id`, `created_at`);
