CREATE TABLE agent_run_timing_marks (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id, phase, item_id)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER agent_run_timing_start AFTER INSERT ON agent_runs
WHEN NEW.completed_at IS NULL AND NEW.status IN ('pending','running')
BEGIN
  INSERT INTO agent_run_timing_marks(run_id,phase,at_ms)
  VALUES (NEW.id,'start',CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER agent_run_timing_end AFTER UPDATE OF completed_at ON agent_runs
WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO agent_run_timing_marks(run_id,phase,at_ms)
  VALUES (NEW.id,'end',CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER));
END;
--> statement-breakpoint
ALTER TABLE checkpoints ADD COLUMN sdk_message_uuid TEXT;
--> statement-breakpoint
CREATE INDEX checkpoints_sdk_message ON checkpoints(worktree_path,sdk_message_uuid)
WHERE sdk_message_uuid IS NOT NULL;
