CREATE TABLE `records_plan_pairs` (
  `id` text PRIMARY KEY NOT NULL,
  `endpoint` text NOT NULL,
  `project_id` text REFERENCES projects(id) ON DELETE SET NULL,
  `status` text NOT NULL,
  `prepared_chat` text NOT NULL,
  `error` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER records_plan_pair_pending_project_delete
BEFORE DELETE ON projects
WHEN EXISTS (SELECT 1 FROM records_plan_pairs WHERE project_id = OLD.id AND status = 'pending')
BEGIN
  SELECT RAISE(ABORT, 'Finish or reconcile the pending Task/Chat pair before deleting its project');
END;
