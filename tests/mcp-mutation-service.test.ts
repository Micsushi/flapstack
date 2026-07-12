import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-mutations-"))
  path = join(directory, "agents.db")
  sqlite = new Database(path)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      "INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', '/tmp/project')",
    )
    .run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode) VALUES ('chat-1', 'Caller', 'task', 'project-1', 'task-1', 'full-access')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode) VALUES ('chat-2', 'Target', 'task', 'project-1', 'task-1', 'full-access')",
    )
    .run()
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP mutation service", () => {
  it("creates idempotently and never expands the caller task scope", async () => {
    const service = createMcpMutationService(path)
    const caller = { chatId: "chat-1", permissionMode: "full-access" as const }

    const first = await service.invoke("create_task", caller, { name: "Follow-up" })
    const second = await service.invoke("create_task", caller, { name: "Follow-up" })
    const outside = await service.invoke("create_task", caller, {
      projectId: "other-project",
      name: "Escape",
    })

    expect(first).toMatchObject({ ok: true, data: { created: true } })
    expect(second).toMatchObject({ ok: true, data: { created: false } })
    expect(outside).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
    expect(
      sqlite.prepare("SELECT count(*) count FROM tasks WHERE name = 'Follow-up'").get(),
    ).toEqual({ count: 1 })
  })

  it("makes archive and restore safe to retry and rejects stale targets", async () => {
    const service = createMcpMutationService(path)
    const caller = { chatId: "chat-1", permissionMode: "full-access" as const }

    await expect(
      service.invoke("archive_item", caller, { kind: "chat", id: "chat-2" }),
    ).resolves.toMatchObject({ ok: true, data: { changed: true } })
    await expect(
      service.invoke("archive_item", caller, { kind: "chat", id: "chat-2" }),
    ).resolves.toMatchObject({ ok: true, data: { changed: false } })
    await expect(
      service.invoke("restore_item", caller, { kind: "chat", id: "missing" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-target" } })
  })

  it("keeps automation drafts non-runnable", async () => {
    const result = await createMcpMutationService(path).invoke(
      "create_automation_draft",
      { chatId: "chat-1", permissionMode: "full-access" },
      { name: "Daily review", trigger: "schedule" },
    )
    expect(result).toMatchObject({ ok: true, data: { runnable: false } })
  })
})
