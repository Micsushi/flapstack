import Database from "better-sqlite3"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CoordinationEngineDefaultsService,
  CoordinationEngineError,
  coordinationEngineSnapshotSqlValues,
  createDefaultCoordinationEngineProbes,
  interpretCoordinationEngineSnapshot,
  previewCoordinationEngineForProject,
  resolveCoordinationEngine,
} from "../src/main/lib/agent-orchestration/coordination-engine"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import {
  COORDINATION_ENGINE_VERSIONS,
  type CoordinationEngine,
} from "../src/shared/coordination-engine"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("coordination engine migration", () => {
  it("migrates a pre-0031 database directly through authoritative 0035 and reopens", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-engine-migration-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "agents.db")
    let database = createPre0031Database(path)
    seedLegacyOrchestration(database, "legacy-running", "running")
    applyMigrations(database, [31, 32, 33, 34, 35])

    expect(
      database.prepare("SELECT * FROM task_orchestrations WHERE task_id = ?").get("legacy-running"),
    ).toMatchObject({
      engine_snapshot_version: 0,
      coordination_engine: "workflow",
      coordination_engine_version: "workflow-legacy-graph",
      coordination_engine_source: "legacy",
      coordination_engine_provider_identity: "null",
    })
    expect(database.pragma("foreign_key_check")).toEqual([])
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok")
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("orchestration_workflow_runs"),
    ).toEqual({ name: "orchestration_workflow_runs" })
    database.close()

    database = new Database(path)
    expect(database.prepare("SELECT coordination_engine FROM task_orchestrations").get()).toEqual({
      coordination_engine: "workflow",
    })
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok")
    database.close()

    expect(createAgentOrchestrationService(path).tickAll()).toBe(0)
    database = new Database(path)
    expect(
      database
        .prepare("SELECT status FROM task_orchestrations WHERE task_id = ?")
        .get("legacy-running"),
    ).toEqual({ status: "running" })
    database.close()
  })

  it("rejects new default bypass, active switching, and legacy reactivation", () => {
    const database = createPre0031Database()
    seedLegacyOrchestration(database, "legacy", "running")
    applyMigrations(database, [31, 32, 33, 34])
    seedTaskAndChat(database, "new-task")

    expect(() =>
      database
        .prepare(
          `INSERT INTO task_orchestrations
           (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions)
           VALUES ('new-task', 'new-task-chat', 'queued', 1, 8, '{}')`,
        )
        .run(),
    ).toThrow(/requires a resolved coordination engine snapshot/i)

    const resolved = resolveCoordinationEngine({})
    if (!resolved.ok) throw new Error(resolved.reason.message)
    database
      .prepare(
        `INSERT INTO task_orchestrations (
          task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
          engine_snapshot_version, coordination_engine, coordination_engine_version,
          coordination_engine_source, coordination_engine_capability_snapshot,
          coordination_engine_provider_identity
        ) VALUES ('new-task', 'new-task-chat', 'queued', 1, 8, '{}', ?, ?, ?, ?, ?, ?)`,
      )
      .run(...coordinationEngineSnapshotSqlValues(resolved.snapshot))

    expect(() =>
      database
        .prepare(
          "UPDATE task_orchestrations SET coordination_engine = 'codex-v1' WHERE task_id = 'new-task'",
        )
        .run(),
    ).toThrow(/snapshot is immutable/i)

    expect(
      database
        .prepare("UPDATE task_orchestrations SET status = 'completed' WHERE task_id = 'legacy'")
        .run(),
    ).toMatchObject({ changes: 1 })
    expect(() =>
      database
        .prepare("UPDATE task_orchestrations SET status = 'queued' WHERE task_id = 'legacy'")
        .run(),
    ).toThrow(/cannot be reactivated/i)
    database.close()
  })

  it("enforces coherent JSON engine/version/provider identity in SQLite", () => {
    const database = createPre0031Database()
    applyMigrations(database, [31, 32, 33, 34])
    seedTaskAndChat(database, "corrupt-task")
    const probes = createDefaultCoordinationEngineProbes("2026-07-14T00:00:00.000Z")
    const capability = JSON.stringify({ ...probes.workflow.snapshot, engine: "codex-v2" })
    expect(() =>
      database
        .prepare(
          `INSERT INTO task_orchestrations (
            task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
            engine_snapshot_version, coordination_engine, coordination_engine_version,
            coordination_engine_source, coordination_engine_capability_snapshot,
            coordination_engine_provider_identity
          ) VALUES ('corrupt-task', 'corrupt-task-chat', 'queued', 1, 8, '{}',
            1, 'workflow', 'workflow-v1', 'product', ?, 'null')`,
        )
        .run(capability),
    ).toThrow(/task_orchestrations_engine_snapshot_check/i)
    database.close()
  })

  it("rejects raw non-canonical v1 snapshots at the database boundary", () => {
    const database = createPre0031Database()
    applyMigrations(database, [31, 32, 33, 34])
    const cases: Array<{
      name: string
      engine: CoordinationEngine
      version?: string
      snapshot: Record<string, unknown>
      identity: unknown
    }> = [
      {
        name: "arbitrary-version",
        engine: "workflow",
        version: "workflow-arbitrary",
        snapshot: canonicalCapabilitySnapshot("workflow", {
          engineVersion: "workflow-arbitrary",
        }),
        identity: null,
      },
      {
        name: "missing-captured-at",
        engine: "workflow",
        snapshot: canonicalCapabilitySnapshot("workflow", { capturedAt: null }),
        identity: null,
      },
      {
        name: "missing-required-capabilities",
        engine: "workflow",
        snapshot: canonicalCapabilitySnapshot("workflow", { capabilities: [] }),
        identity: null,
      },
      {
        name: "malformed-workflow-identity",
        engine: "workflow",
        snapshot: canonicalCapabilitySnapshot("workflow"),
        identity: { schemaVersion: 1, engine: "workflow" },
      },
      {
        name: "malformed-v2-identity",
        engine: "codex-v2",
        snapshot: canonicalCapabilitySnapshot("codex-v2"),
        identity: {
          schemaVersion: 1,
          engine: "codex-v2",
          canonicalTaskPath: "/root/task",
          taskName: "Task",
        },
      },
      {
        name: "malformed-v1-identity",
        engine: "codex-v1",
        snapshot: canonicalCapabilitySnapshot("codex-v1"),
        identity: {
          schemaVersion: 1,
          engine: "codex-v1",
          providerAgentId: "agent-1",
          nickname: 7,
        },
      },
    ]

    for (const testCase of cases) {
      seedTaskAndChat(database, testCase.name)
      expect(() =>
        insertRawEngineSnapshot(database, {
          taskId: testCase.name,
          engine: testCase.engine,
          version: testCase.version,
          snapshot: testCase.snapshot,
          identity: testCase.identity,
        }),
      ).toThrow(/engine snapshot|engine_snapshot|non-canonical/i)
    }
    database.close()
  })

  it("persists and reopens canonical provider identities for every engine", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-engine-canonical-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "agents.db")
    let database = createPre0031Database(path)
    applyMigrations(database, [31, 32, 33, 34])
    const identities = {
      workflow: { schemaVersion: 1, engine: "workflow", workflowRunId: "workflow-run-1" },
      "codex-v2": {
        schemaVersion: 1,
        engine: "codex-v2",
        canonicalTaskPath: "/root/review",
        taskName: "Review",
        providerTaskId: null,
      },
      "codex-v1": {
        schemaVersion: 1,
        engine: "codex-v1",
        providerAgentId: "agent-1",
        nickname: null,
      },
    } as const
    for (const engine of ["workflow", "codex-v2", "codex-v1"] as const) {
      seedTaskAndChat(database, `canonical-${engine}`)
      insertRawEngineSnapshot(database, {
        taskId: `canonical-${engine}`,
        engine,
        snapshot: canonicalCapabilitySnapshot(engine),
        identity: identities[engine],
      })
    }
    database.close()

    database = new Database(path)
    const rows = database
      .prepare("SELECT * FROM task_orchestrations ORDER BY task_id")
      .all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => interpretCoordinationEngineSnapshot(row).engine)).toEqual([
      "codex-v1",
      "codex-v2",
      "workflow",
    ])
    database.close()
  })

  it("uses optimistic defaults and rollback changes only future selection", () => {
    const database = createPre0031Database()
    applyMigrations(database, [31, 32, 33, 34])
    const defaults = new CoordinationEngineDefaultsService(database)
    const first = defaults.write({
      scope: { type: "global", id: null },
      engine: "codex-v1",
      expectedVersion: 0,
    })
    expect(() =>
      defaults.write({
        scope: first.scope,
        engine: "workflow",
        expectedVersion: 0,
      }),
    ).toThrow(/version conflict/i)
    const rollback = defaults.write({
      scope: first.scope,
      engine: "workflow",
      expectedVersion: first.version,
    })
    expect(rollback).toMatchObject({ engine: "workflow", version: 2 })
    database.close()
  })

  it.each(["missing", "archived"])("fails closed for %s preview project", (kind) => {
    const database = createPre0031Database()
    applyMigrations(database, [31, 32, 33, 34])
    if (kind === "archived") {
      database.prepare("INSERT INTO projects (id, archived_at) VALUES ('target', 1)").run()
    }
    expect(() =>
      previewCoordinationEngineForProject(database, { projectId: "target" }),
    ).toThrowError(CoordinationEngineError)
    database.close()
  })

  it("keeps 0036 metadata free of removed mobile identity tables", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "drizzle/0036_coordination_engines.sql"),
      "utf8",
    )
    const snapshot = readFileSync(resolve(process.cwd(), "drizzle/meta/0036_snapshot.json"), "utf8")
    for (const forbidden of [
      "mobile_pairing_tokens",
      "mobile_devices",
      "mobile_auth_challenges",
      "mobile_device_sessions",
      "mobile_session_nonces",
    ]) {
      expect(sql).not.toContain(forbidden)
      expect(snapshot).not.toContain(forbidden)
    }
    expect(snapshot).toContain("coordination_engine_defaults")
    expect(snapshot).toContain("agent_activity_events")
  })

  it("chains mobile-free 0037 metadata directly to authoritative 0036", () => {
    const previous = JSON.parse(
      readFileSync(resolve(process.cwd(), "drizzle/meta/0036_snapshot.json"), "utf8"),
    ) as { id: string }
    const current = JSON.parse(
      readFileSync(resolve(process.cwd(), "drizzle/meta/0037_snapshot.json"), "utf8"),
    ) as { prevId: string; tables: Record<string, unknown> }
    expect(current.prevId).toBe(previous.id)
    expect(Object.keys(current.tables)).toHaveLength(56)
    expect(Object.keys(current.tables).some((name) => name.includes("mobile"))).toBe(false)
  })
})

function createPre0031Database(filename = ":memory:"): Database.Database {
  const database = new Database(filename)
  database.pragma("foreign_keys = ON")
  database.exec(`
    CREATE TABLE projects (id text PRIMARY KEY NOT NULL, archived_at integer);
    CREATE TABLE tasks (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      name text NOT NULL,
      archived_at integer
    );
    CREATE TABLE chats (
      id text PRIMARY KEY NOT NULL,
      project_id text,
      archived_at integer
    );
    CREATE TABLE agent_runs (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE task_orchestrations (
      task_id text PRIMARY KEY NOT NULL,
      initiating_chat_id text NOT NULL,
      status text DEFAULT 'queued' NOT NULL,
      max_parallel_agents integer DEFAULT 1 NOT NULL,
      max_depth integer DEFAULT 8 NOT NULL,
      stop_conditions text DEFAULT '{}' NOT NULL,
      stop_reason text,
      blocker_count integer DEFAULT 0 NOT NULL,
      created_at integer,
      updated_at integer,
      started_at integer,
      completed_at integer,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (initiating_chat_id) REFERENCES chats(id) ON DELETE restrict
    );
  `)
  return database
}

function seedTaskAndChat(database: Database.Database, taskId: string): void {
  database
    .prepare("INSERT OR IGNORE INTO projects (id, archived_at) VALUES ('project-1', NULL)")
    .run()
  database
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, 'project-1', ?)")
    .run(taskId, taskId)
  database
    .prepare("INSERT INTO chats (id, project_id) VALUES (?, 'project-1')")
    .run(`${taskId}-chat`)
}

function seedLegacyOrchestration(
  database: Database.Database,
  taskId: string,
  status: string,
): void {
  seedTaskAndChat(database, taskId)
  database
    .prepare(
      `INSERT INTO task_orchestrations
       (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions)
       VALUES (?, ?, ?, 1, 8, '{}')`,
    )
    .run(taskId, `${taskId}-chat`, status)
}

function applyMigrations(database: Database.Database, migrations: number[]): void {
  for (const number of migrations) {
    const name =
      number === 31
        ? "0033_saved_workspaces"
        : number === 32
          ? "0034_agent_runtime"
          : number === 33
            ? "0035_agent_activity"
            : number === 34
              ? "0036_coordination_engines"
              : "0037_multi_agent_operations"
    const sql = readFileSync(resolve(process.cwd(), `drizzle/${name}.sql`), "utf8")
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement)
    }
  }
}

const REQUIRED_CAPABILITIES = {
  workflow: ["durable-workflow", "checkpoints", "mixed-runtimes"],
  "codex-v2": [
    "named-task-paths",
    "selective-context-fork",
    "queued-messages",
    "follow-up",
    "mailbox",
    "interrupt-without-destroy",
    "resident-workers",
  ],
  "codex-v1": ["legacy-agent-ids", "legacy-resume", "legacy-close"],
} as const

function canonicalCapabilitySnapshot(
  engine: CoordinationEngine,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    engine,
    engineVersion: COORDINATION_ENGINE_VERSIONS[engine],
    status: "available",
    capturedAt: "2026-07-14T00:00:00.000Z",
    capabilities: [...REQUIRED_CAPABILITIES[engine]],
    limitations: [],
    unavailableReason: null,
    ...overrides,
  }
}

function insertRawEngineSnapshot(
  database: Database.Database,
  input: {
    taskId: string
    engine: CoordinationEngine
    version?: string
    snapshot: Record<string, unknown>
    identity: unknown
  },
): void {
  database
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
        engine_snapshot_version, coordination_engine, coordination_engine_version,
        coordination_engine_source, coordination_engine_capability_snapshot,
        coordination_engine_provider_identity
      ) VALUES (?, ?, 'queued', 1, 8, '{}', 1, ?, ?, 'per-launch', ?, ?)`,
    )
    .run(
      input.taskId,
      `${input.taskId}-chat`,
      input.engine,
      input.version ?? COORDINATION_ENGINE_VERSIONS[input.engine],
      JSON.stringify(input.snapshot),
      JSON.stringify(input.identity),
    )
}
