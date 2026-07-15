import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const routerMocks = vi.hoisted(() => ({ databasePath: "" }))

vi.mock("../src/main/lib/db", () => ({
  getDatabasePath: () => routerMocks.databasePath,
}))
import {
  createOperationWorkspaceLayout,
  ensureOperationWorkspaceInTransaction,
  ensureOperationWorkspace,
  getOperationWorkspaceProjection,
  reconcileOperationWorkspaces,
  stableOperationOrchestrationId,
  stableOperationWorkspaceId,
  SavedWorkspaceOperationError,
} from "../src/main/lib/saved-workspaces/operations"
import { SavedWorkspaceLifecycleService } from "../src/main/lib/saved-workspaces/service"
import { resolveSavedWorkspacePane } from "../src/main/lib/saved-workspaces/pane-adapters"
import { savedWorkspacesRouter } from "../src/main/lib/trpc/routers/saved-workspaces"
import {
  enforceWorkspaceChatCap,
  getVisibleWorkspaceChatPaneIds,
  getWorkspaceGroups,
  reduceWorkspaceLayout,
  type WorkspaceLayoutAction,
} from "../src/renderer/features/saved-workspaces/layout-reducer"
import type { SavedWorkspaceLayout, SavedWorkspaceLayoutNode } from "../src/shared/saved-workspaces"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-operation-workspace-"))
  databasePath = join(directory, "agents.db")
  routerMocks.databasePath = databasePath
  const database = new Database(databasePath)
  database.pragma("foreign_keys = ON")
  database.exec(`
    CREATE TABLE projects (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE tasks (
      id text PRIMARY KEY,
      name text NOT NULL,
      project_id text NOT NULL REFERENCES projects(id)
    );
    CREATE TABLE chats (
      id text PRIMARY KEY,
      name text,
      archived_at integer
    );
    CREATE TABLE task_orchestrations (
      task_id text PRIMARY KEY REFERENCES tasks(id),
      initiating_chat_id text NOT NULL REFERENCES chats(id),
      status text NOT NULL,
      created_at integer,
      updated_at integer,
      completed_at integer
    );
    CREATE TABLE orchestration_agents (
      id text PRIMARY KEY,
      task_id text NOT NULL REFERENCES task_orchestrations(task_id),
      chat_id text REFERENCES chats(id),
      run_id text,
      parent_agent_id text,
      replaced_agent_id text,
      definition text NOT NULL,
      status text NOT NULL,
      progress_percent integer NOT NULL DEFAULT 0,
      result_summary text,
      stop_reason text,
      blocker_count integer NOT NULL DEFAULT 0,
      queued_at integer,
      started_at integer,
      completed_at integer
    );
    CREATE TABLE saved_workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      scope_type text NOT NULL,
      project_id text,
      task_id text,
      owner_kind text NOT NULL,
      orchestration_id text,
      layout_version integer NOT NULL,
      layout_json text NOT NULL,
      sort_order text NOT NULL,
      version integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer
    );
    CREATE UNIQUE INDEX saved_workspaces_orchestration_idx
      ON saved_workspaces(orchestration_id);
  `)
  database.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run()
  database.close()
})

afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe("orchestration-owned saved workspaces", () => {
  it("creates one stable task-scoped workspace with the bounded operation layout", () => {
    insertOperation("task-1", "Lead work")

    const first = ensureOperationWorkspace(databasePath, "task-1")
    const second = ensureOperationWorkspace(databasePath, "task-1")
    expect(first).toEqual({
      workspaceId: stableOperationWorkspaceId("task-1"),
      orchestrationId: stableOperationOrchestrationId("task-1"),
      taskId: "task-1",
      created: true,
    })
    expect(second).toEqual({ ...first, created: false })

    const database = new Database(databasePath)
    const count = database.prepare("SELECT count(*) count FROM saved_workspaces").get() as {
      count: number
    }
    expect(count.count).toBe(1)
    database.close()

    const workspace = new SavedWorkspaceLifecycleService(databasePath).get(first.workspaceId)
    expect(
      new SavedWorkspaceLifecycleService(databasePath)
        .list({ projectId: "project-1" })
        .map((item) => item.id),
    ).toContain(first.workspaceId)
    expect(workspace.scope).toEqual({ type: "task", taskId: "task-1" })
    expect(workspace.owner).toEqual({
      kind: "orchestration",
      orchestrationId: first.orchestrationId,
    })
    expect(workspace.roster).toEqual([
      { kind: "lead", chatId: "task-1-lead", agentId: null, order: 0 },
    ])
    expect(paneBindings(workspace.layout!.root)).toEqual([
      "chat",
      "agent-roster",
      "selected-agent",
      "activity",
    ])
    const rosterPane = getWorkspaceGroups(workspace.layout!)
      .flatMap((group) => group.panes)
      .find((pane) => pane.binding.type === "agent-roster")!
    expect(resolveSavedWorkspacePane(databasePath, workspace.id, rosterPane.id)).toMatchObject({
      state: "ready",
      label: "Agent navigator",
    })
    const selectedPane = getWorkspaceGroups(workspace.layout!)
      .flatMap((group) => group.panes)
      .find((pane) => pane.binding.type === "selected-agent")!
    const swapped = reduceWorkspaceLayout(workspace.layout!, {
      type: "replace-binding",
      paneId: selectedPane.id,
      binding: {
        type: "selected-agent",
        orchestrationId: first.orchestrationId,
        agentId: "agent-selected",
      },
    })
    expect(
      getWorkspaceGroups(swapped)
        .flatMap((group) => group.panes)
        .find((pane) => pane.id === selectedPane.id)?.binding,
    ).toEqual({
      type: "selected-agent",
      orchestrationId: first.orchestrationId,
      agentId: "agent-selected",
    })
  })

  it("derives materialized descendant chats once and keeps large teams in navigator overflow", () => {
    insertOperation("task-1", "Lead work")
    for (let index = 1; index <= 6; index += 1) {
      insertAgent("task-1", `agent-${index}`, `chat-${index}`, {
        status: index === 1 ? "completed" : "active",
        resultSummary: index === 1 ? "artifact: report.md" : null,
      })
    }
    insertAgent("task-1", "duplicate-chat-agent", "chat-2")
    insertAgent("task-1", "pending-agent", null, { status: "queued" })
    const workspace = ensureOperationWorkspace(databasePath, "task-1")

    const projection = getOperationWorkspaceProjection(databasePath, workspace.workspaceId)
    expect(projection.roster.map((entry) => entry.chatId)).toEqual([
      "task-1-lead",
      "chat-1",
      "chat-2",
      "chat-3",
      "chat-4",
      "chat-5",
      "chat-6",
    ])
    expect(projection.overflowChatCount).toBe(3)
    expect(projection.materializedAgentCount).toBe(6)
    expect(projection.pendingAgentCount).toBe(1)
    expect(projection.agents.find((agent) => agent.agentId === "agent-1")).toMatchObject({
      chatState: "ready",
      resultSummary: "artifact: report.md",
    })

    const record = new SavedWorkspaceLifecycleService(databasePath).get(workspace.workspaceId)
    expect(record.roster).toEqual(projection.roster)
  })

  it("counts a selected-agent chat toward the four-visible-chat cap", () => {
    const groups: SavedWorkspaceLayoutNode[] = [
      {
        type: "tabs",
        id: "selected-group",
        activePaneId: "selected-pane",
        panes: [
          {
            id: "selected-pane",
            binding: {
              type: "selected-agent",
              orchestrationId: "operation-1",
              agentId: "agent-1",
            },
          },
        ],
      },
      ...[1, 2, 3, 4].map((index): SavedWorkspaceLayoutNode => ({
        type: "tabs",
        id: `chat-group-${index}`,
        activePaneId: `chat-pane-${index}`,
        panes: [
          {
            id: `chat-pane-${index}`,
            binding: { type: "chat", chatId: `chat-${index}` },
          },
        ],
      })),
    ]
    const layout: SavedWorkspaceLayout = {
      version: 1,
      root: {
        type: "split",
        id: "cap-root",
        direction: "row",
        children: groups,
        sizes: groups.map(() => 1),
      },
    }

    const capped = enforceWorkspaceChatCap(layout)
    expect(getVisibleWorkspaceChatPaneIds(capped)).toHaveLength(4)
    expect(getVisibleWorkspaceChatPaneIds(capped)).toContain("selected-pane")
    expect(getWorkspaceGroups(capped).flatMap((group) => group.panes)).toHaveLength(5)
  })

  it("rejects pane and pinned-context identity collisions before schema parsing", () => {
    const layout: SavedWorkspaceLayout = {
      version: 1,
      root: {
        type: "tabs",
        id: "identity-group",
        activePaneId: "identity-pane",
        panes: [
          {
            id: "identity-pane",
            binding: { type: "chat", chatId: "identity-chat" },
            pinnedContext: [
              { id: "identity-context", type: "browser", url: "https://example.com/context" },
            ],
          },
        ],
      },
    }
    const collisions: WorkspaceLayoutAction[] = [
      {
        type: "add-pane" as const,
        groupId: "identity-group",
        pane: {
          id: "identity-context",
          binding: { type: "chat" as const, chatId: "new-chat" },
        },
      },
      {
        type: "add-pane" as const,
        groupId: "identity-group",
        pane: {
          id: "new-pane",
          binding: { type: "chat" as const, chatId: "new-chat" },
          pinnedContext: [
            { id: "identity-pane", type: "browser" as const, url: "https://example.com/new" },
          ],
        },
      },
      {
        type: "pin-context" as const,
        paneId: "identity-pane",
        context: {
          id: "identity-context",
          type: "browser" as const,
          url: "https://example.com/duplicate",
        },
      },
      {
        type: "duplicate-tab" as const,
        groupId: "identity-group",
        paneId: "identity-pane",
        newPaneId: "identity-context",
      },
    ]

    for (const action of collisions) {
      expect(() => reduceWorkspaceLayout(layout, action)).not.toThrow()
      expect(reduceWorkspaceLayout(layout, action)).toEqual(layout)
    }
  })

  it("reconciles half-created links after restart without changing orchestration work", () => {
    insertOperation("task-1", "First")
    insertOperation("task-2", "Second")
    insertAgent("task-2", "agent-2", null, { status: "queued" })
    ensureOperationWorkspace(databasePath, "task-1")

    const before = orchestrationSnapshot()
    expect(reconcileOperationWorkspaces(databasePath)).toMatchObject({ inspected: 2, created: 1 })
    expect(reconcileOperationWorkspaces(databasePath)).toMatchObject({ inspected: 2, created: 0 })
    expect(orchestrationSnapshot()).toEqual(before)
  })

  it("participates in the caller transaction without leaving a half-created link", () => {
    insertOperation("task-1", "Lead work")
    const database = new Database(databasePath)
    expect(() =>
      database
        .transaction(() => {
          ensureOperationWorkspaceInTransaction(database, "task-1")
          throw new Error("roll back launch")
        })
        .immediate(),
    ).toThrow("roll back launch")
    expect(database.prepare("SELECT count(*) count FROM saved_workspaces").get()).toEqual({
      count: 0,
    })
    database.close()

    expect(ensureOperationWorkspace(databasePath, "task-1").created).toBe(true)
  })

  it("deletes metadata across restart and explicitly regenerates the same identity", async () => {
    insertOperation("task-1", "Lead work")
    insertAgent("task-1", "agent-1", "chat-1", { status: "completed" })
    const ensured = ensureOperationWorkspace(databasePath, "task-1")
    const service = new SavedWorkspaceLifecycleService(databasePath)
    let workspace = service.get(ensured.workspaceId)
    const impact = service.previewDelete(workspace.id)
    expect(impact).toMatchObject({
      metadataOnly: true,
      references: { orchestrationIds: [ensured.orchestrationId] },
      operation: {
        taskId: "task-1",
        status: "running",
        active: true,
        agentCount: 1,
        materializedChatCount: 1,
        canRegenerateFromLineage: true,
      },
    })
    expect(impact.preserves).toContain("orchestrations")
    expect(() =>
      service.archive({ workspaceId: workspace.id, expectedVersion: workspace.version }),
    ).toThrow(/preview and confirm/i)
    workspace = service.archive({
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
      confirmActiveOperationImpact: true,
    }).workspace
    workspace = service.restore({ workspaceId: workspace.id, expectedVersion: workspace.version })
    expect(() =>
      service.delete({ workspaceId: workspace.id, expectedVersion: workspace.version }),
    ).toThrow(/preview and confirm/i)
    service.delete({
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
      confirmActiveOperationImpact: true,
    })
    expect(orchestrationSnapshot()).toMatchObject({ orchestrations: 1, agents: 1, chats: 2 })
    expect(() => service.get(ensured.workspaceId)).toThrow(/not found/i)
    expect(service.list({ projectId: "project-1", archive: "all" })).toEqual([])
    expect(reconcileOperationWorkspaces(databasePath)).toMatchObject({
      inspected: 1,
      created: 0,
      workspaceIds: [],
    })
    expect(() => service.get(ensured.workspaceId)).toThrow(/not found/i)

    const database = new Database(databasePath)
    const deletionIntent = database
      .prepare("SELECT layout_json, owner_kind, orchestration_id FROM saved_workspaces")
      .get() as { layout_json: string; owner_kind: string; orchestration_id: string | null }
    expect(deletionIntent).toMatchObject({ owner_kind: "manual", orchestration_id: null })
    expect(deletionIntent.layout_json).not.toContain("task-1-lead")
    expect(deletionIntent.layout_json).not.toContain(ensured.orchestrationId)
    database.close()

    const regenerated = await savedWorkspacesRouter
      .createCaller({ getWindow: () => null })
      .regenerateOperation({ taskId: "task-1" })
    expect(regenerated).toMatchObject({
      created: true,
      workspace: { id: ensured.workspaceId, owner: { kind: "orchestration" } },
    })
    expect(
      getOperationWorkspaceProjection(databasePath, regenerated.workspace.id).roster,
    ).toHaveLength(2)
  })

  it("rejects operation duplication in the service and router", async () => {
    insertOperation("task-1", "Lead work")
    const ensured = ensureOperationWorkspace(databasePath, "task-1")
    const service = new SavedWorkspaceLifecycleService(databasePath)
    const workspace = service.get(ensured.workspaceId)

    expect(() =>
      service.duplicate({ workspaceId: workspace.id, expectedVersion: workspace.version }),
    ).toThrow(/cannot be duplicated/i)

    const caller = savedWorkspacesRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.duplicate({ workspaceId: workspace.id, expectedVersion: workspace.version }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(service.list({ projectId: "project-1" })).toHaveLength(1)
  })

  it("fails closed when task lineage is already linked to a different opaque identity", () => {
    insertOperation("task-1", "Lead work")
    const layout = createOperationWorkspaceLayout({
      taskId: "task-1",
      orchestrationId: "foreign-operation",
      initiatingChatId: "task-1-lead",
    })
    const database = new Database(databasePath)
    database
      .prepare(
        `INSERT INTO saved_workspaces
           (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
            layout_version, layout_json, sort_order, version, created_at, updated_at, archived_at)
         VALUES ('foreign-workspace', 'Foreign', 'task', NULL, 'task-1', 'orchestration',
                 'foreign-operation', 1, ?, 'a0', 1, 1, 1, NULL)`,
      )
      .run(JSON.stringify(layout))
    database.close()

    expect(() => ensureOperationWorkspace(databasePath, "task-1")).toThrowError(
      SavedWorkspaceOperationError,
    )
  })
})

function insertOperation(taskId: string, taskName: string): void {
  const database = new Database(databasePath)
  const leadChatId = `${taskId}-lead`
  database
    .prepare("INSERT INTO tasks (id, name, project_id) VALUES (?, ?, 'project-1')")
    .run(taskId, taskName)
  database
    .prepare("INSERT INTO chats (id, name, archived_at) VALUES (?, ?, NULL)")
    .run(leadChatId, `${taskName} lead`)
  database
    .prepare(
      `INSERT INTO task_orchestrations
         (task_id, initiating_chat_id, status, created_at, updated_at, completed_at)
       VALUES (?, ?, 'running', 10, 20, NULL)`,
    )
    .run(taskId, leadChatId)
  database.close()
}

function insertAgent(
  taskId: string,
  agentId: string,
  chatId: string | null,
  options: { status?: string; resultSummary?: string | null } = {},
): void {
  const database = new Database(databasePath)
  if (chatId) {
    database
      .prepare("INSERT OR IGNORE INTO chats (id, name, archived_at) VALUES (?, ?, NULL)")
      .run(chatId, `${agentId} chat`)
  }
  database
    .prepare(
      `INSERT INTO orchestration_agents
         (id, task_id, chat_id, run_id, parent_agent_id, replaced_agent_id, definition,
          status, progress_percent, result_summary, stop_reason, blocker_count,
          queued_at, started_at, completed_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, 50, ?, NULL, 0, ?, 30, NULL)`,
    )
    .run(
      agentId,
      taskId,
      chatId,
      JSON.stringify({ role: "Worker", name: agentId, harness: "codex" }),
      options.status ?? "active",
      options.resultSummary ?? null,
      100 + Number(agentId.match(/\d+/)?.[0] ?? 99),
    )
  database.close()
}

function orchestrationSnapshot() {
  const database = new Database(databasePath)
  const snapshot = {
    orchestrations: (
      database.prepare("SELECT count(*) count FROM task_orchestrations").get() as {
        count: number
      }
    ).count,
    agents: (
      database.prepare("SELECT count(*) count FROM orchestration_agents").get() as {
        count: number
      }
    ).count,
    chats: (database.prepare("SELECT count(*) count FROM chats").get() as { count: number }).count,
    statuses: database
      .prepare("SELECT task_id, status FROM task_orchestrations ORDER BY task_id")
      .all(),
  }
  database.close()
  return snapshot
}

function paneBindings(node: SavedWorkspaceLayoutNode): string[] {
  if (node.type === "tabs") return node.panes.map((pane) => pane.binding.type)
  return node.children.flatMap(paneBindings)
}
