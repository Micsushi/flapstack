ALTER TABLE `voice_artifacts` ADD `synthesis_key` text;
--> statement-breakpoint
ALTER TABLE `voice_artifacts` ADD `voice_id` text;
--> statement-breakpoint
ALTER TABLE `voice_artifacts` ADD `rate_milli` integer;
--> statement-breakpoint
CREATE INDEX `voice_artifacts_synthesis_idx` ON `voice_artifacts` (`message_id`,`synthesis_key`);
