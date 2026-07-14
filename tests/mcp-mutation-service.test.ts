import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { appendMcpAuditRecord } from "../src/main/lib/mcp-control/audit-storage"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { drainPendingAgentRuns } from "../src/main/lib/run-launch-service"
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

  it("stores MCP-created chat timestamps in Drizzle's Unix-second format", async () => {
    const result = await createMcpMutationService(path).invoke(
      "create_chat",
      { chatId: "chat-1", permissionMode: "full-access" },
      { name: "Timestamp-safe", scope: "task", taskId: "task-1", harness: "codex" },
    )
    expect(result).toMatchObject({ ok: true, data: { created: true } })
    if (!result.ok) throw new Error("Expected chat creation to succeed")

    const database = drizzle(sqlite, { schema })
    const chat = database
      .select()
      .from(schema.chats)
      .where(eq(schema.chats.id, String(result.data.id)))
      .get()
    expect(chat?.createdAt).toBeInstanceOf(Date)
    expect(chat?.updatedAt).toBeInstanceOf(Date)
    expect(Math.abs((chat?.updatedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000)
  })

  it("allows task callers to move chats within their task but not out of it", async () => {
    const service = createMcpMutationService(path)
    await expect(
      service.invoke(
        "move_chat",
        { chatId: "chat-1" },
        { id: "chat-2", scope: "task", taskId: "task-1" },
      ),
    ).resolves.toMatchObject({ ok: true, data: { moved: true } })
    await expect(
      service.invoke(
        "move_chat",
        { chatId: "chat-1" },
        { id: "chat-2", scope: "project", projectId: "project-1" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "out-of-scope" } })
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

  it("queues launch_run once for an idempotency key", async () => {
    sqlite.prepare("UPDATE chats SET harness = 'codex' WHERE id = 'chat-2'").run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-2', 'chat-2', 'codex', 'full-access', '[]')",
      )
      .run()
    const service = createMcpMutationService(path)
    const input = {
      chatId: "chat-2",
      initialPrompt: "Run the tests.",
      idempotencyKey: "launch-1",
    }
    const first = await service.invoke("launch_run", { chatId: "chat-1" }, input)
    const second = await service.invoke("launch_run", { chatId: "chat-1" }, input)

    expect(first).toMatchObject({ ok: true, data: { created: true } })
    expect(second).toMatchObject({ ok: true, data: { created: false } })
    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
    expect(sqlite.prepare("SELECT status, initial_prompt FROM agent_runs").get()).toEqual({
      status: "pending",
      initial_prompt: "Run the tests.",
    })
    expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-2'").get()).toEqual({
      messages: "[]",
    })
  })

  it("keeps the queued custom-permission snapshot after the chat changes", async () => {
    const original = {
      schemaVersion: 1,
      projectWrite: true,
      shell: true,
      network: false,
      git: true,
      browser: false,
      secrets: false,
      subagents: false,
      thirdPartyMcp: false,
      productMcpRead: true,
      productMcpWrite: true,
      productMcpTier3: true,
    }
    sqlite
      .prepare(
        "UPDATE chats SET harness = 'codex', permission_mode = 'custom', custom_permissions = ? WHERE id = 'chat-2'",
      )
      .run(JSON.stringify(original))
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-2', 'chat-2', 'codex', 'custom', '[]')",
      )
      .run()
    await createMcpMutationService(path).invoke(
      "launch_run",
      { chatId: "chat-1" },
      {
        chatId: "chat-2",
        initialPrompt: "Keep approved permissions.",
        idempotencyKey: "custom-snapshot",
      },
    )
    sqlite
      .prepare("UPDATE chats SET custom_permissions = ? WHERE id = 'chat-2'")
      .run(JSON.stringify({ ...original, shell: false, productMcpTier3: false }))

    const launched: Array<{ customPermissions: string | null }> = []
    await drainPendingAgentRuns(
      path,
      async (run) => {
        launched.push(run)
      },
      { waitForCompletion: true },
    )

    expect(JSON.parse(launched[0]!.customPermissions!)).toEqual(original)
    expect(sqlite.prepare("SELECT custom_permissions FROM agent_runs").get()).toEqual({
      custom_permissions: JSON.stringify(original),
    })
  })

  it("fails closed when a custom-mode conversation has no custom capability snapshot", async () => {
    sqlite
      .prepare(
        "UPDATE chats SET harness = 'codex', permission_mode = 'custom', custom_permissions = NULL WHERE id = 'chat-2'",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-2', 'chat-2', 'codex', 'custom', '[]')",
      )
      .run()

    await expect(
      createMcpMutationService(path).invoke(
        "launch_run",
        { chatId: "chat-1" },
        { chatId: "chat-2", initialPrompt: "Do not widen access.", idempotencyKey: "missing" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "permission-denied" } })
    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
  })

  it("gates launch_run and correlates execution failure to its audit invocation", async () => {
    sqlite.prepare("UPDATE chats SET harness = 'claude-code' WHERE id = 'chat-2'").run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-2', 'chat-2', 'claude-code', 'full-access', '[]')",
      )
      .run()
    const approvals = new McpApprovalLifecycle()
    const database = drizzle(sqlite, { schema })
    const pending = invokeMcpControlTool(
      "launch_run",
      { chatId: "chat-1", permissionMode: "full-access" },
      { chatId: "chat-2", initialPrompt: "Run it.", idempotencyKey: "approved-launch" },
      undefined,
      {
        approvals,
        approvalId: () => "launch-approval",
        mutations: createMcpMutationService(path),
        audit: { append: (record) => appendMcpAuditRecord(database, record) },
      },
    )
    approvals.approve("launch-approval")
    await expect(pending).resolves.toMatchObject({ ok: true, data: { created: true } })
    await drainPendingAgentRuns(
      path,
      async () => {
        throw new Error("claude unavailable")
      },
      { waitForCompletion: true },
    )

    const audit = sqlite
      .prepare(
        "SELECT invocation_id, status FROM mcp_audit_records WHERE tool_name = 'launch_run' ORDER BY created_at, id",
      )
      .all() as Array<{ invocation_id: string; status: string }>
    expect(audit.map((row) => row.status)).toEqual(
      expect.arrayContaining(["approval-required", "dispatch-started", "completed", "failed"]),
    )
    expect(new Set(audit.map((row) => row.invocation_id)).size).toBe(1)
    approvals.shutdown()
  })
})
