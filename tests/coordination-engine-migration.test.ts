import Database from "better-sqlite3"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
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
