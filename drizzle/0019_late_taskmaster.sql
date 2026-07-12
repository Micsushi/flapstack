ALTER TABLE `chats` ADD `parent_chat_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `initiator_chat_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `parent_run_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `ancestor_chat_ids` text;