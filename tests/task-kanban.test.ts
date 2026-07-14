import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  archiveTaskKanbanCard,
  listTaskKanban,
  moveTaskKanbanCard,
  TaskKanbanError,
} from "../src/main/lib/task-kanban"
import {
  getTaskKanbanCardAriaLabel,
  getTaskKanbanKeyboardMove,
  selectTaskKanbanCards,
  type TaskKanbanCard,
} from "../src/shared/task-kanban"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function testDatabase(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-task-kanban-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "test.db"))
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrateDatabase(database, sqlite, resolve(process.cwd(), "drizzle"))
  sqlite
    .prepare(
      `INSERT INTO projects
         (id, name, path, git_repo, default_permission_mode)
       VALUES ('project-1', 'Flapstack', '/projects/flapstack', 'flapstack', 'ask-before-edits')`,
    )
    .run()
  return { database, sqlite }
}

function insertTask(
  sqlite: Database.Database,
  id: string,
  status: string,
  order: string,
  updatedAt: number,
) {
  sqlite
    .prepare(
      `INSERT INTO tasks
         (id, project_id, name, description, status, board_order, version, created_at, updated_at)
       VALUES (?, 'project-1', ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, `Task ${id}`, `Description ${id}`, status, order, updatedAt - 10, updatedAt)
}

describe("task Kanban service", () => {
  it("lists only real task cards with durable chat and run summaries", () => {
    const { database, sqlite } = testDatabase("query")
    try {
      insertTask(sqlite, "task-1", "in-progress", "a00000001", 100)
      insertTask(sqlite, "task-archived", "done", "a00000002", 90)
      sqlite.prepare("UPDATE tasks SET archived_at = 200 WHERE id = 'task-archived'").run()
      sqlite
        .prepare(
          `INSERT INTO chats
             (id, name, project_id, task_id, scope, permission_mode, created_at, updated_at)
           VALUES ('chat-1', 'Implementation', 'project-1', 'task-1', 'task', 'read-only', 110, 120),
                  ('chat-old', 'Archived chat', 'project-1', 'task-1', 'task', 'read-only', 90, 95)`,
        )
        .run()
      sqlite.prepare("UPDATE chats SET archived_at = 130 WHERE id = 'chat-old'").run()
      sqlite
        .prepare(
          `INSERT INTO agent_runs
             (id, chat_id, harness, permission_mode, status, started_at)
           VALUES ('run-1', 'chat-1', 'codex', 'read-only', 'running', 125),
                  ('run-2', 'chat-old', 'codex', 'read-only', 'success', 100)`,
        )
        .run()

      const cards = listTaskKanban(database, {})

      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({
        id: "task-1",
        project: { name: "Flapstack", gitRepo: "flapstack" },
        chats: { total: 2, active: 1, latestId: "chat-1", latestName: "Implementation" },
        runs: { total: 2, running: 1, latestStatus: "running" },
      })
    } finally {
      sqlite.close()
    }
  })

  it("moves and rebalances cards atomically while preserving task and chat identity", () => {
    const { database, sqlite } = testDatabase("move")
    try {
      insertTask(sqlite, "moving", "backlog", "a0", 100)
      insertTask(sqlite, "planned-a", "planned", "a00000001", 90)
      insertTask(sqlite, "planned-b", "planned", "a00000002", 80)
      sqlite
        .prepare(
          `INSERT INTO chats
             (id, name, project_id, task_id, scope, permission_mode)
           VALUES ('linked-chat', 'Linked', 'project-1', 'moving', 'task', 'read-only')`,
        )
        .run()

      const moved = moveTaskKanbanCard(database, {
        id: "moving",
        expectedVersion: 1,
        targetStatus: "planned",
        beforeTaskId: "planned-b",
      })

      expect(moved).toMatchObject({ id: "moving", status: "planned", version: 2 })
      const ordered = sqlite
        .prepare(
          "SELECT id, board_order FROM tasks WHERE status = 'planned' ORDER BY board_order, id",
        )
        .all() as Array<{ id: string; board_order: string }>
      expect(ordered.map((task) => task.id)).toEqual(["planned-a", "moving", "planned-b"])
      expect(new Set(ordered.map((task) => task.board_order)).size).toBe(3)
      expect(sqlite.prepare("SELECT task_id FROM chats WHERE id = 'linked-chat'").get()).toEqual({
        task_id: "moving",
      })

      expect(() =>
        moveTaskKanbanCard(database, {
          id: "moving",
          expectedVersion: 1,
          targetStatus: "backlog",
        }),
      ).toThrowError(TaskKanbanError)
      expect(sqlite.prepare("SELECT status, version FROM tasks WHERE id = 'moving'").get()).toEqual(
        {
          status: "planned",
          version: 2,
        },
      )
    } finally {
      sqlite.close()
    }
  })

  it("archives with a version precondition and excludes archived cards by default", () => {
    const { database, sqlite } = testDatabase("archive")
    try {
      insertTask(sqlite, "task-1", "done", "a00000001", 100)

      const archived = archiveTaskKanbanCard(database, { id: "task-1", expectedVersion: 1 })
      expect(archived.version).toBe(2)
      expect(archived.archivedAt).toBeInstanceOf(Date)
      expect(listTaskKanban(database, {})).toEqual([])
      expect(listTaskKanban(database, { includeArchived: true })).toHaveLength(1)
      expect(() => archiveTaskKanbanCard(database, { id: "task-1", expectedVersion: 1 })).toThrow(
        "Board refreshed",
      )
    } finally {
      sqlite.close()
    }
  })
})

describe("task Kanban selectors and keyboard model", () => {
  const card = (overrides: Partial<TaskKanbanCard>): TaskKanbanCard => ({
    id: "task-1",
    projectId: "project-1",
    project: {
      id: "project-1",
      name: "Flapstack",
      path: "/project",
      gitRemoteUrl: null,
      gitProvider: null,
      gitOwner: null,
      gitRepo: "flapstack",
    },
    name: "Build task board",
    description: "Real task cards",
    status: "in-progress",
    boardOrder: "a00000002",
    version: 1,
    primaryWorktreePath: null,
    primaryBranch: "codex/task-board",
    sourceType: null,
    sourcePath: null,
    createdAt: new Date(100),
    updatedAt: new Date(200),
    chats: { total: 2, active: 1, latestId: "chat-1", latestName: "Chat", latestUpdatedAt: null },
    runs: { total: 3, running: 1, latestStatus: "running", latestStartedAt: null },
    ...overrides,
  })

  it("filters by metadata and activity, then applies explicit sort selection", () => {
    const cards = [
      card({ id: "b", name: "Beta", boardOrder: "a00000002" }),
      card({
        id: "a",
        name: "Alpha",
        boardOrder: "a00000001",
        chats: { total: 0, active: 0, latestId: null, latestName: null, latestUpdatedAt: null },
        runs: { total: 0, running: 0, latestStatus: null, latestStartedAt: null },
      }),
    ]

    expect(
      selectTaskKanbanCards(cards, {
        search: "flapstack",
        chatFilter: "with-chats",
        sort: "name",
      }).map((item) => item.id),
    ).toEqual(["b"])
    expect(
      selectTaskKanbanCards(cards, { search: "", chatFilter: "all", sort: "board" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b"])
  })

  it("maps Alt plus arrow keys to adjacent statuses and stable within-column targets", () => {
    const subject = card({ id: "task-b", status: "in-progress" })
    const ids = ["task-a", "task-b", "task-c"]

    expect(getTaskKanbanKeyboardMove(subject, ids, "ArrowLeft", true)).toEqual({
      targetStatus: "planned",
    })
    expect(getTaskKanbanKeyboardMove(subject, ids, "ArrowRight", true)).toEqual({
      targetStatus: "review",
    })
    expect(getTaskKanbanKeyboardMove(subject, ids, "ArrowUp", true)).toEqual({
      targetStatus: "in-progress",
      beforeTaskId: "task-a",
    })
    expect(getTaskKanbanKeyboardMove(subject, ids, "ArrowDown", true)).toEqual({
      targetStatus: "in-progress",
      beforeTaskId: undefined,
    })
    expect(getTaskKanbanKeyboardMove(subject, ids, "ArrowRight", false)).toBeNull()
  })

  it("publishes task, column, project, chat, run, and keyboard context in its accessible label", () => {
    expect(getTaskKanbanCardAriaLabel(card({}))).toBe(
      "Build task board, In Progress, Flapstack, 1 active chat, 1 running run. Alt plus arrow keys moves this task.",
    )
  })
})
