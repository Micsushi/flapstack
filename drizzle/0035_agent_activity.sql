CREATE TABLE `agent_activity_sequences` (
	`run_id` text PRIMARY KEY NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `agent_activity_sequences_next_check` CHECK(`next_sequence` >= 1)
);
--> statement-breakpoint
CREATE TABLE `agent_activity_events` (
	`storage_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`run_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`sub_chat_id` text,
	`orchestration_agent_id` text,
	`runtime` text NOT NULL,
	`harness` text NOT NULL,
	`provider` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`display_class` text NOT NULL,
	`privacy_class` text NOT NULL,
	`redaction_state` text DEFAULT 'none' NOT NULL,
	`redaction_reason` text,
	`provider_timestamp` integer,
	`received_at` integer NOT NULL,
	`provider_event_id` text,
	`provider_session_id` text,
	`provider_thread_id` text,
	`provider_turn_id` text,
	`provider_item_id` text,
	`provider_parent_item_id` text,
	`provider_message_id` text,
	`provider_tool_id` text,
	`summary_index` integer,
	`content_index` integer,
	`part_index` integer,
	`section_boundary` text,
	`dedup_key` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `agent_activity_events_sequence_check` CHECK(`sequence` >= 1),
	CONSTRAINT `agent_activity_events_runtime_check` CHECK(`runtime` in ('codex', 'claude-code', 'flapstack-native')),
	CONSTRAINT `agent_activity_events_kind_check` CHECK(`kind` in ('lifecycle', 'status', 'agent-text', 'reasoning-summary', 'provider-visible-reasoning', 'plan', 'tool', 'command', 'patch', 'permission', 'hook', 'subagent', 'warning', 'compaction', 'usage', 'opaque-metadata', 'private-metadata')),
	CONSTRAINT `agent_activity_events_phase_check` CHECK(`phase` in ('queued', 'started', 'delta', 'updated', 'completed', 'failed', 'cancelled', 'snapshot')),
	CONSTRAINT `agent_activity_events_display_check` CHECK(`display_class` in ('summary', 'provider-visible', 'status', 'tool', 'private', 'metadata')),
	CONSTRAINT `agent_activity_events_privacy_check` CHECK(`privacy_class` in ('public', 'sensitive', 'private', 'encrypted')),
	CONSTRAINT `agent_activity_events_redaction_check` CHECK(`redaction_state` in ('none', 'redacted', 'retained-redaction', 'corrupt')),
	CONSTRAINT `agent_activity_events_payload_check` CHECK(json_valid(`payload_json`) = 1 and length(cast(`payload_json` as blob)) <= 65536)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_events_event_id_idx` ON `agent_activity_events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_events_run_sequence_idx` ON `agent_activity_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_events_run_dedup_idx` ON `agent_activity_events` (`run_id`,`dedup_key`) WHERE `dedup_key` is not null;--> statement-breakpoint
CREATE INDEX `agent_activity_events_chat_storage_idx` ON `agent_activity_events` (`chat_id`,`storage_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_events_run_storage_idx` ON `agent_activity_events` (`run_id`,`storage_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_events_received_idx` ON `agent_activity_events` (`received_at`,`storage_id`);--> statement-breakpoint
CREATE TRIGGER `agent_activity_events_append_only`
BEFORE UPDATE ON `agent_activity_events`
WHEN
  OLD.`redaction_state` <> 'none' OR
  NEW.`redaction_state` = 'none' OR
  NEW.`storage_id` IS NOT OLD.`storage_id` OR
  NEW.`event_id` IS NOT OLD.`event_id` OR
  NEW.`run_id` IS NOT OLD.`run_id` OR
  NEW.`chat_id` IS NOT OLD.`chat_id` OR
  NEW.`sub_chat_id` IS NOT OLD.`sub_chat_id` OR
  NEW.`orchestration_agent_id` IS NOT OLD.`orchestration_agent_id` OR
  NEW.`runtime` IS NOT OLD.`runtime` OR
  NEW.`harness` IS NOT OLD.`harness` OR
  NEW.`provider` IS NOT OLD.`provider` OR
  NEW.`sequence` IS NOT OLD.`sequence` OR
  NEW.`phase` IS NOT OLD.`phase` OR
  NEW.`provider_timestamp` IS NOT OLD.`provider_timestamp` OR
  NEW.`received_at` IS NOT OLD.`received_at` OR
  NEW.`provider_event_id` IS NOT OLD.`provider_event_id` OR
  NEW.`provider_session_id` IS NOT OLD.`provider_session_id` OR
  NEW.`provider_thread_id` IS NOT OLD.`provider_thread_id` OR
  NEW.`provider_turn_id` IS NOT OLD.`provider_turn_id` OR
  NEW.`provider_item_id` IS NOT OLD.`provider_item_id` OR
  NEW.`provider_parent_item_id` IS NOT OLD.`provider_parent_item_id` OR
  NEW.`provider_message_id` IS NOT OLD.`provider_message_id` OR
  NEW.`provider_tool_id` IS NOT OLD.`provider_tool_id` OR
  NEW.`summary_index` IS NOT OLD.`summary_index` OR
  NEW.`content_index` IS NOT OLD.`content_index` OR
  NEW.`part_index` IS NOT OLD.`part_index` OR
  NEW.`section_boundary` IS NOT OLD.`section_boundary` OR
  NEW.`dedup_key` IS NOT OLD.`dedup_key` OR
  NEW.`created_at` IS NOT OLD.`created_at` OR
  NOT (
    NEW.`kind` = 'private-metadata' AND
    NEW.`display_class` = 'private' AND
    NEW.`privacy_class` = 'private' AND
    NEW.`redaction_state` IN ('redacted', 'retained-redaction') AND
    NEW.`redaction_reason` IS NOT NULL AND
    length(trim(NEW.`redaction_reason`)) BETWEEN 1 AND 512 AND
    NEW.`payload_json` = CASE NEW.`redaction_state`
      WHEN 'redacted' THEN '{"eventType":"redacted","metadata":null}'
      WHEN 'retained-redaction' THEN '{"eventType":"retained-redaction","metadata":null}'
    END
  )
BEGIN
  SELECT RAISE(ABORT, 'agent activity events are append-only except one-way redaction');
END;
