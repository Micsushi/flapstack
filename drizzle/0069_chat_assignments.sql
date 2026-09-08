ALTER TABLE `chats` ADD `assigned_role` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `lead_chat_id` text REFERENCES chats(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `discussion_chat_id` text REFERENCES chats(id) ON DELETE SET NULL;