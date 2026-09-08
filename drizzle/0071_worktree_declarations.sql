CREATE TABLE orchestration_worktree_declarations (
 task_id text NOT NULL REFERENCES task_orchestrations(task_id) ON DELETE cascade,
 run_id text NOT NULL,
 revision integer NOT NULL CHECK(revision > 0),
 declaration text,
 PRIMARY KEY(task_id,run_id,revision)
);
