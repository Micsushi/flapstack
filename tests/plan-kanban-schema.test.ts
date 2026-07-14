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
  assertTaskProposalStatusTransition,
  assertTaskStatusTransition,
  taskProposalDraftSchema,
  taskProposalStatusSchema,
  taskWorkflowStatusSchema,
} from "../src/shared/plan-kanban"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("plan and Kanban contracts", () => {
  it("accepts only canonical task and proposal states", () => {
    expect(taskWorkflowStatusSchema.options).toEqual([
      "backlog",
      "planned",
      "in-progress",
      "review",
      "done",
    ])
    expect(taskWorkflowStatusSchema.safeParse("active").success).toBe(false)
    expect(taskProposalStatusSchema.safeParse("running").success).toBe(false)

    expect(() => assertTaskStatusTransition("planned", "in-progress")).not.toThrow()
    expect(() => assertTaskStatusTransition("backlog", "done")).toThrow(
      "Invalid task status transition",
    )
    expect(() => assertTaskProposalStatusTransition("pending", "approved")).not.toThrow()
    expect(() => assertTaskProposalStatusTransition("denied", "pending")).toThrow(
      "Invalid task proposal status transition",
    )
  })

  it("rejects unbounded or malformed proposal drafts", () => {
    expect(
      taskProposalDraftSchema.parse({
        projectId: "project-1",
        proposedByChatId: "chat-1",
        name: "Implement parser",
      }),
    ).toMatchObject({ targetStatus: "backlog" })

    expect(
      taskProposalDraftSchema.safeParse({
        projectId: "project-1",
        proposedByChatId: "chat-1",
        name: "Implement parser",
        targetStatus: "in-progress",
      }).success,
    ).toBe(false)
    expect(
      taskProposalDraftSchema.safeParse({
        projectId: "project-1",
        proposedByChatId: "chat-1",
        name: "Implement parser",
        autoRun: true,
      }).success,
    ).toBe(false)
  })
})

describe("plan and Kanban schema migration", () => {
  it("creates constrained workflow and inert proposal storage for a fresh profile", () => {
    const { sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/p1')").run()
      sqlite.prepare("INSERT INTO tasks (id, project_id, name) VALUES ('t1', 'p1', 'Task')").run()

      expect(
        sqlite.prepare("SELECT status, board_order, version FROM tasks WHERE id = 't1'").get(),
      ).toEqual({ status: "backlog", board_order: "a0", version: 1 })
      expect(() =>
        sqlite.prepare("UPDATE tasks SET status = 'active' WHERE id = 't1'").run(),
      ).toThrow(/check constraint/i)

      sqlite
        .prepare(
          `INSERT INTO task_proposals
             (id, project_id, proposed_by_chat_id, name)
           VALUES ('proposal-1', 'p1', 'caller-chat', 'Proposed work')`,
        )
        .run()
      expect(
        sqlite
          .prepare(
            "SELECT status, target_status, version FROM task_proposals WHERE id = 'proposal-1'",
          )
          .get(),
      ).toEqual({ status: "pending", target_status: "backlog", version: 1 })

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO task_proposals
               (id, project_id, proposed_by_chat_id, name, target_status)
             VALUES ('bad-target', 'p1', 'caller-chat', 'Bad', 'review')`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO task_proposals
               (id, project_id, proposed_by_chat_id, name, status)
             VALUES ('bad-state', 'p1', 'caller-chat', 'Bad', 'running')`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO task_proposals
               (id, project_id, proposed_by_chat_id, name)
             VALUES ('bad-name', 'p1', 'caller-chat', '   ')`,
          )
          .run(),
      ).toThrow(/check constraint/i)
    } finally {
      sqlite.close()
    }
  })

  it("maps active to in-progress without changing task, chat, or orchestration identity", () => {
    const { sqlite, directory } = database("upgrade")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 22),
      })
      sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/p1')").run()
      sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, created_at)
           VALUES ('legacy-task', 'p1', 'Legacy', 'active', 123)`,
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO chats
             (id, name, project_id, task_id, scope, permission_mode)
           VALUES ('legacy-chat', 'Chat', 'p1', 'legacy-task', 'task', 'read-only')`,
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO task_orchestrations
             (task_id, initiating_chat_id, status)
           VALUES ('legacy-task', 'legacy-chat', 'queued')`,
        )
        .run()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)

      expect(
        sqlite
          .prepare(
            `SELECT id, project_id, name, status, board_order, version
             FROM tasks WHERE id = 'legacy-task'`,
          )
          .get(),
      ).toEqual({
        id: "legacy-task",
        project_id: "p1",
        name: "Legacy",
        status: "in-progress",
        board_order: "00000000000000000123:legacy-task",
        version: 1,
      })
      expect(
        sqlite.prepare("SELECT id, task_id FROM chats WHERE id = 'legacy-chat'").get(),
      ).toEqual({ id: "legacy-chat", task_id: "legacy-task" })
      expect(
        sqlite.prepare("SELECT task_id, initiating_chat_id FROM task_orchestrations").get(),
      ).toEqual({ task_id: "legacy-task", initiating_chat_id: "legacy-chat" })
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})

function database(name: string): {
  directory: string
  sqlite: Database.Database
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-plan-kanban-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "agents.db"))
  sqlite.pragma("foreign_keys = ON")
  return { directory, sqlite }
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
