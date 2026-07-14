ALTER TABLE `voice_artifacts` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `voice_artifacts` ADD `origin_kind` text;--> statement-breakpoint
ALTER TABLE `voice_artifacts` ADD `origin_id` text;--> statement-breakpoint
ALTER TABLE `voice_artifacts` ADD `origin_label` text;--> statement-breakpoint
CREATE INDEX `voice_artifacts_origin_idx` ON `voice_artifacts` (`origin_kind`,`origin_id`);