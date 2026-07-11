import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { createMcpReadService, type McpReadStore } from "../src/main/lib/mcp-control/read-service"

let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-reads-"))
  sqlite = new Database(join(directory, "agents.db"))
  seed(sqlite)
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP Tier 0 reads", () => {
  it("returns compact scoped DTOs and bounded pagination", async () => {
    const service = createMcpReadService(store(sqlite))
    const caller = { chatId: "chat-a", runId: "run-a", permissionMode: "read-only" }
    const projects = await invokeMcpControlTool("list_projects", caller, { limit: 1 }, service)
    expect(projects).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "project-a",
            name: "Visible",
            archived: false,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    })

    await expect(invokeMcpControlTool("list_tasks", caller, {}, service)).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: "task-a", project: { id: "project-a" } }] },
    })
    await expect(invokeMcpControlTool("list_chats", caller, {}, service)).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: "chat-a", task: { id: "task-a" } }] },
    })

    const runs = await invokeMcpControlTool("list_runs", caller, { limit: 1 }, service)
    expect(runs).toMatchObject({
      ok: true,
      data: { items: [{ id: "run-a", chat: { id: "chat-a" }, status: "success" }] },
    })
    expect(JSON.stringify(runs)).not.toContain("super-secret")

    const worktrees = await invokeMcpControlTool("list_worktrees", caller, {}, service)
    expect(worktrees).toMatchObject({
      ok: true,
      data: { items: [{ path: "/safe/worktree", branch: "feature/a" }] },
    })

    const artifacts = await invokeMcpControlTool("list_artifacts", caller, {}, service)
    expect(artifacts).toMatchObject({
      ok: true,
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "attachment-a",
            kind: "attachment",
            name: "notes.txt",
          }),
        ]),
      },
    })
    expect(JSON.stringify(artifacts)).not.toContain("super-secret")
  })

  it("rejects invalid, excessive, and out-of-scope inputs", async () => {
    const service = createMcpReadService(store(sqlite))
    const caller = { chatId: "chat-a", permissionMode: "read-only" }
    await expect(
      invokeMcpControlTool("list_chats", caller, { limit: 51 }, service),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })
    await expect(
      invokeMcpControlTool("list_tasks", caller, { projectId: "project-b" }, service),
    ).resolves.toEqual({
      ok: false,
      error: { code: "out-of-scope", message: "Project is outside the caller scope." },
    })
    await expect(
      invokeMcpControlTool("list_runs", caller, { chatId: "chat-b" }, service),
    ).resolves.toMatchObject({ ok: false, error: { code: "out-of-scope" } })
    await expect(
      invokeMcpControlTool("search", caller, { query: "   " }, service),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })
  })

  it("searches metadata only and never message or attachment content", async () => {
    const service = createMcpReadService(store(sqlite))
    const caller = { chatId: "chat-a", permissionMode: "read-only" }
    await expect(
      invokeMcpControlTool("search", caller, { query: "Visible chat" }, service),
    ).resolves.toMatchObject({ ok: true, data: { items: [{ id: "chat-a", type: "chat" }] } })
    await expect(
      invokeMcpControlTool("search", caller, { query: "super-secret" }, service),
    ).resolves.toEqual({ ok: true, data: { items: [], nextCursor: null } })
  })
})

function store(db: Database.Database): McpReadStore {
  return {
    get: (sql, params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
  }
}

function seed(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, archived_at INTEGER, updated_at INTEGER);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, status TEXT, archived_at INTEGER, updated_at INTEGER);
    CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, project_id TEXT, task_id TEXT, scope TEXT, harness TEXT, archived_at INTEGER, updated_at INTEGER, worktree_path TEXT, branch TEXT, base_branch TEXT);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, chat_id TEXT, harness TEXT, model TEXT, status TEXT, started_at INTEGER, completed_at INTEGER);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, chat_id TEXT, name TEXT, content_text TEXT, created_at INTEGER);
    CREATE TABLE file_change_manifests (id TEXT PRIMARY KEY, run_id TEXT, file_path TEXT, change_type TEXT, additions INTEGER, deletions INTEGER);
    INSERT INTO projects VALUES ('project-a','Visible',NULL,1767225600000), ('project-b','Hidden',NULL,1767225600000);
    INSERT INTO tasks VALUES ('task-a','project-a','Visible task','active',NULL,1767225600000), ('task-b','project-b','Hidden task','active',NULL,1767225600000);
    INSERT INTO chats VALUES ('chat-a','Visible chat','project-a','task-a','task','codex',NULL,1767225600000,'/safe/worktree','feature/a','main'), ('chat-b','Hidden chat','project-b','task-b','task','claude',NULL,1767225600000,'/hidden/worktree','feature/b','main');
    INSERT INTO agent_runs VALUES ('run-a','chat-a','codex','gpt','success',1767225600000,1767225660000), ('run-b','chat-b','claude','sonnet','success',1767225600000,1767225660000);
    INSERT INTO attachments VALUES ('attachment-a','chat-a','notes.txt','super-secret attachment body',1767225600000), ('attachment-b','chat-b','hidden.txt','hidden',1767225600000);
    INSERT INTO file_change_manifests VALUES ('manifest-a','run-a','src/a.ts','modified',2,1), ('manifest-b','run-b','src/b.ts','modified',2,1);
  `)
}
