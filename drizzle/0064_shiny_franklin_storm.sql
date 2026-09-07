ALTER TABLE `workspace_edits` ADD `kind` text DEFAULT 'save' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_edits` ADD `file_mode` integer DEFAULT 384 NOT NULL;