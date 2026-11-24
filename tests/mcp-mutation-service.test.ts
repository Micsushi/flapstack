import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMcpReadService } from "../src/main/lib/mcp-control/read-service"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
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
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-2', 'Other', '/tmp/other')")
    .run()
  sqlite
    .prepare(
      "INSERT INTO tasks (id, project_id, name) VALUES ('task-2', 'project-2', 'Other task')",
    )
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
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, project_id, permission_mode) VALUES ('chat-project', 'Project caller', 'project', 'project-1', 'full-access')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, project_id, permission_mode) VALUES ('chat-project-target', 'Project target', 'project', 'project-1', 'full-access')",
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

  it("keeps a chat across turns, freezes overrides on the run and returns only visible replies", async () => {
    const caller = { chatId: "chat-1", permissionMode: "full-access" as const }
    const service = createMcpMutationService(path)
    const read = createMcpReadService({
      get: (sql, params) =>
        sqlite.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      all: (sql, params) => sqlite.prepare(sql).all(...params) as Record<string, unknown>[],
    })
    const created = await service.invoke("create_chat", caller, {
      name: "Two turns",
      scope: "task",
      taskId: "task-1",
      harness: "codex",
      model: "sol",
      reasoningEffort: "high",
    })
    if (!created.ok) throw new Error(created.error.message)
    const chatId = String(created.data.id)
    const request = { chatId, initialPrompt: "First turn", idempotencyKey: "first" }
    const first = await service.invoke("launch_run", caller, request)
    if (!first.ok) throw new Error(first.error.message)
    expect(
      await service.invoke("update_chat_settings", caller, {
        chatId,
        model: "changed",
        reasoningEffort: "low",
      }),
    ).toMatchObject({ ok: true })
    expect(
      await service.invoke("update_chat_settings", caller, { chatId, harness: "claude-code" }),
    ).toMatchObject({ error: { code: "conflict" } })
    await drainPendingAgentRuns(
      path,
      async (run) => {
        expect(run).toMatchObject({
          chatId,
          model: "sol",
          reasoningEffort: "high",
          runtimeLaunch: { controls: { modelEffort: "high" } },
        })
        sqlite
          .prepare("UPDATE agent_runs SET status='success',completed_at=unixepoch() WHERE id=?")
          .run(run.runId)
        sqlite
          .prepare("UPDATE sub_chats SET session_id='old-session',messages=? WHERE chat_id=?")
          .run(
            JSON.stringify([
              { id: "u1", role: "user", parts: [{ type: "text", text: "First turn" }] },
              {
                id: "a1",
                role: "assistant",
                parts: [
                  {
                    type: "text",
                    text: "Working",
                    providerMetadata: { runtime: { phase: "commentary" } },
                  },
                  { type: "text", text: "First reply" },
                  { type: "reasoning", text: "hidden" },
                  { type: "tool-lookup", output: "private output" },
                ],
              },
            ]),
            chatId,
          )
      },
      { waitForCompletion: true },
    )
    expect(
      await service.invoke("update_chat_settings", caller, {
        chatId,
        harness: "claude-code",
        model: "sonnet",
        reasoningEffort: "medium",
        chatMode: "plan",
      }),
    ).toMatchObject({ ok: true })
    expect(
      sqlite
        .prepare("SELECT session_id, needs_provider_handoff FROM sub_chats WHERE chat_id=?")
        .get(chatId),
    ).toEqual({ session_id: null, needs_provider_handoff: 1 })
    const turn = {
      chatId,
      idempotencyKey: "second",
      initialPrompt: "Second turn",
      model: "opus",
      reasoningEffort: "max",
    }
    const second = await service.invoke("launch_run", caller, turn)
    if (!second.ok) throw new Error(second.error.message)
    expect(
      await service.invoke("launch_run", caller, { ...turn, reasoningEffort: "low" }),
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } })
    expect(await service.invoke("launch_run", caller, request)).toMatchObject({
      ok: true,
      data: { created: false, runId: first.data.runId },
    })
    await drainPendingAgentRuns(
      path,
      async (run) => {
        expect(run).toMatchObject({
          chatId,
          harness: "claude-code",
          model: "opus",
          reasoningEffort: "max",
          permissionMode: "read-only",
          runtimeLaunch: { controls: { modelEffort: "max" } },
        })
      },
      { waitForCompletion: true },
    )
    sqlite
      .prepare(
        "INSERT INTO record_chat_links (chat_id,store_identity,record_path,record_id,canonical_project_id,source_revision) VALUES (?,?,?,?,?,?)",
      )
      .run(chatId, "private-store", "tasks.md", "R-2", "canon", "rev")
    const page = read.invoke("read_chat", caller, { chatId, limit: 2 })
    expect(page).toMatchObject({
      chat: {
        model: "sonnet",
        reasoningEffort: "medium",
        recordTask: { path: "tasks.md", recordId: "R-2", canonicalProjectId: "canon" },
      },
      items: [
        { id: "a1", text: "First reply", commentary: "Working", tools: ["lookup"] },
        { id: "mcp-second", text: "Second turn" },
      ],
      nextCursor: expect.any(String),
    })
    expect(JSON.stringify(page)).not.toMatch(/hidden|private output/)
    expect(
      read.invoke("read_messages", caller, {
        chatId,
        limit: 1,
        cursor: (page as { nextCursor: string }).nextCursor,
      }),
    ).toMatchObject({ items: [{ id: "u1" }], nextCursor: null })
    expect(read.invoke("read_run", caller, { runId: second.data.runId })).toMatchObject({
      status: "running",
      model: "opus",
      reasoningEffort: "max",
    })
    expect(() => read.invoke("read_chat", caller, { chatId: "chat-project-target" })).toThrow(
      "not-found",
    )
    sqlite
      .prepare("UPDATE agent_runs SET status='success',completed_at=unixepoch() WHERE id=?")
      .run(second.data.runId)
    expect(
      await service.invoke(
        "update_chat_settings",
        { ...caller, permissionMode: "auto-edit-project-only" },
        { chatId, permissionMode: "full-access" },
      ),
    ).toMatchObject({ ok: false, error: { code: "permission-denied" } })
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
      vaultContextSectionIds: ["index", "handoff"] as const,
    }
    const first = await service.invoke("launch_run", { chatId: "chat-1" }, input)
    const second = await service.invoke("launch_run", { chatId: "chat-1" }, input)

    expect(first).toMatchObject({ ok: true, data: { created: true } })
    expect(second).toMatchObject({ ok: true, data: { created: false } })
    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
    expect(
      sqlite.prepare("SELECT status, initial_prompt, vault_context_sections FROM agent_runs").get(),
    ).toEqual({
      status: "pending",
      initial_prompt: "Run the tests.",
      vault_context_sections: '["index","handoff"]',
    })
    expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-2'").get()).toEqual({
      messages: "[]",
    })
  })
})
