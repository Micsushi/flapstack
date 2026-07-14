CREATE TABLE `mobile_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`challenge_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `mobile_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_auth_challenges_expiry_check" CHECK("mobile_auth_challenges"."expires_at" > "mobile_auth_challenges"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_auth_challenges_hash_idx` ON `mobile_auth_challenges` (`challenge_hash`);--> statement-breakpoint
CREATE INDEX `mobile_auth_challenges_device_idx` ON `mobile_auth_challenges` (`device_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_device_audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text,
	`event` text NOT NULL,
	`outcome` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "mobile_device_audit_outcome_check" CHECK("mobile_device_audit_records"."outcome" in ('allowed', 'denied', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `mobile_device_audit_created_idx` ON `mobile_device_audit_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `mobile_device_audit_device_idx` ON `mobile_device_audit_records` (`device_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mobile_device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`scope_version` integer NOT NULL,
	`rotation` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `mobile_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mobile_device_sessions_scope_version_check" CHECK("mobile_device_sessions"."scope_version" >= 1),
	CONSTRAINT "mobile_device_sessions_rotation_check" CHECK("mobile_device_sessions"."rotation" >= 0),
	CONSTRAINT "mobile_device_sessions_expiry_check" CHECK("mobile_device_sessions"."idle_expires_at" > "mobile_device_sessions"."last_seen_at" and "mobile_device_sessions"."absolute_expires_at" > "mobile_device_sessions"."issued_at" and "mobile_device_sessions"."idle_expires_at" <= "mobile_device_sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_device_sessions_token_idx` ON `mobile_device_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mobile_device_sessions_device_idx` ON `mobile_device_sessions` (`device_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `mobile_device_sessions_expiry_idx` ON `mobile_device_sessions` (`idle_expires_at`,`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`public_key_algorithm` text NOT NULL,
	`public_key` text NOT NULL,
	`public_key_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	`revocation_reason` text,
	`scope_version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mobile_devices_algorithm_check" CHECK("mobile_devices"."public_key_algorithm" in ('Ed25519', 'P-256')),
	CONSTRAINT "mobile_devices_scope_version_check" CHECK("mobile_devices"."scope_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_devices_public_key_idx` ON `mobile_devices` (`public_key_fingerprint`);--> statement-breakpoint
CREATE INDEX `mobile_devices_revoked_idx` ON `mobile_devices` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `mobile_pairing_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`certificate_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	CONSTRAINT "mobile_pairing_tokens_expiry_check" CHECK("mobile_pairing_tokens"."expires_at" > "mobile_pairing_tokens"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_pairing_tokens_hash_idx` ON `mobile_pairing_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mobile_pairing_tokens_expiry_idx` ON `mobile_pairing_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_session_nonces` (
	`session_id` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`used_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `nonce_hash`),
	FOREIGN KEY (`session_id`) REFERENCES `mobile_device_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mobile_session_nonces_used_idx` ON `mobile_session_nonces` (`used_at`);
--> statement-breakpoint
CREATE TRIGGER `mobile_device_audit_records_no_update`
BEFORE UPDATE ON `mobile_device_audit_records`
BEGIN
	SELECT RAISE(ABORT, 'mobile_device_audit_records is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `mobile_device_audit_records_no_delete`
BEFORE DELETE ON `mobile_device_audit_records`
BEGIN
	SELECT RAISE(ABORT, 'mobile_device_audit_records is append-only');
END;
