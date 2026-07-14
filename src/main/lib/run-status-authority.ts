import { eq, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { agentRuns, subChats } from "./db"
import type * as schema from "./db/schema"

type AppDatabase = BetterSQLite3Database<typeof schema>

/**
 * A terminal run may update the conversation status only when no other queued
 * or running run owns that conversation. This keeps stale completions from
 * overwriting the state of a newer authoritative run.
 */
export function updateSubChatRunStatusIfAuthoritative(
  db: AppDatabase,
  input: { runId: string; subChatId: string; status: string; updatedAt?: Date },
): boolean {
  const updated = db
    .update(subChats)
    .set({
      runStatus: sql<string>`COALESCE((
        SELECT status FROM agent_runs
        WHERE sub_chat_id = ${input.subChatId}
          AND id <> ${input.runId}
          AND status IN ('pending', 'running')
        ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
        LIMIT 1
      ), ${input.status})`,
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    })
    .where(eq(subChats.id, input.subChatId))
    .returning({ runStatus: subChats.runStatus })
    .get()
  return updated?.runStatus === input.status
}
