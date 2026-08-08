import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("performance query plans", () => {
  it("uses covering indexes for transcript and active sidebar ordering", () => {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): { all(...values: unknown[]): unknown[] }
      }
    }
    const database = new DatabaseSync(":memory:")
    database.exec(`
      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        task_id TEXT,
        scope TEXT,
        archived_at INTEGER,
        pinned_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE sub_chats (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        created_at INTEGER
      );
    `)
    database.exec(readFileSync("drizzle/0054_performance_indexes.sql", "utf8"))
    database.exec(readFileSync("drizzle/0055_sidebar_query_indexes.sql", "utf8"))

    const transcriptPlan = database
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM sub_chats WHERE chat_id = ? ORDER BY created_at")
      .all("chat")
      .map((row) => String((row as { detail: string }).detail))
      .join(" ")
    const sidebarPlan = database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM chats WHERE archived_at IS NULL ORDER BY pinned_at DESC, updated_at DESC",
      )
      .all()
      .map((row) => String((row as { detail: string }).detail))
      .join(" ")
    const projectSidebarPlan = database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM chats WHERE project_id = ? AND archived_at IS NULL ORDER BY pinned_at DESC, updated_at DESC",
      )
      .all("project")
      .map((row) => String((row as { detail: string }).detail))
      .join(" ")

    expect(transcriptPlan).toContain("sub_chats_chat_created_idx")
    expect(transcriptPlan).not.toContain("USE TEMP B-TREE")
    expect(sidebarPlan).toContain("chats_active_pinned_updated_idx")
    expect(sidebarPlan).not.toContain("USE TEMP B-TREE")
    expect(projectSidebarPlan).toContain("chats_project_active_order_idx")
    expect(projectSidebarPlan).not.toContain("USE TEMP B-TREE")
  })
})
