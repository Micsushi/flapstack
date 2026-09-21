ALTER TABLE `agent_runs` ADD `runtime_launch_identity` text CHECK (`runtime_launch_identity` IS NULL OR json_valid(`runtime_launch_identity`));--> statement-breakpoint
CREATE TRIGGER `agent_runs_runtime_launch_identity_immutable`
BEFORE UPDATE OF `runtime_launch_identity` ON `agent_runs`
WHEN OLD.`runtime_launch_identity` IS NOT NULL AND NEW.`runtime_launch_identity` IS NOT OLD.`runtime_launch_identity`
BEGIN
  SELECT RAISE(ABORT, 'Runtime launch identity is immutable');
END;
