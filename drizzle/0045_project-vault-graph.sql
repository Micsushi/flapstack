-- Rebuildable immutable project-vault graph generations.
CREATE TABLE `project_vault_graph_edges` (
	`generation_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`target_raw` text NOT NULL,
	`target_normalized` text NOT NULL,
	`target_node_id` text,
	`heading` text,
	`block_id` text,
	`status` text NOT NULL,
	`line` integer NOT NULL,
	PRIMARY KEY(`generation_id`, `source_node_id`, `ordinal`),
	FOREIGN KEY (`generation_id`) REFERENCES `project_vault_graph_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`source_node_id`) REFERENCES `project_vault_graph_nodes`(`generation_id`,`node_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`target_node_id`) REFERENCES `project_vault_graph_nodes`(`generation_id`,`node_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_graph_edges_kind_check" CHECK("project_vault_graph_edges"."kind" in ('wikilink', 'embed', 'markdown')),
	CONSTRAINT "project_vault_graph_edges_status_check" CHECK("project_vault_graph_edges"."status" in ('resolved', 'unresolved', 'ambiguous')),
	CONSTRAINT "project_vault_graph_edges_ordinal_line_check" CHECK("project_vault_graph_edges"."ordinal" >= 0 and "project_vault_graph_edges"."line" >= 1)
);
--> statement-breakpoint
CREATE INDEX `project_vault_graph_edges_target_idx` ON `project_vault_graph_edges` (`generation_id`,`target_node_id`);--> statement-breakpoint
CREATE TABLE `project_vault_graph_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`state` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`note_count` integer NOT NULL,
	`edge_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`committed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project_vaults`(`project_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_graph_generations_state_check" CHECK("project_vault_graph_generations"."state" in ('building', 'committed', 'failed')),
	CONSTRAINT "project_vault_graph_generations_counts_check" CHECK("project_vault_graph_generations"."note_count" >= 0 and "project_vault_graph_generations"."edge_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `project_vault_graph_generations_project_idx` ON `project_vault_graph_generations` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_vault_graph_nodes` (
	`generation_id` text NOT NULL,
	`node_id` text NOT NULL,
	`project_id` text NOT NULL,
	`stable_id` text,
	`relative_path` text NOT NULL,
	`normalized_path` text NOT NULL,
	`title` text NOT NULL,
	`note_type` text,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL,
	`aliases_json` text NOT NULL,
	`tags_json` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	PRIMARY KEY(`generation_id`, `node_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `project_vault_graph_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_vault_graph_nodes_bytes_check" CHECK("project_vault_graph_nodes"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_vault_graph_nodes_generation_path_idx` ON `project_vault_graph_nodes` (`generation_id`,`normalized_path`);--> statement-breakpoint
CREATE INDEX `project_vault_graph_nodes_project_generation_idx` ON `project_vault_graph_nodes` (`project_id`,`generation_id`);--> statement-breakpoint
CREATE INDEX `project_vault_graph_nodes_stable_idx` ON `project_vault_graph_nodes` (`project_id`,`stable_id`);--> statement-breakpoint
CREATE TABLE `project_vault_graph_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`current_generation_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project_vaults`(`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_generation_id`) REFERENCES `project_vault_graph_generations`(`id`) ON UPDATE no action ON DELETE set null
);
