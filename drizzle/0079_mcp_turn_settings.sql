ALTER TABLE chats ADD COLUMN reasoning_effort text;
--> statement-breakpoint
ALTER TABLE sub_chats ADD COLUMN reasoning_effort text;
--> statement-breakpoint
ALTER TABLE sub_chats ADD COLUMN needs_provider_handoff integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN reasoning_effort text;
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN turn_overrides text;
