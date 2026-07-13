CREATE TABLE `filesystem_root_registrations` (
	`path` text PRIMARY KEY NOT NULL,
	`canonical_path` text NOT NULL,
	`device_id` text,
	`inode_id` text,
	`bound_at` integer NOT NULL
);
