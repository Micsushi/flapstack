CREATE TABLE `orchestration_run_reviews` (
	`task_id` text NOT NULL,
	`source_run_id` text NOT NULL,
	`revision` integer NOT NULL,
	`review` text,
	PRIMARY KEY(`task_id`, `source_run_id`, `revision`),
	FOREIGN KEY (`task_id`) REFERENCES `task_orchestrations`(`task_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_run_reviews_revision_check" CHECK("orchestration_run_reviews"."revision" > 0)
);
