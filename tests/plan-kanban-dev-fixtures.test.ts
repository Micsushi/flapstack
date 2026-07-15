import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  createPlanKanbanDevFixture,
  DEV_PLAN_MARKDOWN_PATH,
  DEV_PLAN_OPENSPEC_ROOT,
  getPlanKanbanDevFixtureStatus,
} from "../src/main/lib/plan-kanban-dev-fixtures"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

const electronState = vi.hoisted(() => ({ isPackaged: false }))

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/flapstack-plan-kanban-dev-fixtures",
    get isPackaged() {
      return electronState.isPackaged
    },
  },
}))

const directories: string[] = []
let previousRendererUrl: string | undefined

beforeEach(() => {
  previousRendererUrl = process.env.ELECTRON_RENDERER_URL
  process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173"
  electronState.isPackaged = false
})

afterEach(async () => {
  const { closeDatabase } = await import("../src/main/lib/db")
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
  electronState.isPackaged = false
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Dev-only Plan and Kanban dataset", () => {
  it("compensates registration, parse, and first-proposal failures to exact absent state", async () => {
    const fixture = projectFixture("create-compensation")
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, board_order, version)
         VALUES ('unrelated-task', 'project-1', 'Keep task', 'backlog', 'a0', 1)`,
      )
      .run()
    fixture.sqlite
      .prepare(
        `INSERT INTO chats (id, name, project_id, scope, permission_mode, worktree_path)
         VALUES ('unrelated-chat', 'Keep chat', 'project-1', 'project', 'read-only', ?)`,
      )
      .run(fixture.root)
    fixture.sqlite.close()
    writeFileSync(join(fixture.root, "unrelated.md"), "keep\n")
    const config = {
      projectId: "project-1",
      rootPath: realpathSync(fixture.root),
      markdownPaths: [],
    }
    const failures = [
      {
        name: "after registration",
        hooks: { afterRegistration: () => failCreate("after registration") },
      },
      {
        name: "during parse",
        hooks: { readPlanSources: async () => failCreate("during parse") },
      },
      {
        name: "after first proposal",
        hooks: { afterFirstProposal: () => failCreate("after first proposal") },
      },
    ]

    for (const failure of failures) {
      await expect(
        createPlanKanbanDevFixture(fixture.databasePath, config, failure.hooks),
      ).rejects.toThrow(failure.name)
      expect(await getPlanKanbanDevFixtureStatus(fixture.databasePath, config)).toMatchObject({
        state: "absent",
        proposalCount: 0,
        taskCount: 0,
      })
      expect(existsSync(join(fixture.root, DEV_PLAN_MARKDOWN_PATH))).toBe(false)
      expect(existsSync(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT))).toBe(false)
      expect(readText(join(fixture.root, "unrelated.md"))).toBe("keep\n")
      expect(fixtureCount(fixture.databasePath, "tasks", "id = 'unrelated-task'")).toBe(1)
      expect(fixtureCount(fixture.databasePath, "chats", "id = 'unrelated-chat'")).toBe(1)
    }
  })

  it("refuses create compensation after fixture chat or run state becomes user-owned", async () => {
    const fixture = projectFixture("create-compensation-collision")
    fixture.sqlite.close()
    const config = {
      projectId: "project-1",
      rootPath: realpathSync(fixture.root),
      markdownPaths: [],
    }

    await expect(
      createPlanKanbanDevFixture(fixture.databasePath, config, {
        afterRegistration: () => {
          const sqlite = new Database(fixture.databasePath)
          try {
            sqlite
              .prepare(
                `INSERT INTO sub_chats
                   (id, chat_id, name, mode, permission_mode, messages)
                 SELECT 'user-subchat', id, 'User state', 'agent', permission_mode, '[]'
                 FROM chats WHERE name = '[Dev fixture] Plan and Kanban proposals'`,
              )
              .run()
            sqlite
              .prepare(
                `INSERT INTO agent_runs (
                   id, chat_id, sub_chat_id, harness, permission_mode, status, started_at,
                   runtime_snapshot_version, runtime_preference, runtime_preference_source,
                   resolved_runtime, runtime_adapter_version, runtime_protocol_version,
                   runtime_capability_snapshot, runtime_control_snapshot
                 ) SELECT 'user-run', chat_id, id, 'codex', 'read-only', 'running', 1,
                          ?, ?, ?, ?, ?, ?, ?, ?
                   FROM sub_chats WHERE id = 'user-subchat'`,
              )
              .run(...testRuntimeSnapshotSqlValues())
          } finally {
            sqlite.close()
          }
          failCreate("after user run")
        },
      }),
    ).rejects.toThrow(/user-created chat or run state/)

    expect(await getPlanKanbanDevFixtureStatus(fixture.databasePath, config)).toMatchObject({
      state: "collision",
    })
    expect(fixtureCount(fixture.databasePath, "agent_runs", "id = 'user-run'")).toBe(1)
    expect(existsSync(join(fixture.root, DEV_PLAN_MARKDOWN_PATH))).toBe(true)
  })

  it("creates project-scoped Markdown/OpenSpec candidates and inert proposals, then cleans approved cards", async () => {
    const fixture = projectFixture("workflow")
    const otherRoot = mkdtempSync(join(tmpdir(), "flapstack-plan-dev-other-"))
    directories.push(otherRoot)
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, default_permission_mode)
         VALUES ('project-2', 'Other project', ?, 'ask-before-edits')`,
      )
      .run(otherRoot)
    const otherInfo = lstatSync(otherRoot, { bigint: true })
    fixture.sqlite
      .prepare(
        `INSERT INTO filesystem_root_registrations
           (path, canonical_path, device_id, inode_id, bound_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        otherRoot,
        realpathSync(otherRoot),
        otherInfo.dev.toString(),
        otherInfo.ino.toString(),
        Date.now(),
      )
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, board_order, version)
         VALUES ('unrelated-task', 'project-1', 'Keep me', 'backlog', 'a0', 1)`,
      )
      .run()
    fixture.sqlite.close()
    process.env.FLAPSTACK_DB_PATH = fixture.databasePath

    const { planSourcesRouter } = await import("../src/main/lib/trpc/routers/plan-sources")
    const { taskProposalsRouter } = await import("../src/main/lib/trpc/routers/task-proposals")
    const { tasksRouter } = await import("../src/main/lib/trpc/routers/tasks")
    const context = { getWindow: () => null }
    const plans = planSourcesRouter.createCaller(context)
    const proposals = taskProposalsRouter.createCaller(context)
    const tasks = tasksRouter.createCaller(context)

    const created = await plans.devFixtureCreate({ projectId: "project-1" })
    expect(created).toMatchObject({
      state: "ready",
      revision: 1,
      markdownRegistered: true,
      proposalCount: 2,
      taskCount: 0,
    })
    expect(await plans.devFixtureStatus({ projectId: "project-2" })).toMatchObject({
      state: "absent",
      proposalCount: 0,
      taskCount: 0,
    })
    expect(existsSync(join(otherRoot, DEV_PLAN_MARKDOWN_PATH))).toBe(false)
    expect(existsSync(join(fixture.root, DEV_PLAN_MARKDOWN_PATH))).toBe(true)
    expect(existsSync(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT, "proposal.md"))).toBe(true)

    const snapshot = await plans.refresh({ projectId: "project-1" })
    const fixtureSources = snapshot.sources.filter(
      (source) => source.path === DEV_PLAN_MARKDOWN_PATH || source.path === DEV_PLAN_OPENSPEC_ROOT,
    )
    expect(fixtureSources).toHaveLength(2)
    expect(fixtureSources.every((source) => source.status === "current")).toBe(true)
    expect(fixtureSources.map((source) => source.type).sort()).toEqual(["markdown", "openspec"])

    const pending = await proposals.list({
      projectId: "project-1",
      includeArchived: false,
      limit: 20,
    })
    expect(pending.items).toHaveLength(2)
    expect(pending.items.every((proposal) => proposal.status === "pending")).toBe(true)
    expect(fixtureCount(fixture.databasePath, "tasks", "id <> 'unrelated-task'")).toBe(0)
    expect(fixtureCount(fixture.databasePath, "agent_runs")).toBe(0)

    const preview = await proposals.preview({ proposalId: pending.items[0]!.id })
    await proposals.approve({
      proposalId: preview.proposal.id,
      expectedVersion: preview.proposal.version,
      review: preview.review,
    })
    const board = await tasks.board({ projectId: "project-1", includeArchived: false })
    expect(board.map((card) => card.name)).toEqual(
      expect.arrayContaining(["Keep me", preview.review.taskName]),
    )
    expect(fixtureCount(fixture.databasePath, "agent_runs")).toBe(0)

    const advanced = await plans.devFixtureAdvance({ projectId: "project-1" })
    expect(advanced).toMatchObject({ state: "advanced", revision: 2, taskCount: 1 })
    const expectedFingerprints = Object.fromEntries(
      fixtureSources.map((source) => [source.id, source.fingerprint]),
    )
    const stale = await plans.refresh({ projectId: "project-1", expectedFingerprints })
    expect(
      stale.sources
        .filter(
          (source) =>
            source.path === DEV_PLAN_MARKDOWN_PATH || source.path === DEV_PLAN_OPENSPEC_ROOT,
        )
        .every((source) => source.status === "stale"),
    ).toBe(true)
    expect(
      (await plans.sourceLinks({ projectId: "project-1" })).some((link) => link.diverged),
    ).toBe(true)

    const reset = await plans.devFixtureReset({ projectId: "project-1" })
    expect(reset).toMatchObject({ state: "absent", proposalCount: 0, taskCount: 0 })
    expect(existsSync(join(fixture.root, DEV_PLAN_MARKDOWN_PATH))).toBe(false)
    expect(existsSync(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT))).toBe(false)
    const remaining = new Database(fixture.databasePath)
    try {
      expect(remaining.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([
        { id: "unrelated-task" },
      ])
      expect(remaining.prepare("SELECT count(*) count FROM task_proposals").get()).toEqual({
        count: 0,
      })
    } finally {
      remaining.close()
    }
  })

  it("fails closed on unknown files, unrelated source identities, and packaged profiles", async () => {
    const fixture = projectFixture("collisions")
    fixture.sqlite.close()
    process.env.FLAPSTACK_DB_PATH = fixture.databasePath
    const { planSourcesRouter } = await import("../src/main/lib/trpc/routers/plan-sources")
    const plans = planSourcesRouter.createCaller({ getWindow: () => null })

    mkdirSync(dirname(join(fixture.root, DEV_PLAN_MARKDOWN_PATH)), { recursive: true })
    writeFileSync(join(fixture.root, DEV_PLAN_MARKDOWN_PATH), "# User-owned collision\n")
    await expect(plans.devFixtureCreate({ projectId: "project-1" })).rejects.toThrow(
      /partially present|changed outside/,
    )
    expect(readText(join(fixture.root, DEV_PLAN_MARKDOWN_PATH))).toBe("# User-owned collision\n")
    rmSync(join(fixture.root, ".flapstack"), { recursive: true })

    await plans.devFixtureCreate({ projectId: "project-1" })
    writeFileSync(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT, "user-note.md"), "keep\n")
    await expect(plans.devFixtureReset({ projectId: "project-1" })).rejects.toThrow(
      "unknown entries",
    )
    expect(readText(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT, "user-note.md"))).toBe("keep\n")
    rmSync(join(fixture.root, DEV_PLAN_OPENSPEC_ROOT, "user-note.md"))

    const sqlite = new Database(fixture.databasePath)
    sqlite
      .prepare(
        `INSERT INTO tasks (
           id, project_id, name, status, board_order, version, source_type, source_path
         ) VALUES ('unrelated-source-task', 'project-1', 'Keep source task', 'backlog', 'z0', 1,
                   'markdown', ?)`,
      )
      .run(DEV_PLAN_MARKDOWN_PATH)
    sqlite.close()
    await expect(plans.devFixtureReset({ projectId: "project-1" })).rejects.toThrow(
      "non-fixture task",
    )
    expect(fixtureCount(fixture.databasePath, "tasks", "id = 'unrelated-source-task'")).toBe(1)

    electronState.isPackaged = true
    await expect(plans.devFixtureStatus({ projectId: "project-1" })).rejects.toThrow("unavailable")
  })

  it("keeps the normal UI controls development-only", () => {
    const view = readText("src/renderer/features/plan/plan-view.tsx")
    const controls = readText("src/renderer/features/plan/plan-kanban-dev-fixtures.tsx")
    const router = readText("src/main/lib/trpc/routers/plan-sources.ts")
    expect(view).toContain("import.meta.env.DEV")
    expect(view).toContain("<PlanKanbanDevFixtures")
    expect(controls).toContain("Create sources and proposals")
    expect(controls).toContain("Change source revision")
    expect(controls).toContain("Reset dataset")
    expect(router).toContain("!IS_DEV || app.isPackaged")
  })
})

function projectFixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `flapstack-plan-dev-${name}-`))
  directories.push(root)
  const databasePath = join(root, "agents.db")
  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
  sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, default_permission_mode)
       VALUES ('project-1', 'Fixture project', ?, 'ask-before-edits')`,
    )
    .run(root)
  const info = lstatBigInt(root)
  sqlite
    .prepare(
      `INSERT INTO filesystem_root_registrations
         (path, canonical_path, device_id, inode_id, bound_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(root, realpathSync(root), info.dev.toString(), info.ino.toString(), Date.now())
  return { root, databasePath, sqlite }
}

function lstatBigInt(path: string) {
  return lstatSync(path, { bigint: true }) as {
    dev: bigint
    ino: bigint
  }
}

function fixtureCount(databasePath: string, table: string, where = "1 = 1"): number {
  const sqlite = new Database(databasePath)
  try {
    return Number(
      (
        sqlite.prepare(`SELECT count(*) count FROM ${table} WHERE ${where}`).get() as {
          count: number
        }
      ).count,
    )
  } finally {
    sqlite.close()
  }
}

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function failCreate(message: string): never {
  throw new Error(message)
}
