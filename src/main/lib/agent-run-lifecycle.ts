import { and, eq, isNull, ne } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { captureCheckpoint, captureRunManifest } from "./checkpoints"
import { agentRuns } from "./db"
import type * as schema from "./db/schema"
import { updateSubChatRunStatusIfAuthoritative } from "./run-status-authority"

type AppDatabase = BetterSQLite3Database<typeof schema>

export function cancelStaleRunningRuns(
  db: AppDatabase,
  input: { runId: string; subChatId: string },
): void {
  db.update(agentRuns)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(agentRuns.subChatId, input.subChatId),
        eq(agentRuns.status, "running"),
        ne(agentRuns.id, input.runId),
      ),
    )
    .run()
}

export async function completeAgentRun(
  db: AppDatabase,
  input: { runId: string; subChatId: string; status: string; logLabel: string },
) {
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  if (!run || run.completedAt) return run

  let afterCheckpointId: string | undefined
  try {
    const after = await captureCheckpoint(run.id, run.worktreePath, "after")
    afterCheckpointId = after.id
    await captureRunManifest(run.id)
  } catch (error) {
    console.warn(`[${input.logLabel}] Failed to capture after checkpoint/manifest:`, error)
  }

  const completedRun = db
    .update(agentRuns)
    .set({
      status: input.status,
      completedAt: new Date(),
      ...(afterCheckpointId ? { afterCheckpointId } : {}),
    })
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.status, "running"),
        isNull(agentRuns.completedAt),
      ),
    )
    .returning()
    .get()

  if (!completedRun) {
    return db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  }

  updateSubChatRunStatusIfAuthoritative(db, {
    runId: input.runId,
    subChatId: input.subChatId,
    status: input.status,
    updatedAt: new Date(),
  })
  return completedRun
}
