import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
vi.mock("../src/main/lib/permissions", () => ({
  getPermissionPreferences: () => ({ globalDefault: "read-only" }),
}))
import { queueChatRun } from "../src/main/lib/run-launch-service"
let sqlite: Database.Database, directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-queue-target-"))
  sqlite = new Database(join(directory, "test.db"))
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve("drizzle") })
  const root = join(directory, "repo")
  mkdirSync(root)
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({
      id: "chat",
      name: "Chat",
      projectId: "project",
      harness: "codex",
      permissionMode: "read-only",
    })
    .run()
  db.insert(schema.chats)
    .values({ id: "other", name: "Other", projectId: "project", harness: "codex" })
    .run()
  db.insert(schema.subChats)
    .values([
      {
        id: "first",
        chatId: "chat",
        harness: "codex",
        createdAt: new Date(1000),
        permissionMode: "read-only",
      },
      {
        id: "chosen",
        chatId: "chat",
        harness: "claude-code",
        createdAt: new Date(2000),
        permissionMode: "read-only",
      },
      { id: "foreign", chatId: "other", harness: "codex" },
    ])
    .run()
})
afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})
const request = {
  chatId: "chat",
  initialPrompt: "Review this change",
  idempotencyKey: "fixture-key",
}
it("queues the explicitly selected owned conversation with its harness", () => {
  const queued = queueChatRun(sqlite, { ...request, subChatId: "chosen" })
  expect(queued.ok).toBe(true)
  expect(
    sqlite.prepare("SELECT sub_chat_id, harness, permission_mode FROM agent_runs").get(),
  ).toEqual({ sub_chat_id: "chosen", harness: "claude-code", permission_mode: "read-only" })
})
it("rejects a foreign or missing explicit conversation without falling back", () => {
  for (const subChatId of ["foreign", "missing"])
    expect(queueChatRun(sqlite, { ...request, subChatId }).ok).toBe(false)
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
})
it("keeps running status when another run is queued behind it", () => {
  expect(queueChatRun(sqlite, request).ok).toBe(true)
  sqlite.prepare("UPDATE agent_runs SET status = 'running'").run()
  sqlite.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'first'").run()
  expect(queueChatRun(sqlite, { ...request, idempotencyKey: "second" }).ok).toBe(true)
  expect(sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'first'").get()).toEqual({
    run_status: "running",
  })
})
it("retries exactly but rejects reused identity with changed prompt or target", () => {
  const initial = queueChatRun(sqlite, request)
  expect(queueChatRun(sqlite, request)).toMatchObject({ ...initial, created: false })
  expect(queueChatRun(sqlite, { ...request, initialPrompt: "Different" }).ok).toBe(false)
  expect(queueChatRun(sqlite, { ...request, subChatId: "chosen" }).ok).toBe(false)
  expect(queueChatRun(sqlite, { ...request, vaultContextSectionIds: ["changed"] }).ok).toBe(false)
  expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
})
