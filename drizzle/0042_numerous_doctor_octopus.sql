PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_profile_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`runtime` text NOT NULL,
	`model` text NOT NULL,
	`state` text NOT NULL,
	`fixture_set_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`evidence_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`,`profile_version`) REFERENCES `agent_profile_versions`(`profile_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_profile_evaluations_runtime_check" CHECK("__new_agent_profile_evaluations"."runtime" in ('codex','codex-enhanced','claude-code','claude-code-enhanced','flapstack-native')),
	CONSTRAINT "agent_profile_evaluations_state_check" CHECK("__new_agent_profile_evaluations"."state" in ('untested','tested-local','supported','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_profile_evaluations`("id", "profile_id", "profile_version", "runtime", "model", "state", "fixture_set_json", "evidence_json", "evidence_digest", "created_at") SELECT "id", "profile_id", "profile_version", "runtime", "model", "state", "fixture_set_json", "evidence_json", "evidence_digest", "created_at" FROM `agent_profile_evaluations`;--> statement-breakpoint
DROP TABLE `agent_profile_evaluations`;--> statement-breakpoint
ALTER TABLE `__new_agent_profile_evaluations` RENAME TO `agent_profile_evaluations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_profile_evaluations_lookup_idx` ON `agent_profile_evaluations` (`profile_id`,`profile_version`,`runtime`,`model`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `agent_profile_evaluations_no_update`
BEFORE UPDATE ON `agent_profile_evaluations`
BEGIN SELECT RAISE(ABORT, 'agent profile evaluations are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `agent_profile_evaluations_no_delete`
BEFORE DELETE ON `agent_profile_evaluations`
BEGIN SELECT RAISE(ABORT, 'agent profile evaluations are append-only'); END;
