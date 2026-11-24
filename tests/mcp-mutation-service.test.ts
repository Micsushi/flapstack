import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMcpReadService } from "../src/main/lib/mcp-control/read-service"
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
  it("registers an external project once and binds its filesystem identity", async () => {
    const folder = join(directory, "new-project")
    mkdirSync(folder)
    execFileSync("git", ["init", "--quiet", folder], { windowsHide: true })
    execFileSync(
      "git",
      ["-C", folder, "remote", "add", "origin", "https://github.com/example/project.git"],
      { windowsHide: true },
    )
    const service = createMcpMutationService(path)
    const caller = {
      callerKind: "external-owner" as const,
      chatId: "external-owner:grant",
      permissionMode: "full-access" as const,
    }
    const first = await service.invoke("create_project", caller, {
      path: folder,
      name: "Named project",
    })
    expect(first).toMatchObject({
      ok: true,
      data: { created: true, name: "Named project", gitProvider: "github" },
    })
    const again = await service.invoke("create_project", caller, { path: folder })
    expect(again).toMatchObject({ ok: true, data: { created: false, name: "Named project" } })
    expect(
      sqlite
        .prepare(
          "SELECT name FROM projects p JOIN filesystem_root_registrations f ON p.path=f.path WHERE p.name='Named project'",
        )
        .get(),
    ).toEqual({ name: "Named project" })
    expect(
      await service.invoke("create_project", { chatId: "chat-project" }, { path: folder }),
    ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
  })

  it("moves a global owner's thread to a different checkout; scoped callers need an exact desktop approval", async () => {
    const service = createMcpMutationService(path)
    const owner = { callerKind: "external-owner" as const, chatId: "external-owner:grant" }
    const caller = { chatId: "chat-project", projectId: "project-1" }
    sqlite
      .prepare(
        "UPDATE chats SET worktree_path='/tmp/private-custom-checkout' WHERE id='chat-project-target'",
      )
      .run()
    const request = { id: "chat-project-target", scope: "project", projectId: "project-2" }
    expect(
      await service.invoke("move_chat", caller, request, { invocationId: "a", approved: true }),
    ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
    expect(
      await service.invoke("move_chat", caller, request, {
        invocationId: "b",
        approved: true,
        desktopApproved: true,
      }),
    ).toMatchObject({ ok: true })
    expect(
      sqlite.prepare("SELECT project_id,worktree_path FROM chats WHERE id=?").get(request.id),
    ).toEqual({ project_id: "project-2", worktree_path: "/tmp/other" })
    expect(
      await service.invoke("move_chat", owner, { ...request, projectId: "project-1" }),
    ).toMatchObject({ ok: true })
    expect(
      sqlite.prepare("SELECT project_id,worktree_path FROM chats WHERE id=?").get(request.id),
    ).toEqual({ project_id: "project-1", worktree_path: "/tmp/project" })
  })

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

  it("rejects task identity on project-scoped create and move operations", async () => {
    const service = createMcpMutationService(path)
    const caller = { chatId: "chat-project", permissionMode: "full-access" as const }

    await expect(
      service.invoke("create_chat", caller, {
        name: "Malformed scope",
        scope: "project",
        projectId: "project-1",
        taskId: "task-2",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })
    await expect(
      service.invoke("move_chat", caller, {
        id: "chat-project-target",
        scope: "project",
        projectId: "project-1",
        taskId: "task-2",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })

    expect(
      sqlite
        .prepare("SELECT scope, project_id, task_id FROM chats WHERE id = ?")
        .get("chat-project-target"),
    ).toEqual({ scope: "project", project_id: "project-1", task_id: null })

    await expect(
      service.invoke("create_chat", caller, {
        name: "Matching task scope",
        scope: "task",
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      service.invoke("create_chat", caller, {
        name: "Mismatched task scope",
        scope: "task",
        projectId: "project-2",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })
  })

  it("fails closed for a legacy noncanonical caller scope", async () => {
    sqlite.prepare("UPDATE chats SET task_id = 'task-2' WHERE id = 'chat-project'").run()
    const service = createMcpMutationService(path)

    await expect(
      service.invoke(
        "create_chat",
        { chatId: "chat-project", permissionMode: "full-access" },
        { name: "Must not create", scope: "project", projectId: "project-1" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-caller" } })
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

  it("does not retain the legacy automation scaffold in the generic mutation service", async () => {
    const result = await createMcpMutationService(path).invoke(
      "create_automation_draft",
      { chatId: "chat-1", permissionMode: "full-access" },
      { name: "Daily review", trigger: "schedule" },
    )
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } })
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

  it("registers an idempotent agent-only wait for the active caller run", async () => {
    sqlite.prepare("UPDATE chats SET harness = 'codex' WHERE id = 'chat-1'").run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-caller', 'chat-1', 'codex', 'full-access', '[]')",
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, sub_chat_id, harness, permission_mode, status,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot
        ) VALUES ('run-caller', 'chat-1', 'sub-caller', 'codex', 'full-access', 'running',
          1, 'codex-enhanced', 'product', 'codex', 'test-adapter', 'test-protocol', '{}', '{}')`,
      )
      .run()
    const service = createMcpMutationService(path)
    const input = { targetChatIds: ["chat-2"], idempotencyKey: "wait-for-target" }

    const first = await service.invoke(
      "wait_for_chats",
      { chatId: "chat-1", runId: "run-caller" },
      input,
    )
    const second = await service.invoke(
      "wait_for_chats",
      { chatId: "chat-1", runId: "run-caller" },
      input,
    )

    expect(first).toMatchObject({
      ok: true,
      data: { created: true, state: "waiting", targetChatIds: ["chat-2"] },
    })
    expect(second).toMatchObject({ ok: true, data: { created: false } })
    expect(sqlite.prepare("SELECT count(*) count FROM chat_waits").get()).toEqual({ count: 1 })
    expect(
      await service.invoke(
        "wait_for_chats",
        { chatId: "chat-1", runId: "run-caller" },
        { targetChatIds: ["chat-1"], idempotencyKey: "self-wait" },
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } })
  })

  it("never tells the agent to stop when replaying an already settled wait", async () => {
    sqlite.prepare("UPDATE chats SET harness = 'codex' WHERE id = 'chat-1'").run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages) VALUES ('sub-caller', 'chat-1', 'codex', 'full-access', '[]')",
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, sub_chat_id, harness, permission_mode, status,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot
        ) VALUES ('run-caller', 'chat-1', 'sub-caller', 'codex', 'full-access', 'running',
          1, 'codex-enhanced', 'product', 'codex', 'test-adapter', 'test-protocol', '{}', '{}')`,
      )
      .run()
    const service = createMcpMutationService(path)
    const input = { targetChatIds: ["chat-2"], idempotencyKey: "settled-replay" }

    const first = await service.invoke(
      "wait_for_chats",
      { chatId: "chat-1", runId: "run-caller" },
      input,
    )
    expect(first).toMatchObject({ ok: true, data: { state: "waiting", active: true } })
    if (!first.ok) throw new Error("Expected the first wait registration to succeed")
    expect(String(first.data.instruction)).toContain("Stop this turn now")

    sqlite.prepare("UPDATE chat_waits SET status = 'failed', error = 'target vanished'").run()
    const replay = await service.invoke(
      "wait_for_chats",
      { chatId: "chat-1", runId: "run-caller" },
      input,
    )

    expect(replay).toMatchObject({
      ok: true,
      data: { created: false, state: "failed", active: false },
    })
    if (!replay.ok) throw new Error("Expected the replay to succeed")
    expect(String(replay.data.instruction)).not.toContain("Stop this turn now")
    expect(String(replay.data.instruction)).toContain("Continue this turn")
    expect(sqlite.prepare("SELECT count(*) count FROM chat_waits").get()).toEqual({ count: 1 })
  })

  it("queues launch_run for API-provider chats with their selected model", async () => {
    sqlite
      .prepare(
        "UPDATE chats SET harness = 'openrouter', model = 'anthropic/claude-sonnet-4' WHERE id = 'chat-2'",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, model, permission_mode, messages) VALUES ('sub-openrouter', 'chat-2', 'openrouter', 'anthropic/claude-sonnet-4', 'full-access', '[]')",
      )
      .run()
    const result = await createMcpMutationService(path).invoke(
      "launch_run",
      { chatId: "chat-1" },
      {
        chatId: "chat-2",
        initialPrompt: "Review through OpenRouter.",
        idempotencyKey: "launch-openrouter",
      },
    )
    expect(result).toMatchObject({ ok: true, data: { created: true } })
    expect(sqlite.prepare("SELECT harness, model, status FROM agent_runs").get()).toEqual({
      harness: "openrouter",
      model: "anthropic/claude-sonnet-4",
      status: "pending",
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
      expect.arrayContaining(["allowed", "dispatch-started", "completed", "failed"]),
    )
    expect(new Set(audit.map((row) => row.invocation_id)).size).toBe(1)
    approvals.shutdown()
  })
})
