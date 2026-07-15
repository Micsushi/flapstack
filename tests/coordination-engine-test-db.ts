import {
  coordinationEngineSnapshotSqlValues,
  resolveCoordinationEngine,
} from "../src/main/lib/agent-orchestration/coordination-engine"

export function testCoordinationEngineSnapshotSqlValues(): readonly unknown[] {
  const resolution = resolveCoordinationEngine({})
  if (!resolution.ok) throw new Error(resolution.reason.message)
  return coordinationEngineSnapshotSqlValues(resolution.snapshot)
}
