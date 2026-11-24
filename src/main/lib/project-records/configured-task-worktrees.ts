import { homedir } from "node:os"
import { join } from "node:path"
import { getSqliteDatabase } from "../db"
import { createWorktree } from "../git/worktree"
import { bindFilesystemRootIdentity } from "../git/security/path-validation"
import { configuredProjectRecordsClient } from "./client"
import { RecordTaskWorktreeService } from "./task-worktree"

export async function configuredRecordTaskWorktrees() {
  const client = await configuredProjectRecordsClient()
  return new RecordTaskWorktreeService(
    getSqliteDatabase(),
    client,
    client.endpoint,
    join(process.env.FLAPSTACK_CONFIG_DIR || join(homedir(), ".flapstack"), "worktrees", "records"),
    createWorktree,
    bindFilesystemRootIdentity,
  )
}
