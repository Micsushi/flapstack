import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { buildRecordTaskRunContext } from "../src/main/lib/project-records/run-context"

let root: string
let sqlite: Database.Database
let db: ReturnType<typeof drizzle<typeof schema>>
const endpoint = "http://127.0.0.1:1234"
const path = "projects/flapstack/features.md"
const record = {
  id: "TASK-1",
  title: "Current title",
  kind: "task" as const,
  state: "in_progress",
  history: [],
  description: "Updated task details",
  projects: [{ id: "flapstack" }],
  workSpec: { acceptance: ["One reviewed change"] },
  sourceLinks: ["docs/task.md"],
  dependencies: [],
  executionAuthorization: { secret: "desktop-authority-must-never-leak" },
}
const read = vi.fn()
const connect = vi.fn(async () => ({ endpoint, read }))
const build = () => buildRecordTaskRunContext(db, { chatId: "chat", cwd: root }, connect)
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-record-context-")))
  sqlite = new Database(":memory:")
  db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolve("drizzle") })
  db.insert(schema.projects).values({ id: "project", name: "Project", path: root }).run()
  db.insert(schema.chats)
    .values({ id: "chat", name: "Task", projectId: "project", worktreePath: root })
    .run()
  db.insert(schema.recordTaskWorktrees)
    .values({
      id: "link",
      endpoint,
      recordPath: path,
      recordId: "TASK-1",
      canonicalProjectId: "flapstack",
      localProjectId: "project",
      sourceRevision: "a".repeat(64),
      claimId: "old-claim",
      chatId: "chat",
      worktreePath: root,
      branch: "codex/task",
      baseCommit: "a".repeat(40),
    })
    .run()
  const stat = statSync(root, { bigint: true })
  sqlite
    .prepare(
      "INSERT INTO filesystem_root_registrations(path,canonical_path,device_id,inode_id,bound_at) VALUES(?,?,?,?,0)",
    )
    .run(root, root, String(stat.dev), String(stat.ino))
  read
    .mockReset()
    .mockResolvedValue({ path, revision: "b".repeat(64), document: { records: [record] } })
  connect.mockClear()
})
afterEach(() => {
  sqlite.close()
  rmSync(root, { recursive: true, force: true })
})

it("reads fresh task context every turn without copying authority or replaying stored messages", async () => {
  const first = await build()
  expect(first).toContain('>   "recordId": "TASK-1"')
  expect(first).toContain("Updated task details")
  expect(first).toContain("b".repeat(64))
  expect(first).not.toContain("desktop-authority-must-never-leak")
  expect(first).not.toContain("old-claim")
  read.mockResolvedValue({
    path,
    revision: "c".repeat(64),
    document: { records: [{ ...record, title: "Changed again" }] },
  })
  expect(await build()).toContain("Changed again")
  expect(read).toHaveBeenCalledTimes(2)
})
it("does not connect for unrelated chats", async () => {
  sqlite.prepare("DELETE FROM record_task_worktrees").run()
  expect(await build()).toBe("")
  expect(connect).not.toHaveBeenCalled()
})
it("rejects changed chat or run workspace before reading task data", async () => {
  await expect(
    buildRecordTaskRunContext(db, { chatId: "chat", cwd: join(root, "other") }, connect),
  ).rejects.toThrow("workspace changed")
  sqlite.prepare("UPDATE chats SET worktree_path=NULL WHERE id='chat'").run()
  await expect(build()).rejects.toThrow("workspace changed")
  expect(connect).not.toHaveBeenCalled()
})
it("rejects a different Records connection", async () => {
  await expect(
    buildRecordTaskRunContext(db, { chatId: "chat", cwd: root }, async () => ({
      endpoint: "http://127.0.0.1:9999",
      read,
    })),
  ).rejects.toThrow("different Project Records")
  expect(read).not.toHaveBeenCalled()
})
it.each([
  { ...record, projects: [{ id: "another-project" }] },
  { ...record, id: "TASK-2" },
  { ...record, kind: "question" },
])("rejects unavailable or reassigned task identity", async (changed) => {
  read.mockResolvedValue({ path, revision: "b".repeat(64), document: { records: [changed] } })
  await expect(build()).rejects.toThrow("no longer available")
})
it("fails closed when current Records cannot be read", async () => {
  read.mockRejectedValue(new Error("Records unavailable"))
  await expect(build()).rejects.toThrow("Records unavailable")
})
it("rejects oversized context instead of silently dropping work instructions", async () => {
  read.mockResolvedValue({
    path,
    revision: "b".repeat(64),
    document: { records: [{ ...record, description: "x".repeat(32_001) }] },
  })
  await expect(build()).rejects.toThrow("too large")
})

it("rejects secret-like content in allowed task fields", async () => {
  read.mockResolvedValue({
    path,
    revision: "b".repeat(64),
    document: {
      records: [
        { ...record, description: "Authorization: Bearer fixture-token-not-a-real-secret" },
      ],
    },
  })
  await expect(build()).rejects.toThrow("secret-like content")
})
