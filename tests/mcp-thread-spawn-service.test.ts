import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import {
  drainPendingAgentRuns,
  recoverInterruptedMcpRuns,
} from "../src/main/lib/run-launch-service"
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
    ["cursor-root", "cursor-agent"],
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
  it("creates durable Codex-to-Claude and Claude-to-Codex threads with resolved lineage", async () => {
    const service = createMcpMutationService(path)
    const codexToClaude = await service.invoke(
      "spawn_thread",
      { chatId: "codex-root", permissionMode: "full-access" },
      {
        targetHarness: "claude-code",
        reasoningEffort: "medium",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "full-access" },
        worktree: { strategy: "inherit" },
        launch: { initialPrompt: "Review this change." },
      },
    )
    const claudeToCodex = await service.invoke(
      "spawn_thread",
      { chatId: "claude-root", permissionMode: "full-access" },
      {
        targetHarness: "codex",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "read-only" },
        worktree: { strategy: "existing", worktreeId: "claude-root" },
        launch: { initialPrompt: "Implement this change." },
      },
    )

    if (!codexToClaude.ok) throw new Error(codexToClaude.error.message)
    if (!claudeToCodex.ok) throw new Error(claudeToCodex.error.message)

    expect(
      sqlite
        .prepare(
          `SELECT r.reasoning_effort run, c.reasoning_effort chat, s.reasoning_effort conversation,
      json_extract(r.runtime_control_snapshot,'$.modelEffort') frozen FROM agent_runs r JOIN chats c ON c.id=r.chat_id
      JOIN sub_chats s ON s.id=r.sub_chat_id WHERE r.id=?`,
        )
        .get(codexToClaude.data.runId),
    ).toEqual({ run: "medium", chat: "medium", conversation: "medium", frozen: "medium" })

    expect(codexToClaude).toMatchObject({ ok: true, data: { launch: { status: "pending" } } })
    expect(claudeToCodex).toMatchObject({ ok: true, data: { launch: { status: "pending" } } })
    expect(
      sqlite
        .prepare(
          `SELECT r.initial_prompt, s.messages
           FROM agent_runs r JOIN sub_chats s ON s.id = r.sub_chat_id
           ORDER BY r.harness`,
        )
        .all(),
    ).toEqual([
      { initial_prompt: "Review this change.", messages: "[]" },
      { initial_prompt: "Implement this change.", messages: "[]" },
    ])
    const launched: string[] = []
    expect(
      await drainPendingAgentRuns(path, async (run) => {
        launched.push(run.harness)
      }),
    ).toBe(2)
    expect(launched.sort()).toEqual(["claude-code", "codex"])
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

  it("fails an interrupted direct MCP run without replay when no recovery authority exists", async () => {
    const result = await createMcpMutationService(path).invoke(
      "spawn_thread",
      { chatId: "codex-root", permissionMode: "full-access" },
      {
        targetHarness: "claude-code",
        scope: { kind: "task", projectId: "project-1", taskId: "task-1" },
        permission: { mode: "full-access" },
        worktree: { strategy: "inherit" },
        launch: { initialPrompt: "Resume after restart." },
      },
    )
    expect(result.ok).toBe(true)
    await drainPendingAgentRuns(path, async () => undefined)
    expect(sqlite.prepare("SELECT status FROM agent_runs").get()).toEqual({ status: "running" })

    expect(await recoverInterruptedMcpRuns(path)).toBe(0)
    expect(sqlite.prepare("SELECT status FROM agent_runs").get()).toEqual({ status: "failure" })
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE run_status IS NOT NULL").get(),
    ).toEqual({ run_status: "failure" })
  })
})
