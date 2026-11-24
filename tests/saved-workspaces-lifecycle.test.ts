import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SavedWorkspaceLifecycleService } from "../src/main/lib/saved-workspaces/service"
import type {
  SavedWorkspaceLayout,
  SavedWorkspacePaneBinding,
} from "../src/shared/saved-workspaces"

let directory = ""
let databasePath = ""
let sqlite: Database.Database
let service: SavedWorkspaceLifecycleService

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-saved-workspace-lifecycle-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  createFixtureSchema(sqlite)
  seedReferencedWork(sqlite)
  service = new SavedWorkspaceLifecycleService(databasePath)
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(() => {
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("saved workspace lifecycle", () => {
  it("rejects stale concurrent writers with optimistic versions", () => {
    const created = service.create({
      name: "Concurrent",
      scope: { type: "project", projectId: "project-1" },
      layout: layout({ type: "chat", chatId: "chat-1" }),
    })
    const firstWindow = new SavedWorkspaceLifecycleService(databasePath)
    const secondWindow = new SavedWorkspaceLifecycleService(databasePath)

    expect(
      firstWindow.rename({
        workspaceId: created.id,
        expectedVersion: 1,
        name: "First wins",
      }),
    ).toMatchObject({ version: 2, name: "First wins" })
    expect(() =>
      secondWindow.saveLayout({
        workspaceId: created.id,
        expectedVersion: 1,
        layout: layout({ type: "chat", chatId: "chat-2" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(service.get(created.id)).toMatchObject({ version: 2, name: "First wins" })
  })

  it("rolls back an interrupted layout transaction and restores the last valid version", () => {
    const created = service.create({
      name: "Crash Safe",
      scope: { type: "project", projectId: "project-1" },
      layout: layout({ type: "chat", chatId: "chat-1" }),
    })
    const crashing = new SavedWorkspaceLifecycleService(databasePath, {
      afterWriteBeforeCommit: (operation) => {
        if (operation === "save-layout") throw new Error("simulated process exit")
      },
    })

    expect(() =>
      crashing.saveLayout({
        workspaceId: created.id,
        expectedVersion: 1,
        layout: layout({ type: "browser", url: "https://example.com/interrupted" }),
      }),
    ).toThrow("simulated process exit")

    expect(new SavedWorkspaceLifecycleService(databasePath).get(created.id)).toMatchObject({
      version: 1,
      layout: {
        root: { panes: [{ binding: { type: "chat", chatId: "chat-1" } }] },
      },
    })
  })

  it("archives with an exact undo contract and restores atomically", () => {
    const created = service.create({
      name: "Undoable",
      scope: { type: "task", taskId: "task-1" },
      layout: layout({ type: "chat", chatId: "chat-1" }),
    })
    const archived = service.archive({ workspaceId: created.id, expectedVersion: 1 })
    expect(archived).toMatchObject({
      workspace: { archivedAt: expect.any(Number), version: 2 },
      undo: { workspaceId: created.id, expectedVersion: 2 },
    })
    expect(service.list()).toEqual([])

    const restored = service.restore(archived.undo)
    expect(restored).toMatchObject({ archivedAt: null, version: 3 })
    expect(service.list().map((item) => item.id)).toEqual([created.id])
  })
})

function layout(binding: SavedWorkspacePaneBinding): SavedWorkspaceLayout {
  return layoutMany([binding])
}

function layoutMany(bindings: SavedWorkspacePaneBinding[]): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "tabs",
      id: "root-tabs",
      activePaneId: "pane-1",
      panes: bindings.map((binding, index) => ({
        id: `pane-${index + 1}`,
        binding,
      })),
    },
  }
}

function createFixtureSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      task_id TEXT,
      name TEXT
    );
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE task_orchestrations (
      task_id TEXT PRIMARY KEY,
      initiating_chat_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE orchestration_agents (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      chat_id TEXT,
      run_id TEXT
    );
    CREATE TABLE usage_samples (id TEXT PRIMARY KEY, run_id TEXT, total_tokens INTEGER NOT NULL);

    CREATE TABLE saved_workspaces (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      scope_type text NOT NULL,
      project_id text,
      task_id text,
      owner_kind text DEFAULT 'manual' NOT NULL,
      orchestration_id text,
      layout_version integer DEFAULT 1 NOT NULL,
      layout_json text NOT NULL,
      sort_order text DEFAULT 'a0' NOT NULL,
      version integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON UPDATE no action ON DELETE cascade,
      CONSTRAINT saved_workspaces_name_check CHECK(length(trim(name)) between 1 and 256),
      CONSTRAINT saved_workspaces_scope_check CHECK((
        (scope_type = 'project' and project_id is not null and task_id is null) or
        (scope_type = 'task' and project_id is null and task_id is not null)
      )),
      CONSTRAINT saved_workspaces_owner_check CHECK((
        (owner_kind = 'manual' and orchestration_id is null) or
        (owner_kind = 'orchestration' and scope_type = 'task' and task_id is not null and orchestration_id is not null)
      )),
      CONSTRAINT saved_workspaces_layout_version_check CHECK(layout_version = 1),
      CONSTRAINT saved_workspaces_version_check CHECK(version >= 1),
      CONSTRAINT saved_workspaces_sort_order_check CHECK(length(trim(sort_order)) between 1 and 512),
      CONSTRAINT saved_workspaces_layout_json_check CHECK(
        json_valid(layout_json) = 1 and
        json_extract(layout_json, '$.version') = layout_version and
        length(cast(layout_json as blob)) <= 262144
      )
    );
    CREATE INDEX saved_workspaces_project_order_idx
      ON saved_workspaces (project_id, archived_at, sort_order);
    CREATE INDEX saved_workspaces_task_order_idx
      ON saved_workspaces (task_id, archived_at, sort_order);
    CREATE UNIQUE INDEX saved_workspaces_orchestration_idx
      ON saved_workspaces (orchestration_id);
  `)
}

function seedReferencedWork(database: Database.Database): void {
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/project-1')")
    .run()
  database
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  database
    .prepare(
      "INSERT INTO chats (id, project_id, task_id, name) VALUES ('chat-1', 'project-1', 'task-1', 'One'), ('chat-2', 'project-1', 'task-1', 'Two')",
    )
    .run()
  database
    .prepare("INSERT INTO agent_runs (id, chat_id, status) VALUES ('run-1', 'chat-1', 'done')")
    .run()
  database
    .prepare(
      "INSERT INTO task_orchestrations (task_id, initiating_chat_id, status) VALUES ('task-1', 'chat-1', 'running')",
    )
    .run()
  database
    .prepare(
      "INSERT INTO orchestration_agents (id, task_id, chat_id, run_id) VALUES ('agent-1', 'task-1', 'chat-2', 'run-1')",
    )
    .run()
  database
    .prepare(
      "INSERT INTO usage_samples (id, run_id, total_tokens) VALUES ('usage-1', 'run-1', 100)",
    )
    .run()
}
