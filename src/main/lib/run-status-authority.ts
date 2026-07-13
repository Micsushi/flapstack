import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
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
  const competingRun = db
    .select({ id: agentRuns.id, status: agentRuns.status })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.subChatId, input.subChatId),
        ne(agentRuns.id, input.runId),
        inArray(agentRuns.status, ["pending", "running"]),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${agentRuns.status} = 'running' THEN 0 ELSE 1 END`,
      asc(agentRuns.startedAt),
      asc(agentRuns.id),
    )
    .limit(1)
    .get()

  db.update(subChats)
    .set({
      runStatus: competingRun?.status ?? input.status,
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    })
    .where(eq(subChats.id, input.subChatId))
    .run()
  return !competingRun
}
