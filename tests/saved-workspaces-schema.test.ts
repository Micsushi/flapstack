import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  MAX_SAVED_WORKSPACE_LAYOUT_BYTES,
  MAX_SAVED_WORKSPACE_LAYOUT_DEPTH,
  MAX_SAVED_WORKSPACE_LAYOUT_NODES,
  savedWorkspaceDtoSchema,
  savedWorkspaceLayoutJsonSchema,
  savedWorkspaceLayoutSchema,
  savedWorkspacePaneBindingSchema,
  savedWorkspaceRosterSchema,
  savedWorkspaceScopeSchema,
} from "../src/shared/saved-workspaces"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("saved workspace DTO contracts", () => {
  it.each([
    { type: "chat", chatId: "chat-1" },
    {
      type: "terminal",
      cwd: "/tmp/repo",
      worktreePath: null,
      restorePolicy: "prompt",
    },
    { type: "diff", worktreePath: "/tmp/repo", baseRef: "main", targetRef: "HEAD" },
    { type: "file", path: "src/main.ts", worktreePath: null, line: 12 },
    { type: "browser", url: "https://example.com/docs" },
    { type: "agent-roster", orchestrationId: "orchestration-1" },
    {
      type: "selected-agent",
      orchestrationId: "orchestration-1",
      agentId: "agent-1",
    },
    { type: "activity", orchestrationId: "orchestration-1" },
  ])("accepts the $type pane binding", (binding) => {
    expect(savedWorkspacePaneBindingSchema.safeParse(binding).success).toBe(true)
  })

  it("rejects malformed or unsafe pane bindings", () => {
    expect(
      savedWorkspacePaneBindingSchema.safeParse({ type: "chat", workspaceId: "legacy-chat" })
        .success,
    ).toBe(false)
    expect(
      savedWorkspacePaneBindingSchema.safeParse({
        type: "terminal",
        cwd: "/tmp/repo",
        processId: 123,
      }).success,
    ).toBe(false)
    expect(
      savedWorkspacePaneBindingSchema.safeParse({ type: "browser", url: "file:///etc/passwd" })
        .success,
    ).toBe(false)
    expect(savedWorkspacePaneBindingSchema.safeParse({ type: "unknown", id: "x" }).success).toBe(
      false,
    )
  })

  it("requires exactly one project or task scope", () => {
    expect(
      savedWorkspaceScopeSchema.safeParse({ type: "project", projectId: "project-1" }).success,
    ).toBe(true)
    expect(savedWorkspaceScopeSchema.safeParse({ type: "task", taskId: "task-1" }).success).toBe(
      true,
    )
    expect(
      savedWorkspaceScopeSchema.safeParse({
        type: "project",
        projectId: "project-1",
        taskId: "task-1",
      }).success,
    ).toBe(false)
    expect(savedWorkspaceScopeSchema.safeParse({ type: "task" }).success).toBe(false)
  })

  it("keeps task and orchestration identities separate", () => {
    const result = savedWorkspaceDtoSchema.safeParse(
      workspaceDto({
        scope: { type: "task", taskId: "task-17" },
        owner: { kind: "orchestration", orchestrationId: "orchestration-93" },
        roster: [{ kind: "lead", chatId: "chat-lead", agentId: null, order: 0 }],
      }),
    )
    expect(result.success).toBe(true)

    expect(
      savedWorkspaceDtoSchema.safeParse(
        workspaceDto({
          scope: { type: "project", projectId: "project-1" },
          owner: { kind: "orchestration", orchestrationId: "orchestration-93" },
          roster: [{ kind: "lead", chatId: "chat-lead", agentId: null, order: 0 }],
        }),
      ).success,
    ).toBe(false)
  })

  it("validates derived roster identity and order", () => {
    expect(
      savedWorkspaceRosterSchema.safeParse([
        { kind: "lead", chatId: "chat-lead", agentId: null, order: 0 },
        { kind: "agent", chatId: "chat-agent", agentId: "agent-1", order: 1 },
      ]).success,
    ).toBe(true)
    expect(
      savedWorkspaceRosterSchema.safeParse([
        { kind: "lead", chatId: "chat-lead", agentId: null, order: 0 },
        { kind: "agent", chatId: "chat-lead", agentId: "agent-1", order: 1 },
      ]).success,
    ).toBe(false)
    expect(
      savedWorkspaceDtoSchema.safeParse(
        workspaceDto({
          roster: [{ kind: "lead", chatId: "chat-lead", agentId: null, order: 0 }],
        }),
      ).success,
    ).toBe(false)
  })
})

describe("saved workspace layout validation", () => {
  it("accepts a versioned row, column, and tab tree", () => {
    expect(savedWorkspaceLayoutSchema.parse(splitLayout())).toEqual(splitLayout())
    expect(savedWorkspaceLayoutJsonSchema.parse(JSON.stringify(splitLayout()))).toEqual(
      splitLayout(),
    )
  })

  it("rejects malformed layouts and bindings", () => {
    expect(
      savedWorkspaceLayoutSchema.safeParse({
        version: 1,
        root: { type: "split", id: "root", direction: "row", children: [], sizes: [] },
      }).success,
    ).toBe(false)
    expect(
      savedWorkspaceLayoutSchema.safeParse({
        version: 1,
        root: {
          type: "tabs",
          id: "root",
          activePaneId: "missing",
          panes: [{ id: "chat-pane", binding: { type: "chat", chatId: "chat-1" } }],
        },
      }).success,
    ).toBe(false)
    expect(savedWorkspaceLayoutJsonSchema.safeParse("{not-json").success).toBe(false)
  })

  it.each([
    ["duplicate node IDs", duplicateIdentityLayout("node")],
    ["duplicate pane IDs across tab groups", duplicateIdentityLayout("pane")],
    ["a pane ID colliding with a node ID", duplicateIdentityLayout("cross")],
  ])("rejects %s", (_name, layout) => {
    const result = savedWorkspaceLayoutSchema.safeParse(layout)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain(
        "globally unique",
      )
    }
  })

  it("rejects hostile depth before recursive validation", () => {
    const root: Record<string, unknown> = {}
    let cursor = root
    for (let depth = 0; depth <= MAX_SAVED_WORKSPACE_LAYOUT_DEPTH + 2; depth += 1) {
      const child: Record<string, unknown> = {}
      cursor.child = child
      cursor = child
    }
    const result = savedWorkspaceLayoutSchema.safeParse({ version: 1, root })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maximum depth")
    }
  })

  it("rejects hostile node counts before recursive validation", () => {
    const result = savedWorkspaceLayoutSchema.safeParse({
      version: 1,
      root: {
        type: "tabs",
        id: "root",
        activePaneId: "pane-1",
        panes: Array.from({ length: MAX_SAVED_WORKSPACE_LAYOUT_NODES + 1 }, () => ({})),
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maximum node count")
    }
  })

  it("rejects hostile serialized byte sizes before JSON or recursive validation", () => {
    const oversized = JSON.stringify({
      version: 1,
      root: "x".repeat(MAX_SAVED_WORKSPACE_LAYOUT_BYTES),
    })
    const result = savedWorkspaceLayoutJsonSchema.safeParse(oversized)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maximum serialized size")
    }
  })
})

describe("saved workspace schema migration", () => {
  it("creates constrained metadata without changing existing chats", () => {
    const { sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      seedExistingWork(sqlite)
      const chatBefore = existingChat(sqlite)
      const layoutJson = JSON.stringify(singleChatLayout())

      insertWorkspace(sqlite, {
        id: "project-workspace",
        scopeType: "project",
        projectId: "project-1",
        layoutJson,
      })
      insertWorkspace(sqlite, {
        id: "task-workspace",
        scopeType: "task",
        taskId: "task-1",
        layoutJson,
        sortOrder: "b0",
        archivedAt: 400,
      })
      insertWorkspace(sqlite, {
        id: "operation-workspace",
        scopeType: "task",
        taskId: "task-1",
        ownerKind: "orchestration",
        orchestrationId: "orchestration-opaque-7",
        layoutJson,
      })

      expect(
        sqlite
          .prepare(
            `SELECT id, scope_type, project_id, task_id, owner_kind, orchestration_id,
                    layout_version, sort_order, version, archived_at
             FROM saved_workspaces ORDER BY id`,
          )
          .all(),
      ).toEqual([
        {
          id: "operation-workspace",
          scope_type: "task",
          project_id: null,
          task_id: "task-1",
          owner_kind: "orchestration",
          orchestration_id: "orchestration-opaque-7",
          layout_version: 1,
          sort_order: "a0",
          version: 1,
          archived_at: null,
        },
        {
          id: "project-workspace",
          scope_type: "project",
          project_id: "project-1",
          task_id: null,
          owner_kind: "manual",
          orchestration_id: null,
          layout_version: 1,
          sort_order: "a0",
          version: 1,
          archived_at: null,
        },
        {
          id: "task-workspace",
          scope_type: "task",
          project_id: null,
          task_id: "task-1",
          owner_kind: "manual",
          orchestration_id: null,
          layout_version: 1,
          sort_order: "b0",
          version: 1,
          archived_at: 400,
        },
      ])
      expect(existingChat(sqlite)).toEqual(chatBefore)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it("enforces XOR scope, owner kind, unique orchestration, and bounded layout JSON", () => {
    const { sqlite } = database("constraints")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      seedExistingWork(sqlite)
      const layoutJson = JSON.stringify(singleChatLayout())

      expect(() =>
        insertWorkspace(sqlite, {
          id: "both-scope",
          scopeType: "project",
          projectId: "project-1",
          taskId: "task-1",
          layoutJson,
        }),
      ).toThrow(/check constraint/i)
      expect(() =>
        insertWorkspace(sqlite, { id: "no-scope", scopeType: "task", layoutJson }),
      ).toThrow(/check constraint/i)
      expect(() =>
        insertWorkspace(sqlite, {
          id: "manual-link",
          scopeType: "task",
          taskId: "task-1",
          orchestrationId: "orchestration-1",
          layoutJson,
        }),
      ).toThrow(/check constraint/i)
      expect(() =>
        insertWorkspace(sqlite, {
          id: "project-operation",
          scopeType: "project",
          projectId: "project-1",
          ownerKind: "orchestration",
          orchestrationId: "orchestration-1",
          layoutJson,
        }),
      ).toThrow(/check constraint/i)

      insertWorkspace(sqlite, {
        id: "operation-one",
        scopeType: "task",
        taskId: "task-1",
        ownerKind: "orchestration",
        orchestrationId: "orchestration-1",
        layoutJson,
      })
      expect(() =>
        insertWorkspace(sqlite, {
          id: "operation-duplicate",
          scopeType: "task",
          taskId: "task-1",
          ownerKind: "orchestration",
          orchestrationId: "orchestration-1",
          layoutJson,
        }),
      ).toThrow(/unique constraint/i)
      expect(() =>
        insertWorkspace(sqlite, {
          id: "invalid-json",
          scopeType: "task",
          taskId: "task-1",
          layoutJson: "{invalid",
        }),
      ).toThrow(/malformed JSON|check constraint/i)
      expect(() =>
        insertWorkspace(sqlite, {
          id: "wrong-layout-version",
          scopeType: "task",
          taskId: "task-1",
          layoutVersion: 1,
          layoutJson: JSON.stringify({ version: 2, root: {} }),
        }),
      ).toThrow(/check constraint/i)
      expect(() =>
        insertWorkspace(sqlite, {
          id: "oversized-layout",
          scopeType: "task",
          taskId: "task-1",
          layoutJson: JSON.stringify({
            version: 1,
            padding: "x".repeat(MAX_SAVED_WORKSPACE_LAYOUT_BYTES),
          }),
        }),
      ).toThrow(/check constraint/i)
    } finally {
      sqlite.close()
    }
  })

  it("upgrades the supported 0031 schema additively and idempotently", () => {
    const { sqlite, directory } = database("prior-schema")
    try {
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: migrationSubset(directory, 30) })
      seedExistingWork(sqlite)
      const chatBefore = existingChat(sqlite)

      expect(tableExists(sqlite, "saved_workspaces")).toBe(false)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)

      expect(tableExists(sqlite, "saved_workspaces")).toBe(true)
      expect(sqlite.prepare("SELECT count(*) count FROM saved_workspaces").get()).toEqual({
        count: 0,
      })
      expect(existingChat(sqlite)).toEqual(chatBefore)
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it("keeps saved workspaces in the next actual migration slot", () => {
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.find((entry) => entry.idx === 31)).toEqual(
      expect.objectContaining({ idx: 31, tag: "0031_saved_workspaces" }),
    )
  })
})

function singleChatLayout() {
  return {
    version: 1 as const,
    root: {
      type: "tabs" as const,
      id: "root-tabs",
      activePaneId: "chat-pane",
      panes: [{ id: "chat-pane", binding: { type: "chat" as const, chatId: "chat-1" } }],
    },
  }
}

function splitLayout() {
  return {
    version: 1 as const,
    root: {
      type: "split" as const,
      id: "root-split",
      direction: "row" as const,
      sizes: [1, 1],
      children: [
        singleChatLayout().root,
        {
          type: "split" as const,
          id: "nested-split",
          direction: "column" as const,
          sizes: [1, 1],
          children: [
            {
              type: "tabs" as const,
              id: "files-tabs",
              activePaneId: "file-pane",
              panes: [
                {
                  id: "file-pane",
                  binding: {
                    type: "file" as const,
                    path: "src/main.ts",
                    worktreePath: null,
                    line: null,
                  },
                },
              ],
            },
            {
              type: "tabs" as const,
              id: "browser-tabs",
              activePaneId: "browser-pane",
              panes: [
                {
                  id: "browser-pane",
                  binding: { type: "browser" as const, url: "https://example.com" },
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

function duplicateIdentityLayout(kind: "node" | "pane" | "cross") {
  const firstNodeId = kind === "node" ? "duplicate" : "left-tabs"
  const secondNodeId = kind === "node" ? "duplicate" : "right-tabs"
  const firstPaneId = kind === "cross" ? "right-tabs" : "left-pane"
  const secondPaneId = kind === "pane" ? "left-pane" : "right-pane"
  return {
    version: 1,
    root: {
      type: "split",
      id: "root",
      direction: "row",
      sizes: [1, 1],
      children: [
        {
          type: "tabs",
          id: firstNodeId,
          activePaneId: firstPaneId,
          panes: [{ id: firstPaneId, binding: { type: "chat", chatId: "chat-1" } }],
        },
        {
          type: "tabs",
          id: secondNodeId,
          activePaneId: secondPaneId,
          panes: [{ id: secondPaneId, binding: { type: "chat", chatId: "chat-2" } }],
        },
      ],
    },
  }
}

function workspaceDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "workspace-1",
    name: "Workspace",
    scope: { type: "project", projectId: "project-1" },
    owner: { kind: "manual" },
    layoutVersion: 1,
    layout: singleChatLayout(),
    roster: [],
    sortOrder: "a0",
    version: 1,
    createdAt: 100,
    updatedAt: 200,
    archivedAt: null,
    ...overrides,
  }
}

function database(name: string): {
  directory: string
  sqlite: Database.Database
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-saved-workspaces-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "agents.db"))
  sqlite.pragma("foreign_keys = ON")
  return { directory, sqlite }
}

function seedExistingWork(sqlite: Database.Database): void {
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/project-1')")
    .run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
         (id, name, project_id, task_id, scope, permission_mode, created_at, updated_at)
       VALUES ('chat-1', 'Existing chat', 'project-1', 'task-1', 'task', 'read-only', 100, 200)`,
    )
    .run()
}

function existingChat(sqlite: Database.Database): unknown {
  return sqlite
    .prepare(
      `SELECT id, name, project_id, task_id, scope, permission_mode, created_at, updated_at
       FROM chats WHERE id = 'chat-1'`,
    )
    .get()
}

function insertWorkspace(
  sqlite: Database.Database,
  input: {
    id: string
    scopeType: string
    projectId?: string | null
    taskId?: string | null
    ownerKind?: string
    orchestrationId?: string | null
    layoutVersion?: number
    layoutJson: string
    sortOrder?: string
    archivedAt?: number | null
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO saved_workspaces
         (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
          layout_version, layout_json, sort_order, created_at, updated_at, archived_at)
       VALUES (?, 'Workspace', ?, ?, ?, ?, ?, ?, ?, ?, 100, 200, ?)`,
    )
    .run(
      input.id,
      input.scopeType,
      input.projectId ?? null,
      input.taskId ?? null,
      input.ownerKind ?? "manual",
      input.orchestrationId ?? null,
      input.layoutVersion ?? 1,
      input.layoutJson,
      input.sortOrder ?? "a0",
      input.archivedAt ?? null,
    )
}

function migrationSubset(directory: string, lastIndex: number): string {
  const target = join(directory, `migrations-through-${lastIndex}`)
  mkdirSync(join(target, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
    version: string
    dialect: string
    entries: Array<{ idx: number; tag: string }>
  }
  const subset = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= lastIndex) }
  writeFileSync(join(target, "meta", "_journal.json"), `${JSON.stringify(subset, null, 2)}\n`)
  for (const entry of subset.entries) {
    cpSync(join(migrations, `${entry.tag}.sql`), join(target, `${entry.tag}.sql`))
  }
  return target
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(name),
  )
}
