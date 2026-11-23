import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { runsRouter } from "../src/main/lib/trpc/routers/runs"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-run-recovery-test", isPackaged: false },
}))

let directory = ""
let sqlite: Database.Database | undefined
const previousPath = process.env.FLAPSTACK_DB_PATH
afterEach(() => {
  closeDatabase()
  sqlite?.close()
  if (previousPath === undefined) delete process.env.FLAPSTACK_DB_PATH
  else process.env.FLAPSTACK_DB_PATH = previousPath
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it("reads the latest intent across statuses without crossing chat boundaries or losing timestamp ties", async () => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-run-recovery-"))
  const filename = join(directory, "agents.db")
  sqlite = new Database(filename)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.prepare("INSERT INTO projects (id,name,path) VALUES ('p','Fixture',?)").run(directory)
  for (const chat of ["a", "b"]) {
    sqlite.prepare("INSERT INTO chats (id,project_id) VALUES (?, 'p')").run(chat)
    sqlite.prepare("INSERT INTO sub_chats (id,chat_id) VALUES (?,?)").run(`${chat}-sub`, chat)
  }
  process.env.FLAPSTACK_DB_PATH = filename
  const caller = runsRouter.createCaller({ getWindow: () => null })
  const add = sqlite.prepare(
    "INSERT INTO agent_runs (id,chat_id,sub_chat_id,harness,permission_mode,status,prompt_message_id,started_at,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES (?,?,?,'codex','read-only',?,?,?,?,?,?,?,?,?,?,?)",
  )
  add.run("failed", "a", "a-sub", "failure", "intent", 100, ...testRuntimeSnapshotSqlValues())
  add.run(
    "sibling",
    "b",
    "b-sub",
    "failure",
    "other-intent",
    200,
    ...testRuntimeSnapshotSqlValues(),
  )
  expect(await caller.latestForSubChat({ chatId: "a", subChatId: "a-sub" })).toEqual({
    id: "failed",
    limitKind: null,
    subChatId: "a-sub",
    status: "failure",
    promptMessageId: "intent",
  })
  expect(await caller.latestForSubChat({ chatId: "b", subChatId: "a-sub" })).toBeUndefined()
  for (const status of ["pending", "running", "success", "cancelled", "failure"]) {
    add.run(status, "a", "a-sub", status, "intent", 100, ...testRuntimeSnapshotSqlValues())
    expect(await caller.latestForSubChat({ chatId: "a", subChatId: "a-sub" })).toMatchObject({
      id: status,
      status,
    })
  }
  add.run(
    "later-time",
    "a",
    "a-sub",
    "success",
    "new-intent",
    101,
    ...testRuntimeSnapshotSqlValues(),
  )
  add.run(
    "late-import-old",
    "a",
    "a-sub",
    "failure",
    "old-intent",
    99,
    ...testRuntimeSnapshotSqlValues(),
  )
  expect(await caller.latestForSubChat({ chatId: "a", subChatId: "a-sub" })).toMatchObject({
    id: "later-time",
    status: "success",
    promptMessageId: "new-intent",
  })
})
