import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-thread-spawn-"))
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
  for (const [id, harness] of [
    ["codex-root", "codex"],
    ["claude-root", "claude-code"],
  ]) {
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode, harness,
          worktree_path, branch, initiator_chat_id, ancestor_chat_ids)
         VALUES (?, ?, 'task', 'project-1', 'task-1', 'full-access', ?, '/tmp/project-worktree',
          'main', ?, '[]')`,
      )
      .run(id, `${harness} root`, harness, id)
  }
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP cross-harness thread spawn service", () => {
  it("uses the Tier 3 approval and audit invoker before dispatching", async () => {
    const approvals = new McpApprovalLifecycle()
    const statuses: string[] = []
    const result = invokeMcpControlTool(
      "spawn_thread",
      { chatId: "codex-root", permissionMode: "full-access" },
      {
        targetHarness: "claude-code",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "read-only" },
        worktree: { strategy: "none" },
      },
      undefined,
      {
        approvals,
        approvalId: () => "spawn-approval",
        mutations: createMcpMutationService(path),
        audit: { append: (record) => statuses.push(record.status) },
      },
    )
    approvals.approve("spawn-approval")

    await expect(result).resolves.toMatchObject({
      ok: true,
      data: { launch: { status: "not-requested" } },
    })
    expect(statuses).toEqual(["approval-required", "allowed", "completed"])
    approvals.shutdown()
  })

  it("creates durable Codex-to-Claude and Claude-to-Codex threads with resolved lineage", async () => {
    const service = createMcpMutationService(path, { launchThread: () => undefined })
    const codexToClaude = await service.invoke(
      "spawn_thread",
      { chatId: "codex-root" },
      {
        targetHarness: "claude-code",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "full-access" },
        worktree: { strategy: "inherit" },
        launch: { initialPrompt: "Review this change." },
      },
    )
    const claudeToCodex = await service.invoke(
      "spawn_thread",
      { chatId: "claude-root" },
      {
        targetHarness: "codex",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "read-only" },
        worktree: { strategy: "existing", worktreeId: "claude-root" },
      },
    )

    if (!codexToClaude.ok) throw new Error(codexToClaude.error.message)
    if (!claudeToCodex.ok) throw new Error(claudeToCodex.error.message)

    expect(codexToClaude).toMatchObject({ ok: true, data: { launch: { status: "running" } } })
    expect(claudeToCodex).toMatchObject({ ok: true, data: { launch: { status: "not-requested" } } })
    const spawned = sqlite
      .prepare(
        "SELECT harness, permission_mode, parent_chat_id, initiator_chat_id, ancestor_chat_ids, worktree_path FROM chats WHERE parent_chat_id IS NOT NULL ORDER BY harness",
      )
      .all()
    expect(spawned).toEqual([
      expect.objectContaining({
        harness: "claude-code",
        permission_mode: "full-access",
        parent_chat_id: "codex-root",
        initiator_chat_id: "codex-root",
        ancestor_chat_ids: '["codex-root"]',
        worktree_path: "/tmp/project-worktree",
      }),
      expect.objectContaining({
        harness: "codex",
        permission_mode: "read-only",
        parent_chat_id: "claude-root",
        initiator_chat_id: "claude-root",
        ancestor_chat_ids: '["claude-root"]',
      }),
    ])
  })

  it("keeps the created thread and failed first run durable when a harness launch fails", async () => {
    const service = createMcpMutationService(path, {
      launchThread: () => {
        throw new Error("harness unavailable")
      },
    })
    const result = await service.invoke(
      "spawn_thread",
      { chatId: "codex-root" },
      {
        targetHarness: "claude-code",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "full-access" },
        worktree: { strategy: "inherit" },
        launch: { initialPrompt: "Run the check." },
      },
    )

    if (result.ok) throw new Error("Expected harness launch failure.")

    expect(result).toMatchObject({ ok: false, error: { code: "internal-error" } })
    expect(
      sqlite.prepare("SELECT count(*) count FROM chats WHERE parent_chat_id = 'codex-root'").get(),
    ).toEqual({ count: 1 })
    expect(
      sqlite
        .prepare("SELECT status, completed_at FROM agent_runs ORDER BY started_at DESC LIMIT 1")
        .get(),
    ).toEqual(expect.objectContaining({ status: "failure" }))
  })
})
